/**
 * INSPECTION-DELEGATE-GUARD-SMOKE-001
 * Packaging must run this case and stop when it fails.
 * Read-only SSH inspection must not die on docker --format or /dev/null,
 * and a queued child agent must not be marked failed before it starts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PolicyEngine } from "../../../agentd/src/policy-engine.js";
import { DelegatedAgentIpcService } from "./delegated-agent-ipc-service.ts";

const CASE_ID = "INSPECTION-DELEGATE-GUARD-SMOKE-001";
const workspace = "C:\\inspection-smoke";
const descriptor = { risk: "high", requiresApproval: true };

function evaluate(command: string) {
  return new PolicyEngine().evaluate({
    toolName: "shell.exec",
    arguments: { command },
    descriptor,
    workspacePath: workspace,
    permissionMode: "full"
  });
}

test(`${CASE_ID} allows docker --format and /dev/null while still denying disk format`, () => {
  const policySource = readFileSync(fileURLToPath(new URL("../../../agentd/src/policy-engine.js", import.meta.url)), "utf8");
  assert.match(policySource, /\(\?<!\[\\w-\]\)\(\?:diskpart\|format/);

  for (const command of [
    "format C:",
    "format.com E:",
    "diskpart",
    "mkfs.ext4 /dev/sdb",
    "Format-Volume -DriveLetter D"
  ]) {
    const result = evaluate(command);
    assert.equal(result.decision, "deny", command);
    assert.equal(result.ruleId, "critical-disk-management", command);
  }

  const inspection = "ssh -o BatchMode=yes -o ConnectTimeout=12 spring-primary \"hostname; df -h / /data 2>/dev/null; docker ps -a --format '{{.Names}}|{{.Status}}'; curl -sS -m8 -k https://www.sinnauze.cn/app/ -o /dev/null -w 'code=%{http_code}'\"";
  const result = evaluate(inspection);
  assert.notEqual(result.ruleId, "critical-disk-management");
  assert.equal(result.decision, "allow");
});

test(`${CASE_ID} does not fail a queued inspection child before its run starts`, async () => {
  const serviceSource = readFileSync(fileURLToPath(new URL("./delegated-agent-ipc-service.ts", import.meta.url)), "utf8");
  const listStart = serviceSource.indexOf("async list(");
  const listBody = serviceSource.slice(listStart, serviceSource.indexOf("async respondApproval("));
  assert.match(listBody, /status === "running"/);
  assert.match(listBody, /Child agent run is no longer active/);
  const runningGuard = listBody.indexOf('status === "running"');
  const failCall = listBody.indexOf("Child agent run is no longer active");
  assert.ok(runningGuard >= 0 && runningGuard < failCall);

  const indexSource = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
  assert.match(indexSource, /delegated agent start failed child=/);
  assert.match(indexSource, /const persistedError = String\(latest\?\.error \|\| ""\)\.trim\(\)/);

  let failedReason = "";
  const queued = { id: "inspect-1", childThreadId: "child-inspect", parentThreadId: "parent", status: "queued" };
  const workspaceRecord = { id: "workspace", threads: [{ id: "parent" }, { id: "child-inspect" }] };
  const service = new DelegatedAgentIpcService({
    readCatalog: async () => ({ workspaces: [workspaceRecord] }),
    listTasks: () => [queued],
    readState: async () => ({ agentCheckpoint: { status: "idle" } }),
    respondApproval: () => undefined,
    run: async () => queued,
    observeRunFailure: () => undefined,
    hasActiveRun: () => false,
    failTask: (current, reason) => {
      failedReason = reason;
      current.status = "failed";
      current.error = reason;
      return { ...current };
    }
  } as never);
  const queuedTasks = await service.list({ workspaceId: "workspace", parentThreadId: "parent" });
  assert.equal(queuedTasks[0].status, "queued");
  assert.equal(failedReason, "");

  const running = { id: "inspect-2", childThreadId: "child-running", parentThreadId: "parent", status: "running" };
  const abandoned = new DelegatedAgentIpcService({
    readCatalog: async () => ({ workspaces: [{ id: "workspace", threads: [{ id: "parent" }, { id: "child-running" }] }] }),
    listTasks: () => [running],
    readState: async () => ({ agentCheckpoint: { status: "running" } }),
    respondApproval: () => undefined,
    run: async () => running,
    observeRunFailure: () => undefined,
    hasActiveRun: () => false,
    failTask: (current, reason) => {
      failedReason = reason;
      current.status = "failed";
      current.error = reason;
      return { ...current };
    }
  } as never);
  const abandonedTasks = await abandoned.list({ workspaceId: "workspace", parentThreadId: "parent" });
  assert.equal(abandonedTasks[0].status, "failed");
  assert.match(failedReason, /no longer active/i);
});
