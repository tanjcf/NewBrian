import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveLegacySidebarRowForThread,
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
