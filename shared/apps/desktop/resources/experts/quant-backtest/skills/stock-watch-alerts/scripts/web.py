"""Loopback-only single-user UI for the notification Skill; never a trading API."""
import argparse
import json
from pathlib import Path
import re
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from watch import Store, Market, Transport, WatchError, encode

ASSETS = Path(__file__).resolve().parent.parent / "assets"


class Application:
    def __init__(self, db, owner, config, deliver=False, prototype=None):
        self.db, self.owner, self.config = db, owner, config
        self.deliver, self.prototype = deliver, prototype
        self.token = secrets.token_urlsafe(32)
        self.stop = threading.Event()
        self.poll_lock = threading.Lock()
        self.worker_error = ""
        store = Store(db)
        store.profile(owner)
        store.db.close()

    def cycle(self):
        # Manual checks and the background loop share the same due-work rules.
        if not self.poll_lock.acquire(blocking=False):
            return {"busy": True}
        store = None
        try:
            store = Store(self.db)
            checked = store.poll(self.owner, Market(self.config))
            accepted = store.deliver(self.owner, Transport(self.config)) if self.deliver else 0
            self.worker_error = ""
            return {"checked": checked, "accepted": accepted}
        except Exception:
            self.worker_error = "MONITOR_CYCLE_FAILED"
            raise WatchError(self.worker_error) from None
        finally:
            if store:
                store.db.close()
            self.poll_lock.release()

    def worker(self):
        while not self.stop.is_set():
            try:
                self.cycle()
            except WatchError:
                pass
            self.stop.wait(10)

    def state(self, store):
        profile = dict(store.db.execute("SELECT * FROM profiles WHERE owner=?", (self.owner,)).fetchone())
        return {"subscriptions": store.subscriptions(self.owner), "alerts": store.alerts(self.owner),
                "profile": profile, "csrf": self.token, "delivery_enabled": self.deliver,
                "market_configured": bool(self.config.get("market", {}).get("url")),
                "worker_error": self.worker_error, "monitor_running": not self.stop.is_set()}


def handler_for(app):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Do not write recipient addresses, request bodies or tokens to logs.

        def reply(self, status, value, mime="application/json; charset=utf-8"):
            raw = value if isinstance(value, bytes) else encode(value).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'none'; form-action 'self'")
            self.end_headers()
            self.wfile.write(raw)

        def allowed(self, mutate=False):
            expected = f"127.0.0.1:{self.server.server_port}"
            origin = self.headers.get("Origin")
            if self.headers.get("Host") != expected or (origin and origin != "http://" + expected):
                self.reply(403, {"error": "LOCAL_ORIGIN_REQUIRED"})
                return False
            if mutate and (origin != "http://" + expected or not secrets.compare_digest(
                    self.headers.get("X-Watch-CSRF", ""), app.token)):
                self.reply(403, {"error": "CSRF_REQUIRED"})
                return False
            return True

        def do_GET(self):
            if not self.allowed():
                return
            path = urlsplit(self.path).path
            if path == "/api/state":
                if self.headers.get("X-Watch-Client") != "1":
                    self.reply(403, {"error": "LOCAL_CLIENT_REQUIRED"})
                    return
                store = Store(app.db)
                try:
                    self.reply(200, app.state(store))
                finally:
                    store.db.close()
            elif path in ("/", "/original") and app.prototype:
                content = Path(app.prototype).read_text(encoding="utf-8-sig")
                if path == "/":
                    content = content.replace('</head>', '''<style>
                      .topbar {flex-wrap:wrap;padding:8px 12px}.app {grid-template-rows:auto auto minmax(0,1fr)}
                      .banner {padding:8px 12px}.watch-mode #toolsStatus,.watch-mode #marketStatus {display:none}
                      [data-pane="watch"] {padding:0}.scene-tabs {min-height:36px}
                      @media(max-width:1200px){.layout{grid-template-columns:minmax(0,1fr)}.spec{display:none}}
                      @media(max-width:650px){.top-actions{display:none}.topbar .chip{display:none}.q-header{padding:8px 12px}}
                    </style></head>''', 1)
                    content = re.sub(r'<div class="banner">.*?</div>', '<div class="banner"><b>长期关注 · 本地持久化</b><span>新入口只提供参考提醒；其他页保留原型演示数据。</span><a href="/watch" target="_blank">独立打开关注页</a></div>', content, count=1, flags=re.S)
                    content = content.replace('<div class="scene-tabs">', '<div class="scene-tabs"><button type="button" class="scene-tab" data-tab="watch">长期关注</button>', 1)
                    content = content.replace('<section class="pane active"', '<section class="pane" data-pane="watch"><iframe title="长期关注与参考提醒" src="/watch" style="width:100%;height:78vh;min-height:640px;border:0"></iframe></section><section class="pane active"', 1)
                    content = content.replace('</body>', '<script>TAB_TITLES.watch="长期关注 · 仅供参考";const originalSetTab=setTab;setTab=function(tab){document.body.classList.toggle("watch-mode",tab==="watch");originalSetTab(tab)};setTab("watch");</script></body>')
                self.reply(200, content.encode("utf-8"), "text/html; charset=utf-8")
            elif path in ("/", "/watch"):
                self.reply(200, (ASSETS / "watch.html").read_bytes(), "text/html; charset=utf-8")
            elif path == "/watch.js":
                self.reply(200, (ASSETS / "watch.js").read_bytes(), "text/javascript; charset=utf-8")
            else:
                self.reply(404, {"error": "NOT_FOUND"})

        def do_POST(self):
            if not self.allowed(mutate=True):
                return
            store = None
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 32768 or self.headers.get("Content-Type") != "application/json":
                    raise WatchError("INVALID_REQUEST")
                data = json.loads(self.rfile.read(size))
                if not isinstance(data, dict):
                    raise WatchError("INVALID_REQUEST")
                path = urlsplit(self.path).path
                store = Store(app.db)
                if path == "/api/subscribe":
                    store.subscribe(app.owner, data)
                elif path == "/api/profile":
                    if any(k not in ("email", "sms", "email_enabled", "sms_enabled") for k in data):
                        raise WatchError("INVALID_PROFILE")
                    if any(not isinstance(v, bool if k.endswith("_enabled") else str) for k, v in data.items()):
                        raise WatchError("INVALID_PROFILE")
                    store.profile(app.owner, **data)
                elif path in ("/api/pause", "/api/resume", "/api/unsubscribe"):
                    store.change(app.owner, data.get("id", ""), path.rsplit("/", 1)[-1])
                elif path == "/api/poll":
                    self.reply(200, app.cycle())
                    return
                else:
                    self.reply(404, {"error": "NOT_FOUND"})
                    return
                self.reply(200, {"ok": True})
            except Exception as exc:
                self.reply(400, {"error": str(exc) if isinstance(exc, WatchError) else "INVALID_REQUEST"})
            finally:
                if store:
                    store.db.close()

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True)
    parser.add_argument("--user", required=True)
    parser.add_argument("--config")
    parser.add_argument("--port", type=int, default=8879)
    parser.add_argument("--prototype", help="Optional user-provided BRAIN HTML; never executed as server code")
    parser.add_argument("--deliver", action="store_true", help="Enable authorized external notifications")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", args.user):
        parser.error("INVALID_USER_ID")
    config = json.loads(Path(args.config).read_text(encoding="utf-8-sig")) if args.config else {}
    app = Application(args.db, args.user, config, args.deliver, args.prototype)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(app))
    worker = threading.Thread(target=app.worker, daemon=True)
    worker.start()
    print(encode({"url": f"http://127.0.0.1:{server.server_port}", "delivery_enabled": args.deliver}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        app.stop.set()
        server.server_close()


if __name__ == "__main__":
    main()
