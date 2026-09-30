import assert from "node:assert/strict";
import test from "node:test";

const { ThreadRolloutLifecycleService } = await import(
  new URL("./thread-rollout-lifecycle-service.ts", import.meta.url).href
);

function fixture(initial = ["active/thread.rollout.jsonl"], failEnsure = false) {
  const files = new Set(initial);
  const storage: Array<{ archived: boolean; path: string }> = [];
  const metadata: boolean[] = [];
  const service = new ThreadRolloutLifecycleService({
    getActivePath: () => "active/thread.rollout.jsonl",
    getArchivedPath: () => "archive/thread.rollout.jsonl",
    fileExists: async (path: string) => files.has(path),
    ensureDirectory: async () => undefined,
    unlink: async (path: string) => { files.delete(path); },
    rename: async (source: string, target: string) => {
      if (!files.delete(source)) throw new Error("source missing");
      files.add(target);
    },
    setStorageArchived: (_threadId: string, archived: boolean, path: string) => { storage.push({ archived, path }); },
    updateMetadata: async (input: { archived: boolean }) => {
      metadata.push(input.archived);
      return { workspaces: [] };
    },
    ensureCatalogState: async () => {
      if (failEnsure) throw new Error("activation failed");
    }
  } as never);
  return { service, files, storage, metadata };
}

test("moves an active rollout into archived storage before publishing archived metadata", async () => {
  const { service, files, storage } = fixture();
  await service.setArchived({ workspaceId: "workspace", threadId: "thread", archived: true });
  assert.equal(files.has("active/thread.rollout.jsonl"), false);
  assert.equal(files.has("archive/thread.rollout.jsonl"), true);
  assert.deepEqual(storage.at(-1), { archived: true, path: "archive/thread.rollout.jsonl" });
});

test("rolls the file and metadata direction back when activation fails", async () => {
  const { service, files, storage, metadata } = fixture(["active/thread.rollout.jsonl"], true);
  await assert.rejects(
    service.setArchived({ workspaceId: "workspace", threadId: "thread", archived: true }),
    /activation failed/
  );
  assert.equal(files.has("active/thread.rollout.jsonl"), true);
  assert.deepEqual(metadata, [true, false]);
  assert.equal(storage.at(-1)?.archived, false);
});

test("startup reconciliation moves archived threads in the canonical direction", async () => {
  const { service, files } = fixture();
  await service.reconcileArchived({ id: "workspace" } as never, [{ id: "thread", archived: true }] as never);
  assert.equal(files.has("archive/thread.rollout.jsonl"), true);
});

test("startup reconciliation accepts an existing archived rollout without replacing it", async () => {
  const files = new Set([
    "active/thread.rollout.jsonl",
    "archive/thread.rollout.jsonl"
  ]);
  const storage: Array<{ archived: boolean; path: string }> = [];
  let unlinkCalls = 0;
  const service = new ThreadRolloutLifecycleService({
    getActivePath: () => "active/thread.rollout.jsonl",
    getArchivedPath: () => "archive/thread.rollout.jsonl",
    fileExists: async (path: string) => files.has(path),
    ensureDirectory: async () => undefined,
    unlink: async () => {
      unlinkCalls += 1;
      throw Object.assign(new Error("file is locked"), { code: "EPERM" });
    },
    rename: async () => {
      throw new Error("existing archived rollout must remain canonical");
    },
    setStorageArchived: (_threadId: string, archived: boolean, path: string) => {
      storage.push({ archived, path });
    },
    updateMetadata: async () => ({ workspaces: [] }),
    ensureCatalogState: async () => undefined
  } as never);

  await service.reconcileArchived(
    { id: "workspace" } as never,
    [{ id: "thread", archived: true }] as never
  );

  assert.equal(unlinkCalls, 0);
  assert.deepEqual(storage, [{
    archived: true,
    path: "archive/thread.rollout.jsonl"
  }]);
});
