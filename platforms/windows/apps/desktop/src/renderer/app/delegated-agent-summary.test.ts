import assert from "node:assert/strict";
import test from "node:test";

const { summarizeDelegatedAgents } = await import(
  new URL("./delegated-agent-summary.ts", import.meta.url).href
) as typeof import("./delegated-agent-summary.js");

test("summarizes failed children as terminal instead of pretending they are still running", () => {
  const summary = summarizeDelegatedAgents([
    { status: "failed", checkpointStatus: "failed" },
    { status: "failed", checkpointStatus: "awaiting-approval" }
  ]);
  assert.equal(summary.completed, 0);
  assert.equal(summary.failed, 2);
  assert.equal(summary.active, 0);
  assert.equal(summary.allTerminal, true);
  assert.equal(summary.awaiting, 0);
  assert.equal(summary.visible, false);
  assert.match(summary.label, /2 失败/);
});

test("keeps awaiting-approval visible only for non-terminal children", () => {
  const summary = summarizeDelegatedAgents([
    { status: "running", checkpointStatus: "awaiting-approval" },
    { status: "completed", checkpointStatus: "completed" }
  ]);
  assert.equal(summary.awaiting, 1);
  assert.equal(summary.completed, 1);
  assert.equal(summary.allTerminal, false);
  assert.equal(summary.visible, true);
});
