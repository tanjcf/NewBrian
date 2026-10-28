"""Exercise the actual local HTTP API; no live market or notification services."""
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.request
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer

from web import Application, handler_for


class WebTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.app = Application(Path(self.tmp.name)/"watch.db", "local-user", {})
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(self.app))
        self.base = "http://127.0.0.1:" + str(self.server.server_port)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.close)

    def close(self):
        self.app.stop.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, path, data=None, headers=None):
        req = urllib.request.Request(self.base+path, data=None if data is None else json.dumps(data).encode(),
            headers={"X-Watch-Client":"1", "Origin":self.base, "X-Watch-CSRF":self.app.token,
                     "Content-Type":"application/json", **(headers or {})})
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=5) as res:
            return res.read()

    def test_lifecycle_and_restart_persistence(self):
        state = json.loads(self.request("/api/state"))
        self.assertFalse(state["delivery_enabled"])
        spec = {"id":"web-test", "symbol":"510300", "asset_type":"etf", "notes":"长期记忆",
                "enabled":False, "rules":[{"id":"below", "type":"price_below", "value":3, "action":"observe"}]}
        self.request("/api/subscribe", spec)
        self.request("/api/profile", {"email":"test@example.test", "email_enabled":False})
        self.request("/api/resume", {"id":"web-test"})
        self.request("/api/poll", {})
        state = json.loads(self.request("/api/state"))
        self.assertEqual(state["subscriptions"][0]["error"], "INVALID_ENDPOINT")
        self.assertEqual(state["alerts"], [])
        self.request("/api/pause", {"id":"web-test"})
        restarted = Application(self.app.db, "local-user", {})
        from watch import Store
        store = Store(restarted.db)
        try:
            self.assertEqual(store.subscriptions("local-user")[0]["notes"], "长期记忆")
            self.assertFalse(store.subscriptions("local-user")[0]["enabled"])
        finally:
            store.db.close()
        self.request("/api/unsubscribe", {"id":"web-test"})
        self.assertEqual(json.loads(self.request("/api/state"))["subscriptions"], [])

    def test_rejects_cross_origin_csrf_and_rebinding(self):
        for headers in ({"Origin":"https://example.test"}, {"X-Watch-CSRF":"wrong"}, {"Host":"evil.test"}):
            with self.subTest(headers=headers), self.assertRaises(HTTPError) as raised:
                self.request("/api/profile", {}, headers)
            self.assertEqual(raised.exception.code, 403)
        with self.assertRaises(HTTPError):
            self.request("/api/state", headers={"X-Watch-Client":""})

    def test_serves_only_ui_assets_and_never_trading_or_config_api(self):
        self.assertIn("长期关注", self.request("/watch").decode())
        self.assertIn(b"/api/subscribe", self.request("/watch.js"))
        for path in ("/../watch.db", "/config.json", "/api/order", "/api/dispatch"):
            with self.subTest(path=path), self.assertRaises(HTTPError):
                self.request(path, {} if path.startswith("/api") else None)
        with self.assertRaises(HTTPError):
            self.request("/api/profile", {"email_enabled":"false"})

    def test_prototype_integration_keeps_original_file_unchanged(self):
        path = Path(self.tmp.name) / "prototype.html"
        original = '<html><head></head><body><div class="banner">fixture</div><div class="scene-tabs"></div><section class="pane active"></section></body></html>'
        path.write_text(original, encoding="utf-8")
        self.app.prototype = path
        served = self.request("/").decode()
        self.assertIn('data-tab="watch"', served)
        self.assertIn('src="/watch"', served)
        self.assertIn('originalSetTab', served)
        self.assertEqual(path.read_text(encoding="utf-8"), original)
        self.assertEqual(self.request("/original").decode(), original)


if __name__ == "__main__":
    unittest.main()
