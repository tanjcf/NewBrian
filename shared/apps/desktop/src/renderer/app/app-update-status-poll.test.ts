import assert from "node:assert/strict";
import test from "node:test";

const {
  APP_UPDATE_STATUS_POLL_MS,
  shouldRefreshAppUpdateOnWindowSignal
} = await import(new URL("./app-update-status-poll.ts", import.meta.url).href);

test("app-update sidebar poll matches 30s control-plane heartbeat", () => {
  assert.equal(APP_UPDATE_STATUS_POLL_MS, 30_000);
});

test("focus refresh runs only while logged in and visible", () => {
  assert.equal(shouldRefreshAppUpdateOnWindowSignal({
    isAuthenticated: true,
    documentHidden: false
  }), true);
  assert.equal(shouldRefreshAppUpdateOnWindowSignal({
    isAuthenticated: true,
    documentHidden: true
  }), false);
  assert.equal(shouldRefreshAppUpdateOnWindowSignal({
    isAuthenticated: false,
    documentHidden: false
  }), false);
});
