import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLegacyConversationThreadMappings,
  mergeConversationThreadMappings,
  parseLegacyConversationThreadId,
  resolveBrainProjectForWorkspace,
  resolveLegacyConversationIdForThread,
  shouldSyncBrainConversationThread
} from "./brain-project-binding.ts";

test("resolves brain project by bound local workspace id", () => {
  const project = resolveBrainProjectForWorkspace([
    { id: "brain-a", localWorkspaceId: "workspace-a" },
    { id: "brain-b", localWorkspaceId: "workspace-b" }
  ], "workspace-b");
  assert.equal(project?.id, "brain-b");
});

test("builds legacy conversation to thread mappings for historical imports", () => {
  const mappings = buildLegacyConversationThreadMappings({
    conversations: [{ id: "conversation_legacy_thread-1" }, { id: "conversation_new" }],
    threads: [{ id: "thread-1" }, { id: "thread-2" }]
  });
  assert.deepEqual(mappings, { "conversation_legacy_thread-1": "thread-1" });
  assert.equal(parseLegacyConversationThreadId("conversation_legacy_thread-1"), "thread-1");
  assert.equal(resolveLegacyConversationIdForThread("thread-9"), "conversation_legacy_thread-9");
});

test("only syncs brain conversation threads for explicit brain-conversation rows in the same workspace", () => {
  assert.equal(shouldSyncBrainConversationThread({
    sidebarRow: "project:workspace-a",
    selectedWorkspaceId: "workspace-a",
    boundWorkspaceId: "workspace-a"
  }), false);
  assert.equal(shouldSyncBrainConversationThread({
    sidebarRow: "feature:new-chat",
    selectedWorkspaceId: "workspace-a",
    boundWorkspaceId: "workspace-a"
  }), false);
  assert.equal(shouldSyncBrainConversationThread({
    sidebarRow: "chat:workspace-a:thread-1",
    selectedWorkspaceId: "workspace-a",
    boundWorkspaceId: "workspace-a"
  }), false);
  assert.equal(shouldSyncBrainConversationThread({
    sidebarRow: "task:workspace-a:thread-1",
    selectedWorkspaceId: "workspace-a",
    boundWorkspaceId: "workspace-a"
  }), false);
  assert.equal(shouldSyncBrainConversationThread({
    sidebarRow: "brain-conversation:conv-a",
    selectedWorkspaceId: "workspace-a",
    boundWorkspaceId: "workspace-b"
  }), false);
  assert.equal(shouldSyncBrainConversationThread({
    sidebarRow: "brain-conversation:conv-a",
    selectedWorkspaceId: "workspace-a",
    boundWorkspaceId: "workspace-a"
  }), true);
});

test("mergeConversationThreadMappings keeps existing entries and adds missing legacy ones", () => {
  const merged = mergeConversationThreadMappings(
    { "conversation_legacy_thread-1": "thread-1" },
    { "conversation_legacy_thread-2": "thread-2", "conversation_legacy_thread-1": "thread-1" }
  );
  assert.deepEqual(merged, {
    "conversation_legacy_thread-1": "thread-1",
    "conversation_legacy_thread-2": "thread-2"
  });
});
