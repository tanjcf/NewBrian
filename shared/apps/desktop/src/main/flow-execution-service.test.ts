import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BrainWorkspaceStorage } from "./brain-workspace-storage.ts";
import { FlowExecutionService } from "./flow-execution-service.ts";

function fixture(approve: boolean) {
  const root = mkdtempSync(join(tmpdir(), "brain-flow-service-"));
  const storage = new BrainWorkspaceStorage(root);
  const project = storage.createProject({ ownerId: "owner-a", name: "Flow", primaryWorkspaceKey: "software" });
  const flow = storage.saveFlow({ ownerId: "owner-a", projectId: project.id, name: "受控流程", definition: { schemaVersion: 1, nodes: [{ id: "start", type: "start", next: "approval" }, { id: "approval", type: "approval", next: "tool" }, { id: "tool", type: "tool", tool: "safe.echo", next: "end" }, { id: "end", type: "end" }] } });
  let invoked = 0;
  const service = new FlowExecutionService({ storage, tools: { "safe.echo": { execute: (input) => { invoked += 1; return input ?? "ok"; } } }, confirmApproval: () => approve });
  return { root, storage, flow, service, invoked: () => invoked };
}

test("persists every approval and tool transition through successful completion", async () => {
  const value = fixture(true);
  try {
    const run = await value.service.start("owner-a", { flowId: value.flow.id });
    assert.equal(run.status, "SUCCEEDED"); assert.equal(value.invoked(), 1);
    assert.ok(run.audit.some((item) => item.status === "WAITING")); assert.ok(run.audit.some((item) => item.nodeId === "tool" && item.status === "STARTED"));
    assert.equal(value.service.get("owner-a", run.id).finishedAt.length > 0, true);
  } finally { value.storage.close(); rmSync(value.root, { recursive: true, force: true }); }
});

test("approval denial persists terminal state and never invokes tool", async () => {
  const value = fixture(false);
  try { const run = await value.service.start("owner-a", { flowId: value.flow.id }); assert.equal(run.status, "DECLINED"); assert.equal(run.errorCode, "BRAIN_FLOW_APPROVAL_DECLINED"); assert.equal(value.invoked(), 0); }
  finally { value.storage.close(); rmSync(value.root, { recursive: true, force: true }); }
});

test("unregistered tools fail without executing arbitrary input", async () => {
  const value = fixture(true);
  try { value.storage.saveFlow({ ownerId: "owner-a", projectId: value.flow.projectId, id: value.flow.id, name: value.flow.name, definition: { schemaVersion: 1, nodes: [{ id: "start", type: "start", next: "tool" }, { id: "tool", type: "tool", tool: "shell.anything" }] } }); const run = await value.service.start("owner-a", { flowId: value.flow.id }); assert.equal(run.status, "FAILED"); assert.equal(run.errorCode, "FLOW_TOOL_NOT_REGISTERED"); assert.equal(value.invoked(), 0); }
  finally { value.storage.close(); rmSync(value.root, { recursive: true, force: true }); }
});

test("does not impose a fixed execution deadline on long-running nodes", async () => {
  const value = fixture(true);
  try {
    value.storage.saveFlow({ ownerId: "owner-a", projectId: value.flow.projectId, id: value.flow.id, name: value.flow.name, definition: { schemaVersion: 1, nodes: [{ id: "start", type: "start", next: "tool" }, { id: "tool", type: "tool", tool: "slow", next: "end" }, { id: "end", type: "end" }] } });
    const service = new FlowExecutionService({ storage: value.storage, tools: { slow: { execute: async () => { await new Promise((resolve) => setTimeout(resolve, 25)); return "late"; } } }, confirmApproval: () => true });
    const run = await service.start("owner-a", { flowId: value.flow.id });
    assert.equal(run.status, "SUCCEEDED"); assert.equal(run.errorCode, "");
    assert.equal(run.audit.some((item) => item.nodeId === "end"), true);
  } finally { value.storage.close(); rmSync(value.root, { recursive: true, force: true }); }
});
