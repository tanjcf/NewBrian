import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("activates and synchronizes the native thread mapped to a BRAIN conversation", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");

  assert.match(source, /brainConversationThreads\[selectedBrainConversationId\]/);
  assert.match(source, /api\.activateWorkspaceThread\(\{\s*workspaceId:\s*selectedWorkspace\.id,\s*threadId:\s*mappedThreadId\s*\}\)/);
  assert.match(source, /syncSnapshot\(threadSnapshot,\s*mappedThreadId\)/);
});
