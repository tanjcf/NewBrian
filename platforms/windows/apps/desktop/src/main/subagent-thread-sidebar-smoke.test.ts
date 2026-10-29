/**
 * SUBAGENT-THREAD-SIDEBAR-SMOKE-001
 * Packaging must run this case and stop when it fails.
 * Child agents must stay inside the parent conversation. Refreshing the catalog
 * must not turn them into extra sidebar threads, and opening one must not steal
 * a parent turn that is still generating.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CodexStorage } from "./codex-storage.ts";

const CASE_ID = "SUBAGENT-THREAD-SIDEBAR-SMOKE-001";

function readRepoFile(relativeUrl: string) {
  const file = fileURLToPath(new URL(relativeUrl, import.meta.url));
  return readFileSync(file, "utf8");
}

function readFirstExisting(relativeUrls: string[]) {
  for (const relativeUrl of relativeUrls) {
    const file = fileURLToPath(new URL(relativeUrl, import.meta.url));
    if (existsSync(file)) return readFileSync(file, "utf8");
  }
  throw new Error(`Missing smoke source: ${relativeUrls.join(" | ")}`);
}

function sliceFunction(source: string, signature: string) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing ${signature}`);
  const next = source.indexOf("\nasync function ", start + signature.length);
  return source.slice(start, next === -1 ? undefined : next);
}

test(`${CASE_ID} keeps spawned child agents out of the sidebar after reload`, () => {
  const root = mkdtempSync(join(tmpdir(), "subagent-sidebar-"));
  try {
    const storage = new CodexStorage(root);
    const parent = {
      id: "parent-thread",
      rolloutPath: "parent.jsonl",
      createdAt: 1,
      updatedAt: 2,
      cwd: "rhadoc",
      title: "这个项目你阅读下然后启动",
      scope: "project" as const,
      status: "running",
      approvalMode: "on-request",
      archived: false,
      gitBranch: "",
      preview: "父对话",
      memoryMode: "enabled",
      model: ""
    };
    storage.upsertThread(parent);
    for (const [index, title] of ["rhadoc 代码现状与高可用架构", "核对部署拓扑", "整理启动步骤"].entries()) {
      storage.upsertThread({
        ...parent,
        id: `child-${index}`,
        rolloutPath: `child-${index}.jsonl`,
        createdAt: 3 + index,
        updatedAt: 4 + index,
        title,
        preview: "子 Agent"
      });
      storage.linkThreadSpawn({
        parentThreadId: parent.id,
        childThreadId: `child-${index}`,
        status: "running"
      });
    }
    storage.close();

    const reloaded = new CodexStorage(root);
    const threads = reloaded.listThreads("rhadoc");
    const children = threads.filter((thread) => thread.id.startsWith("child-"));
    assert.equal(children.length, 3);
    for (const child of children) {
      assert.equal(child.kind, "subagent");
      assert.equal(child.parentThreadId, parent.id);
    }
    assert.equal(threads.find((thread) => thread.id === parent.id)?.kind, "user");
    const sidebarThreads = threads.filter((thread) => thread.kind !== "subagent");
    assert.deepEqual(sidebarThreads.map((thread) => thread.id), [parent.id]);
    reloaded.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(`${CASE_ID} hides subagent threads in the project sidebar and does not steal a live parent`, () => {
  const visibility = readFirstExisting([
    "../renderer/app/workspace-visibility.ts",
    "../../../../../../shared/apps/desktop/src/renderer/app/workspace-visibility.ts"
  ]);
  const modules = readFirstExisting([
    "../renderer/app/WorkspaceModules.tsx",
    "../../../../../../shared/apps/desktop/src/renderer/app/WorkspaceModules.tsx"
  ]);
  const main = readRepoFile("./index.ts");
  assert.match(visibility, /return thread\.kind !== "subagent"/);
  assert.match(
    modules,
    /projectThreads = \(workspace\.threads \?\? \[\]\)\.filter\(\(thread: any\) => thread\.scope !== "chat" && isUserVisibleThread\(thread\)\)/
  );
  assert.match(main, /kind: thread\.kind/);
  assert.match(main, /parentThreadId: thread\.parentThreadId/);
  assert.match(main, /kind: thread\.kind === "subagent" \? "subagent" : "user"/);

  const activate = sliceFunction(main, "async function activateWorkspaceThreadUnlocked");
  const guardAt = activate.indexOf('thread.kind === "subagent"');
  const saveAt = activate.indexOf("saveActiveThreadState");
  assert.ok(guardAt >= 0 && saveAt > guardAt);
  assert.match(activate, /parentTask/);
  assert.match(activate, /buildSnapshotWithThreadState\(liveRuntime\.getSnapshot\(\), liveState\)/);
  assert.match(activate, /return activateWorkspaceThreadUnlocked\(\{ workspaceId: workspace\.id, threadId: parent\.id \}\)/);
});
