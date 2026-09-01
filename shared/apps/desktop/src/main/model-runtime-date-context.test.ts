import assert from "node:assert/strict";
import test from "node:test";

const {
  DEFAULT_MODEL_RUNTIME_TIMEZONE,
  formatModelRuntimeDateContext
} = await import(new URL("./model-runtime-date-context.ts", import.meta.url).href);

test("formatModelRuntimeDateContext uses Asia/Shanghai calendar date by default", () => {
  const context = formatModelRuntimeDateContext({
    now: new Date("2026-08-28T18:30:00.000Z"),
    timezone: DEFAULT_MODEL_RUNTIME_TIMEZONE
  });
  assert.match(context, /2026-08-29/);
  assert.match(context, /Current year: 2026/);
  assert.match(context, /Asia\/Shanghai/);
  assert.match(context, /authoritative/i);
});

test("formatModelRuntimeDateContext respects configured timezone", () => {
  const context = formatModelRuntimeDateContext({
    now: new Date("2026-08-28T18:30:00.000Z"),
    timezone: "America/New_York"
  });
  assert.match(context, /2026-08-28/);
  assert.match(context, /America\/New_York/);
});
