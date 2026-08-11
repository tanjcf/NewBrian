import assert from "node:assert/strict";
import test from "node:test";
import { createStructuredAgentResult, synthesizeAgentResults } from "./agent-result.js";

test("creates evidence-aware structured child results", () => {
  const result = createStructuredAgentResult({
    role: "researcher",
    content: "Found the runtime boundary.",
    events: [{ id: "event-1", type: "tool_result", payload: { result: { ok: true } } }]
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(result.evidenceRefs, ["event-1"]);
  assert.equal(result.qualityGates.find((gate) => gate.id === "tool_evidence").status, "passed");
  assert.equal(result.modelUsage, null);
});
test("fails the isolation gate when an editor has no worktree", () => {
  const result = createStructuredAgentResult({ role: "editor", content: "Changed files" });
  assert.equal(result.status, "partial");
  assert.equal(result.qualityGates.find((gate) => gate.id === "isolated_write_scope").status, "failed");
});

test("records child agent model usage for parent return", () => {
  const result = createStructuredAgentResult({
    role: "researcher",
    content: "Done",
    modelUsage: {
      requestedModel: "auto",
      selectedModel: "deepseek-v4-flash",
      selectedModels: ["deepseek-v4-flash", "deepseek-v4-pro"],
      routingReasons: ["task_class=code"]
    }
  });
  assert.equal(result.modelUsage?.requestedModel, "auto");
  assert.equal(result.modelUsage?.selectedModel, "deepseek-v4-flash");
  assert.deepEqual(result.modelUsage?.selectedModels, ["deepseek-v4-flash", "deepseek-v4-pro"]);
});

test("synthesizes evidence and exposes failed quality gates", () => {
  const good = createStructuredAgentResult({
    role: "researcher",
    content: "A",
    evidenceRefs: ["source-a"],
    modelUsage: { requestedModel: "auto", selectedModel: "deepseek-v4-flash", selectedModels: ["deepseek-v4-flash"] }
  });
  const partial = createStructuredAgentResult({ role: "editor", content: "B" });
  const synthesis = synthesizeAgentResults([good, partial]);
  assert.equal(synthesis.status, "needs_review");
  assert.deepEqual(synthesis.evidenceRefs, ["source-a"]);
  assert.equal(synthesis.failedGates[0].gate, "isolated_write_scope");
  assert.deepEqual(synthesis.modelsUsed, ["deepseek-v4-flash"]);
});
