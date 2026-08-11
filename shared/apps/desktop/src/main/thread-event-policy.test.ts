import assert from "node:assert/strict";
import test from "node:test";

const policy = await import(new URL("./thread-event-policy.ts", import.meta.url).href);
const context = {
  makeId: () => "thread-event-fixed",
  nowIso: () => "2026-07-17T08:00:00.000Z"
};

test("creates thread events from injected identity and clock sources", () => {
  assert.deepEqual(policy.createThreadEvent("tool_call", { tool: "shell" }, "turn-1", context), {
    id: "thread-event-fixed",
    type: "tool_call",
    createdAt: "2026-07-17T08:00:00.000Z",
    turnId: "turn-1",
    payload: { tool: "shell" }
  });
});

test("maps thread events to versioned rollout records", () => {
  const event = policy.createThreadEvent("message", { role: "user", eventId: "payload-value" }, undefined, context);
  const rollout = policy.toRolloutThreadEvent("thread-1", event);
  assert.equal(rollout.schema_version, 1);
  assert.equal(rollout.record_type, "message");
  assert.equal(rollout.thread_id, "thread-1");
  assert.equal(rollout.timestamp, event.createdAt);
  assert.deepEqual(rollout.payload, { eventId: "payload-value", role: "user" });
});
