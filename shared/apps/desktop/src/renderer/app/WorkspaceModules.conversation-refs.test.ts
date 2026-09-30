import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");

test("composer wires @ conversation mention picker and ref chips", () => {
  assert.match(source, /composer-mention-picker/);
  assert.match(source, /composer-conversation-refs/);
  assert.match(source, /injectConversationRefsIntoQuestion/);
  assert.match(source, /previewConversationRef/);
  assert.match(source, /onMentionQueryChange=\{setComposerMentionQuery\}/);
});

test("approval banners surface policy category tags", () => {
  assert.match(source, /approval-category-tags/);
  assert.match(source, /buildApprovalUx/);
  assert.match(source, /approvalUx\.reasonText/);
});
