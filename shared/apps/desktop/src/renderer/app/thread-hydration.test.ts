import assert from "node:assert/strict";
import test from "node:test";
import {
  parseLegacySidebarRow,
  resolveLegacySidebarRowForThread,
  resolveSidebarRowThreadTarget,
  shouldPreferSidebarRowThreadRestore,
  snapshotToDisplayMessages
} from "./thread-hydration.ts";

test("maps persisted snapshots to user and assistant display messages only", () => {
  const messages = snapshotToDisplayMessages({
    messages: [
      { id: "sys", role: "system", content: "boot" },
      { id: "u1", role: "user", content: "hello" },
      { id: "a1", role: "assistant", content: "hi" }
    ]
  } as never);
  assert.deepEqual(messages.map((message) => message.id), ["u1", "a1"]);
});

test("builds legacy sidebar rows for project and chat scoped threads", () => {
  assert.equal(
    resolveLegacySidebarRowForThread({
      workspaceId: "workspace-a",
      threadId: "thread-1",
      scope: "project"
    }),
    "project-thread:workspace-a:thread-1"
  );
  assert.equal(
    resolveLegacySidebarRowForThread({
      workspaceId: "workspace:internal-chat",
      threadId: "thread-2",
      scope: "chat"
    }),
    "chat:workspace:internal-chat:thread-2"
  );
});

test("parseLegacySidebarRow handles chat and project-thread rows with colon workspace ids", () => {
  assert.deepEqual(parseLegacySidebarRow("project-thread:workspace-a:thread-1"), {
    kind: "project-thread",
    workspaceId: "workspace-a",
    threadId: "thread-1"
  });
  assert.deepEqual(parseLegacySidebarRow("chat:workspace:internal-chat:thread-2"), {
    kind: "chat",
    workspaceId: "workspace:internal-chat",
    threadId: "thread-2"
  });
  assert.deepEqual(parseLegacySidebarRow("brain-conversation:conv-1"), {
    kind: "brain-conversation",
    conversationId: "conv-1"
  });
  assert.equal(parseLegacySidebarRow("feature:new-chat")?.kind, "other");
});

test("resolveSidebarRowThreadTarget finds catalog threads and skips archived ones", () => {
  const workspaces = [
    {
      id: "workspace-a",
      threads: [
        { id: "thread-1", archived: false },
        { id: "thread-old", archived: true }
      ]
    }
  ];
  assert.deepEqual(resolveSidebarRowThreadTarget({
    sidebarRow: "project-thread:workspace-a:thread-1",
    workspaces
  }), {
    kind: "project-thread",
    workspace: workspaces[0],
    thread: workspaces[0].threads[0]
  });
  assert.equal(resolveSidebarRowThreadTarget({
    sidebarRow: "project-thread:workspace-a:thread-old",
    workspaces
  }), null);
  assert.equal(resolveSidebarRowThreadTarget({
    sidebarRow: "project-thread:missing:thread-1",
    workspaces
  }), null);
  assert.equal(resolveSidebarRowThreadTarget({
    sidebarRow: "project-thread:workspace-a:child",
    workspaces: [{
      id: "workspace-a",
      threads: [
        { id: "thread-1", archived: false },
        { id: "child", archived: false, kind: "subagent" }
      ]
    }]
  }), null);
});

test("shouldPreferSidebarRowThreadRestore only when sidebar row disagrees with selection", () => {
  const workspaces = [{ id: "workspace-a", threads: [{ id: "thread-1" }] }];
  assert.equal(shouldPreferSidebarRowThreadRestore({
    sidebarRow: "project-thread:workspace-a:thread-1",
    selectedWorkspaceId: "workspace-a",
    selectedThreadId: "thread-2",
    workspaces
  }), true);
  assert.equal(shouldPreferSidebarRowThreadRestore({
    sidebarRow: "project-thread:workspace-a:thread-1",
    selectedWorkspaceId: "workspace-a",
    selectedThreadId: "thread-1",
    workspaces
  }), false);
});
