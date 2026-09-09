import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

const policy = await import(new URL("./workspace-catalog-policy.ts", import.meta.url).href);
const context = {
  workspacePath: resolve("default-workspace"),
  makeId: (prefix: string) => `${prefix}-fixed`,
  nowIso: () => "2026-07-17T00:00:00.000Z",
  getWorkspaceEnvRoot: (id: string) => resolve("envs", id),
  makeWorkspaceEnvName: (id: string) => `newbrain-${id}`
};

test("repairs persisted thread text and applies bounded defaults", () => {
  const thread = policy.normalizeWorkspaceThread({ title: "榛樿绾跨▼", status: "unknown" }, context);
  assert.equal(thread.id, "thread-fixed");
  assert.equal(thread.title, "默认线程");
  assert.equal(thread.status, "idle");
  assert.equal(thread.scope, "project");
  assert.equal(thread.updatedAt, context.nowIso());
});

test("defaults missing brainWorkspaceKey to document scene", () => {
  const workspace = policy.normalizeWorkspaceCatalogItem({
    id: "workspace-legacy",
    path: "./legacy",
    threads: []
  }, context);
  assert.equal(workspace.brainWorkspaceKey, "document");
});

test("preserves an explicit brainWorkspaceKey on catalog items", () => {
  const workspace = policy.normalizeWorkspaceCatalogItem({
    id: "workspace-quant",
    path: "./quant",
    brainWorkspaceKey: "quant",
    threads: []
  }, context);
  assert.equal(workspace.brainWorkspaceKey, "quant");
});

test("normalizes workspace identity, thread order, and Conda defaults", () => {
  const workspace = policy.normalizeWorkspaceCatalogItem({
    id: " workspace-1 ",
    path: " ./project ",
    threads: [
      { id: "old", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "new", updatedAt: "2026-02-01T00:00:00.000Z" }
    ],
    conda: { condaPath: " C:/conda.exe " }
  }, context);
  assert.equal(workspace.id, "workspace-1");
  assert.equal(workspace.path, resolve("project"));
  assert.deepEqual(workspace.threads.map((thread: { id: string }) => thread.id), ["new", "old"]);
  assert.deepEqual(workspace.conda, {
    source: "system",
    condaPath: "C:/conda.exe",
    envPath: resolve("envs", "workspace-1"),
    envName: "newbrain-workspace-1",
    pythonVersion: "3.11",
    lastCheckedAt: undefined,
    lastProvisionedAt: undefined
  });
});

test("drops incomplete Conda metadata", () => {
  assert.equal(policy.normalizeWorkspaceCondaConfig("workspace-1", { condaPath: " " }, context), undefined);
});

test("removes only the generated default workspace and preserves user projects", () => {
  assert.equal(typeof policy.removeGeneratedDefaultWorkspace, "function");
  const userWorkspace = { id: "workspace-user", name: "workspace", path: resolve("user-workspace"), threads: [] };
  assert.deepEqual(policy.removeGeneratedDefaultWorkspace([
    { id: "workspace-newbrain", name: "workspace", path: resolve("generated-workspace"), threads: [] },
    userWorkspace
  ]), [userWorkspace]);
  assert.deepEqual(policy.removeGeneratedDefaultWorkspace([]), []);
});
