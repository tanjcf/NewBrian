import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import type { WorkspaceCatalogItem } from "@codex-forge/protocol";

const policy = await import(new URL("./internal-chat-workspace.ts", import.meta.url).href);

function workspace(overrides: Partial<WorkspaceCatalogItem> = {}): WorkspaceCatalogItem {
  return {
    id: "workspace-user",
    name: "User project",
    path: "C:\\Projects\\user-project",
    threads: [],
    ...overrides
  };
}

test("resolves the packaged chat cwd beside NewBrain.exe", () => {
  assert.equal(policy.resolveInternalChatPath({
    isPackaged: true,
    execPath: "C:\\Apps\\NewBrain\\NewBrain.exe",
    workspacePath: "C:\\Users\\me\\.newbrain"
  }), "C:\\Apps\\NewBrain\\tmp");
});

test("resolves the development chat cwd beneath the workspace", () => {
  assert.equal(policy.resolveInternalChatPath({
    isPackaged: false,
    execPath: "C:\\Apps\\NewBrain\\NewBrain.exe",
    workspacePath: "C:\\Users\\me\\NewBrain"
  }), "C:\\Users\\me\\NewBrain\\tmp");
});

test("adds exactly one stable hidden chat workspace idempotently", () => {
  const first = policy.ensureInternalChatWorkspace([workspace()], "C:\\Apps\\NewBrain\\tmp");
  const second = policy.ensureInternalChatWorkspace(first, "C:\\Apps\\NewBrain\\tmp");
  const internal = second.filter(policy.isInternalChatWorkspace);

  assert.equal(internal.length, 1);
  assert.equal(internal[0].id, policy.INTERNAL_CHAT_WORKSPACE_ID);
  assert.equal(internal[0].path, resolve("C:\\Apps\\NewBrain\\tmp"));
  assert.notEqual(internal[0].name, "tmp");
  assert.deepEqual(second.filter((item: WorkspaceCatalogItem) => item.id === "workspace-user"), [workspace()]);
});

test("uses the stable ID as the only internal workspace identity", () => {
  assert.equal(policy.isInternalChatWorkspace(workspace({
    id: policy.INTERNAL_CHAT_WORKSPACE_ID,
    name: "ordinary-looking project",
    path: "C:\\Projects\\ordinary"
  })), true);
  assert.equal(policy.isInternalChatWorkspace(workspace({
    id: "workspace-user",
    name: "tmp",
    path: "C:\\Apps\\NewBrain\\tmp"
  })), false);
});

test("repairs the internal record with only chat-scope threads", () => {
  const repaired = policy.ensureInternalChatWorkspace([workspace({
    id: policy.INTERNAL_CHAT_WORKSPACE_ID,
    name: "old visible name",
    path: "C:\\old",
    threads: [
      { id: "chat-1", title: "Chat", summary: "", scope: "chat", updatedAt: "2026-07-23T00:00:00.000Z" },
      { id: "project-1", title: "Project", summary: "", scope: "project", updatedAt: "2026-07-23T00:00:00.000Z" },
      { id: "legacy-1", title: "Legacy", summary: "", updatedAt: "2026-07-23T00:00:00.000Z" }
    ]
  })], "C:\\Apps\\NewBrain\\tmp");

  assert.deepEqual(repaired[0].threads.map((thread: { id: string }) => thread.id), ["chat-1"]);
  assert.equal(repaired[0].path, resolve("C:\\Apps\\NewBrain\\tmp"));
});

test("repairs duplicate internal records into one chat-thread workspace", () => {
  const repaired = policy.ensureInternalChatWorkspace([
    workspace({
      id: policy.INTERNAL_CHAT_WORKSPACE_ID,
      name: "first internal record",
      path: "C:\\old-one",
      threads: [
        { id: "chat-1", title: "First chat", summary: "", scope: "chat", updatedAt: "2026-07-23T00:00:00.000Z" },
        { id: "project-1", title: "Project", summary: "", scope: "project", updatedAt: "2026-07-23T00:00:00.000Z" }
      ]
    }),
    workspace({
      id: policy.INTERNAL_CHAT_WORKSPACE_ID,
      name: "second internal record",
      path: "C:\\old-two",
      threads: [
        { id: "chat-2", title: "Second chat", summary: "", scope: "chat", updatedAt: "2026-07-23T00:00:00.000Z" }
      ]
    }),
    workspace({ id: "workspace-user", name: "User project" })
  ], "C:\\Apps\\NewBrain\\tmp");
  const internal = repaired.filter(policy.isInternalChatWorkspace);

  assert.equal(internal.length, 1);
  assert.deepEqual(internal[0].threads.map((thread: { id: string }) => thread.id), ["chat-1", "chat-2"]);
  assert.deepEqual(repaired.map((item: WorkspaceCatalogItem) => item.id), [
    policy.INTERNAL_CHAT_WORKSPACE_ID,
    "workspace-user"
  ]);
});

test("deduplicates merged chat thread IDs with the first occurrence winning", () => {
  const userWorkspace = workspace({ id: "workspace-user", name: "User project" });
  const repaired = policy.ensureInternalChatWorkspace([
    workspace({
      id: policy.INTERNAL_CHAT_WORKSPACE_ID,
      threads: [
        { id: "shared", title: "First shared chat", summary: "first", scope: "chat", updatedAt: "2026-07-23T00:00:00.000Z" },
        { id: "chat-1", title: "First unique chat", summary: "", scope: "chat", updatedAt: "2026-07-23T00:00:00.000Z" }
      ]
    }),
    userWorkspace,
    workspace({
      id: policy.INTERNAL_CHAT_WORKSPACE_ID,
      threads: [
        { id: "shared", title: "Later shared chat", summary: "later", scope: "chat", updatedAt: "2026-07-24T00:00:00.000Z" },
        { id: "project-1", title: "Project thread", summary: "", scope: "project", updatedAt: "2026-07-23T00:00:00.000Z" },
        { id: "chat-2", title: "Second unique chat", summary: "", scope: "chat", updatedAt: "2026-07-23T00:00:00.000Z" }
      ]
    })
  ], "C:\\Apps\\NewBrain\\tmp");
  const internal = repaired.filter(policy.isInternalChatWorkspace);

  assert.equal(internal.length, 1);
  assert.deepEqual(internal[0].threads.map((thread: { id: string }) => thread.id), ["shared", "chat-1", "chat-2"]);
  assert.equal(internal[0].threads[0].title, "First shared chat");
  assert.deepEqual(repaired.filter((item: WorkspaceCatalogItem) => item.id === "workspace-user"), [userWorkspace]);
});

test("blocks project-only operations for the internal workspace", () => {
  assert.throws(
    () => policy.assertProjectWorkspace(policy.INTERNAL_CHAT_WORKSPACE_ID),
    new Error("Project operations are not available for standalone chat.")
  );
  assert.doesNotThrow(() => policy.assertProjectWorkspace("workspace-user"));
});
