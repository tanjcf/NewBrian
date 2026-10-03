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
    /shownApproval\s*&&\s*conversationTurns\.length\s*===\s*0\s*\?\s*\(/
  );
  assert.doesNotMatch(
    source,
    /\{effectiveApproval\s*\?\s*\(\s*<section className="approval-request-banner composer-approval-banner"/
  );
});

test("approval resume catch clears the live busy request instead of sticking on 处理中", () => {
  assert.match(
    source,
    /settleApprovalRequest\(requestId,\s*selectedThread\?\.id \|\| "",\s*\{\s*approval:\s*null,\s*pendingTool:\s*null/
  );
});

test("full access auto-approves the pending tool and upgrades the running loop", () => {
  assert.match(source, /const shownApproval = composerPermission === "full" && !approvalError \? null : effectiveApproval/);
  assert.match(source, /void handleApprovalResponse\(true, "full"\)/);
  assert.match(source, /permissionMode === "full" \? \{ permissionMode \} : \{\}/);
  assert.match(source, /chooseComposerPermission\(option\.id === "full" \? "full" : "agent"\)/);
  assert.match(source, /fullAccess: mode === "full"/);
});

test("approval resume success settles again after activateWorkspaceThread", () => {
  assert.match(
    source,
    /activateWorkspaceThread\(\{[\s\S]*?\}\)[\s\S]*?settleApprovalRequest\(requestId,\s*selectedThread\.id,\s*settledSnapshot\)/
  );
});
