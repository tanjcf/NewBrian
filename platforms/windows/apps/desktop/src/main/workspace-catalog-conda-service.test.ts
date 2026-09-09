import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceCatalogItem } from "@codex-forge/protocol";

const { ensureWorkspaceCatalogConda } = await import(
  new URL("./workspace-catalog-conda-service.ts", import.meta.url).href
);
const { INTERNAL_CHAT_WORKSPACE_ID, isInternalChatWorkspace } = await import(
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

test("preserves the internal chat workspace without provisioning Conda", async () => {
  const internal = workspace({
    id: INTERNAL_CHAT_WORKSPACE_ID,
    name: "__internal_chat__",
    path: "C:\\Apps\\NewBrain\\tmp"
  });
  let provisioningCalls = 0;
  const result = await ensureWorkspaceCatalogConda({
    catalog: { workspaces: [internal] },
    isInternalWorkspace: isInternalChatWorkspace,
    provisionWorkspace: async () => {
      provisioningCalls += 1;
      return { config: undefined };
    },
    normalizeWorkspace: (item: WorkspaceCatalogItem) => item,
    writeCatalog: async (workspaces: WorkspaceCatalogItem[]) => ({ workspaces }),
    onProvisionError: () => undefined
  });

  assert.equal(provisioningCalls, 0);
  assert.equal(result.workspaces[0], internal);
});

test("continues provisioning project workspaces", async () => {
  const project = workspace();
  let writes = 0;
  const result = await ensureWorkspaceCatalogConda({
    catalog: { workspaces: [project] },
    isInternalWorkspace: isInternalChatWorkspace,
    provisionWorkspace: async () => ({
      config: {
        source: "managed",
        condaPath: "C:\\Conda\\conda.exe",
        envPath: "C:\\Envs\\workspace-user",
        envName: "newbrain-workspace-user",
        pythonVersion: "3.11"
      }
    }),
    normalizeWorkspace: (item: WorkspaceCatalogItem) => item,
    writeCatalog: async (workspaces: WorkspaceCatalogItem[]) => {
      writes += 1;
      return { workspaces };
    },
    onProvisionError: () => undefined
  });

  assert.equal(writes, 1);
  assert.equal(result.workspaces[0].conda?.envName, "newbrain-workspace-user");
});
