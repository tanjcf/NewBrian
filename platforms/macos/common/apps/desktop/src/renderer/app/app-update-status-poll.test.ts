import assert from "node:assert/strict";
import test from "node:test";

const {
  APP_UPDATE_STATUS_POLL_MS,
  shouldRefreshAppUpdateOnWindowSignal
} = await import(new URL("./app-update-status-poll.ts", import.meta.url).href);

test("app-update sidebar poll matches 30s control-plane heartbeat", () => {
  assert.equal(APP_UPDATE_STATUS_POLL_MS, 30_000);
});

test("focus refresh runs whenever the window is visible", () => {
  assert.equal(shouldRefreshAppUpdateOnWindowSignal({
    isAuthenticated: true,
    documentHidden: false
  }), true);
  assert.equal(shouldRefreshAppUpdateOnWindowSignal({
    isAuthenticated: false,
    documentHidden: false
  }), true);
  assert.equal(shouldRefreshAppUpdateOnWindowSignal({
    isAuthenticated: true,
    documentHidden: true
  }), false);
  assert.equal(shouldRefreshAppUpdateOnWindowSignal({
    isAuthenticated: false,
    documentHidden: true
  }), false);
});

test("poll interval stays short enough for admin stable promotions", () => {
  assert.ok(APP_UPDATE_STATUS_POLL_MS <= 30_000);
  assert.ok(APP_UPDATE_STATUS_POLL_MS >= 10_000);
});
