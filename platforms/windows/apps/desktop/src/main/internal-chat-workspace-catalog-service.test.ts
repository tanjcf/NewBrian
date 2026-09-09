import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import type { WorkspaceCatalogItem } from "@codex-forge/protocol";

const { ensureInternalChatWorkspaceCatalog } = await import(
  new URL("./internal-chat-workspace-catalog-service.ts", import.meta.url).href
);
const { INTERNAL_CHAT_WORKSPACE_ID, ensureInternalChatWorkspace } = await import(
  new URL("./internal-chat-workspace.ts", import.meta.url).href
);

function workspace(overrides: Partial<WorkspaceCatalogItem> = {}): WorkspaceCatalogItem {
  return {
    id: "workspace-user",
    name: "User project",
    path: "C:\\Projects\\user-project",
    threads: [],
    ...overrides
  };
}

test("persists one chat-scoped internal workspace only when the catalog changes", async () => {
  const directories: string[] = [];
  const writes: WorkspaceCatalogItem[][] = [];
  const first = await ensureInternalChatWorkspaceCatalog({
    workspaces: [workspace()],
    internalChatPath: "C:\\Apps\\NewBrain\\tmp",
    ensureDirectory: async (path: string) => { directories.push(path); },
    ensureWorkspace: ensureInternalChatWorkspace,
    writeCatalog: async (workspaces: WorkspaceCatalogItem[]) => {
      writes.push(workspaces);
      return { workspaces };
    }
  });
  const second = await ensureInternalChatWorkspaceCatalog({
    workspaces: first.catalog.workspaces,
    internalChatPath: "C:\\Apps\\NewBrain\\tmp",
    ensureDirectory: async (path: string) => { directories.push(path); },
    ensureWorkspace: ensureInternalChatWorkspace,
    writeCatalog: async (workspaces: WorkspaceCatalogItem[]) => {
      writes.push(workspaces);
      return { workspaces };
    }
  });
  const internal = first.catalog.workspaces.find((item: WorkspaceCatalogItem) => item.id === INTERNAL_CHAT_WORKSPACE_ID);

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(writes.length, 1);
  assert.deepEqual(directories, ["C:\\Apps\\NewBrain\\tmp", "C:\\Apps\\NewBrain\\tmp"]);
  assert.equal(internal?.path, resolve("C:\\Apps\\NewBrain\\tmp"));
  assert.deepEqual(internal?.threads, []);
});

test("retains chat-scoped threads while persisting the internal workspace", async () => {
  const result = await ensureInternalChatWorkspaceCatalog({
    workspaces: [workspace({
      id: INTERNAL_CHAT_WORKSPACE_ID,
      name: "legacy internal chat",
      path: "C:\\old",
      threads: [{
        id: "chat-1",
        title: "Standalone chat",
        summary: "",
        scope: "chat",
        updatedAt: "2026-07-23T00:00:00.000Z"
      }]
    })],
    internalChatPath: "C:\\Apps\\NewBrain\\tmp",
    ensureDirectory: async () => undefined,
    ensureWorkspace: ensureInternalChatWorkspace,
    writeCatalog: async (workspaces: WorkspaceCatalogItem[]) => ({ workspaces })
  });
  const internal = result.catalog.workspaces.find((item: WorkspaceCatalogItem) => item.id === INTERNAL_CHAT_WORKSPACE_ID);

  assert.equal(internal?.threads[0]?.scope, "chat");
});

test("reports the tmp target path when it cannot create the internal chat directory", async () => {
  await assert.rejects(
    ensureInternalChatWorkspaceCatalog({
      workspaces: [],
      internalChatPath: "C:\\Apps\\NewBrain\\tmp",
      ensureDirectory: async () => { throw new Error("access denied"); },
      ensureWorkspace: ensureInternalChatWorkspace,
      writeCatalog: async (workspaces: WorkspaceCatalogItem[]) => ({ workspaces })
    }),
    /Unable to create standalone chat directory at C:\\Apps\\NewBrain\\tmp: access denied/
  );
});
