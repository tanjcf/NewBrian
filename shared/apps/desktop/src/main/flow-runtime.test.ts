import assert from "node:assert/strict";
import test from "node:test";
import { runFlow, validateFlowDefinition } from "./flow-runtime.ts";

test("runs start, tool, condition, approval and end with bounded retry audit", async () => {
  let attempts = 0;
  const result = await runFlow({ schemaVersion: 1, nodes: [
    { id: "start", type: "start", next: "prepare" },
    { id: "prepare", type: "tool", tool: "prepare", maxAttempts: 2, next: "condition" },
    { id: "condition", type: "condition", valueKey: "allowed", onTrue: "approval", onFalse: "end" },
    { id: "approval", type: "approval", next: "end" },
    { id: "end", type: "end" }
  ] }, { tools: { prepare: () => { attempts += 1; if (attempts === 1) throw new Error("transient"); return "done"; } }, approve: () => true }, { allowed: true });
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(attempts, 2);
  assert.equal(result.context.values.prepare, "done");
  assert.ok(result.context.audit.some((item) => item.status === "WAITING"));
});

test("declined approval cannot execute the following tool", async () => {
  let invoked = false;
  const result = await runFlow({ schemaVersion: 1, nodes: [
    { id: "start", type: "start", next: "approval" }, { id: "approval", type: "approval", next: "danger" },
    { id: "danger", type: "tool", tool: "danger", next: "end" }, { id: "end", type: "end" }
  ] }, { tools: { danger: () => { invoked = true; } }, approve: () => false });
  assert.equal(result.status, "DECLINED");
  assert.equal(invoked, false);
});

test("rejects invalid graphs, unknown tools and unbounded cycles", async () => {
  assert.throws(() => validateFlowDefinition({ schemaVersion: 1, nodes: [{ id: "x", type: "start" }, { id: "x", type: "end" }] }), /FLOW_NODE_ID_INVALID/);
  await assert.rejects(runFlow({ schemaVersion: 1, nodes: [{ id: "start", type: "start", next: "missing" }] }), /FLOW_EDGE_TARGET_NOT_FOUND/);
  await assert.rejects(runFlow({ schemaVersion: 1, nodes: [{ id: "start", type: "start", next: "tool" }, { id: "tool", type: "tool", tool: "missing" }] }), /FLOW_TOOL_NOT_REGISTERED/);
  await assert.rejects(runFlow({ schemaVersion: 1, maxSteps: 2, nodes: [{ id: "start", type: "start", next: "loop" }, { id: "loop", type: "condition", valueKey: "yes", onTrue: "loop", onFalse: "end" }, { id: "end", type: "end" }] }, {}, { yes: true }), /FLOW_STEP_LIMIT_EXCEEDED/);
});

test("stops before advancing when the run is cancelled", async () => {
  const controller = new AbortController();
  let invoked = 0;
  controller.abort(new Error("BRAIN_FLOW_CANCELLED"));
  await assert.rejects(runFlow({ schemaVersion: 1, nodes: [{ id: "start", type: "start", next: "tool" }, { id: "tool", type: "tool", tool: "safe", next: "end" }, { id: "end", type: "end" }] }, { signal: controller.signal, tools: { safe: () => { invoked += 1; } } }), /BRAIN_FLOW_CANCELLED/);
  assert.equal(invoked, 0);
});

test("assigns constants and existing values into explicit context keys", async () => {
  const result = await runFlow({ schemaVersion: 1, nodes: [
    { id: "start", type: "start", next: "copy" },
    { id: "copy", type: "assign", targetKey: "copied", valueKey: "source", next: "constant" },
    { id: "constant", type: "assign", targetKey: "flag", value: true, next: "end" },
    { id: "end", type: "end" }
  ] }, {}, { source: "payload" });
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.context.values.copied, "payload");
  assert.equal(result.context.values.flag, true);
});

test("rejects an assign node without a source or constant", () => {
  assert.throws(() => validateFlowDefinition({ schemaVersion: 1, nodes: [
    { id: "start", type: "start", next: "assign" },
    { id: "assign", type: "assign", targetKey: "x", next: "end" },
    { id: "end", type: "end" }
  ] }), /FLOW_ASSIGN_VALUE_REQUIRED/);
});

test("routes with typed condition operators while preserving legacy truthy behavior", async () => {
  const definitions = [
    { operator: "equals" as const, actual: "ready", expected: "ready" },
    { operator: "notEquals" as const, actual: 2, expected: 3 },
    { operator: "exists" as const, actual: false, expected: undefined },
    { operator: "greaterThan" as const, actual: 10, expected: 9 },
    { operator: "lessThan" as const, actual: 1, expected: 2 },
    { operator: "contains" as const, actual: ["alpha", "beta"], expected: "beta" }
  ];
  for (const item of definitions) {
    const result = await runFlow({ schemaVersion: 1, nodes: [
      { id: "start", type: "start", next: "condition" },
      { id: "condition", type: "condition", valueKey: "actual", operator: item.operator, ...(item.expected !== undefined ? { expected: item.expected } : {}), onTrue: "yes", onFalse: "no" },
      { id: "yes", type: "assign", targetKey: "routed", value: true, next: "end" },
      { id: "no", type: "assign", targetKey: "routed", value: false, next: "end" },
      { id: "end", type: "end" }
    ] }, {}, { actual: item.actual });
    assert.equal(result.context.values.routed, true, item.operator);
  }
  const legacy = await runFlow({ schemaVersion: 1, nodes: [
    { id: "start", type: "start", next: "condition" },
    { id: "condition", type: "condition", valueKey: "actual", onTrue: "yes", onFalse: "no" },
    { id: "yes", type: "end" }, { id: "no", type: "end" }
  ] }, {}, { actual: "non-empty" });
  assert.equal(legacy.context.audit.at(-1)?.nodeId, "yes");
});

test("rejects invalid condition operands", () => {
  assert.throws(() => validateFlowDefinition({ schemaVersion: 1, nodes: [
    { id: "start", type: "start", next: "condition" },
    { id: "condition", type: "condition", valueKey: "score", operator: "greaterThan", expected: "9" as unknown as number, onTrue: "end", onFalse: "end" },
    { id: "end", type: "end" }
  ] }), /FLOW_CONDITION_NUMBER_REQUIRED/);
  assert.throws(() => validateFlowDefinition({ schemaVersion: 1, nodes: [
    { id: "start", type: "start", next: "condition" },
    { id: "condition", type: "condition", valueKey: "score", operator: "equals", onTrue: "end", onFalse: "end" },
    { id: "end", type: "end" }
  ] }), /FLOW_CONDITION_EXPECTED_REQUIRED/);
});

test("aggregates selected context values without mutating source keys", async () => {
  const result = await runFlow({ schemaVersion: 1, nodes: [
    { id: "start", type: "start", next: "aggregate" },
    { id: "aggregate", type: "aggregate", targetKey: "summary", sources: { title: "sourceTitle", count: "sourceCount" }, next: "end" },
    { id: "end", type: "end" }
  ] }, {}, { sourceTitle: "Report", sourceCount: 3 });
  assert.deepEqual(result.context.values.summary, { title: "Report", count: 3 });
  assert.equal(result.context.values.sourceTitle, "Report");
});

test("rejects empty aggregate mappings", () => {
  assert.throws(() => validateFlowDefinition({ schemaVersion: 1, nodes: [
    { id: "start", type: "start", next: "aggregate" },
    { id: "aggregate", type: "aggregate", targetKey: "summary", sources: {}, next: "end" },
    { id: "end", type: "end" }
  ] }), /FLOW_AGGREGATE_INVALID/);
});
