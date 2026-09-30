import assert from "node:assert/strict";
import test from "node:test";

const sanitizer = import(new URL("./remote-event-sanitizer.js", import.meta.url).href) as Promise<
  typeof import("./remote-event-sanitizer.js")
>;

test("sanitizes tool evidence without leaking output, secrets, or absolute paths", async () => {
  const { sanitizeRemoteAgentEvent } = await sanitizer;
  const event = sanitizeRemoteAgentEvent({
    type: "tool_result",
    payload: {
      callId: "call_1",
      name: "shell.exec",
      result: {
        ok: true,
        command: "Get-Content C:\\private\\secret.txt",
        output: "API_KEY=super-secret user@example.com C:\\private\\secret.txt\n65 tests passed",
        exitCode: 0,
        durationMs: 1250
      }
    }
  });

  assert.equal(event?.eventType, "tool.completed");
  assert.equal(event?.payload.tool_name, "shell.exec");
  assert.equal(event?.payload.exit_code, 0);
  assert.equal(event?.payload.duration_ms, 1250);
  assert.match(String(event?.payload.output_hash), /^sha256:[a-f0-9]{64}$/);
  const serialized = JSON.stringify(event);
  assert.equal(serialized.includes("super-secret"), false);
  assert.equal(serialized.includes("user@example.com"), false);
  assert.equal(serialized.includes("C:\\\\private"), false);
  assert.equal(serialized.includes("65 tests passed"), false);
  assert.equal(serialized.includes("command"), false);
});

test("maps approval and terminal events without persisting private reasoning", async () => {
  const { sanitizeRemoteAgentEvent } = await sanitizer;
  const approval = sanitizeRemoteAgentEvent({
    type: "approval_requested",
    payload: { call: { id: "call_1", name: "shell.exec", arguments: { command: "rm secret" } }, risk: "high" }
  });
  const completed = sanitizeRemoteAgentEvent({
    type: "agent_loop_completed",
    payload: { step: 3, reasoning: "private chain of thought", output: "full answer" }
  });

  assert.deepEqual(approval, {
    eventType: "approval.requested",
    payload: { call_id: "call_1", tool_name: "shell.exec", risk: "high" }
  });
  assert.deepEqual(completed, {
    eventType: "work_item.completed",
    payload: { steps: 3 }
  });
});

test("ignores model-only events that are not learning evidence", async () => {
  const { sanitizeRemoteAgentEvent } = await sanitizer;
  assert.equal(sanitizeRemoteAgentEvent({ type: "model_response", payload: { content: "secret" } }), null);
  assert.equal(sanitizeRemoteAgentEvent({ type: "policy_decision", payload: {} }), null);
});
