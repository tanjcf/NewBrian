import assert from "node:assert/strict";
import test from "node:test";

const { AutomationTimerService } = await import(new URL("./automation-timer-service.ts", import.meta.url).href);

test("starts with an immediate tick and one repeating timer", async () => {
  let ticks = 0;
  const scheduled: Array<() => void> = [];
  const service = new AutomationTimerService({
    intervalMs: 60_000,
    tick: async () => { ticks += 1; },
    setInterval: (callback: () => void, intervalMs: number) => {
      assert.equal(intervalMs, 60_000);
      scheduled.push(callback);
      return 7;
    },
    clearInterval: () => undefined
  });

  service.start();
  service.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ticks, 1);
  assert.equal(scheduled.length, 1);

  scheduled[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ticks, 2);
});

test("reports tick failures without stopping future runs", async () => {
  const errors: unknown[] = [];
  const scheduled: Array<() => void> = [];
  const service = new AutomationTimerService({
    intervalMs: 60_000,
    tick: async () => { throw new Error("tick failed"); },
    onError: (error: unknown) => errors.push(error),
    setInterval: (callback: () => void) => { scheduled.push(callback); return 9; },
    clearInterval: () => undefined
  });

  service.start();
  await new Promise((resolve) => setImmediate(resolve));
  scheduled[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(errors.length, 2);
});

test("stops and clears the active timer", () => {
  const cleared: unknown[] = [];
  const service = new AutomationTimerService({
    intervalMs: 60_000,
    tick: async () => undefined,
    setInterval: () => 11,
    clearInterval: (timer: unknown) => cleared.push(timer)
  });

  service.start();
  service.stop();
  service.stop();
  assert.deepEqual(cleared, [11]);
});
