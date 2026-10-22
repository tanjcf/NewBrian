/**
 * EMPTY-CHAT-PLACEHOLDER-SMOKE-001
 * Packaging must run this case and stop when it fails.
 * An empty chat list must not render the 「暂无聊天」 placeholder.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

export const CASE_ID = "EMPTY-CHAT-PLACEHOLDER-SMOKE-001";

test(`${CASE_ID} WorkspaceModules empty chat path never mounts 「暂无聊天」`, () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /暂无聊天/);
  assert.match(source, /visibleSidebarTaskEntries\.map\(renderSidebarTaskEntry\)/);
  assert.match(source, /data-testid="new-chat-button"/);
  assert.match(source, /<strong>新对话<\/strong>/);
});
