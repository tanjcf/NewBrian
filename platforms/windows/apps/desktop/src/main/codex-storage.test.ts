import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

function cleanupTempRoot(root: string) {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  } catch (error: any) {
    if (process.platform !== "win32" || error?.code !== "EPERM") throw error;
    process.once("exit", () => {
      try { rmSync(root, { recursive: true, force: true }); } catch { /* WAL handles close at process exit. */ }
    });
  }
}

test("creates Codex-style WAL databases and persists each core domain", async () => {
  const { CodexStorage } = await import(new URL("./codex-storage.ts", import.meta.url).href) as typeof import("./codex-storage.js");
  const root = mkdtempSync(join(tmpdir(), "newbrain-storage-"));
  try {
    const storage = new CodexStorage(root);
    storage.upsertThread({
      id: "thread-1", rolloutPath: "rollout.jsonl", createdAt: 1, updatedAt: 2,
      cwd: "workspace", title: "Thread", scope: "project", status: "idle", approvalMode: "on-request",
      archived: false, gitBranch: "main", preview: "preview", summary: "summary",
      lastEventSummary: "The user cancelled the current task.", statusLabel: "Cancelled",
      memoryMode: "enabled", model: "gpt"
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
      result: null, error: "", createdAt: new Date(0).toISOString(), startedAt: null, completedAt: null,
      dependsOn: ["thread-prerequisite"]
    });
    assert.deepEqual(storage.listThreadSpawns("thread-1"), [
      { parentThreadId: "thread-1", childThreadId: "thread-2", status: "running" }
    ]);
    assert.equal(storage.listDelegatedAgentTasks("thread-1")[0].instruction, "Verify the change");
    assert.deepEqual(storage.listDelegatedAgentTasks("thread-1")[0].dependsOn, ["thread-prerequisite"]);
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
    const replacement = storage.createGoal("thread-1", "replacement", 100, "turn-replacement");
    assert.equal(replacement.tokenBudget, 100);
    assert.equal(storage.getGoal("thread-1")?.turnId, "turn-replacement");
    assert.equal(storage.getGoalSnapshot("thread-1")?.runtime.phase, "idle");
    const boundRuntime = storage.getGoalSnapshot("thread-1")!.runtime;
    storage.upsertGoalRuntime({ ...boundRuntime, selectedSkillNames: ["government-research-writing"], updatedAtMs: Date.now() });
    assert.deepEqual(storage.getGoalSnapshot("thread-1")?.runtime.selectedSkillNames, ["government-research-writing"]);
    const goalPlan = storage.replaceGoalPlan("thread-1", replacement.goalId, [
      { stepId: "inspect", title: "检查现状", description: "读取当前实现", status: "in_progress" },
      { stepId: "verify", title: "验证结果", description: "执行验收测试", status: "pending" }
    ]);
    assert.deepEqual(goalPlan.map((step) => [step.stepId, step.position, step.status]), [
      ["inspect", 0, "in_progress"],
      ["verify", 1, "pending"]
    ]);
    const question = storage.createGoalQuestion("thread-1", replacement.goalId, {
      questionId: "scope",
      prompt: "需要验证哪个环境？",
      options: [
        { label: "开发环境", description: "先验证本地开发版", recommended: true },
        { label: "安装包", description: "验证 MSI 安装结果" }
      ]
    });
    assert.equal(question.status, "pending");
    assert.equal(storage.getGoalSnapshot("thread-1")?.runtime.phase, "waiting_user");
    assert.throws(() => storage.createGoalQuestion("thread-1", replacement.goalId, {
      questionId: "duplicate",
      prompt: "重复问题？",
      options: [{ label: "是", description: "确认" }, { label: "否", description: "拒绝" }]
    }));
    storage.answerGoalQuestion("thread-1", replacement.goalId, "scope", "开发环境");
    const answeredSnapshot = storage.getGoalSnapshot("thread-1");
    assert.equal(answeredSnapshot?.pendingQuestion, null);
    assert.equal(answeredSnapshot?.runtime.phase, "idle");
    const repeatedQuestion = storage.createGoalQuestion("thread-1", replacement.goalId, {
      questionId: "scope",
      prompt: "请再次确认调整后的范围",
      options: [
        { label: "确认调整", description: "采用修订结果", recommended: true },
        { label: "继续修改", description: "返回调整阶段" }
      ]
    });
    assert.equal(repeatedQuestion.status, "pending");
    assert.equal(repeatedQuestion.prompt, "请再次确认调整后的范围");
    assert.equal(repeatedQuestion.answer, "");
    storage.answerGoalQuestion("thread-1", replacement.goalId, "scope", "确认调整");
    assert.equal(storage.setGoalPaused("thread-1", true).status, "paused");
    assert.throws(() => storage.createGoal("thread-1", "must not replace paused goal"), /unfinished goal/);
    assert.equal(storage.setGoalPaused("thread-1", false).status, "active");
    assert.equal(storage.updateGoalObjective("thread-1", "updated replacement").objective, "updated replacement");
    const budgetedTurn = storage.recordGoalTurn("thread-1", { tokensUsed: 101, timeUsedSeconds: 4 });
    assert.equal(budgetedTurn?.status, "budget_limited");
    assert.equal(budgetedTurn?.tokensUsed, 101);
    assert.equal(budgetedTurn?.timeUsedSeconds, 4);
    storage.createGoal("thread-2", "resolve a repeated external blocker");
    assert.deepEqual(storage.attemptBlockGoal("thread-2", "missing credential").accepted, false);
    const changedBlocker = storage.attemptBlockGoal("thread-2", "service unavailable");
    assert.equal(changedBlocker.attempt, 1);
    assert.equal(storage.attemptBlockGoal("thread-2", "service unavailable").attempt, 2);
    const acceptedBlocker = storage.attemptBlockGoal("thread-2", "service unavailable");
    assert.equal(acceptedBlocker.accepted, true);
    assert.equal(acceptedBlocker.goal.status, "blocked");
    assert.equal(storage.listThreads("workspace").length, 2);
    const persistedThread = storage.listThreads("workspace").find((thread) => thread.id === "thread-1");
    assert.equal(persistedThread?.summary, "summary");
    assert.equal(persistedThread?.lastEventSummary, "The user cancelled the current task.");
    assert.equal(persistedThread?.statusLabel, "Cancelled");
    assert.equal(storage.listThreads("workspace").find((thread) => thread.id === "thread-2")?.scope, "chat");
    assert.equal(storage.setThreadArchived("thread-2", true, "archived_sessions/thread-2.rollout.jsonl"), true);
    assert.equal(storage.listThreads("workspace").some((thread) => thread.id === "thread-2"), false);
    const archivedThread = storage.state.prepare(
      "SELECT archived, rollout_path AS rolloutPath FROM threads WHERE id = ?"
    ).get("thread-2") as any;
    assert.equal(Boolean(archivedThread.archived), true);
    assert.equal(archivedThread.rolloutPath, "archived_sessions/thread-2.rollout.jsonl");
    assert.equal(storage.setThreadArchived("thread-2", false, "threads/thread-2.rollout.jsonl"), true);
    assert.equal(storage.listThreads("workspace").find((thread) => thread.id === "thread-2")?.rolloutPath, "threads/thread-2.rollout.jsonl");
    storage.close();

    const stateDatabase = new DatabaseSync(join(root, "state_5.sqlite"), { readOnly: true });
    const stateTables = new Set((stateDatabase.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all() as Array<{ name: string }>).map((row) => row.name));
    for (const table of [
      "threads", "thread_spawn_edges", "thread_dynamic_tools", "agent_jobs", "agent_job_items",
      "backfill_state", "external_agent_config_imports", "remote_control_enrollments", "delegated_agent_tasks",
      "remote_work_items", "remote_event_outbox"
    ]) assert.ok(stateTables.has(table), `missing state table ${table}`);
    assert.equal(Number((stateDatabase.prepare("SELECT count(*) AS count FROM _sqlx_migrations").get() as any).count), 8);
    stateDatabase.close();

    for (const [file, table] of [
      ["state_5.sqlite", "threads"], ["logs_2.sqlite", "logs"],
      ["memories_1.sqlite", "stage1_outputs"], ["goals_1.sqlite", "thread_goals"]
    ]) {
      const database = new DatabaseSync(join(root, file), { readOnly: true });
      assert.equal((database.prepare("PRAGMA journal_mode").get() as any).journal_mode, "wal");
      const expected = table === "thread_goals" ? 3 : table === "threads" ? 2 : 1;
      assert.equal(Number((database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as any).count), expected);
      database.close();
    }
  } finally {
    cleanupTempRoot(root);
  }
});

test("updates and deletes the current goal without deleting its thread", async () => {
  const { CodexStorage } = await import(new URL("./codex-storage.ts", import.meta.url).href) as typeof import("./codex-storage.js");
  const root = mkdtempSync(join(tmpdir(), "newbrain-goal-controls-"));
  try {
    const storage = new CodexStorage(root);
    storage.upsertThread({
      id: "thread", rolloutPath: "thread.jsonl", createdAt: 1, updatedAt: 1,
      cwd: "workspace", title: "Thread", scope: "project", status: "idle", approvalMode: "on-request",
      archived: false, gitBranch: "", preview: "", memoryMode: "enabled", model: "test"
    });
    storage.createGoal("thread", "original");
    assert.equal(storage.updateGoalObjective("thread", "edited").objective, "edited");
    storage.deleteGoal("thread");
    assert.equal(storage.getGoal("thread"), null);
    assert.equal(storage.listThreads("workspace").length, 1);
    storage.close();
  } finally {
    cleanupTempRoot(root);
  }
});

test("sustains 2000 state and log writes and reopens without data loss", async () => {
  const { CodexStorage } = await import(new URL("./codex-storage.ts", import.meta.url).href) as typeof import("./codex-storage.js");
  const root = mkdtempSync(join(tmpdir(), "newbrain-storage-pressure-"));
  try {
    let storage = new CodexStorage(root);
    for (let index = 0; index < 2000; index += 1) {
      storage.upsertThread({
        id: `thread-${index}`, rolloutPath: `thread-${index}.jsonl`, createdAt: index, updatedAt: index,
        cwd: "pressure-workspace", title: `Thread ${index}`, scope: "project", status: "idle",
        approvalMode: "on-request", archived: false, gitBranch: "", preview: "pressure",
        memoryMode: "enabled", model: "test-model"
      });
      storage.appendLog({
        level: "info", target: "pressure", body: `record-${index}`,
        threadId: `thread-${index}`, processUuid: "pressure-run"
      });
    }
    storage.close();

    storage = new CodexStorage(root);
    assert.equal(storage.listThreads("pressure-workspace").length, 2000);
    const logCount = storage.logs.prepare("SELECT count(*) AS count FROM logs").get() as { count: number };
    assert.equal(Number(logCount.count), 2000);
    const integrity = storage.state.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    assert.equal(integrity.integrity_check, "ok");
    storage.close();
  } finally {
    cleanupTempRoot(root);
  }
});
