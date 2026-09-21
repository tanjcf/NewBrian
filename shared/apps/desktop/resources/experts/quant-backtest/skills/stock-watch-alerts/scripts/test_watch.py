"""Behavior tests use isolated SQLite files and fake providers, never live recipients."""
from datetime import datetime, timezone
import json
import tempfile
import unittest
import threading
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from watch import Store, WatchError, evaluate, message, Transport, Market

NOW = 1800000000


def bars(price=90, end=NOW):
    return [{"symbol": "600519", "close": price,
             "timestamp": datetime.fromtimestamp(end - (20-i)*86400, timezone.utc).isoformat(),
             "source": {"provider": "test-fixture"}} for i in range(21)]


def spec():
    return {"id": "maotai", "symbol": "600519", "label": "贵州茅台", "notes": "长期关注",
            "enabled": True, "channels": ["email", "sms"], "interval_seconds": 60,
            "cooldown_seconds": 60, "rules": [
                {"id": "above", "type": "price_above", "value": 100, "action": "sell_reference"}]}


class FakeMarket:
    def __init__(self, value):
        self.value = value

    def fetch(self, sub, now):
        return self.value


class Recorder:
    def __init__(self, fail=False):
        self.calls = []
        self.fail = fail

    def send(self, *args):
        if self.fail:
            raise RuntimeError("secret should never reach database")
        self.calls.append(args)


class WatchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "watch.db"
        self.store = Store(self.path)
        self.store.profile("alice", email="alice@example.test", sms="+8613800000000", email_enabled=True, sms_enabled=True)
        self.store.subscribe("alice", spec())

    def tearDown(self):
        self.store.db.close()
        self.tmp.cleanup()

    def trigger(self):
        self.store.poll("alice", FakeMarket(bars()), NOW)
        self.store.poll("alice", FakeMarket(bars(110, NOW + 86400)), NOW + 86400)

    def test_remembers_across_restart_and_isolates_users(self):
        self.store.db.close()
        self.store = Store(self.path)
        self.assertEqual(self.store.subscriptions("alice")[0]["notes"], "长期关注")
        self.assertEqual(self.store.subscriptions("bob"), [])
        with self.assertRaises(WatchError):
            self.store.change("bob", "maotai", "unsubscribe")

    def test_baseline_no_send_transition_and_same_bar_dedupe(self):
        self.store.poll("alice", FakeMarket(bars()), NOW)
        self.assertEqual(self.store.alerts("alice"), [])
        self.store.poll("alice", FakeMarket(bars(110, NOW+86400)), NOW+86400)
        self.store.poll("alice", FakeMarket(bars(110, NOW+86400)), NOW+86500)
        self.assertEqual(len(self.store.alerts("alice")), 2)  # one event, two channels
        sink = Recorder()
        self.assertEqual(self.store.deliver("alice", sink, NOW+86500), 2)
        self.assertEqual(self.store.deliver("alice", sink, NOW+86501), 0)
        self.assertEqual({c[1] for c in sink.calls}, {"alice@example.test", "+8613800000000"})
        self.assertTrue(all(c[2]["reference_only"] for c in sink.calls))

    def test_stale_bad_symbol_bad_price_and_future_never_alert(self):
        self.store.poll("alice", FakeMarket(bars()), NOW)
        values = [bars(110, NOW-10*86400), bars(110, NOW+2*86400)]
        wrong = bars(110); wrong[-1]["symbol"] = "OTHER"; values.append(wrong)
        invalid = bars(110); invalid[-1]["close"] = float("nan"); values.append(invalid)
        for i, value in enumerate(values):
            self.store.poll("alice", FakeMarket(value), NOW + (i+1)*100)
            self.assertTrue(self.store.subscriptions("alice")[0]["error"])
        self.assertEqual(self.store.alerts("alice"), [])

    def test_pause_and_unsubscribe_cancel_pending(self):
        for action in ("pause", "unsubscribe"):
            self.store.subscribe("alice", spec())
            self.trigger()
            self.store.change("alice", "maotai", action)
            sink = Recorder()
            self.assertEqual(self.store.deliver("alice", sink, NOW+86400), 0)
            self.assertFalse(sink.calls)

    def test_resume_rebaselines_without_old_signal(self):
        self.trigger()
        self.store.change("alice", "maotai", "pause")
        self.store.change("alice", "maotai", "resume")
        self.store.poll("alice", FakeMarket(bars(110, NOW+86500)), NOW+86500)
        self.assertEqual(self.store.deliver("alice", Recorder(), NOW+86500), 0)

    def test_retries_are_bounded_and_do_not_leak_errors(self):
        self.trigger()
        sink = Recorder(fail=True)
        for offset in (0, 61, 182, 500):
            self.store.deliver("alice", sink, NOW+86400+offset)
        rows = self.store.alerts("alice")
        self.assertTrue(all(r["state"] == "failed" and r["attempts"] == 3 for r in rows))
        self.assertNotIn("secret", str(rows))

    def test_expired_and_revoked_notifications_not_sent(self):
        self.trigger()
        self.assertEqual(self.store.deliver("alice", Recorder(), NOW+86400+21601), 0)
        self.assertTrue(all(r["state"] == "expired" for r in self.store.alerts("alice")))
        self.store.subscribe("alice", spec()); self.trigger()
        self.store.profile("alice", email_enabled=False, sms_enabled=False)
        self.assertEqual(self.store.deliver("alice", Recorder(), NOW+86400), 0)

    def test_new_market_failure_blocks_pending_delivery(self):
        self.trigger()
        self.store.poll("alice", FakeMarket([]), NOW+86500)
        self.assertEqual(self.store.deliver("alice", Recorder(), NOW+86500), 0)

    def test_signal_reversal_cancels_obsolete_reference(self):
        self.trigger()
        self.store.poll("alice", FakeMarket(bars(90, NOW+86500)), NOW+86500)
        self.assertEqual(self.store.deliver("alice", Recorder(), NOW+86500), 0)

    def test_inflight_edit_does_not_apply_old_quote(self):
        store = self.store
        class EditingMarket:
            def fetch(self, sub, now):
                store.change("alice", "maotai", "pause")
                store.change("alice", "maotai", "resume")
                return bars()
        self.store.poll("alice", EditingMarket(), NOW)
        self.assertEqual(self.store.subscriptions("alice")[0]["last_bar"], 0)

    def test_concurrent_poll_claim_is_exclusive(self):
        other = Store(self.path)
        try:
            store = self.store
            class ConcurrentMarket:
                def fetch(self, sub, now):
                    assert other.poll("alice", FakeMarket(bars()), now) == 0
                    return bars()
            self.assertEqual(store.poll("alice", ConcurrentMarket(), NOW), 1)
        finally:
            other.db.close()

    def test_ma_rules_cross_only_after_baseline(self):
        item = spec()
        item["rules"] = [{"id":"cross", "type":"ma_cross_up", "action":"buy_reference"}]
        self.store.subscribe("alice", item)
        initial = bars(100)
        for p in initial[-5:]: p["close"] = 90
        self.store.poll("alice", FakeMarket(initial), NOW)
        nxt = bars(100, NOW+86400)
        for p in nxt[-5:]: p["close"] = 110
        self.store.poll("alice", FakeMarket(nxt), NOW+86400)
        self.assertEqual(len(self.store.alerts("alice")), 2)
        event = json.loads(self.store.alerts("alice")[0]["evidence"])
        self.assertIn("买入参考", message(event, "test"))

    def test_missing_source_and_naive_timestamp_rejected(self):
        sub = self.store.subscriptions("alice")[0]
        values = bars(); values[-1]["source"] = {}
        with self.assertRaisesRegex(WatchError, "SOURCE"):
            evaluate(sub, values, NOW)
        values = bars(); values[-1]["timestamp"] = "2027-01-15T00:00:00"
        with self.assertRaisesRegex(WatchError, "TIMESTAMP"):
            evaluate(sub, values, NOW)

    def test_invalid_rules_are_atomic_and_no_trading_actions(self):
        item = spec(); item["rules"][0]["action"] = "buy"
        with self.assertRaises(WatchError): self.store.subscribe("alice", item)
        self.assertEqual(len(self.store.subscriptions("alice")), 1)

    def test_market_contract_and_sms_gateway_receipt(self):
        with patch("watch.post_json", return_value={"ok":True,"data":{"bars":bars()}}) as call:
            self.assertEqual(len(Market({"market":{}}).fetch(spec(), NOW)), 21)
            self.assertEqual(call.call_args[0][1]["symbol"], "600519")
        self.trigger()
        event = json.loads(self.store.alerts("alice")[0]["evidence"])
        with patch("watch.post_json", return_value={"accepted":True}) as call:
            Transport({"sms":{"url":"https://sms.example.test"}}).send("sms", "+8613800000000", event, "event1")
            self.assertEqual(call.call_args[0][2]["Idempotency-Key"], "event1")
        with patch("watch.post_json", return_value={"accepted":False}):
            with self.assertRaises(WatchError):
                Transport({"sms":{"url":"https://sms.example.test"}}).send("sms", "+8613800000000", event, "event1")

    def test_etf_provider_routing_and_persistence(self):
        item = spec(); item.update(symbol="510300", asset_type="etf")
        self.store.subscribe("alice", item)
        sub = self.store.subscriptions("alice")[0]
        self.assertEqual(sub["asset_type"], "etf")
        config = {"market":{"url":"https://stocks.example.test"}, "market_etf":{"url":"https://etfs.example.test"}}
        with patch("watch.post_json", return_value={"ok":True,"data":{"bars":[]}}) as call:
            Market(config).fetch(sub, NOW)
            self.assertEqual(call.call_args[0][0]["url"], "https://etfs.example.test")
            self.assertEqual(call.call_args[0][1]["symbol"], "510300")

    def test_smtp_tls_message_and_failure(self):
        self.trigger()
        event = json.loads(self.store.alerts("alice")[0]["evidence"])
        cfg = {"smtp":{"host":"smtp.example.test","from":"sender@example.test","security":"ssl"}}
        with patch("watch.smtplib.SMTP_SSL") as client:
            client.return_value.__enter__.return_value.send_message.return_value = {}
            Transport(cfg).send("email", "alice@example.test", event, "event1")
            mail = client.return_value.__enter__.return_value.send_message.call_args[0][0]
            self.assertEqual(mail["To"], "alice@example.test")
            self.assertIn("仅供参考", mail.get_content())
            self.assertIn("context", client.call_args.kwargs)
        cfg["smtp"]["security"] = "none"
        with self.assertRaisesRegex(WatchError, "TLS"):
            Transport(cfg).send("email", "alice@example.test", event, "event1")

    def test_local_http_end_to_end_market_queue_and_sms(self):
        captured = []
        feed = {"bars":bars()}
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                captured.append((self.path, data, self.headers.get("Idempotency-Key")))
                response = {"ok":True,"data":feed} if self.path == "/bars" else {"accepted":True}
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(response).encode())
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True); worker.start()
        try:
            url = f"http://127.0.0.1:{server.server_port}"
            config = {"market":{"url":url+"/bars","use_proxy":False}, "sms":{"url":url+"/sms","use_proxy":False}}
            item = spec(); item["channels"] = ["sms"]
            self.store.subscribe("alice", item)
            self.store.poll("alice", Market(config), NOW)
            feed["bars"] = bars(110, NOW+86400)
            self.store.poll("alice", Market(config), NOW+86400)
            self.assertEqual(self.store.deliver("alice", Transport(config), NOW+86400), 1)
            self.assertEqual([c[0] for c in captured], ["/bars","/bars","/sms"])
            self.assertEqual(captured[-1][1]["to"], "+8613800000000")
            self.assertTrue(captured[-1][2])
            self.assertIn("不执行任何买卖", captured[-1][1]["message"])
        finally:
            server.shutdown(); server.server_close(); worker.join()

    def test_cli_subscription_and_monitor_process(self):
        item = spec(); item["enabled"] = False
        data_file = Path(self.tmp.name) / "subscription.json"
        data_file.write_text(json.dumps(item), encoding="utf-8")
        command = [sys.executable, "-X", "utf8", str(Path(__file__).with_name("watch.py")),
                   "--db", str(self.path), "--user", "cli-user"]
        subprocess.run(command + ["subscribe", "--file", str(data_file)], check=True, capture_output=True)
        result = subprocess.run(command + ["list"], check=True, capture_output=True, encoding="utf-8")
        self.assertEqual(json.loads(result.stdout)[0]["symbol"], "600519")
        # Paused subscription: exercise the real polling loop without network or notifications.
        process = subprocess.Popen(command + ["run"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8")
        try:
            with self.assertRaises(subprocess.TimeoutExpired):
                process.communicate(timeout=0.8)
        finally:
            process.terminate()
            stdout, stderr = process.communicate(timeout=5)
        self.assertIn('"monitor": "running"', stdout)
        self.assertIn('"delivery_enabled": false', stdout)
        self.assertEqual(stderr, "")


if __name__ == "__main__":
    unittest.main()
