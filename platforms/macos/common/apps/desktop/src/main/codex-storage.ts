import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

export interface PersistedThread {
  id: string;
  rolloutPath: string;
  createdAt: number;
  updatedAt: number;
  cwd: string;
  title: string;
  scope: "project" | "chat";
  status: string;
  approvalMode: string;
  archived: boolean;
  gitBranch: string;
  preview: string;
  memoryMode: string;
  model: string;
}

export interface PersistedMemory {
  threadId: string;
  sourceUpdatedAt: number;
  rawMemory: string;
  rolloutSummary: string;
  rolloutSlug: string;
  generatedAt: number;
  usageCount: number;
  lastUsage: number;
}

export interface PersistedGoal {
  threadId: string;
  goalId: string;
  objective: string;
  status: string;
  tokenBudget?: number;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface PersistedSpawnEdge {
  parentThreadId: string;
  childThreadId: string;
  status: "queued" | "running" | "completed" | "failed" | "canceled";
}

export interface PersistedDelegatedAgentTask {
  id: string;
  parentThreadId: string;
  childThreadId: string;
  title: string;
  instruction: string;
  owner: "planner" | "researcher" | "verifier" | "editor";
  status: "queued" | "running" | "completed" | "failed";
  summary: string;
  result: unknown;
  error: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

type BoundValue = string | number | bigint | null | Uint8Array;

function openDatabase(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS _sqlx_migrations (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      installed_on TEXT NOT NULL,
      success INTEGER NOT NULL,
      checksum BLOB,
      execution_time INTEGER NOT NULL
    );
  `);
  return database;
}

function migrate(database: DatabaseSync, version: number, description: string, sql: string) {
  const applied = database.prepare("SELECT 1 FROM _sqlx_migrations WHERE version = ? AND success = 1").get(version);
  if (applied) return;
  const startedAt = Date.now();
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(sql);
    database.prepare(`
      INSERT INTO _sqlx_migrations(version, description, installed_on, success, checksum, execution_time)
      VALUES (?, ?, ?, 1, NULL, ?)
    `).run(version, description, new Date().toISOString(), Date.now() - startedAt);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function run(statement: StatementSync, ...values: BoundValue[]) {
  statement.run(...values);
}

export class CodexStorage {
  readonly state: DatabaseSync;
  readonly logs: DatabaseSync;
  readonly memories: DatabaseSync;
  readonly goals: DatabaseSync;

  constructor(root: string) {
    this.state = openDatabase(join(root, "state_5.sqlite"));
    this.logs = openDatabase(join(root, "logs_2.sqlite"));
    this.memories = openDatabase(join(root, "memories_1.sqlite"));
    this.goals = openDatabase(join(root, "goals_1.sqlite"));
    this.applyMigrations();
  }

  private applyMigrations() {
    migrate(this.state, 1, "codex-compatible thread index", `
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        rollout_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        source TEXT NOT NULL DEFAULT 'newbrain',
        model_provider TEXT NOT NULL DEFAULT 'openai',
        cwd TEXT NOT NULL,
        title TEXT NOT NULL,
        sandbox_policy TEXT NOT NULL DEFAULT 'workspace-write',
        approval_mode TEXT NOT NULL DEFAULT 'on-request',
        tokens_used INTEGER NOT NULL DEFAULT 0,
        has_user_event INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        archived_at INTEGER,
        git_sha TEXT NOT NULL DEFAULT '',
        git_branch TEXT NOT NULL DEFAULT '',
        git_origin_url TEXT NOT NULL DEFAULT '',
        cli_version TEXT NOT NULL DEFAULT '',
        first_user_message TEXT NOT NULL DEFAULT '',
        agent_nickname TEXT NOT NULL DEFAULT '',
        agent_role TEXT NOT NULL DEFAULT '',
        memory_mode TEXT NOT NULL DEFAULT 'enabled',
        model TEXT NOT NULL DEFAULT '',
        reasoning_effort TEXT NOT NULL DEFAULT '',
        agent_path TEXT NOT NULL DEFAULT '',
        thread_source TEXT NOT NULL DEFAULT 'desktop',
        preview TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'idle',
        recency_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_threads_cwd_recency ON threads(cwd, recency_at DESC);
      CREATE TABLE IF NOT EXISTS thread_spawn_edges (
        parent_thread_id TEXT NOT NULL,
        child_thread_id TEXT NOT NULL PRIMARY KEY,
        status TEXT NOT NULL,
        FOREIGN KEY(parent_thread_id) REFERENCES threads(id) ON DELETE CASCADE,
        FOREIGN KEY(child_thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS thread_dynamic_tools (
        thread_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        input_schema TEXT NOT NULL,
        defer_loading INTEGER NOT NULL DEFAULT 0,
        namespace TEXT NOT NULL DEFAULT '',
        PRIMARY KEY(thread_id, position),
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );
    `);
    migrate(this.state, 2, "complete Codex state schema", `
      ALTER TABLE threads ADD COLUMN created_at_ms INTEGER;
      ALTER TABLE threads ADD COLUMN updated_at_ms INTEGER;
      ALTER TABLE threads ADD COLUMN recency_at_ms INTEGER;
      UPDATE threads SET created_at_ms=created_at, updated_at_ms=updated_at, recency_at_ms=recency_at;

      CREATE TABLE IF NOT EXISTS agent_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        instruction TEXT NOT NULL,
        output_schema_json TEXT,
        input_headers_json TEXT,
        input_csv_path TEXT,
        output_csv_path TEXT,
        auto_export INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        last_error TEXT,
        max_runtime_seconds INTEGER
      );
      CREATE TABLE IF NOT EXISTS agent_job_items (
        job_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        row_index INTEGER NOT NULL,
        source_id TEXT,
        row_json TEXT NOT NULL,
        status TEXT NOT NULL,
        assigned_thread_id TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        result_json TEXT,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        reported_at INTEGER,
        PRIMARY KEY(job_id, item_id),
        FOREIGN KEY(job_id) REFERENCES agent_jobs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_agent_job_items_status ON agent_job_items(job_id, status, row_index);
      CREATE TABLE IF NOT EXISTS backfill_state (
        id INTEGER PRIMARY KEY,
        status TEXT NOT NULL,
        last_watermark TEXT,
        last_success_at INTEGER,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS external_agent_config_imports (
        import_id TEXT PRIMARY KEY,
        completed_at_ms INTEGER NOT NULL,
        successes TEXT NOT NULL,
        failures TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS remote_control_enrollments (
        websocket_url TEXT NOT NULL,
        account_id TEXT NOT NULL,
        app_server_client_name TEXT NOT NULL,
        server_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        server_name TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        remote_control_enabled INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(account_id, server_id, environment_id)
      );
    `);
    migrate(this.state, 3, "durable delegated agent tasks", `
      CREATE TABLE IF NOT EXISTS delegated_agent_tasks (
        id TEXT PRIMARY KEY,
        parent_thread_id TEXT NOT NULL,
        child_thread_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        instruction TEXT NOT NULL,
        owner TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        result_json TEXT,
        last_error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        FOREIGN KEY(parent_thread_id) REFERENCES threads(id) ON DELETE CASCADE,
        FOREIGN KEY(child_thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_delegated_agent_parent_status
        ON delegated_agent_tasks(parent_thread_id, status);
    `);
    migrate(this.state, 4, "persist desktop thread scope", `
      ALTER TABLE threads ADD COLUMN scope TEXT NOT NULL DEFAULT 'project';
    `);
    migrate(this.state, 5, "repair known mojibake thread labels", `
      UPDATE threads SET title = '默认线程' WHERE title IN ('榛樿绾跨▼', '姒涙顓荤痪璺ㄢ柤');
      UPDATE threads SET title = '未命名线程' WHERE title = '鏈懡鍚嶇嚎绋?';
      UPDATE threads SET title = '新线程' WHERE title = '鏂扮嚎绋?';
      UPDATE threads SET title = '新对话' WHERE title = '鏂板璇?';
      UPDATE threads SET preview = replace(preview, '榛樿绾跨▼', '默认线程');
      UPDATE threads SET preview = replace(preview, '姒涙顓荤痪璺ㄢ柤', '默认线程');
      UPDATE threads SET preview = replace(preview, '鏈懡鍚嶇嚎绋?', '未命名线程');
      UPDATE threads SET preview = replace(preview, '鏆傛棤绾跨▼鎽樿銆?', '暂无线程摘要。');
      UPDATE threads SET preview = replace(preview, '绾跨▼宸插垱寤?', '线程已创建');
      UPDATE threads SET preview = replace(preview, '鏂扮嚎绋?', '新线程');
      UPDATE threads SET preview = replace(preview, '鏂板璇?', '新对话');
    `);
    migrate(this.logs, 1, "structured logs", `
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        ts_nanos INTEGER NOT NULL DEFAULT 0,
        level TEXT NOT NULL,
        target TEXT NOT NULL,
        feedback_log_body TEXT NOT NULL,
        module_path TEXT,
        file TEXT,
        line INTEGER,
        thread_id TEXT,
        process_uuid TEXT NOT NULL,
        estimated_bytes INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_logs_thread_ts ON logs(thread_id, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_logs_target_ts ON logs(target, ts DESC);
    `);
    migrate(this.memories, 1, "memory pipeline", `
      CREATE TABLE IF NOT EXISTS jobs (
        kind TEXT NOT NULL,
        job_key TEXT NOT NULL,
        status TEXT NOT NULL,
        worker_id TEXT,
        ownership_token TEXT,
        started_at INTEGER,
        finished_at INTEGER,
        lease_until INTEGER,
        retry_at INTEGER,
        retry_remaining INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        input_watermark INTEGER NOT NULL DEFAULT 0,
        last_success_watermark INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(kind, job_key)
      );
      CREATE TABLE IF NOT EXISTS stage1_outputs (
        thread_id TEXT PRIMARY KEY,
        source_updated_at INTEGER NOT NULL,
        raw_memory TEXT NOT NULL,
        rollout_summary TEXT NOT NULL,
        rollout_slug TEXT NOT NULL,
        generated_at INTEGER NOT NULL,
        usage_count INTEGER NOT NULL DEFAULT 0,
        last_usage INTEGER NOT NULL DEFAULT 0,
        selected_for_phase2 INTEGER NOT NULL DEFAULT 0,
        selected_for_phase2_source_updated_at INTEGER
      );
    `);
    migrate(this.goals, 1, "thread goals", `
      CREATE TABLE IF NOT EXISTS thread_goals (
        thread_id TEXT NOT NULL,
        goal_id TEXT NOT NULL,
        objective TEXT NOT NULL,
        status TEXT NOT NULL,
        token_budget INTEGER,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        time_used_seconds INTEGER NOT NULL DEFAULT 0,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY(thread_id, goal_id)
      );
      CREATE INDEX IF NOT EXISTS idx_thread_goals_status ON thread_goals(status, updated_at_ms DESC);
    `);
  }

  upsertThread(thread: PersistedThread) {
    run(this.state.prepare(`
      INSERT INTO threads(id, rollout_path, created_at, updated_at, cwd, title, scope, status, approval_mode,
        archived, git_branch, preview, memory_mode, model, recency_at, created_at_ms, updated_at_ms, recency_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET rollout_path=excluded.rollout_path, updated_at=excluded.updated_at,
        cwd=excluded.cwd, title=excluded.title, scope=excluded.scope, status=excluded.status, approval_mode=excluded.approval_mode,
        archived=excluded.archived, git_branch=excluded.git_branch, preview=excluded.preview,
        memory_mode=excluded.memory_mode, model=excluded.model, recency_at=excluded.recency_at,
        updated_at_ms=excluded.updated_at_ms, recency_at_ms=excluded.recency_at_ms
    `), thread.id, thread.rolloutPath, thread.createdAt, thread.updatedAt, thread.cwd, thread.title,
      thread.scope === "chat" ? "chat" : "project", thread.status, thread.approvalMode, thread.archived ? 1 : 0, thread.gitBranch, thread.preview,
      thread.memoryMode, thread.model, thread.updatedAt, thread.createdAt, thread.updatedAt, thread.updatedAt);
  }

  listThreads(cwd: string): PersistedThread[] {
    return this.state.prepare(`
      SELECT id, rollout_path AS rolloutPath, created_at AS createdAt, updated_at AS updatedAt,
        cwd, title, scope, status, approval_mode AS approvalMode, archived, git_branch AS gitBranch,
        preview, memory_mode AS memoryMode, model
      FROM threads WHERE cwd = ? AND archived = 0 ORDER BY recency_at DESC
    `).all(cwd).map((row: any) => ({
      ...row,
      scope: row.scope === "chat" ? "chat" : "project",
      archived: Boolean(row.archived)
    })) as PersistedThread[];
  }

  deleteThread(threadId: string) {
    this.state.prepare("DELETE FROM threads WHERE id = ?").run(threadId);
    this.memories.prepare("DELETE FROM stage1_outputs WHERE thread_id = ?").run(threadId);
    this.goals.prepare("DELETE FROM thread_goals WHERE thread_id = ?").run(threadId);
  }

  linkThreadSpawn(edge: PersistedSpawnEdge) {
    run(this.state.prepare(`
      INSERT INTO thread_spawn_edges(parent_thread_id, child_thread_id, status)
      VALUES (?, ?, ?)
      ON CONFLICT(child_thread_id) DO UPDATE SET
        parent_thread_id=excluded.parent_thread_id, status=excluded.status
    `), edge.parentThreadId, edge.childThreadId, edge.status);
  }

  updateThreadSpawnStatus(childThreadId: string, status: PersistedSpawnEdge["status"]) {
    const result = this.state.prepare(
      "UPDATE thread_spawn_edges SET status = ? WHERE child_thread_id = ?"
    ).run(status, childThreadId);
    if (Number(result.changes) === 0) throw new Error(`Unknown child thread: ${childThreadId}`);
  }

  listThreadSpawns(parentThreadId: string): PersistedSpawnEdge[] {
    return (this.state.prepare(`
      SELECT parent_thread_id AS parentThreadId, child_thread_id AS childThreadId, status
      FROM thread_spawn_edges WHERE parent_thread_id = ? ORDER BY child_thread_id
    `).all(parentThreadId) as unknown as PersistedSpawnEdge[]).map((row) => ({ ...row }));
  }

  setThreadAgentMetadata(threadId: string, input: { nickname?: string; role?: string; agentPath?: string }) {
    this.state.prepare(`
      UPDATE threads SET agent_nickname = ?, agent_role = ?, agent_path = ? WHERE id = ?
    `).run(input.nickname ?? "", input.role ?? "", input.agentPath ?? "", threadId);
  }

  upsertDelegatedAgentTask(task: PersistedDelegatedAgentTask) {
    run(this.state.prepare(`
      INSERT INTO delegated_agent_tasks(id, parent_thread_id, child_thread_id, title, instruction,
        owner, status, summary, result_json, last_error, created_at, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, summary=excluded.summary,
        result_json=excluded.result_json, last_error=excluded.last_error,
        started_at=excluded.started_at, completed_at=excluded.completed_at
    `), task.id, task.parentThreadId, task.childThreadId, task.title, task.instruction,
      task.owner, task.status, task.summary, task.result == null ? null : JSON.stringify(task.result),
      task.error, task.createdAt, task.startedAt, task.completedAt);
  }

  listDelegatedAgentTasks(parentThreadId?: string): PersistedDelegatedAgentTask[] {
    const rows = parentThreadId
      ? this.state.prepare("SELECT * FROM delegated_agent_tasks WHERE parent_thread_id = ? ORDER BY created_at").all(parentThreadId)
      : this.state.prepare("SELECT * FROM delegated_agent_tasks ORDER BY created_at").all();
    return (rows as any[]).map((row) => ({
      id: row.id,
      parentThreadId: row.parent_thread_id,
      childThreadId: row.child_thread_id,
      title: row.title,
      instruction: row.instruction,
      owner: row.owner,
      status: row.status,
      summary: row.summary,
      result: row.result_json ? JSON.parse(row.result_json) : null,
      error: row.last_error,
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at
    }));
  }

  appendLog(input: { level: string; target: string; body: string; threadId?: string; processUuid: string }) {
    const bytes = Buffer.byteLength(input.body, "utf8");
    run(this.logs.prepare(`
      INSERT INTO logs(ts, level, target, feedback_log_body, thread_id, process_uuid, estimated_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `), Date.now(), input.level, input.target, input.body, input.threadId ?? null, input.processUuid, bytes);
  }

  upsertMemory(memory: PersistedMemory) {
    run(this.memories.prepare(`
      INSERT INTO stage1_outputs(thread_id, source_updated_at, raw_memory, rollout_summary, rollout_slug,
        generated_at, usage_count, last_usage)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET source_updated_at=excluded.source_updated_at,
        raw_memory=excluded.raw_memory, rollout_summary=excluded.rollout_summary,
        rollout_slug=excluded.rollout_slug, generated_at=excluded.generated_at,
        usage_count=excluded.usage_count, last_usage=excluded.last_usage
    `), memory.threadId, memory.sourceUpdatedAt, memory.rawMemory, memory.rolloutSummary,
      memory.rolloutSlug, memory.generatedAt, memory.usageCount, memory.lastUsage);
  }

  upsertGoal(goal: PersistedGoal) {
    run(this.goals.prepare(`
      INSERT INTO thread_goals(thread_id, goal_id, objective, status, token_budget, tokens_used,
        time_used_seconds, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id, goal_id) DO UPDATE SET objective=excluded.objective, status=excluded.status,
        token_budget=excluded.token_budget, tokens_used=excluded.tokens_used,
        time_used_seconds=excluded.time_used_seconds, updated_at_ms=excluded.updated_at_ms
    `), goal.threadId, goal.goalId, goal.objective, goal.status, goal.tokenBudget ?? null,
      goal.tokensUsed, goal.timeUsedSeconds, goal.createdAtMs, goal.updatedAtMs);
  }

  getGoal(threadId: string): PersistedGoal | null {
    const row = this.goals.prepare(`
      SELECT thread_id AS threadId, goal_id AS goalId, objective, status,
        token_budget AS tokenBudget, tokens_used AS tokensUsed,
        time_used_seconds AS timeUsedSeconds, created_at_ms AS createdAtMs,
        updated_at_ms AS updatedAtMs
      FROM thread_goals WHERE thread_id = ?
      ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at_ms DESC LIMIT 1
    `).get(threadId) as any;
    if (!row) return null;
    return { ...row, tokenBudget: row.tokenBudget ?? undefined } as PersistedGoal;
  }

  createGoal(threadId: string, objective: string, tokenBudget?: number): PersistedGoal {
    const normalizedObjective = objective.trim();
    if (!normalizedObjective) throw new Error("Goal objective is required.");
    const current = this.getGoal(threadId);
    if (current?.status === "active") {
      throw new Error("An unfinished goal already exists for this thread.");
    }
    if (tokenBudget !== undefined && (!Number.isInteger(tokenBudget) || tokenBudget <= 0)) {
      throw new Error("Goal token budget must be a positive integer.");
    }
    const now = Date.now();
    const goal: PersistedGoal = {
      threadId,
      goalId: randomUUID(),
      objective: normalizedObjective,
      status: "active",
      tokenBudget,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAtMs: now,
      updatedAtMs: now
    };
    this.upsertGoal(goal);
    return goal;
  }

  updateGoal(
    threadId: string,
    status: "complete" | "blocked",
    usage?: { tokensUsed?: number; timeUsedSeconds?: number }
  ): PersistedGoal {
    const current = this.getGoal(threadId);
    if (!current || current.status !== "active") throw new Error("No active goal exists for this thread.");
    const tokensUsed = usage?.tokensUsed ?? current.tokensUsed;
    const timeUsedSeconds = usage?.timeUsedSeconds ?? current.timeUsedSeconds;
    if (tokensUsed < current.tokensUsed || timeUsedSeconds < current.timeUsedSeconds) {
      throw new Error("Goal usage counters cannot decrease.");
    }
    const next = { ...current, status, tokensUsed, timeUsedSeconds, updatedAtMs: Date.now() };
    this.upsertGoal(next);
    return next;
  }

  close() {
    this.state.close();
    this.logs.close();
    this.memories.close();
    this.goals.close();
  }
}
