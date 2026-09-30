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
  summary?: string;
  lastEventSummary?: string;
  statusLabel?: string;
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
  turnId?: string;
  objective: string;
  status: "active" | "paused" | "blocked" | "usage_limited" | "budget_limited" | "complete";
  tokenBudget?: number;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface PersistedGoalPlanStep {
  threadId: string;
  goalId: string;
  stepId: string;
  position: number;
  title: string;
  description: string;
  status: "pending" | "in_progress" | "completed";
  result: string;
  updatedAtMs: number;
}

export interface PersistedGoalQuestion {
  threadId: string;
  goalId: string;
  questionId: string;
  prompt: string;
  options: Array<{ label: string; description: string; recommended?: boolean }>;
  status: "pending" | "answered" | "dismissed";
  answer: string;
  createdAtMs: number;
  answeredAtMs?: number;
}

export interface PersistedGoalRuntime {
  threadId: string;
  goalId: string;
  phase: "idle" | "running" | "waiting_user" | "complete" | "blocked";
  consecutiveBlockedTurns: number;
  lastError: string;
  selectedSkillNames?: string[];
  updatedAtMs: number;
}

export interface PersistedGoalSnapshot {
  goal: PersistedGoal;
  runtime: PersistedGoalRuntime;
  plan: PersistedGoalPlanStep[];
  pendingQuestion: PersistedGoalQuestion | null;
}

export type PersistedRemoteWorkItemStatus =
  | "claimed"
  | "running"
  | "waiting_approval"
  | "interrupted"
  | "completed"
  | "failed"
  | "cancelled";

export interface PersistedRemoteWorkItem {
  id: string;
  status: PersistedRemoteWorkItemStatus;
  objective: string;
  source: string;
  targetDeviceId: string;
  knowledgeSnapshotId?: string;
  payloadJson: string;
  threadId?: string;
  claimedAtMs: number;
  leaseUntilMs: number;
  completedAtMs?: number;
  lastError: string;
}

export type PersistedRemoteEventStatus = "pending" | "sending" | "acknowledged" | "quarantined";

export interface PersistedRemoteEvent {
  eventId: string;
  workItemId: string;
  sequenceNo: number;
  payloadJson: string;
  status: PersistedRemoteEventStatus;
  attemptCount: number;
  nextAttemptAtMs: number;
  createdAtMs: number;
  acknowledgedAtMs?: number;
  lastError?: string;
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
  dependsOn?: string[];
}

type BoundValue = string | number | bigint | null | Uint8Array;

function openDatabase(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec("PRAGMA busy_timeout=5000;");
  database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;");
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
    migrate(this.state, 6, "persist desktop thread presentation metadata", `
      ALTER TABLE threads ADD COLUMN summary TEXT NOT NULL DEFAULT '';
      ALTER TABLE threads ADD COLUMN last_event_summary TEXT NOT NULL DEFAULT '';
      ALTER TABLE threads ADD COLUMN status_label TEXT NOT NULL DEFAULT '';
      UPDATE threads SET summary = preview, last_event_summary = preview WHERE summary = '';
    `);
    migrate(this.state, 7, "persist delegated task dependencies", `
      ALTER TABLE delegated_agent_tasks ADD COLUMN depends_on_json TEXT NOT NULL DEFAULT '[]';
    `);
    migrate(this.state, 8, "durable Holon remote work and event outbox", `
      CREATE TABLE IF NOT EXISTS remote_work_items (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        objective TEXT NOT NULL,
        source TEXT NOT NULL,
        target_device_id TEXT NOT NULL,
        knowledge_snapshot_id TEXT,
        payload_json TEXT NOT NULL,
        thread_id TEXT,
        claimed_at_ms INTEGER NOT NULL,
        lease_until_ms INTEGER NOT NULL,
        completed_at_ms INTEGER,
        last_error TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_remote_work_items_status
        ON remote_work_items(status, claimed_at_ms DESC);
      CREATE TABLE IF NOT EXISTS remote_event_outbox (
        event_id TEXT PRIMARY KEY,
        work_item_id TEXT NOT NULL,
        sequence_no INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at_ms INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL,
        acknowledged_at_ms INTEGER,
        last_error TEXT NOT NULL DEFAULT '',
        UNIQUE(work_item_id, sequence_no)
      );
      CREATE INDEX IF NOT EXISTS idx_remote_event_outbox_due
        ON remote_event_outbox(status, next_attempt_at_ms, created_at_ms);
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
    migrate(this.goals, 2, "durable goal execution state", `
      CREATE TABLE IF NOT EXISTS goal_runtime (
        thread_id TEXT NOT NULL,
        goal_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        consecutive_blocked_turns INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NOT NULL DEFAULT '',
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY(thread_id, goal_id),
        FOREIGN KEY(thread_id, goal_id) REFERENCES thread_goals(thread_id, goal_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS goal_plan_steps (
        thread_id TEXT NOT NULL,
        goal_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT NOT NULL DEFAULT '',
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY(thread_id, goal_id, step_id),
        UNIQUE(thread_id, goal_id, position),
        FOREIGN KEY(thread_id, goal_id) REFERENCES thread_goals(thread_id, goal_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS goal_questions (
        thread_id TEXT NOT NULL,
        goal_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        options_json TEXT NOT NULL,
        status TEXT NOT NULL,
        answer TEXT NOT NULL DEFAULT '',
        created_at_ms INTEGER NOT NULL,
        answered_at_ms INTEGER,
        PRIMARY KEY(thread_id, goal_id, question_id),
        FOREIGN KEY(thread_id, goal_id) REFERENCES thread_goals(thread_id, goal_id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_goal_pending_question
        ON goal_questions(thread_id, goal_id) WHERE status = 'pending';
      CREATE TABLE IF NOT EXISTS goal_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        goal_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        FOREIGN KEY(thread_id, goal_id) REFERENCES thread_goals(thread_id, goal_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_goal_events_goal
        ON goal_events(thread_id, goal_id, created_at_ms);
    `);
    migrate(this.goals, 3, "bind explicit skills to durable goals", `
      ALTER TABLE goal_runtime ADD COLUMN selected_skill_names_json TEXT NOT NULL DEFAULT '[]';
    `);
    migrate(this.goals, 4, "bind goal presentation to conversation turn", `
      ALTER TABLE thread_goals ADD COLUMN turn_id TEXT;
    `);
    migrate(this.goals, 5, "government writing specification versions", `
      CREATE TABLE IF NOT EXISTS government_writing_spec_versions (
        version_id TEXT PRIMARY KEY,
        specification_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        goal_id TEXT NOT NULL,
        version_number INTEGER NOT NULL,
        source TEXT NOT NULL,
        content_json TEXT NOT NULL,
        change_summary TEXT NOT NULL,
        replaces_version_id TEXT,
        created_at_ms INTEGER NOT NULL,
        UNIQUE(specification_id, version_number),
        FOREIGN KEY(thread_id, goal_id) REFERENCES thread_goals(thread_id, goal_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_gov_spec_thread_goal
        ON government_writing_spec_versions(thread_id, goal_id, version_number DESC);
      CREATE TABLE IF NOT EXISTS government_writing_spec_state (
        specification_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        goal_id TEXT NOT NULL,
        current_version_id TEXT NOT NULL,
        confirmed_version_id TEXT,
        updated_at_ms INTEGER NOT NULL,
        UNIQUE(thread_id, goal_id),
        FOREIGN KEY(thread_id, goal_id) REFERENCES thread_goals(thread_id, goal_id) ON DELETE CASCADE,
        FOREIGN KEY(current_version_id) REFERENCES government_writing_spec_versions(version_id),
        FOREIGN KEY(confirmed_version_id) REFERENCES government_writing_spec_versions(version_id)
      );
    `);
    migrate(this.goals, 6, "government writing specification guidance", `
      ALTER TABLE government_writing_spec_state ADD COLUMN suggestions_json TEXT NOT NULL DEFAULT '[]';
    `);
  }

  upsertThread(thread: PersistedThread) {
    run(this.state.prepare(`
      INSERT INTO threads(id, rollout_path, created_at, updated_at, cwd, title, scope, status, approval_mode,
        archived, git_branch, preview, summary, last_event_summary, status_label, memory_mode, model,
        recency_at, created_at_ms, updated_at_ms, recency_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET rollout_path=excluded.rollout_path, updated_at=excluded.updated_at,
        cwd=excluded.cwd, title=excluded.title, scope=excluded.scope, status=excluded.status, approval_mode=excluded.approval_mode,
        archived=excluded.archived, git_branch=excluded.git_branch, preview=excluded.preview,
        summary=excluded.summary, last_event_summary=excluded.last_event_summary, status_label=excluded.status_label,
        memory_mode=excluded.memory_mode, model=excluded.model, recency_at=excluded.recency_at,
        updated_at_ms=excluded.updated_at_ms, recency_at_ms=excluded.recency_at_ms
    `), thread.id, thread.rolloutPath, thread.createdAt, thread.updatedAt, thread.cwd, thread.title,
      thread.scope === "chat" ? "chat" : "project", thread.status, thread.approvalMode, thread.archived ? 1 : 0, thread.gitBranch, thread.preview,
      thread.summary ?? thread.preview, thread.lastEventSummary ?? thread.preview, thread.statusLabel ?? "",
      thread.memoryMode, thread.model, thread.updatedAt, thread.createdAt, thread.updatedAt, thread.updatedAt);
  }

  listThreads(cwd: string): PersistedThread[] {
    return this.state.prepare(`
      SELECT id, rollout_path AS rolloutPath, created_at AS createdAt, updated_at AS updatedAt,
        cwd, title, scope, status, approval_mode AS approvalMode, archived, git_branch AS gitBranch,
        preview, summary, last_event_summary AS lastEventSummary, status_label AS statusLabel,
        memory_mode AS memoryMode, model
      FROM threads WHERE cwd = ? AND archived = 0 ORDER BY recency_at DESC
    `).all(cwd).map((row: any) => ({
      ...row,
      scope: row.scope === "chat" ? "chat" : "project",
      archived: Boolean(row.archived)
    })) as PersistedThread[];
  }

  listArchivedThreads(cwd: string): PersistedThread[] {
    return this.state.prepare(`
      SELECT id, rollout_path AS rolloutPath, created_at AS createdAt, updated_at AS updatedAt,
        cwd, title, scope, status, approval_mode AS approvalMode, archived, git_branch AS gitBranch,
        preview, summary, last_event_summary AS lastEventSummary, status_label AS statusLabel,
        memory_mode AS memoryMode, model
      FROM threads WHERE cwd = ? AND archived = 1 ORDER BY COALESCE(archived_at, recency_at) DESC
    `).all(cwd).map((row: any) => ({
      ...row,
      scope: row.scope === "chat" ? "chat" : "project",
      archived: Boolean(row.archived)
    })) as PersistedThread[];
  }

  setThreadArchived(threadId: string, archived: boolean, rolloutPath?: string) {
    const now = Date.now();
    const result = rolloutPath
      ? this.state.prepare(`
          UPDATE threads
          SET archived = ?, archived_at = ?, rollout_path = ?, updated_at = ?, updated_at_ms = ?
          WHERE id = ?
        `).run(archived ? 1 : 0, archived ? now : null, rolloutPath, now, now, threadId)
      : this.state.prepare(`
          UPDATE threads
          SET archived = ?, archived_at = ?, updated_at = ?, updated_at_ms = ?
          WHERE id = ?
        `).run(archived ? 1 : 0, archived ? now : null, now, now, threadId);
    return Number(result.changes) > 0;
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
        owner, status, summary, result_json, last_error, created_at, started_at, completed_at, depends_on_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, summary=excluded.summary,
        result_json=excluded.result_json, last_error=excluded.last_error,
        started_at=excluded.started_at, completed_at=excluded.completed_at,
        depends_on_json=excluded.depends_on_json
    `), task.id, task.parentThreadId, task.childThreadId, task.title, task.instruction,
      task.owner, task.status, task.summary, task.result == null ? null : JSON.stringify(task.result),
      task.error, task.createdAt, task.startedAt, task.completedAt, JSON.stringify(task.dependsOn ?? []));
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
      completedAt: row.completed_at,
      dependsOn: row.depends_on_json ? JSON.parse(row.depends_on_json) : []
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
      INSERT INTO thread_goals(thread_id, goal_id, turn_id, objective, status, token_budget, tokens_used,
        time_used_seconds, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id, goal_id) DO UPDATE SET objective=excluded.objective, status=excluded.status,
        turn_id=excluded.turn_id, token_budget=excluded.token_budget, tokens_used=excluded.tokens_used,
        time_used_seconds=excluded.time_used_seconds, updated_at_ms=excluded.updated_at_ms
    `), goal.threadId, goal.goalId, goal.turnId ?? null, goal.objective, goal.status, goal.tokenBudget ?? null,
      goal.tokensUsed, goal.timeUsedSeconds, goal.createdAtMs, goal.updatedAtMs);
  }

  getGoal(threadId: string): PersistedGoal | null {
    const row = this.goals.prepare(`
      SELECT thread_id AS threadId, goal_id AS goalId, turn_id AS turnId, objective, status,
        token_budget AS tokenBudget, tokens_used AS tokensUsed,
        time_used_seconds AS timeUsedSeconds, created_at_ms AS createdAtMs,
        updated_at_ms AS updatedAtMs
      FROM thread_goals WHERE thread_id = ?
      ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at_ms DESC LIMIT 1
    `).get(threadId) as any;
    if (!row) return null;
    return { ...row, turnId: row.turnId ?? undefined, tokenBudget: row.tokenBudget ?? undefined } as PersistedGoal;
  }

  createGoal(threadId: string, objective: string, tokenBudget?: number, turnId?: string): PersistedGoal {
    const normalizedObjective = objective.trim();
    if (!normalizedObjective) throw new Error("Goal objective is required.");
    const current = this.getGoal(threadId);
    if (current && !["complete", "blocked"].includes(current.status)) {
      throw new Error("An unfinished goal already exists for this thread.");
    }
    if (tokenBudget !== undefined && (!Number.isInteger(tokenBudget) || tokenBudget <= 0)) {
      throw new Error("Goal token budget must be a positive integer.");
    }
    const now = Date.now();
    const goal: PersistedGoal = {
      threadId,
      goalId: randomUUID(),
      turnId: turnId?.trim() || undefined,
      objective: normalizedObjective,
      status: "active",
      tokenBudget,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAtMs: now,
      updatedAtMs: now
    };
    this.upsertGoal(goal);
    this.upsertGoalRuntime({
      threadId,
      goalId: goal.goalId,
      phase: "idle",
      consecutiveBlockedTurns: 0,
      lastError: "",
      updatedAtMs: now
    });
    this.appendGoalEvent(threadId, goal.goalId, "goal_created", { objective: normalizedObjective, tokenBudget });
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
    const runtime = this.getGoalRuntime(threadId, current.goalId);
    this.upsertGoalRuntime({
      ...(runtime ?? {
        threadId,
        goalId: current.goalId,
        consecutiveBlockedTurns: 0,
        lastError: ""
      }),
      phase: status,
      updatedAtMs: next.updatedAtMs
    });
    this.appendGoalEvent(threadId, current.goalId, `goal_${status}`, { tokensUsed, timeUsedSeconds });
    return next;
  }

  setGoalPaused(threadId: string, paused: boolean): PersistedGoal {
    const current = this.getGoal(threadId);
    const expectedStatus = paused ? "active" : "paused";
    if (!current || current.status !== expectedStatus) {
      throw new Error(paused ? "No active goal exists for this thread." : "No paused goal exists for this thread.");
    }
    const now = Date.now();
    const next: PersistedGoal = { ...current, status: paused ? "paused" : "active", updatedAtMs: now };
    this.upsertGoal(next);
    const runtime = this.getGoalRuntime(threadId, current.goalId);
    this.upsertGoalRuntime({
      ...(runtime ?? { threadId, goalId: current.goalId, consecutiveBlockedTurns: 0, lastError: "" }),
      phase: "idle",
      updatedAtMs: now
    });
    this.appendGoalEvent(threadId, current.goalId, paused ? "goal_paused" : "goal_resumed", {});
    return next;
  }

  updateGoalObjective(threadId: string, objective: string): PersistedGoal {
    const current = this.getGoal(threadId);
    const normalizedObjective = objective.trim();
    if (!current || !["active", "paused"].includes(current.status)) throw new Error("No editable goal exists for this thread.");
    if (!normalizedObjective) throw new Error("Goal objective is required.");
    const next = { ...current, objective: normalizedObjective, updatedAtMs: Date.now() };
    this.upsertGoal(next);
    this.appendGoalEvent(threadId, current.goalId, "goal_objective_updated", { objective: normalizedObjective });
    return next;
  }

  deleteGoal(threadId: string): void {
    const current = this.getGoal(threadId);
    if (!current) return;
    this.goals.prepare("DELETE FROM thread_goals WHERE thread_id = ? AND goal_id = ?").run(threadId, current.goalId);
  }

  recordGoalTurn(threadId: string, usage: { tokensUsed: number; timeUsedSeconds: number; lastError?: string }) {
    const current = this.getGoal(threadId);
    if (!current) return null;
    const tokensUsed = current.tokensUsed + Math.max(0, Math.trunc(usage.tokensUsed));
    const timeUsedSeconds = current.timeUsedSeconds + Math.max(0, Math.trunc(usage.timeUsedSeconds));
    const budgetLimited = current.status === "active" && current.tokenBudget !== undefined && tokensUsed >= current.tokenBudget;
    const next: PersistedGoal = {
      ...current,
      status: budgetLimited ? "budget_limited" : current.status,
      tokensUsed,
      timeUsedSeconds,
      updatedAtMs: Date.now()
    };
    this.upsertGoal(next);
    const pendingQuestion = this.getPendingGoalQuestion(threadId, current.goalId);
    const runtime = this.getGoalRuntime(threadId, current.goalId);
    this.upsertGoalRuntime({
      ...(runtime ?? { threadId, goalId: current.goalId, consecutiveBlockedTurns: 0, lastError: "" }),
      phase: next.status === "complete" ? "complete"
        : next.status === "blocked" ? "blocked"
          : pendingQuestion ? "waiting_user" : "idle",
      lastError: usage.lastError?.trim() ?? runtime?.lastError ?? "",
      updatedAtMs: next.updatedAtMs
    });
    this.appendGoalEvent(threadId, current.goalId, "turn_recorded", {
      tokensUsed: Math.max(0, Math.trunc(usage.tokensUsed)),
      timeUsedSeconds: Math.max(0, Math.trunc(usage.timeUsedSeconds)),
      budgetLimited,
      lastError: usage.lastError?.trim() ?? ""
    });
    return next;
  }

  attemptBlockGoal(threadId: string, reason: string): { accepted: boolean; attempt: number; goal: PersistedGoal } {
    const current = this.getGoal(threadId);
    if (!current || current.status !== "active") throw new Error("No active goal exists for this thread.");
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw new Error("A concrete blocking reason is required.");
    const runtime = this.getGoalRuntime(threadId, current.goalId) ?? {
      threadId,
      goalId: current.goalId,
      phase: "idle" as const,
      consecutiveBlockedTurns: 0,
      lastError: "",
      updatedAtMs: current.updatedAtMs
    };
    const attempt = runtime.lastError === normalizedReason ? runtime.consecutiveBlockedTurns + 1 : 1;
    const now = Date.now();
    this.upsertGoalRuntime({
      ...runtime,
      phase: attempt >= 3 ? "blocked" : "idle",
      consecutiveBlockedTurns: attempt,
      lastError: normalizedReason,
      updatedAtMs: now
    });
    this.appendGoalEvent(threadId, current.goalId, "blocked_attempt", { reason: normalizedReason, attempt });
    if (attempt < 3) return { accepted: false, attempt, goal: current };
    const goal: PersistedGoal = { ...current, status: "blocked", updatedAtMs: now };
    this.upsertGoal(goal);
    return { accepted: true, attempt, goal };
  }

  upsertGoalRuntime(runtime: PersistedGoalRuntime) {
    run(this.goals.prepare(`
      INSERT INTO goal_runtime(thread_id, goal_id, phase, consecutive_blocked_turns, last_error, selected_skill_names_json, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id, goal_id) DO UPDATE SET phase=excluded.phase,
        consecutive_blocked_turns=excluded.consecutive_blocked_turns,
        last_error=excluded.last_error, selected_skill_names_json=excluded.selected_skill_names_json,
        updated_at_ms=excluded.updated_at_ms
    `), runtime.threadId, runtime.goalId, runtime.phase, runtime.consecutiveBlockedTurns,
      runtime.lastError, JSON.stringify(runtime.selectedSkillNames ?? []), runtime.updatedAtMs);
  }

  getGoalRuntime(threadId: string, goalId: string): PersistedGoalRuntime | null {
    const row = this.goals.prepare(`
      SELECT thread_id AS threadId, goal_id AS goalId, phase,
        consecutive_blocked_turns AS consecutiveBlockedTurns, last_error AS lastError,
        selected_skill_names_json AS selectedSkillNamesJson,
        updated_at_ms AS updatedAtMs
      FROM goal_runtime WHERE thread_id = ? AND goal_id = ?
    `).get(threadId, goalId) as (Omit<PersistedGoalRuntime, "selectedSkillNames"> & { selectedSkillNamesJson: string }) | undefined;
    if (!row) return null;
    let selectedSkillNames: string[] = [];
    try {
      const parsed = JSON.parse(row.selectedSkillNamesJson);
      if (Array.isArray(parsed)) selectedSkillNames = parsed.filter((name): name is string => typeof name === "string");
    } catch {
      selectedSkillNames = [];
    }
    const { selectedSkillNamesJson: _ignored, ...runtime } = row;
    return { ...runtime, selectedSkillNames };
  }

  replaceGoalPlan(threadId: string, goalId: string, steps: Array<{
    stepId: string;
    title: string;
    description: string;
    status: PersistedGoalPlanStep["status"];
    result?: string;
  }>): PersistedGoalPlanStep[] {
    if (!steps.length) throw new Error("A goal plan requires at least one step.");
    if (new Set(steps.map((step) => step.stepId)).size !== steps.length) {
      throw new Error("Goal plan step ids must be unique.");
    }
    if (steps.filter((step) => step.status === "in_progress").length > 1) {
      throw new Error("A goal plan can have at most one in-progress step.");
    }
    if (steps.some((step) => !step.stepId.trim() || !step.title.trim() || !step.description.trim())) {
      throw new Error("Goal plan steps require an id, title, and description.");
    }
    const now = Date.now();
    this.goals.exec("BEGIN IMMEDIATE");
    try {
      this.goals.prepare("DELETE FROM goal_plan_steps WHERE thread_id = ? AND goal_id = ?").run(threadId, goalId);
      const insert = this.goals.prepare(`
        INSERT INTO goal_plan_steps(thread_id, goal_id, step_id, position, title, description, status, result, updated_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      steps.forEach((step, position) => insert.run(threadId, goalId, step.stepId, position,
        step.title.trim(), step.description.trim(), step.status, step.result?.trim() ?? "", now));
      this.goals.exec("COMMIT");
    } catch (error) {
      this.goals.exec("ROLLBACK");
      throw error;
    }
    this.appendGoalEvent(threadId, goalId, "plan_replaced", { stepCount: steps.length });
    return this.listGoalPlan(threadId, goalId);
  }

  listGoalPlan(threadId: string, goalId: string): PersistedGoalPlanStep[] {
    return this.goals.prepare(`
      SELECT thread_id AS threadId, goal_id AS goalId, step_id AS stepId, position,
        title, description, status, result, updated_at_ms AS updatedAtMs
      FROM goal_plan_steps WHERE thread_id = ? AND goal_id = ? ORDER BY position
    `).all(threadId, goalId) as unknown as PersistedGoalPlanStep[];
  }

  createGoalQuestion(threadId: string, goalId: string, input: {
    questionId: string;
    prompt: string;
    options: PersistedGoalQuestion["options"];
  }): PersistedGoalQuestion {
    if (input.options.length < 2 || input.options.length > 3) {
      throw new Error("A goal question requires two or three options.");
    }
    const now = Date.now();
    this.goals.prepare(`
      INSERT INTO goal_questions(thread_id, goal_id, question_id, prompt, options_json, status, answer, created_at_ms)
      VALUES (?, ?, ?, ?, ?, 'pending', '', ?)
      ON CONFLICT(thread_id, goal_id, question_id) DO UPDATE SET
        prompt = excluded.prompt,
        options_json = excluded.options_json,
        status = 'pending',
        answer = '',
        created_at_ms = excluded.created_at_ms,
        answered_at_ms = NULL
    `).run(threadId, goalId, input.questionId, input.prompt.trim(), JSON.stringify(input.options), now);
    const runtime = this.getGoalRuntime(threadId, goalId);
    this.upsertGoalRuntime({
      ...(runtime ?? { threadId, goalId, consecutiveBlockedTurns: 0, lastError: "" }),
      phase: "waiting_user",
      updatedAtMs: now
    });
    this.appendGoalEvent(threadId, goalId, "question_created", { questionId: input.questionId });
    return this.getPendingGoalQuestion(threadId, goalId)!;
  }

  getPendingGoalQuestion(threadId: string, goalId: string): PersistedGoalQuestion | null {
    const row = this.goals.prepare(`
      SELECT thread_id AS threadId, goal_id AS goalId, question_id AS questionId,
        prompt, options_json AS optionsJson, status, answer,
        created_at_ms AS createdAtMs, answered_at_ms AS answeredAtMs
      FROM goal_questions WHERE thread_id = ? AND goal_id = ? AND status = 'pending'
      ORDER BY created_at_ms DESC LIMIT 1
    `).get(threadId, goalId) as any;
    if (!row) return null;
    return { ...row, options: JSON.parse(row.optionsJson), answeredAtMs: row.answeredAtMs ?? undefined };
  }

  answerGoalQuestion(threadId: string, goalId: string, questionId: string, answer: string) {
    const normalizedAnswer = answer.trim();
    if (!normalizedAnswer) throw new Error("Goal question answer is required.");
    const now = Date.now();
    const result = this.goals.prepare(`
      UPDATE goal_questions SET status = 'answered', answer = ?, answered_at_ms = ?
      WHERE thread_id = ? AND goal_id = ? AND question_id = ? AND status = 'pending'
    `).run(normalizedAnswer, now, threadId, goalId, questionId);
    if (Number(result.changes) === 0) throw new Error("No matching pending goal question exists.");
    const runtime = this.getGoalRuntime(threadId, goalId);
    this.upsertGoalRuntime({
      ...(runtime ?? { threadId, goalId, consecutiveBlockedTurns: 0, lastError: "" }),
      phase: "idle",
      updatedAtMs: now
    });
    this.appendGoalEvent(threadId, goalId, "question_answered", { questionId, answer: normalizedAnswer });
  }

  listExpertQuestions(threadId: string, goalId: string) {
    return (this.goals.prepare(`SELECT question_id AS questionId, prompt, status, answer,
      options_json AS optionsJson FROM goal_questions
      WHERE thread_id = ? AND goal_id = ? AND question_id LIKE 'expert-%'
      ORDER BY created_at_ms DESC`).all(threadId, goalId) as Array<any>)
      .map(row => ({ ...row, options: JSON.parse(row.optionsJson) }));
  }

  markExpertPreferenceApplied(threadId: string, goalId: string, questionId: string) {
    this.goals.prepare("UPDATE goal_questions SET status = 'applied' WHERE thread_id = ? AND goal_id = ? AND question_id = ? AND status = 'answered'")
      .run(threadId, goalId, questionId);
  }

  hasExpertActivation(threadId: string, goalId: string, expertId: string) {
    return Boolean(this.goals.prepare("SELECT 1 FROM goal_events WHERE thread_id = ? AND goal_id = ? AND event_type = 'expert_activated' AND json_extract(payload_json, '$.expertId') = ? LIMIT 1")
      .get(threadId, goalId, expertId));
  }

  getGoalSnapshot(threadId: string): PersistedGoalSnapshot | null {
    const goal = this.getGoal(threadId);
    if (!goal) return null;
    const runtime = this.getGoalRuntime(threadId, goal.goalId) ?? {
      threadId,
      goalId: goal.goalId,
      phase: goal.status === "complete" ? "complete" : goal.status === "blocked" ? "blocked" : "idle",
      consecutiveBlockedTurns: 0,
      lastError: "",
      updatedAtMs: goal.updatedAtMs
    };
    return {
      goal,
      runtime,
      plan: this.listGoalPlan(threadId, goal.goalId),
      pendingQuestion: this.getPendingGoalQuestion(threadId, goal.goalId)
    };
  }

  appendGoalEvent(threadId: string, goalId: string, eventType: string, payload: unknown) {
    this.goals.prepare(`
      INSERT INTO goal_events(thread_id, goal_id, event_type, payload_json, created_at_ms)
      VALUES (?, ?, ?, ?, ?)
    `).run(threadId, goalId, eventType, JSON.stringify(payload ?? null), Date.now());
  }

  upsertRemoteWorkItem(item: PersistedRemoteWorkItem) {
    this.state.prepare(`
      INSERT INTO remote_work_items(id, status, objective, source, target_device_id,
        knowledge_snapshot_id, payload_json, thread_id, claimed_at_ms, lease_until_ms,
        completed_at_ms, last_error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, objective=excluded.objective,
        source=excluded.source, target_device_id=excluded.target_device_id,
        knowledge_snapshot_id=excluded.knowledge_snapshot_id, payload_json=excluded.payload_json,
        thread_id=COALESCE(excluded.thread_id, remote_work_items.thread_id),
        lease_until_ms=excluded.lease_until_ms,
        completed_at_ms=COALESCE(excluded.completed_at_ms, remote_work_items.completed_at_ms),
        last_error=excluded.last_error
    `).run(item.id, item.status, item.objective, item.source, item.targetDeviceId,
      item.knowledgeSnapshotId ?? null, item.payloadJson, item.threadId ?? null,
      item.claimedAtMs, item.leaseUntilMs, item.completedAtMs ?? null, item.lastError);
  }

  getRemoteWorkItem(id: string): PersistedRemoteWorkItem | null {
    const row = this.state.prepare(`
      SELECT id, status, objective, source, target_device_id AS targetDeviceId,
        knowledge_snapshot_id AS knowledgeSnapshotId, payload_json AS payloadJson,
        thread_id AS threadId, claimed_at_ms AS claimedAtMs, lease_until_ms AS leaseUntilMs,
        completed_at_ms AS completedAtMs, last_error AS lastError
      FROM remote_work_items WHERE id = ?
    `).get(id) as PersistedRemoteWorkItem | undefined;
    return row ? {
      ...row,
      knowledgeSnapshotId: row.knowledgeSnapshotId ?? undefined,
      threadId: row.threadId ?? undefined,
      completedAtMs: row.completedAtMs ?? undefined
    } : null;
  }

  getLatestActionableRemoteWorkItem(): PersistedRemoteWorkItem | null {
    const row = this.state.prepare(`
      SELECT id, status, objective, source, target_device_id AS targetDeviceId,
        knowledge_snapshot_id AS knowledgeSnapshotId, payload_json AS payloadJson,
        thread_id AS threadId, claimed_at_ms AS claimedAtMs, lease_until_ms AS leaseUntilMs,
        completed_at_ms AS completedAtMs, last_error AS lastError
      FROM remote_work_items
      WHERE status IN ('claimed', 'interrupted')
      ORDER BY claimed_at_ms DESC LIMIT 1
    `).get() as PersistedRemoteWorkItem | undefined;
    return row ? {
      ...row,
      knowledgeSnapshotId: row.knowledgeSnapshotId ?? undefined,
      threadId: row.threadId ?? undefined,
      completedAtMs: row.completedAtMs ?? undefined
    } : null;
  }

  updateRemoteWorkItemStatus(
    id: string,
    expectedStatus: PersistedRemoteWorkItemStatus,
    nextStatus: PersistedRemoteWorkItemStatus,
    input: { threadId?: string; completedAtMs?: number; lastError?: string } = {}
  ): boolean {
    const result = this.state.prepare(`
      UPDATE remote_work_items
      SET status = ?, thread_id = COALESCE(?, thread_id),
        completed_at_ms = COALESCE(?, completed_at_ms), last_error = ?
      WHERE id = ? AND status = ?
    `).run(nextStatus, input.threadId ?? null, input.completedAtMs ?? null,
      input.lastError ?? "", id, expectedStatus);
    return Number(result.changes) === 1;
  }

  nextRemoteEventSequence(workItemId: string): number {
    const row = this.state.prepare(`
      SELECT COALESCE(MAX(sequence_no), -1) + 1 AS nextSequence
      FROM remote_event_outbox WHERE work_item_id = ?
    `).get(workItemId) as { nextSequence: number };
    return Number(row.nextSequence);
  }

  appendRemoteEvent(event: PersistedRemoteEvent) {
    this.state.prepare(`
      INSERT INTO remote_event_outbox(event_id, work_item_id, sequence_no, payload_json,
        status, attempt_count, next_attempt_at_ms, created_at_ms, acknowledged_at_ms, last_error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(event.eventId, event.workItemId, event.sequenceNo, event.payloadJson,
      event.status, event.attemptCount, event.nextAttemptAtMs, event.createdAtMs,
      event.acknowledgedAtMs ?? null, event.lastError ?? "");
  }

  listDueRemoteEvents(limit: number, nowMs: number): PersistedRemoteEvent[] {
    return this.state.prepare(`
      SELECT event_id AS eventId, work_item_id AS workItemId, sequence_no AS sequenceNo,
        payload_json AS payloadJson, status, attempt_count AS attemptCount,
        next_attempt_at_ms AS nextAttemptAtMs, created_at_ms AS createdAtMs,
        acknowledged_at_ms AS acknowledgedAtMs, last_error AS lastError
      FROM remote_event_outbox
      WHERE status = 'pending' AND next_attempt_at_ms <= ?
      ORDER BY created_at_ms, work_item_id, sequence_no LIMIT ?
    `).all(nowMs, Math.max(1, Math.min(100, Math.trunc(limit)))).map((row: any) => ({
      ...row,
      acknowledgedAtMs: row.acknowledgedAtMs ?? undefined,
      lastError: row.lastError || undefined
    })) as PersistedRemoteEvent[];
  }

  getRemoteEventSyncStatus(): {
    pendingEventCount: number;
    sendingEventCount: number;
    quarantinedEventCount: number;
    lastAcknowledgedAtMs: number | null;
    lastError: string;
  } {
    const counts = this.state.prepare(`
      SELECT
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pendingEventCount,
        SUM(CASE WHEN status = 'sending' THEN 1 ELSE 0 END) AS sendingEventCount,
        SUM(CASE WHEN status = 'quarantined' THEN 1 ELSE 0 END) AS quarantinedEventCount,
        MAX(acknowledged_at_ms) AS lastAcknowledgedAtMs
      FROM remote_event_outbox
    `).get() as { pendingEventCount: number | null; sendingEventCount: number | null; quarantinedEventCount: number | null; lastAcknowledgedAtMs: number | null };
    const failure = this.state.prepare(`
      SELECT last_error AS lastError FROM remote_event_outbox
      WHERE last_error <> '' ORDER BY created_at_ms DESC LIMIT 1
    `).get() as { lastError: string } | undefined;
    return {
      pendingEventCount: Number(counts.pendingEventCount ?? 0),
      sendingEventCount: Number(counts.sendingEventCount ?? 0),
      quarantinedEventCount: Number(counts.quarantinedEventCount ?? 0),
      lastAcknowledgedAtMs: counts.lastAcknowledgedAtMs ?? null,
      lastError: failure?.lastError ?? ""
    };
  }

  markRemoteEventsSending(eventIds: string[]) {
    if (!eventIds.length) return;
    const update = this.state.prepare(`
      UPDATE remote_event_outbox SET status = 'sending' WHERE event_id = ? AND status = 'pending'
    `);
    this.state.exec("BEGIN IMMEDIATE");
    try {
      for (const eventId of eventIds) update.run(eventId);
      this.state.exec("COMMIT");
    } catch (error) {
      this.state.exec("ROLLBACK");
      throw error;
    }
  }

  acknowledgeRemoteEvents(eventIds: string[], acknowledgedAtMs: number) {
    if (!eventIds.length) return;
    const update = this.state.prepare(`
      UPDATE remote_event_outbox
      SET status = 'acknowledged', acknowledged_at_ms = ?, last_error = ''
      WHERE event_id = ? AND status IN ('pending', 'sending')
    `);
    this.state.exec("BEGIN IMMEDIATE");
    try {
      for (const eventId of eventIds) update.run(acknowledgedAtMs, eventId);
      this.state.exec("COMMIT");
    } catch (error) {
      this.state.exec("ROLLBACK");
      throw error;
    }
  }

  retryRemoteEvents(eventIds: string[], nextAttemptAtMs: number, lastError: string) {
    const update = this.state.prepare(`
      UPDATE remote_event_outbox SET status = 'pending', attempt_count = attempt_count + 1,
        next_attempt_at_ms = ?, last_error = ? WHERE event_id = ? AND status = 'sending'
    `);
    for (const eventId of eventIds) update.run(nextAttemptAtMs, lastError, eventId);
  }

  quarantineRemoteEvents(eventIds: string[], lastError: string) {
    const update = this.state.prepare(`
      UPDATE remote_event_outbox SET status = 'quarantined', attempt_count = attempt_count + 1,
        last_error = ? WHERE event_id = ? AND status = 'sending'
    `);
    for (const eventId of eventIds) update.run(lastError, eventId);
  }

  recoverRemoteExecutionState(nowMs: number) {
    this.state.exec("BEGIN IMMEDIATE");
    try {
      this.state.prepare(`
        UPDATE remote_event_outbox SET status = 'pending', next_attempt_at_ms = ?
        WHERE status = 'sending'
      `).run(nowMs);
      this.state.prepare(`
        UPDATE remote_work_items SET status = 'interrupted', last_error = 'APP_RESTARTED_DURING_EXECUTION'
        WHERE status IN ('running', 'waiting_approval')
      `).run();
      this.state.exec("COMMIT");
    } catch (error) {
      this.state.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.state.close();
    this.logs.close();
    this.memories.close();
    this.goals.close();
  }
}
