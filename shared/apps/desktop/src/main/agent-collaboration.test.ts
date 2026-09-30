import assert from "node:assert/strict";
import test from "node:test";
const {
  assertCanDelegateChild,
  buildAgentCollaborationInstruction,
  buildDelegateFailureRecoveryMessage,
  countActiveChildren,
  DELEGATE_CHILDREN_LIMIT,
  DELEGATE_DEPTH_EXCEEDED,
  DELEGATE_REFUSED_AFTER_FAILURE,
  normalizeChildThreadIds,
  normalizeDelegationRequest,
  WAIT_UNAVAILABLE,
  waitForAgentRun
} = await import(new URL("./agent-collaboration.ts", import.meta.url).href) as typeof import("./agent-collaboration.js");

test("normalizes bounded child delegation requests", () => {
  assert.deepEqual(normalizeDelegationRequest({
    title: " Research ", instruction: " Inspect the runtime ", role: "researcher"
  }), {
    title: "Research", instruction: "Inspect the runtime", role: "researcher", dependsOn: []
  });
  assert.equal(normalizeDelegationRequest({ title: "x", instruction: "y", role: "unknown" }).role, "researcher");
  assert.equal(
    normalizeDelegationRequest(
      { title: "x", instruction: "y", role: "tech-lead" },
      { allowedExtraRoles: ["tech-lead", "qa-engineer"] }
    ).role,
    "tech-lead"
  );
  assert.throws(() => normalizeDelegationRequest({ title: "", instruction: "work" }), /required/);
});

test("deduplicates and bounds child wait identifiers", () => {
  assert.deepEqual(normalizeChildThreadIds([" a ", "a", "b"], 2), ["a", "b"]);
  assert.throws(() => normalizeChildThreadIds([]), /At least one/);
});

test("collaboration instruction requires parallel start and final collection", () => {
  const instruction = buildAgentCollaborationInstruction(3);
  assert.match(instruction, /at most 3 child agents/i);
  assert.match(instruction, /before calling agent\.wait/i);
  assert.match(instruction, /root agent remains responsible/i);
  assert.match(instruction, /not visible as sidebar threads/i);
  assert.match(instruction, /ordinary chat/i);
  assert.match(instruction, /MUST try the relevant retrieval\/tool capability/i);
  assert.match(instruction, /stronger model is required/i);
  assert.match(instruction, /Do not empty-loop re-delegate/i);
  assert.match(instruction, /workspace\.write_file/);
});

test("enforces OC spawn depth and active child limits", () => {
  assert.throws(
    () => assertCanDelegateChild({ parentKind: "subagent", activeChildCount: 0 }),
    (error: Error & { code?: string }) => error.code === DELEGATE_DEPTH_EXCEEDED
  );
  assert.throws(
    () => assertCanDelegateChild({ spawnDepth: 1, activeChildCount: 0 }),
    (error: Error & { code?: string }) => error.code === DELEGATE_DEPTH_EXCEEDED
  );
  assert.throws(
    () => assertCanDelegateChild({ activeChildCount: 3 }),
    (error: Error & { code?: string }) => error.code === DELEGATE_CHILDREN_LIMIT
  );
  assert.throws(
    () => assertCanDelegateChild({ activeChildCount: 0, recentFailedCount: 2 }),
    (error: Error & { code?: string; nextAction?: string }) => {
      assert.equal(error.code, DELEGATE_REFUSED_AFTER_FAILURE);
      assert.match(error.message, /next_action:/i);
      assert.match(String(error.nextAction || ""), /Do not call agent\.delegate/);
      assert.match(buildDelegateFailureRecoveryMessage(2), /workspace\.write_file/);
      return true;
    }
  );
  assert.doesNotThrow(() => assertCanDelegateChild({ activeChildCount: 0, recentFailedCount: 1 }));
  assert.equal(countActiveChildren([{ status: "running" }, { status: "failed" }, { status: "queued" }]).active, 2);
});

test("waitForAgentRun settles only through the child lifecycle and never creates a timeout result", async () => {
  let settle!: (value: { status: string }) => void;
  const active = new Promise<{ status: string }>((resolve) => { settle = resolve; });
  const pending = waitForAgentRun(active, { status: "running" });
  let observed = false;
  void pending.then(() => { observed = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(observed, false);
  settle({ status: "completed" });
  const result = await pending;
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.status, "completed");

  const terminal = await waitForAgentRun(undefined, { status: "failed" });
  assert.equal(terminal.ok, true);
  if (terminal.ok) assert.equal(terminal.value.status, "failed");

  const unavailable = await waitForAgentRun(undefined, { status: "running" });
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) assert.equal(unavailable.code, WAIT_UNAVAILABLE);

  const settled = await waitForAgentRun(Promise.resolve({ status: "completed" }), undefined);
  assert.equal(settled.ok, true);
  if (settled.ok) assert.equal(settled.value.status, "completed");
});
