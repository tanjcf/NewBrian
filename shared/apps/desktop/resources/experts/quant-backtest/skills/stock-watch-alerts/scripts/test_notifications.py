"""Provider contract checks with fake credentials and no external I/O."""
import json
import os
import unittest
from urllib.parse import urlsplit, parse_qs
from unittest.mock import patch

import sms_providers
from watch import Transport


class NotificationTests(unittest.TestCase):
    def setUp(self):
        self.config = {"provider":"aliyun-sms", "notification_template_confirmed":True,
                       "notification_template_code":"notification-only", "access_key_env":"TEST_SMS_AK",
                       "access_secret_env":"TEST_SMS_SK", "secret_key_env":"TEST_SMS_SK",
                       "sign_name":"测试通知", "signature":"signature-test"}
        self.event = {"symbol":"510300", "label":"测试 ETF", "rule":{"id":"cross", "action":"observe"},
                      "evidence":{"price":3.5, "as_of":"2026-09-21T07:00:00Z", "source":"test-fixture"}}
        self.env = patch.dict(os.environ, {"TEST_SMS_AK":"fake-ak", "TEST_SMS_SK":"fake-sk"}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_aliyun_notification_contract(self):
        seen = []
        sms_providers.send(self.config, "+8613800000000", self.event, "a"*64,
                           lambda req: seen.append(req) or {"Code":"OK"})
        self.assertEqual(len(seen), 1)
        req = seen[0]
        self.assertEqual(urlsplit(req.full_url).hostname, "dysmsapi.aliyuncs.com")
        params = parse_qs(urlsplit(req.full_url).query)
        self.assertEqual(params["Action"], ["SendSms"])
        self.assertEqual(params["TemplateCode"], ["notification-only"])
        self.assertIn("Signature", params)
        variables = json.loads(params["TemplateParam"][0])
        self.assertNotIn("code", variables)
        self.assertEqual(variables["symbol"], "510300")
        self.assertEqual(variables["action"], "观察提醒")
        self.assertNotIn("fake-sk", req.full_url)

    def test_baidu_v3_contract_signed_request_and_item_receipt(self):
        self.config["provider"] = "baidu-sms"
        seen = []
        def receive(req):
            seen.append(req)
            return {"code":"1000", "data":[{"mobile":"13800000000", "code":"1000"}]}
        sms_providers.send(self.config, "+8613800000000", self.event, "b"*64, receive)
        self.assertEqual(len(seen), 1)  # No unrelated OAuth endpoint.
        req = seen[0]
        self.assertEqual(req.get_method(), "POST")
        self.assertEqual(urlsplit(req.full_url).path, "/api/v3/sendSms")
        self.assertEqual(parse_qs(urlsplit(req.full_url).query)["clientToken"], ["b"*64])
        body = json.loads(req.data)
        self.assertEqual(body["template"], "notification-only")
        self.assertEqual(body["contentVar"]["symbol"], "510300")
        self.assertTrue(req.get_header("Authorization").startswith("bce-auth-v1/fake-ak/"))
        self.assertIn("/host;x-bce-date/", req.get_header("Authorization"))
        self.assertNotIn("fake-sk", str(req.headers))
        with self.assertRaisesRegex(ValueError, "BAIDU_SMS_NOT_ACCEPTED"):
            sms_providers.send(self.config, "+8613800000000", self.event, "b"*64,
                               lambda req: {"code":"1000", "data":[{"mobile":"13800000000", "code":"2000"}]})

    def test_unconfirmed_template_missing_context_or_secret_never_sends(self):
        def forbidden(req):
            self.fail("Network must not be called")
        for changes in ({"notification_template_confirmed":False}, {"template_variables":{"code":"price"}},
                        {"access_key_env":"MISSING_ENV"}, {"notification_template_code":""}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                sms_providers.send({**self.config, **changes}, "+8613800000000", self.event, "id", forbidden)

    def test_provider_errors_are_sanitized(self):
        with self.assertRaisesRegex(ValueError, "^ALIYUN_SMS_NOT_ACCEPTED$"):
            sms_providers.send(self.config, "+8613800000000", self.event, "id",
                               lambda req: {"Code":"ERROR", "Message":"secret upstream response"})

    def test_existing_mail_environment_reuse_and_explicit_override(self):
        with patch.dict(os.environ, {"APP_MAIL_HOST":"smtp.test", "APP_MAIL_PORT":"587",
                "APP_MAIL_USERNAME":"sender@example.test", "APP_MAIL_PASSWORD":"fake-password",
                "APP_MAIL_SMTP_STARTTLS_ENABLE":"true", "APP_AUTH_LOGIN_CODE_FROM":"notice@example.test"}):
            cfg = Transport({"smtp":{"reuse_project_mail_env":True}}).smtp_config()
            self.assertEqual(cfg["host"], "smtp.test")
            self.assertEqual(cfg["security"], "starttls")
            self.assertEqual(cfg["from"], "notice@example.test")
            self.assertEqual(cfg["password_env"], "APP_MAIL_PASSWORD")
            self.assertNotIn("fake-password", str(cfg))
            overridden = Transport({"smtp":{"reuse_project_mail_env":True, "host":"override.test"}}).smtp_config()
            self.assertEqual(overridden["host"], "override.test")
        self.assertEqual(Transport({"smtp":{"reuse_project_mail_env":True}}).smtp_config()["security"], "unconfigured")


if __name__ == "__main__":
    unittest.main()
