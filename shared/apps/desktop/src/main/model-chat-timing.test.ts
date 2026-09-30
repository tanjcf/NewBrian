import assert from "node:assert/strict";
import test from "node:test";

const timingModule = await import(new URL("./model-chat-timing.ts", import.meta.url).href);

test("records monotonic model-chat stage durations from one request origin", () => {
  const values = [100, 112, 145, 190];
  const timing = new timingModule.ModelChatTiming({
    requestId: "request_1",
    now: () => values.shift() ?? 190
  });

  assert.deepEqual(timing.mark("prepared"), {
    requestId: "request_1",
    stage: "prepared",
    elapsedMs: 12,
    stageMs: 12
  });
  assert.deepEqual(timing.mark("context-ready"), {
    requestId: "request_1",
    stage: "context-ready",
    elapsedMs: 45,
    stageMs: 33
  });
  assert.deepEqual(timing.mark("loop-completed"), {
    requestId: "request_1",
    stage: "loop-completed",
    elapsedMs: 90,
    stageMs: 45
  });
});
test("rejects duplicate or non-monotonic timing marks", () => {
  const values = [100, 120, 110, 130];
  const timing = new timingModule.ModelChatTiming({
    requestId: "request_1",
    now: () => values.shift() ?? 130
  });
  timing.mark("prepared");
  assert.throws(() => timing.mark("context-ready"), /monotonic/i);
  assert.throws(() => timing.mark("prepared"), /already recorded/i);
});
