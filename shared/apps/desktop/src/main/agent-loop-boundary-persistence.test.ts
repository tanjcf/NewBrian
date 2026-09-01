import assert from "node:assert/strict";
import test from "node:test";

const {
  buildOrphanToolResultPayloads,
  buildTurnReplayMetadata,
  enrichBoundaryEventsForPersistence,
  extractRecoveredToolResultPayloads,
  isReplaySafeToolDescriptor,
  mergeToolBoundaryEventsForOrphanRepair,
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

test("surfaces the turn failure reason on synthetic orphan tool results", () => {
  const [orphan] = buildOrphanToolResultPayloads(
    [{ type: "tool_call", payload: { id: "call-9", name: "video.generate", replaySafe: false } }],
    { failureReason: "Agent loop stalled: no tool progress across 4 consecutive steps." }
  );
  assert.match(orphan.result.output, /Agent loop stalled/);
});

test("merges supplemental in-memory tool_result events before orphan repair", () => {
  const merged = mergeToolBoundaryEventsForOrphanRepair(
    [{ type: "tool_call", payload: { id: "call-1", name: "document.create_pdf" } }],
    [{ type: "tool_result", payload: { callId: "call-1", name: "document.create_pdf", result: { ok: false, output: "HTTP 401 unauthorized" } } }]
  );
  assert.equal(buildOrphanToolResultPayloads(merged).length, 0);
  const recovered = extractRecoveredToolResultPayloads(
    [{ type: "tool_call", payload: { id: "call-1", name: "document.create_pdf" } }],
    [{ type: "tool_result", payload: { callId: "call-1", name: "document.create_pdf", result: { ok: false, output: "HTTP 401 unauthorized" } } }]
  );
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].result.output, "HTTP 401 unauthorized");
});

test("suppresses unsafe auto-replay when side effects may have occurred", () => {
  assert.equal(shouldSuppressUnsafeAutoReplay(buildTurnReplayMetadata([{ replaySafe: false }])), true);
  assert.equal(shouldSuppressUnsafeAutoReplay(buildTurnReplayMetadata([{ replaySafe: true }])), false);
  assert.equal(shouldSuppressUnsafeAutoReplay(null), true);
});
