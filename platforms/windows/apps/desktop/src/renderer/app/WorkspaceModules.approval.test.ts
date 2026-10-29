import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const localPath = fileURLToPath(new URL("./WorkspaceModules.tsx", import.meta.url));
const sharedPath = fileURLToPath(new URL("../../../../../../../shared/apps/desktop/src/renderer/app/WorkspaceModules.tsx", import.meta.url));
const source = readFileSync(existsSync(localPath) ? localPath : sharedPath, "utf8");

test("shows only one approval surface when conversation turns already host the banner", () => {
  assert.match(source, /data-testid="conversation-approval-dialog"/);
  assert.match(source, /data-testid="approval-dialog"/);
  // Composer fallback must not render when the conversation already shows approval.
  assert.match(
    source,
    /effectiveApproval\s*&&\s*conversationTurns\.length\s*===\s*0\s*\?\s*\(/
  );
});

test("approval resume catch clears the live busy request instead of sticking on 处理中", () => {
  assert.match(
    source,
    /settleApprovalRequest\(requestId,\s*selectedThread\?\.id \|\| "",\s*\{\s*approval:\s*null,\s*pendingTool:\s*null/
  );
});

test("full access auto-approves the pending tool and upgrades the running loop", () => {
  assert.match(source, /void handleApprovalResponse\(true\)/);
  assert.match(source, /composerPermission === "full" \? \{ permissionMode: "full" as const \} : \{\}/);
  assert.match(source, /applyLivePermissionMode\(\{ requestId, permissionMode: "full" \}\)/);
});

test("approval resume success settles again after activateWorkspaceThread", () => {
  assert.match(
    source,
    /activateWorkspaceThread\(\{[\s\S]*?\}\)[\s\S]*?settleApprovalRequest\(requestId,\s*selectedThread\.id,\s*settledSnapshot\)/
  );
});

test("approve click retains settled guard when the same approval id is replayed", () => {
  assert.match(source, /shouldRetainSettledApprovalGuard/);
  assert.match(source, /stripSettledApprovalFromSnapshot/);
  assert.match(source, /if\s*\(\s*!retainSettledGuard\s*\)\s*\{\s*setSettledApprovalId\(""\)/);
  assert.match(source, /forceClearApproval:\s*true/);
  assert.doesNotMatch(
    source,
    /returnedApprovalId\s*&&\s*returnedApprovalId\s*===\s*decidedApprovalId\s*\)\s*\{\s*setSettledApprovalId\(""\)/
  );
});
