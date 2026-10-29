"""Persistent, notification-only market watcher. No trading operations or SDKs."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import smtplib
import sqlite3
import ssl
import time
import uuid
from datetime import datetime, timezone, timedelta
from email.message import EmailMessage
import urllib.request
from urllib.parse import urlsplit
import sms_providers


class WatchError(Exception):
    """Safe error code: never include provider response bodies or credentials."""


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def positive(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise WatchError("INVALID_NUMBER")
    if not math.isfinite(value) or value <= 0:
        raise WatchError("INVALID_NUMBER")
    return float(value)


def utcstamp(value):
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError()
        return parsed.timestamp()
    except (ValueError, TypeError, OverflowError):
        raise WatchError("INVALID_MARKET_TIMESTAMP") from None


def validate_rules(rules):
    if not isinstance(rules, list) or not 1 <= len(rules) <= 20:
        raise WatchError("RULES_REQUIRED")
    ids = set()
    for rule in rules:
        if not isinstance(rule, dict) or not re.fullmatch(r"[a-z0-9_-]{1,48}", str(rule.get("id", ""))):
            raise WatchError("INVALID_RULE_ID")
        if rule["id"] in ids:
            raise WatchError("DUPLICATE_RULE_ID")
        ids.add(rule["id"])
        if rule.get("action") not in ("observe", "buy_reference", "sell_reference"):
            raise WatchError("INVALID_REFERENCE_ACTION")
        if rule.get("type") in ("price_above", "price_below"):
            positive(rule.get("value"))
        elif rule.get("type") not in ("ma_cross_up", "ma_cross_down"):
            raise WatchError("UNSUPPORTED_RULE")
    return rules


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise WatchError("REDIRECT_NOT_ALLOWED")


def endpoint(value, allow_insecure=False):
    url = urlsplit(value)
    if url.username or url.password or url.fragment or not url.hostname:
        raise WatchError("INVALID_ENDPOINT")
    if url.scheme != "https" and not (url.scheme == "http" and (
            url.hostname in ("localhost", "127.0.0.1", "::1") or allow_insecure)):
        raise WatchError("HTTPS_REQUIRED")
    return value


def env_headers(settings):
    result = {}
    for key, name in settings.get("headers_env", {}).items():
        value = os.environ.get(name, "")
        if not value:
            raise WatchError("MISSING_HEADER_ENV")
        result[key] = value
    return result


def post_json(settings, payload, extra_headers=None):
    url = endpoint(settings.get("url", ""), settings.get("allow_insecure_http") is True)
    headers = {"Content-Type": "application/json", **env_headers(settings), **(extra_headers or {})}
    req = urllib.request.Request(url, encode(payload).encode("utf-8"), headers, method="POST")
    return request_json(req, settings)


def request_json(req, settings):
    opener = urllib.request.build_opener(NoRedirect(), *(
        [urllib.request.ProxyHandler({})] if settings.get("use_proxy") is False else []))
    try:
        with opener.open(req, timeout=20) as response:
            raw = response.read(8 * 1024 * 1024 + 1)
            if len(raw) > 8 * 1024 * 1024:
                raise WatchError("RESPONSE_TOO_LARGE")
            return json.loads(raw)
    except WatchError:
        raise
    except Exception:
        raise WatchError("PROVIDER_REQUEST_FAILED") from None


class Market:
    def __init__(self, config):
        self.config = config

    def fetch(self, subscription, now):
        settings = self.config.get("market_etf", self.config.get("market", {})) if subscription.get("asset_type") == "etf" else self.config.get("market", {})
        day = datetime.fromtimestamp(now, timezone.utc)
        payload = post_json(settings, {
            "symbol": subscription["symbol"], "interval": "1d", "adjustment": "forward",
            "startDate": (day - timedelta(days=120)).date().isoformat(),
            "endDate": day.date().isoformat(),
        })
        if not isinstance(payload, dict) or payload.get("ok") is not True:
            raise WatchError("MARKET_RESPONSE_INVALID")
        data = payload.get("data")
        if not isinstance(data, dict) or not isinstance(data.get("bars"), list):
            raise WatchError("MARKET_RESPONSE_INVALID")
        return data["bars"]


def evaluate(subscription, bars, now):
    if not isinstance(bars, list) or not bars:
        raise WatchError("NO_MARKET_DATA")
    points = []
    stamps = set()
    for bar in bars:
        if not isinstance(bar, dict) or bar.get("symbol") != subscription["symbol"]:
            raise WatchError("MARKET_SYMBOL_MISMATCH")
        stamp = utcstamp(bar.get("timestamp"))
        if stamp in stamps or stamp > now + 60:
            raise WatchError("MARKET_TIME_INVALID")
        stamps.add(stamp)
        price = positive(bar.get("close"))
        if bar.get("closed") is False:
            continue
        points.append((stamp, price, bar))
    if not points:
        raise WatchError("NO_CLOSED_BARS")
    points.sort(key=lambda p: p[0])
    stamp, price, latest = points[-1]
    if now - stamp > subscription["max_age_hours"] * 3600:
        raise WatchError("STALE_MARKET_DATA")
    source = latest.get("source")
    if not isinstance(source, dict) or not isinstance(source.get("provider"), str) or not source["provider"].strip():
        raise WatchError("MARKET_SOURCE_REQUIRED")
    rules = json.loads(subscription["rules"])
    outcomes = {}
    for rule in rules:
        kind = rule["type"]
        if kind.startswith("ma_"):
            if len(points) < 20:
                raise WatchError("INSUFFICIENT_BARS")
            fast = sum(p[1] for p in points[-5:]) / 5
            slow = sum(p[1] for p in points[-20:]) / 20
            result = fast > slow if kind == "ma_cross_up" else fast < slow
            detail = {"ma5": fast, "ma20": slow}
        else:
            result = price > rule["value"] if kind == "price_above" else price < rule["value"]
            detail = {"threshold": rule["value"]}
        outcomes[rule["id"]] = {"active": result, **detail}
    return stamp, {"price": price, "as_of": latest["timestamp"],
                   "source": source["provider"], "outcomes": outcomes}


class Store:
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), timeout=30)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS profiles (
            owner TEXT PRIMARY KEY, email TEXT NOT NULL DEFAULT '', sms TEXT NOT NULL DEFAULT '',
            email_enabled INTEGER NOT NULL DEFAULT 0, sms_enabled INTEGER NOT NULL DEFAULT 0);
          CREATE TABLE IF NOT EXISTS subscriptions (
            owner TEXT NOT NULL, id TEXT NOT NULL, symbol TEXT NOT NULL, label TEXT NOT NULL,
            asset_type TEXT NOT NULL,
            notes TEXT NOT NULL, rules TEXT NOT NULL, channels TEXT NOT NULL,
            enabled INTEGER NOT NULL, interval_seconds INTEGER NOT NULL, max_age_hours REAL NOT NULL,
            cooldown_seconds INTEGER NOT NULL, state TEXT NOT NULL DEFAULT '{}',
            last_bar REAL NOT NULL DEFAULT 0, last_alert REAL NOT NULL DEFAULT 0,
            next_poll REAL NOT NULL DEFAULT 0, checked_at REAL NOT NULL DEFAULT 0,
            error TEXT NOT NULL DEFAULT '', revision TEXT NOT NULL, PRIMARY KEY(owner,id));
          CREATE INDEX IF NOT EXISTS subscriptions_due ON subscriptions(owner,enabled,next_poll);
          CREATE TABLE IF NOT EXISTS alerts (
            id TEXT PRIMARY KEY, owner TEXT NOT NULL, subscription_id TEXT NOT NULL,
            evidence TEXT NOT NULL, created REAL NOT NULL, expires REAL NOT NULL);
          CREATE INDEX IF NOT EXISTS alerts_owner ON alerts(owner,created);
          CREATE TABLE IF NOT EXISTS deliveries (
            alert_id TEXT NOT NULL, channel TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
            attempts INTEGER NOT NULL DEFAULT 0, next_attempt REAL NOT NULL DEFAULT 0,
            error TEXT NOT NULL DEFAULT '', PRIMARY KEY(alert_id,channel));
          CREATE INDEX IF NOT EXISTS deliveries_due ON deliveries(state,next_attempt);
        """)

    def profile(self, owner, **updates):
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO profiles(owner) VALUES(?)", (owner,))
            current = dict(self.db.execute("SELECT * FROM profiles WHERE owner=?", (owner,)).fetchone())
            current.update(updates)
            email, sms = current["email"], current["sms"]
            if email and not re.fullmatch(r"[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+", email):
                raise WatchError("INVALID_EMAIL")
            if sms and not re.fullmatch(r"\+[1-9][0-9]{7,14}", sms):
                raise WatchError("INVALID_PHONE")
            if current["email_enabled"] and not email or current["sms_enabled"] and not sms:
                raise WatchError("RECIPIENT_REQUIRED")
            if updates:
                self.db.execute("""UPDATE deliveries SET state='cancelled'
                  WHERE state='pending' AND alert_id IN (SELECT id FROM alerts WHERE owner=?)""", (owner,))
            self.db.execute("UPDATE profiles SET email=?,sms=?,email_enabled=?,sms_enabled=? WHERE owner=?",
                            (email, sms, bool(current["email_enabled"]), bool(current["sms_enabled"]), owner))

    def subscribe(self, owner, spec):
        ident, symbol = spec.get("id", ""), spec.get("symbol", "")
        if not isinstance(ident, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", ident):
            raise WatchError("INVALID_SUBSCRIPTION_ID")
        if not isinstance(symbol, str) or not re.fullmatch(r"[0-9]{6}(?:\.(?:SH|SZ|BJ))?", symbol):
            raise WatchError("INVALID_SYMBOL")
        asset_type = spec.get("asset_type", "stock")
        if asset_type not in ("stock", "etf"):
            raise WatchError("UNSUPPORTED_ASSET_TYPE")
        rules = validate_rules(spec.get("rules"))
        channels = spec.get("channels", [])
        if not isinstance(channels, list) or any(x not in ("email", "sms") for x in channels):
            raise WatchError("INVALID_CHANNEL")
        interval = positive(spec.get("interval_seconds", 900))
        age = positive(spec.get("max_age_hours", 96))
        cooldown = positive(spec.get("cooldown_seconds", 3600))
        if not 60 <= interval <= 86400 or not 1 <= age <= 168 or cooldown > 604800:
            raise WatchError("INVALID_MONITOR_LIMITS")
        if not isinstance(spec.get("enabled", False), bool):
            raise WatchError("INVALID_ENABLED_FLAG")
        with self.db:
            self.cancel_pending(owner, ident)
            self.db.execute("""INSERT OR REPLACE INTO subscriptions
              (owner,id,symbol,label,asset_type,notes,rules,channels,enabled,interval_seconds,max_age_hours,cooldown_seconds,revision)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""", (owner, ident, symbol, str(spec.get("label", symbol))[:160], asset_type,
              str(spec.get("notes", ""))[:4000], encode(rules), encode(sorted(set(channels))),
              spec.get("enabled", False), int(interval), age, int(cooldown), uuid.uuid4().hex))

    def cancel_pending(self, owner, ident):
        self.db.execute("""UPDATE deliveries SET state='cancelled' WHERE state='pending'
          AND alert_id IN (SELECT id FROM alerts WHERE owner=? AND subscription_id=?)""", (owner, ident))

    def change(self, owner, ident, action):
        with self.db:
            if not self.db.execute("SELECT 1 FROM subscriptions WHERE owner=? AND id=?", (owner, ident)).fetchone():
                raise WatchError("SUBSCRIPTION_NOT_FOUND")
            self.cancel_pending(owner, ident)
            if action == "unsubscribe":
                self.db.execute("DELETE FROM subscriptions WHERE owner=? AND id=?", (owner, ident))
            else:
                self.db.execute("""UPDATE subscriptions SET enabled=?,state='{}',last_bar=0,next_poll=0,error='',revision=?
                  WHERE owner=? AND id=?""", (action == "resume", uuid.uuid4().hex, owner, ident))

    def subscriptions(self, owner):
        return [dict(r) for r in self.db.execute("SELECT * FROM subscriptions WHERE owner=? ORDER BY id", (owner,))]

    def alerts(self, owner):
        return [dict(r) for r in self.db.execute("""SELECT a.*,d.channel,d.state,d.attempts,d.error
          FROM alerts a LEFT JOIN deliveries d ON d.alert_id=a.id WHERE a.owner=?
          ORDER BY a.created DESC LIMIT 200""", (owner,))]

    def poll(self, owner, market, now=None):
        now = time.time() if now is None else now
        # Claim due work by advancing next_poll in a write transaction; concurrent workers skip it.
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            due = [dict(r) for r in self.db.execute("""SELECT * FROM subscriptions
              WHERE owner=? AND enabled=1 AND next_poll<=?""", (owner, now))]
            for sub in due:
                self.db.execute("UPDATE subscriptions SET next_poll=? WHERE owner=? AND id=?",
                                (now + sub["interval_seconds"], owner, sub["id"]))
        for sub in due:
            try:
                stamp, evidence = evaluate(sub, market.fetch(sub, now), now)
                with self.db:
                    self.db.execute("BEGIN IMMEDIATE")
                    current = self.db.execute("SELECT * FROM subscriptions WHERE owner=? AND id=?", (owner, sub["id"])).fetchone()
                    # A paused/deleted/edited subscription must never be resurrected by an in-flight fetch.
                    if not current or not current["enabled"] or current["revision"] != sub["revision"]:
                        continue
                    sub = dict(current)
                    if stamp < sub["last_bar"]:
                        raise WatchError("MARKET_TIME_REGRESSION")
                    previous = json.loads(sub["state"])
                    if stamp > sub["last_bar"]:
                        pending = self.db.execute("""SELECT a.id,a.evidence FROM alerts a JOIN deliveries d ON d.alert_id=a.id
                          WHERE a.owner=? AND a.subscription_id=? AND d.state='pending'""", (owner, sub["id"])).fetchall()
                        for old in pending:
                            rule_id = json.loads(old["evidence"])["rule"]["id"]
                            if not evidence["outcomes"].get(rule_id, {}).get("active", False):
                                self.db.execute("UPDATE deliveries SET state='cancelled' WHERE alert_id=? AND state='pending'", (old["id"],))
                        triggered = [r for r in json.loads(sub["rules"]) if previous
                                     and not previous.get(r["id"], {}).get("active", False)
                                     and evidence["outcomes"][r["id"]]["active"]]
                        if triggered and now - sub["last_alert"] >= sub["cooldown_seconds"]:
                            self.cancel_pending(owner, sub["id"])
                            for rule in triggered:
                                event = {"symbol": sub["symbol"], "label": sub["label"], "rule": rule,
                                         "evidence": evidence, "reference_only": True}
                                key = hashlib.sha256(encode([owner, sub["id"], sub["revision"], rule, stamp]).encode()).hexdigest()
                                self.db.execute("INSERT OR IGNORE INTO alerts VALUES(?,?,?,?,?,?)",
                                                (key, owner, sub["id"], encode(event), now, now + 21600))
                                for channel in json.loads(sub["channels"]):
                                    self.db.execute("INSERT OR IGNORE INTO deliveries(alert_id,channel) VALUES(?,?)", (key, channel))
                            self.db.execute("UPDATE subscriptions SET last_alert=? WHERE owner=? AND id=?", (now, owner, sub["id"]))
                        self.db.execute("UPDATE subscriptions SET state=?,last_bar=? WHERE owner=? AND id=?",
                                        (encode(evidence["outcomes"]), stamp, owner, sub["id"]))
                    self.db.execute("UPDATE subscriptions SET checked_at=?,error='' WHERE owner=? AND id=?", (now, owner, sub["id"]))
            except Exception as exc:
                code = str(exc) if isinstance(exc, WatchError) else "MONITOR_FAILED"
                with self.db:
                    self.db.execute("UPDATE subscriptions SET checked_at=?,error=? WHERE owner=? AND id=? AND revision=?",
                                    (now, code, owner, sub["id"], sub["revision"]))
        return len(due)

    def deliver(self, owner, transport, now=None):
        now = time.time() if now is None else now
        count = 0
        # Serialize delivery and subscription edits. Bounded I/O; crash-after-send is at-least-once.
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            rows = self.db.execute("""SELECT a.*, d.channel,d.attempts FROM deliveries d JOIN alerts a ON a.id=d.alert_id
              WHERE a.owner=? AND d.state='pending' AND d.next_attempt<=? ORDER BY a.created LIMIT 20""", (owner, now)).fetchall()
            profile = self.db.execute("SELECT * FROM profiles WHERE owner=?", (owner,)).fetchone()
            for row in rows:
                sub = self.db.execute("SELECT * FROM subscriptions WHERE owner=? AND id=?", (owner, row["subscription_id"])).fetchone()
                state, error = "accepted", ""
                if not sub or not sub["enabled"] or not profile or not profile[row["channel"] + "_enabled"]:
                    state = "cancelled"
                elif row["expires"] <= now:
                    state = "expired"
                elif sub["error"] or now - sub["checked_at"] > max(300, sub["interval_seconds"] * 2):
                    continue
                else:
                    try:
                        transport.send(row["channel"], profile[row["channel"]], json.loads(row["evidence"]), row["id"])
                        count += 1
                    except Exception as exc:
                        state = "failed" if row["attempts"] + 1 >= 3 else "pending"
                        error = str(exc) if isinstance(exc, WatchError) else "DELIVERY_FAILED"
                self.db.execute("""UPDATE deliveries SET state=?,attempts=attempts+?,next_attempt=?,error=?
                  WHERE alert_id=? AND channel=?""", (state, int(state not in ("cancelled", "expired")),
                  now + 60 * 2 ** row["attempts"], error, row["id"], row["channel"]))
        return count


def message(event, event_id):
    rule, evidence = event["rule"], event["evidence"]
    action = {"observe": "观察提醒", "buy_reference": "买入参考", "sell_reference": "卖出参考"}[rule["action"]]
    return (f"{action}：{event['label']} ({event['symbol']})\n"
            f"用户规则 {rule['id']} / {rule['type']} 由不成立变为成立。\n"
            f"价格：{evidence['price']}；数据时间：{evidence['as_of']}；来源：{evidence['source']}\n"
            f"规则证据：{encode(evidence['outcomes'][rule['id']])}\n"
            f"仅供参考，不预测收益，不执行任何买卖。事件：{event_id}\n"
            "可通过 stock-watch-alerts 的 pause/unsubscribe 命令暂停或退订。")


class Transport:
    def __init__(self, config):
        self.config = config

    def send(self, channel, recipient, event, event_id):
        body = message(event, event_id)
        if channel == "email":
            cfg = self.smtp_config()
            if not cfg.get("host") or not cfg.get("from"):
                raise WatchError("SMTP_NOT_CONFIGURED")
            mail = EmailMessage()
            mail["From"], mail["To"] = cfg["from"], recipient
            mail["Subject"] = "BRAIN 标的关注参考提醒"
            mail["Message-ID"] = f"<{event_id}@brain-watch.local>"
            mail.set_content(body)
            password = os.environ.get(cfg.get("password_env", ""), "")
            if cfg.get("username") and not password:
                raise WatchError("SMTP_PASSWORD_MISSING")
            mode = cfg.get("security", "ssl")
            if mode not in ("ssl", "starttls"):
                raise WatchError("SMTP_TLS_REQUIRED")
            cls = smtplib.SMTP_SSL if mode == "ssl" else smtplib.SMTP
            args = {"timeout": 20}
            if mode == "ssl":
                args["context"] = ssl.create_default_context()
            with cls(cfg["host"], int(cfg.get("port", 465 if mode == "ssl" else 587)), **args) as client:
                if mode == "starttls":
                    client.starttls(context=ssl.create_default_context())
                if cfg.get("username"):
                    client.login(cfg["username"], password)
                if client.send_message(mail):
                    raise WatchError("SMTP_RECIPIENT_REFUSED")
        elif channel == "sms":
            cfg = self.config.get("sms", {})
            if cfg.get("provider") in ("aliyun-sms", "baidu-sms"):
                try:
                    sms_providers.send(cfg, recipient, event, event_id, lambda req: request_json(req, cfg))
                except ValueError as exc:
                    raise WatchError(str(exc)) from None
                return
            if not cfg.get("url"):
                raise WatchError("SMS_NOT_CONFIGURED")
            response = post_json(cfg, {"to": recipient, "message": body, "event_id": event_id},
                                 {"Idempotency-Key": event_id})
            if not isinstance(response, dict) or response.get("accepted") is not True:
                raise WatchError("SMS_NOT_ACCEPTED")
        else:
            raise WatchError("INVALID_CHANNEL")

    def smtp_config(self):
        cfg = dict(self.config.get("smtp", {}))
        if not cfg.pop("reuse_project_mail_env", False):
            return cfg
        def value(*names):
            return next((os.environ[n] for n in names if os.environ.get(n)), "")
        def flag(*names):
            return value(*names).lower() in ("true", "1", "yes")
        ssl_enabled = flag("APP_MAIL_SMTP_SSL_ENABLE", "SPRING_MAIL_PROPERTIES_MAIL_SMTP_SSL_ENABLE")
        tls_enabled = flag("APP_MAIL_SMTP_STARTTLS_ENABLE", "SPRING_MAIL_PROPERTIES_MAIL_SMTP_STARTTLS_ENABLE")
        security = "ssl" if ssl_enabled else "starttls" if tls_enabled else "unconfigured"
        defaults = {
            "host": value("APP_MAIL_HOST", "SPRING_MAIL_HOST"),
            "port": value("APP_MAIL_PORT", "SPRING_MAIL_PORT") or (465 if ssl_enabled else 587),
            "username": value("APP_MAIL_USERNAME", "SPRING_MAIL_USERNAME"),
            "from": value("APP_AUTH_LOGIN_CODE_FROM", "APP_MAIL_FROM", "APP_MAIL_USERNAME", "SPRING_MAIL_USERNAME"),
            "password_env": "APP_MAIL_PASSWORD" if os.environ.get("APP_MAIL_PASSWORD") else "SPRING_MAIL_PASSWORD",
            "security": security,
        }
        return {**defaults, **cfg}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, help="User-owned SQLite file; keep outside the source repository")
    parser.add_argument("--user", required=True, help="Stable local user ID, not an authentication credential")
    parser.add_argument("--config", help="JSON provider settings; secrets are environment references")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("check")
    profile = commands.add_parser("profile")
    profile.add_argument("--email")
    profile.add_argument("--sms")
    for channel in ("email", "sms"):
        group = profile.add_mutually_exclusive_group()
        group.add_argument("--enable-" + channel, dest=channel + "_enabled", action="store_const", const=True, default=None)
        group.add_argument("--disable-" + channel, dest=channel + "_enabled", action="store_const", const=False)
    sub = commands.add_parser("subscribe")
    sub.add_argument("--file", required=True, help="Subscription JSON approved by the user")
    for name in ("pause", "resume", "unsubscribe"):
        commands.add_parser(name).add_argument("id")
    for name in ("list", "status", "alerts", "poll"):
        commands.add_parser(name)
    commands.add_parser("dispatch").add_argument("--deliver", action="store_true", required=True)
    run = commands.add_parser("run")
    run.add_argument("--deliver", action="store_true", help="Opt in to real external notification delivery")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", args.user):
        raise WatchError("INVALID_USER_ID")
    config = json.loads(Path(args.config).read_text(encoding="utf-8-sig")) if args.config else {}
    store = Store(args.db)
    try:
        if args.command == "profile":
            updates = {k: getattr(args, k) for k in ("email", "sms", "email_enabled", "sms_enabled") if getattr(args, k) is not None}
            store.profile(args.user, **updates)
        elif args.command == "subscribe":
            store.subscribe(args.user, json.loads(Path(args.file).read_text(encoding="utf-8-sig")))
        elif args.command in ("pause", "resume", "unsubscribe"):
            store.change(args.user, args.id, args.command)
        elif args.command in ("list", "status"):
            print(encode(store.subscriptions(args.user)))
        elif args.command == "alerts":
            print(encode(store.alerts(args.user)))
        elif args.command == "check":
            endpoint(config.get("market", {}).get("url", ""), config.get("market", {}).get("allow_insecure_http") is True)
            env_headers(config["market"])
            print(encode({"configuration_valid": True, "network_checked": False, "delivery_enabled": False}))
        elif args.command == "poll":
            print(encode({"checked": store.poll(args.user, Market(config)), "delivery_enabled": False}))
        elif args.command == "dispatch":
            print(encode({"accepted": store.deliver(args.user, Transport(config))}))
        elif args.command == "run":
            print(encode({"monitor": "running", "delivery_enabled": args.deliver}), flush=True)
            while True:
                store.poll(args.user, Market(config))
                if args.deliver:
                    store.deliver(args.user, Transport(config))
                time.sleep(10)
    finally:
        store.db.close()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print('{"monitor":"stopped"}')
    except Exception as error:
        print(encode({"error": str(error) if isinstance(error, WatchError) else "COMMAND_FAILED"}))
        raise SystemExit(1)
