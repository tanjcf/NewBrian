import assert from "node:assert/strict";
import test from "node:test";
const {
  assertCanDelegateChild,
  buildAgentCollaborationInstruction,
  countActiveChildren,
  DELEGATE_CHILDREN_LIMIT,
  DELEGATE_DEPTH_EXCEEDED,
  DELEGATE_REFUSED_AFTER_FAILURE,
  normalizeChildThreadIds,
  normalizeDelegationRequest,
  WAIT_TIMEOUT,
  waitWithTimeout
} = await import(new URL("./agent-collaboration.ts", import.meta.url).href) as typeof import("./agent-collaboration.js");

test("normalizes bounded child delegation requests", () => {
  assert.deepEqual(normalizeDelegationRequest({
    title: " Research ", instruction: " Inspect the runtime ", role: "researcher"
  }), {
    title: "Research", instruction: "Inspect the runtime", role: "researcher", dependsOn: []
  });
  assert.equal(normalizeDelegationRequest({ title: "x", instruction: "y", role: "unknown" }).role, "researcher");
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
  assert.match(instruction, /Do not empty-loop re-delegate/i);
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
    (error: Error & { code?: string }) => error.code === DELEGATE_REFUSED_AFTER_FAILURE
  );
  assert.doesNotThrow(() => assertCanDelegateChild({ activeChildCount: 0, recentFailedCount: 1 }));
  assert.equal(countActiveChildren([{ status: "running" }, { status: "failed" }, { status: "queued" }]).active, 2);
});

test("waitWithTimeout returns wait_timeout instead of hanging forever", async () => {
  const hung = new Promise<{ status: string }>(() => undefined);
  const started = Date.now();
  const result = await waitWithTimeout(hung, { status: "running" }, 40);
  assert.ok(Date.now() - started < 1_000);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, WAIT_TIMEOUT);

  const terminal = await waitWithTimeout(undefined, { status: "failed" }, 40);
  assert.equal(terminal.ok, true);
  if (terminal.ok) assert.equal(terminal.value.status, "failed");

  const settled = await waitWithTimeout(Promise.resolve({ status: "completed" }), undefined, 40);
  assert.equal(settled.ok, true);
  if (settled.ok) assert.equal(settled.value.status, "completed");
});
