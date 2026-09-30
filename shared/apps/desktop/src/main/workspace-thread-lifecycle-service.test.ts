import assert from "node:assert/strict";
import test from "node:test";

const { WorkspaceThreadLifecycleService } = await import(
  new URL("./workspace-thread-lifecycle-service.ts", import.meta.url).href
);

function thread(id: string, title = id) {
  return { id, title, summary: "summary", updatedAt: "2026-07-18T00:00:00.000Z" };
}

function fixture(workspaces: unknown[]) {
  const writes: unknown[][] = [];
  const states: unknown[] = [];
  const delegations: unknown[] = [];
  const service = new WorkspaceThreadLifecycleService({
    readCatalog: async () => ({ workspaces }),
    writeCatalog: async (next: unknown[]) => {
      writes.push(next);
      return { workspaces: next };
    },
    normalizeThread: (input: Record<string, unknown>) => ({ id: "new-thread", updatedAt: "2026-07-18T00:00:00.000Z", ...input }),
    sortThreads: (items: unknown[]) => items,
    createDefaultState: () => ({ version: 2, messages: [], memories: [], runs: [], timeline: [], events: [] }),
    writeState: async (_workspace: unknown, nextThread: unknown) => { states.push(nextThread); },
    cloneState: async (_workspace: unknown, _source: unknown, nextThread: unknown) => { states.push(nextThread); },
    ensureCatalogState: async () => undefined,
    registerDelegation: async (input: unknown) => { delegations.push(input); },
    updateMetadata: async () => ({ workspaces })
  } as never);
  return { service, writes, states, delegations };
}

test("rejects thread creation for a missing workspace without writing the catalog", async () => {
  const { service, writes } = fixture([]);
  await assert.rejects(
    service.add({ workspaceId: "missing", title: "Title", summary: "Summary" }),
    /Workspace was not found/
  );
  assert.equal(writes.length, 0);
});

test("creates the catalog entry before its durable default state", async () => {
  const workspace = { id: "workspace-1", name: "Workspace", threads: [] };
  const { service, writes, states } = fixture([workspace]);
  const catalog = await service.add({ workspaceId: workspace.id, title: "Title", summary: "Summary" });
  assert.equal(writes.length, 1);
  assert.equal((catalog.workspaces[0] as { threads: unknown[] }).threads.length, 1);
  assert.equal(states.length, 1);
});

test("adds a chat-scoped thread to the internal workspace without changing its scope on write", async () => {
  const workspace = { id: "workspace:internal-chat", name: "Standalone chat", threads: [] };
  const { service, writes } = fixture([workspace]);
  const catalog = await service.add({
    workspaceId: workspace.id,
    title: "Standalone chat",
    summary: "Summary",
    scope: "chat"
  });
  const persistedThread = (writes[0][0] as { threads: Array<{ scope: string }> }).threads[0];

  assert.equal(persistedThread.scope, "chat");
  assert.equal((catalog.workspaces[0].threads[0] as { scope: string }).scope, "chat");
});

test("clones state before registering one normalized delegation", async () => {
  const source = thread("source", "Source");
  const workspace = { id: "workspace-1", name: "Workspace", threads: [source] };
  const { service, states, delegations } = fixture([workspace]);
  await service.fork({ workspaceId: workspace.id, sourceThreadId: source.id, title: " Child " });
  assert.equal(states.length, 1);
  assert.equal(delegations.length, 1);
  assert.equal((delegations[0] as { instruction: string }).instruction, "Continue from Source in an isolated child thread.");
});
