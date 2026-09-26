import assert from "node:assert/strict";
import test from "node:test";

const { DesktopControlPlaneHeartbeat } = await import(
  new URL("./desktop-control-plane-heartbeat.ts", import.meta.url).href
);

test("starts one non-overlapping control-plane heartbeat and stops its timer", async () => {
  let scheduled: (() => void) | undefined;
  let cleared: unknown;
  let resolveSync: (() => void) | undefined;
  let syncCalls = 0;
  const timer = { unrefCalled: false, unref() { this.unrefCalled = true; } };
  const heartbeat = new DesktopControlPlaneHeartbeat({
    intervalMs: 30_000,
    sync: () => {
      syncCalls += 1;
      return new Promise<void>((resolve) => { resolveSync = resolve; });
    },
    setInterval: (callback: () => void) => {
      scheduled = callback;
      return timer;
    },
    clearInterval: (handle: unknown) => { cleared = handle; }
  });

  heartbeat.start();
  heartbeat.start();
  assert.equal(timer.unrefCalled, true);
  assert.ok(scheduled);
  // start() kicks an immediate sync, then interval callbacks continue.
  assert.equal(syncCalls, 1);
  scheduled();
  assert.equal(syncCalls, 1);

  resolveSync?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  scheduled();
  assert.equal(syncCalls, 2);

  heartbeat.stop();
  assert.equal(cleared, timer);
});

test("start warms the control-plane cache immediately after login", async () => {
  let syncCalls = 0;
  const heartbeat = new DesktopControlPlaneHeartbeat({
    intervalMs: 30_000,
    sync: async () => { syncCalls += 1; },
    setInterval: () => ({ unref() {} }),
    clearInterval: () => undefined
  });
  heartbeat.start();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(syncCalls, 1);
  heartbeat.stop();
});
