"""Notification-template adapters matching token-system's existing SMS providers.

Login OTP templates and code generation are deliberately not used.
Credentials stay in environment variables owned by the deployment operator.
"""
import base64
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
import re
from urllib.parse import quote, urlencode
from urllib.request import Request
import uuid


def required(config, key):
    value = config.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError("SMS_NOTIFICATION_CONFIG_MISSING")
    return value.strip()


def secret(config, key):
    name = required(config, key)
    value = os.environ.get(name, "")
    if not value:
        raise ValueError("SMS_CREDENTIAL_ENV_MISSING")
    return value


def parameters(config, event, event_id):
    # The approved notification template must itself contain the reference-only disclaimer.
    if config.get("notification_template_confirmed") is not True:
        raise ValueError("SMS_NOTIFICATION_TEMPLATE_REQUIRED")
    values = {
        "symbol": event["symbol"], "label": event["label"],
        "action": {"buy_reference":"买入参考", "sell_reference":"卖出参考", "observe":"观察提醒"}[event["rule"]["action"]],
        "price": str(event["evidence"]["price"]), "time": event["evidence"]["as_of"],
        "rule": event["rule"]["id"], "source":event["evidence"]["source"], "event_id":event_id,
    }
    required_fields = ("symbol", "action", "price", "time", "rule", "source", "event_id")
    mapping = config.get("template_variables", {key:key for key in required_fields})
    if not isinstance(mapping, dict) or not mapping or any(v not in values for v in mapping.values()):
        raise ValueError("SMS_TEMPLATE_VARIABLES_INVALID")
    if not all(k in mapping.values() for k in required_fields):
        raise ValueError("SMS_TEMPLATE_CONTEXT_REQUIRED")
    return {key: values[field] for key, field in mapping.items()}


def send(config, phone, event, event_id, request_json):
    if not re.fullmatch(r"\+861[0-9]{10}", phone):
        raise ValueError("SMS_A_SHARE_CN_PHONE_REQUIRED")
    mobile = phone[3:]
    template = required(config, "notification_template_code")
    content = json.dumps(parameters(config, event, event_id), ensure_ascii=False, separators=(",", ":"))
    provider = config.get("provider")
    if provider == "aliyun-sms":
        values = {
            "AccessKeyId": secret(config, "access_key_env"), "Action": "SendSms", "Format": "JSON",
            "PhoneNumbers": mobile, "SignatureMethod": "HMAC-SHA1", "SignatureNonce": uuid.uuid4().hex,
            "SignatureVersion": "1.0", "SignName": required(config, "sign_name"),
            "TemplateCode": template, "TemplateParam": content, "OutId": event_id[:32],
            "Timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "Version": "2017-05-25",
        }
        canonical = "&".join(quote(k, safe="~") + "=" + quote(v, safe="~") for k,v in sorted(values.items()))
        signing = "GET&%2F&" + quote(canonical, safe="~")
        key = secret(config, "access_secret_env") + "&"
        values["Signature"] = base64.b64encode(hmac.new(key.encode(), signing.encode(), hashlib.sha1).digest()).decode()
        response = request_json(Request("https://dysmsapi.aliyuncs.com/?" + urlencode(values, quote_via=quote)))
        if not isinstance(response, dict) or response.get("Code") != "OK":
            raise ValueError("ALIYUN_SMS_NOT_ACCEPTED")
    elif provider == "baidu-sms":
        region = config.get("region", "bj")
        if not isinstance(region, str) or not re.fullmatch(r"[a-z0-9-]{1,24}", region):
            raise ValueError("BAIDU_REGION_INVALID")
        host = f"smsv3.{region}.baidubce.com"
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        prefix = f"bce-auth-v1/{secret(config, 'access_key_env')}/{stamp}/1800"
        query = urlencode({"clientToken": event_id}, quote_via=quote)
        canonical = f"POST\n/api/v3/sendSms\n{query}\nhost:{host}\nx-bce-date:{quote(stamp, safe='~')}"
        signing_key = hmac.new(secret(config, "secret_key_env").encode(), prefix.encode(), hashlib.sha256).hexdigest()
        signature = hmac.new(signing_key.encode(), canonical.encode(), hashlib.sha256).hexdigest()
        body = json.dumps({"mobile":mobile, "template":template, "signatureId":required(config, "signature"),
                           "contentVar":json.loads(content), "custom":event_id}, ensure_ascii=False).encode()
        response = request_json(Request(f"https://{host}/api/v3/sendSms?{query}", data=body, headers={
            "Content-Type":"application/json", "Host":host, "x-bce-date":stamp,
            "Authorization":f"{prefix}/host;x-bce-date/{signature}"}, method="POST"))
        accepted = isinstance(response, dict) and str(response.get("code")) == "1000"
        rows = response.get("data") if accepted else None
        if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict) or (
                rows[0].get("mobile") != mobile or str(rows[0].get("code")) != "1000"):
            raise ValueError("BAIDU_SMS_NOT_ACCEPTED")
    else:
        raise ValueError("SMS_PROVIDER_UNSUPPORTED")
