import assert from "node:assert/strict";
import test from "node:test";
import { classifyAgentEvent, createAgentActivityEvent } from "./agent-event.js";

test("creates an immutable stable activity envelope", () => {
  const payload = { nested: { status: "queued" } };
  const event = createAgentActivityEvent({
    id: "event-1", type: "agent_task_queued", source: "orchestrator", kind: "lifecycle",
    runtimeId: "runtime-1", taskId: "task-1", agentId: "child-1", threadId: "child-1",
    parentThreadId: "parent-1", summary: "Task queued",
    evidenceRefs: ["trace-1", "trace-1", ""], payload
  });
  payload.nested.status = "changed";
  assert.equal(event.schemaVersion, 1);
  assert.equal(event.payload.nested.status, "queued");
  assert.deepEqual(event.evidenceRefs, ["trace-1"]);
});
test("classifies events for rendering and trace storage", () => {
  assert.deepEqual(classifyAgentEvent("model_reasoning_delta"), { source: "model", kind: "reasoning_summary" });
  assert.deepEqual(classifyAgentEvent("tool_call"), { source: "tool", kind: "tool_activity" });
  assert.deepEqual(classifyAgentEvent("agent_task_started"), { source: "orchestrator", kind: "lifecycle" });
  assert.deepEqual(classifyAgentEvent("quality_gate_completed"), { source: "runtime", kind: "quality_gate" });
});

test("rejects events without a type", () => {
  assert.throws(() => createAgentActivityEvent({}), /require a type/);
});
