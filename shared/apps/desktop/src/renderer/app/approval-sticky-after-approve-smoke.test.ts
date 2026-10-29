/**
 * APPROVAL-STICKY-AFTER-APPROVE-SMOKE-001
 * Packaging must run this case and stop when it fails.
 *
 * Regression: user clicked「批准并继续」but UI stayed on「等待批准」/
 * 「处理中，发送后排队」because:
 * 1) respondApproval / activateWorkspaceThread replayed the same approval id
 * 2) handleApprovalResponse cleared settledApprovalId on that replay
 * 3) listWorkspaces reintroduced catalog awaiting-approval
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  resolveEffectiveApproval,
  shouldRetainSettledApprovalGuard,
  stripSettledApprovalFromSnapshot
} from "./assistant-activity-merge.ts";
import { threadStillNeedsApproval } from "./thread-activity-policy.ts";

export const CASE_ID = "APPROVAL-STICKY-AFTER-APPROVE-SMOKE-001";

function brainSourceRoot() {
  const envRoot = String(process.env.NEWBRAIN_SOURCE_ROOT || "").trim();
  if (envRoot && existsSync(path.join(envRoot, "platforms", "windows"))) return envRoot;
  let current = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(path.join(current, "platforms", "windows")) && existsSync(path.join(current, "shared"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "";
}

function readFirst(candidates: string[]) {
  for (const filePath of candidates) {
    if (existsSync(filePath)) return { path: filePath, text: readFileSync(filePath, "utf8") };
  }
  throw new Error(`Missing source: ${candidates.join(" | ")}`);
}

test(`${CASE_ID} keeps settled guard when the same approval id is replayed`, () => {
  assert.equal(shouldRetainSettledApprovalGuard({
    settledApprovalId: "apr-1",
    returnedApprovalId: "apr-1"
  }), true);
  assert.equal(shouldRetainSettledApprovalGuard({
    settledApprovalId: "apr-1",
    returnedApprovalId: ""
  }), true);
  assert.equal(shouldRetainSettledApprovalGuard({
    settledApprovalId: "apr-1",
    returnedApprovalId: "apr-2"
  }), false);
});

test(`${CASE_ID} strips replayed approval so banner and busy can settle`, () => {
  const stripped = stripSettledApprovalFromSnapshot({
    approval: { id: "apr-1", message: "确认执行" },
    pendingTool: { kind: "shell" },
    session: { status: "awaiting-approval" }
  }, "apr-1");
  assert.equal(stripped.approval, null);
  assert.equal(stripped.pendingTool, null);
  assert.equal(stripped.session?.status, "running");

  const nextTool = stripSettledApprovalFromSnapshot({
    approval: { id: "apr-2", message: "下一个工具" },
    pendingTool: { kind: "shell" },
    session: { status: "awaiting-approval" }
  }, "apr-1");
  assert.equal(nextTool.approval?.id, "apr-2");

  const phantom = stripSettledApprovalFromSnapshot({
    approval: { message: "无 id 幽灵批准" },
    pendingTool: { kind: "shell" },
    session: { status: "awaiting-approval" }
  }, "pending", { forceClearApproval: true });
  assert.equal(phantom.approval, null);
  assert.equal(phantom.session?.status, "running");
});

test(`${CASE_ID} effective approval and sidebar badge ignore settled replay`, () => {
  assert.equal(resolveEffectiveApproval({
    snapshotApproval: { id: "apr-1", message: "确认执行" },
    selectedThreadOwnsLiveApproval: true,
    selectedThreadAwaitingApproval: true,
    selectedThreadHasLiveRequest: true,
    settledApprovalId: "apr-1"
  }), null);

  assert.equal(threadStillNeedsApproval({
    threadStatus: "awaiting-approval",
    threadKey: "ws:thread",
    pendingApprovalThreadKey: "ws:thread",
    threadId: "thread",
    settledApprovalId: "apr-1",
    settledThreadId: "thread",
    snapshotApprovalId: "apr-1"
  }), false);
});

test(`${CASE_ID} handleApprovalResponse retains settled guard and strips activate reload`, () => {
  const root = brainSourceRoot();
  assert.ok(root, "BRAIN source root");
  const { text } = readFirst([
    path.join(root, "shared", "apps", "desktop", "src", "renderer", "app", "WorkspaceModules.tsx"),
    path.join(root, "platforms", "windows", "apps", "desktop", "src", "renderer", "app", "WorkspaceModules.tsx")
  ]);
  assert.match(text, /shouldRetainSettledApprovalGuard/);
  assert.match(text, /stripSettledApprovalFromSnapshot/);
  assert.match(text, /retainSettledGuard/);
  assert.match(text, /forceClearApproval:\s*true/);
  assert.match(text, /markThreadApprovalSettlingInCatalog\(/);
  // Must not clear settledApprovalId merely because the same id came back.
  assert.doesNotMatch(
    text,
    /returnedApprovalId\s*&&\s*returnedApprovalId\s*===\s*decidedApprovalId\s*\)\s*\{\s*setSettledApprovalId\(""\)/
  );
  assert.match(
    text,
    /if\s*\(\s*!retainSettledGuard\s*\)\s*\{\s*setSettledApprovalId\(""\)\s*;?\s*\}/
  );
});
