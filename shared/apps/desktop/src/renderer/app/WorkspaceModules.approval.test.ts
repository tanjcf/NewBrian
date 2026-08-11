import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./WorkspaceModules.tsx", import.meta.url)), "utf8");

test("shows only one approval surface when conversation turns already host the banner", () => {
  assert.match(source, /data-testid="conversation-approval-dialog"/);
  assert.match(source, /data-testid="approval-dialog"/);
  // Composer fallback must not render when the conversation already shows approval.
  assert.match(
    source,
    /effectiveApproval\s*&&\s*conversationTurns\.length\s*===\s*0\s*\?\s*\(/
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

test("approval resume success settles again after activateWorkspaceThread", () => {
  assert.match(
    source,
    /activateWorkspaceThread\(\{[\s\S]*?\}\)[\s\S]*?settleApprovalRequest\(requestId,\s*selectedThread\.id,\s*settledSnapshot\)/
  );
});
