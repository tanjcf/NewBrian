import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

test("creates Codex-style WAL databases and persists each core domain", async () => {
  const { CodexStorage } = await import(new URL("./codex-storage.ts", import.meta.url).href) as typeof import("./codex-storage.js");
  const root = mkdtempSync(join(tmpdir(), "newbrain-storage-"));
  try {
    const storage = new CodexStorage(root);
    storage.upsertThread({
      id: "thread-1", rolloutPath: "rollout.jsonl", createdAt: 1, updatedAt: 2,
      cwd: "workspace", title: "Thread", scope: "project", status: "idle", approvalMode: "on-request",
      archived: false, gitBranch: "main", preview: "preview", memoryMode: "enabled", model: "gpt"
    });
    storage.upsertThread({
      id: "thread-2", rolloutPath: "child.jsonl", createdAt: 2, updatedAt: 3,
      cwd: "workspace", title: "Child", scope: "chat", status: "idle", approvalMode: "on-request",
      archived: false, gitBranch: "", preview: "child", memoryMode: "enabled", model: "gpt"
    });
    storage.linkThreadSpawn({ parentThreadId: "thread-1", childThreadId: "thread-2", status: "queued" });
    storage.updateThreadSpawnStatus("thread-2", "running");
    storage.setThreadAgentMetadata("thread-2", { nickname: "Verifier", role: "verifier", agentPath: "/agents/verifier" });
    storage.upsertDelegatedAgentTask({
      id: "task-1", parentThreadId: "thread-1", childThreadId: "thread-2", title: "Verify",
      instruction: "Verify the change", owner: "verifier", status: "queued", summary: "",
      result: null, error: "", createdAt: new Date(0).toISOString(), startedAt: null, completedAt: null
    });
    assert.deepEqual(storage.listThreadSpawns("thread-1"), [
      { parentThreadId: "thread-1", childThreadId: "thread-2", status: "running" }
    ]);
    assert.equal(storage.listDelegatedAgentTasks("thread-1")[0].instruction, "Verify the change");
    storage.appendLog({ level: "info", target: "test", body: "ok", threadId: "thread-1", processUuid: "test" });
    storage.upsertMemory({
      threadId: "thread-1", sourceUpdatedAt: 2, rawMemory: "{}", rolloutSummary: "memory",
      rolloutSlug: "thread-1", generatedAt: 2, usageCount: 1, lastUsage: 2
    });
    storage.upsertGoal({
      threadId: "thread-1", goalId: "goal-1", objective: "verify", status: "active",
      tokensUsed: 0, timeUsedSeconds: 0, createdAtMs: 1, updatedAtMs: 2
    });
    assert.equal(storage.getGoal("thread-1")?.objective, "verify");
    assert.throws(() => storage.createGoal("thread-1", "duplicate"), /unfinished goal/);
    const completed = storage.updateGoal("thread-1", "complete", { tokensUsed: 12, timeUsedSeconds: 3 });
    assert.equal(completed.status, "complete");
    const replacement = storage.createGoal("thread-1", "replacement", 100);
    assert.equal(replacement.tokenBudget, 100);
    assert.equal(storage.listThreads("workspace").length, 2);
    assert.equal(storage.listThreads("workspace").find((thread) => thread.id === "thread-2")?.scope, "chat");
    storage.close();

    const stateDatabase = new DatabaseSync(join(root, "state_5.sqlite"), { readOnly: true });
    const stateTables = new Set((stateDatabase.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all() as Array<{ name: string }>).map((row) => row.name));
    for (const table of [
      "threads", "thread_spawn_edges", "thread_dynamic_tools", "agent_jobs", "agent_job_items",
      "backfill_state", "external_agent_config_imports", "remote_control_enrollments", "delegated_agent_tasks"
    ]) assert.ok(stateTables.has(table), `missing state table ${table}`);
    assert.equal(Number((stateDatabase.prepare("SELECT count(*) AS count FROM _sqlx_migrations").get() as any).count), 5);
    stateDatabase.close();

    for (const [file, table] of [
      ["state_5.sqlite", "threads"], ["logs_2.sqlite", "logs"],
      ["memories_1.sqlite", "stage1_outputs"], ["goals_1.sqlite", "thread_goals"]
    ]) {
      const database = new DatabaseSync(join(root, file), { readOnly: true });
      assert.equal((database.prepare("PRAGMA journal_mode").get() as any).journal_mode, "wal");
      const expected = table === "thread_goals" || table === "threads" ? 2 : 1;
      assert.equal(Number((database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as any).count), expected);
      database.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  }
});
