import assert from "node:assert/strict";
import test from "node:test";

const {
  buildOrphanToolResultPayloads,
  buildTurnReplayMetadata,
  enrichBoundaryEventsForPersistence,
  isReplaySafeToolDescriptor,
  shouldSuppressUnsafeAutoReplay
} = await import(new URL("./agent-loop-boundary-persistence.ts", import.meta.url).href);

test("marks low-risk read tools as replay-safe and fail-closes otherwise", () => {
  assert.equal(isReplaySafeToolDescriptor({ name: "workspace.read_file", kind: "read", risk: "low" }), true);
  assert.equal(isReplaySafeToolDescriptor({ name: "workspace.read", kind: "read", risk: "low", replaySafe: true }), true);
  assert.equal(isReplaySafeToolDescriptor(undefined, "workspace.read"), true);
  assert.equal(isReplaySafeToolDescriptor(undefined, "read"), true);
  assert.equal(isReplaySafeToolDescriptor({ name: "shell.exec", kind: "shell", risk: "high" }), false);
  assert.equal(isReplaySafeToolDescriptor(undefined, "workspace.write_file"), false);
  assert.equal(isReplaySafeToolDescriptor(undefined, "goal.get"), true);
});

test("enriches tool_call payloads with replaySafe before persistence", () => {
  const [enriched] = enrichBoundaryEventsForPersistence(
    [{ type: "tool_call", payload: { id: "call-1", name: "shell.exec", arguments: { command: "echo hi" } } }],
    [{ name: "shell.exec", kind: "shell", risk: "high" }]
  );
  assert.equal((enriched.payload as { replaySafe: boolean }).replaySafe, false);
});

test("builds orphan tool_result payloads for unpaired tool_call events", () => {
  const orphans = buildOrphanToolResultPayloads([
    { type: "tool_call", payload: { id: "call-1", name: "shell.exec", replaySafe: false } },
    { type: "tool_call", payload: { id: "call-2", name: "goal.get", replaySafe: true } },
    { type: "tool_result", payload: { callId: "call-2", name: "goal.get", result: { ok: true } } }
  ]);
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].callId, "call-1");
  assert.equal(orphans[0].result.orphan, true);
  assert.equal(orphans[0].result.interrupted, true);
  assert.equal(orphans[0].result.replaySafe, false);
});

test("suppresses unsafe auto-replay when side effects may have occurred", () => {
  assert.equal(shouldSuppressUnsafeAutoReplay(buildTurnReplayMetadata([{ replaySafe: false }])), true);
  assert.equal(shouldSuppressUnsafeAutoReplay(buildTurnReplayMetadata([{ replaySafe: true }])), false);
  assert.equal(shouldSuppressUnsafeAutoReplay(null), true);
});
