import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const brainWorkspaceKeys = [
  "quant",
  "game",
  "video",
  "music",
  "data",
  "software",
  "document"
] as const;

export type BrainWorkspaceKey = (typeof brainWorkspaceKeys)[number];
export type BrainProjectStatus = "ACTIVE" | "ARCHIVED";
export type BrainConversationStatus = "ACTIVE" | "ARCHIVED";

export interface BrainWorkspaceRecord {
  workspaceKey: BrainWorkspaceKey;
  displayName: string;
  enabled: boolean;
  capabilities: string[];
  defaultModelRoute: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface BrainProjectRecord {
  id: string;
  ownerId: string;
  name: string;
  primaryWorkspaceKey: BrainWorkspaceKey;
  status: BrainProjectStatus;
  lastConversationId: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
}

export interface BrainConversationRecord {
  id: string;
  projectId: string;
  ownerId: string;
  title: string;
  workspaceSnapshot: BrainWorkspaceKey;
  status: BrainConversationStatus;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
}

export interface BrainAnnotationRecord {
  id: string; fileId: string; fileVersion: number; pageOrSheet: string; annotationType: string;
  geometryJson: string; structuralAnchorJson: string; selectedText: string; createdBy: string; createdAt: string;
}

export interface BrainMessageRecord {
  id: string;
  conversationId: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallsJson: string;
  sourceRefsJson: string;
  requestId: string;
  createdAt: string;
}

export interface BrainFileRecord {
  id: string; projectId: string; ownerId: string; logicalName: string; mimeType: string;
  sizeBytes: number; contentHash: string; storageKey: string; versionNo: number;
  parseStatus: string; validationStatus: string; createdAt: string;
}

export interface BrainTaskRecord {
  id: string; projectId: string; conversationId: string; workspaceKey: BrainWorkspaceKey;
  taskType: string; status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
  progress: number; requestId: string; idempotencyKey: string; attempt: number; maxAttempts: number;
  errorCode: string; errorDetail: string; startedAt: string; finishedAt: string; heartbeatAt: string;
}

export interface BrainArtifactRecord {
  id: string; projectId: string; taskId: string; sourceFileId: string; artifactType: string;
  storageKey: string; contentHash: string; validationStatus: string; createdAt: string;
}

export class BrainStorageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BrainStorageError";
    this.code = code;
  }
}

const latestMigrationVersion = 1;
const workspaceDefinitions: ReadonlyArray<readonly [BrainWorkspaceKey, string, number]> = [
  ["quant", "量化交易", 10],
  ["game", "游戏制作", 20],
  ["video", "视频制作", 30],
  ["music", "音乐创作", 40],
  ["data", "数据与决策", 50],
  ["software", "软件与自动化", 60],
  ["document", "文档创作", 70]
];

function nowIso() {
  return new Date().toISOString();
}

function requireText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) throw new BrainStorageError("BRAIN_INPUT_INVALID", `${field} is required`);
  return normalized;
}

function requireWorkspaceKey(value: string): BrainWorkspaceKey {
  if ((brainWorkspaceKeys as readonly string[]).includes(value)) return value as BrainWorkspaceKey;
  throw new BrainStorageError("BRAIN_WORKSPACE_UNSUPPORTED", `Unsupported workspace: ${value}`);
}

function openDatabase(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  try {
    database.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;");
    database.exec(`
      CREATE TABLE IF NOT EXISTS brain_schema_migration (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        installed_at TEXT NOT NULL
      );
    `);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function currentMigrationVersion(database: DatabaseSync) {
  const row = database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM brain_schema_migration").get() as { version: number };
  return Number(row.version || 0);
}

function applyMigration(database: DatabaseSync, version: number, description: string, sql: string) {
  if (currentMigrationVersion(database) >= version) return;
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(sql);
    database.prepare("INSERT INTO brain_schema_migration(version, description, installed_at) VALUES (?, ?, ?)")
      .run(version, description, nowIso());
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function migrationOneSql() {
  return `
    CREATE TABLE brain_workspace (
      workspace_key TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
      capabilities_json TEXT NOT NULL DEFAULT '[]',
      default_model_route TEXT NOT NULL DEFAULT 'auto',
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE brain_project (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      primary_workspace_key TEXT NOT NULL REFERENCES brain_workspace(workspace_key),
      status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'ARCHIVED')),
      last_conversation_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_opened_at TEXT NOT NULL
    );
    CREATE INDEX idx_brain_project_owner_workspace_opened
      ON brain_project(owner_id, primary_workspace_key, last_opened_at DESC);
    CREATE INDEX idx_brain_project_owner_status_updated
      ON brain_project(owner_id, status, updated_at DESC);
    CREATE TABLE brain_project_workspace (
      project_id TEXT NOT NULL REFERENCES brain_project(id) ON DELETE CASCADE,
      workspace_key TEXT NOT NULL REFERENCES brain_workspace(workspace_key),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
      PRIMARY KEY(project_id, workspace_key)
    );
    CREATE TABLE brain_private_model_profile (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      provider_type TEXT NOT NULL,
      model_name TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      auth_mode TEXT NOT NULL CHECK(auth_mode IN ('os_vault', 'external_proxy', 'none')),
      credential_ref TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE brain_conversation (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES brain_project(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      workspace_snapshot TEXT NOT NULL REFERENCES brain_workspace(workspace_key),
      status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'ARCHIVED')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_message_at TEXT NOT NULL
    );
    CREATE INDEX idx_brain_conversation_project_recent
      ON brain_conversation(project_id, status, last_message_at DESC);
    CREATE TABLE brain_message (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES brain_conversation(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant', 'tool')),
      content TEXT NOT NULL,
      tool_calls_json TEXT NOT NULL DEFAULT '[]',
      source_refs_json TEXT NOT NULL DEFAULT '[]',
      request_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_brain_message_conversation_created
      ON brain_message(conversation_id, created_at, id);
    CREATE TABLE brain_draft (
      owner_id TEXT NOT NULL,
      project_id TEXT NOT NULL REFERENCES brain_project(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES brain_conversation(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(owner_id, conversation_id)
    );
    CREATE TABLE brain_file (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES brain_project(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL,
      logical_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      version_no INTEGER NOT NULL,
      parse_status TEXT NOT NULL,
      validation_status TEXT NOT NULL,
      extractor_name TEXT NOT NULL DEFAULT '',
      extractor_version TEXT NOT NULL DEFAULT '',
      page_slide_sheet_count INTEGER NOT NULL DEFAULT 0,
      extracted_text_size INTEGER NOT NULL DEFAULT 0,
      structure_index_key TEXT NOT NULL DEFAULT '',
      preview_manifest_key TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      UNIQUE(project_id, storage_key, version_no)
    );
    CREATE TABLE brain_file_extract (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL REFERENCES brain_file(id) ON DELETE CASCADE,
      file_version INTEGER NOT NULL,
      unit_type TEXT NOT NULL,
      unit_index INTEGER NOT NULL,
      plain_text TEXT NOT NULL DEFAULT '',
      structure_json TEXT NOT NULL DEFAULT '{}',
      source_anchor_json TEXT NOT NULL DEFAULT '{}',
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(file_id, file_version, unit_type, unit_index)
    );
    CREATE TABLE brain_task (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES brain_project(id) ON DELETE CASCADE,
      conversation_id TEXT REFERENCES brain_conversation(id) ON DELETE SET NULL,
      workspace_key TEXT NOT NULL REFERENCES brain_workspace(workspace_key),
      task_type TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT')),
      progress REAL NOT NULL DEFAULT 0 CHECK(progress >= 0 AND progress <= 1),
      request_id TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 1,
      resource_limits_json TEXT NOT NULL DEFAULT '{}',
      error_code TEXT NOT NULL DEFAULT '',
      error_detail TEXT NOT NULL DEFAULT '',
      started_at TEXT,
      finished_at TEXT,
      heartbeat_at TEXT,
      UNIQUE(project_id, idempotency_key)
    );
    CREATE TABLE brain_artifact (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES brain_project(id) ON DELETE CASCADE,
      task_id TEXT REFERENCES brain_task(id) ON DELETE SET NULL,
      source_file_id TEXT REFERENCES brain_file(id) ON DELETE SET NULL,
      artifact_type TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      validation_status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE brain_annotation (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL REFERENCES brain_file(id) ON DELETE CASCADE,
      file_version INTEGER NOT NULL,
      page_or_sheet TEXT NOT NULL DEFAULT '',
      annotation_type TEXT NOT NULL,
      geometry_json TEXT NOT NULL DEFAULT '{}',
      structural_anchor_json TEXT NOT NULL DEFAULT '{}',
      selected_text TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE brain_change_set (
      id TEXT PRIMARY KEY,
      annotation_id TEXT NOT NULL REFERENCES brain_annotation(id) ON DELETE CASCADE,
      task_id TEXT REFERENCES brain_task(id) ON DELETE SET NULL,
      base_file_version INTEGER NOT NULL,
      result_file_version INTEGER,
      change_summary TEXT NOT NULL,
      diff_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL CHECK(status IN ('PROPOSED', 'ACCEPTED', 'REJECTED', 'REVERTED')),
      created_at TEXT NOT NULL,
      reviewed_at TEXT
    );
  `;
}

function mapWorkspace(row: Record<string, unknown>): BrainWorkspaceRecord {
  return {
    workspaceKey: requireWorkspaceKey(String(row.workspace_key)),
    displayName: String(row.display_name),
    enabled: Number(row.enabled) === 1,
    capabilities: JSON.parse(String(row.capabilities_json || "[]")) as string[],
    defaultModelRoute: String(row.default_model_route),
    sortOrder: Number(row.sort_order),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapAnnotation(row: Record<string, unknown>): BrainAnnotationRecord {
  return { id: String(row.id), fileId: String(row.file_id), fileVersion: Number(row.file_version), pageOrSheet: String(row.page_or_sheet), annotationType: String(row.annotation_type), geometryJson: String(row.geometry_json), structuralAnchorJson: String(row.structural_anchor_json), selectedText: String(row.selected_text), createdBy: String(row.created_by), createdAt: String(row.created_at) };
}

function mapProject(row: Record<string, unknown>): BrainProjectRecord {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    name: String(row.name),
    primaryWorkspaceKey: requireWorkspaceKey(String(row.primary_workspace_key)),
    status: String(row.status) as BrainProjectStatus,
    lastConversationId: String(row.last_conversation_id || ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastOpenedAt: String(row.last_opened_at)
  };
}

function mapConversation(row: Record<string, unknown>): BrainConversationRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    ownerId: String(row.owner_id),
    title: String(row.title),
    workspaceSnapshot: requireWorkspaceKey(String(row.workspace_snapshot)),
    status: String(row.status) as BrainConversationStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastMessageAt: String(row.last_message_at)
  };
}

function mapFile(row: Record<string, unknown>): BrainFileRecord {
  return {
    id: String(row.id), projectId: String(row.project_id), ownerId: String(row.owner_id),
    logicalName: String(row.logical_name), mimeType: String(row.mime_type), sizeBytes: Number(row.size_bytes),
    contentHash: String(row.content_hash), storageKey: String(row.storage_key), versionNo: Number(row.version_no),
    parseStatus: String(row.parse_status), validationStatus: String(row.validation_status), createdAt: String(row.created_at)
  };
}

function mapTask(row: Record<string, unknown>): BrainTaskRecord {
  return {
    id: String(row.id), projectId: String(row.project_id), conversationId: String(row.conversation_id || ""),
    workspaceKey: requireWorkspaceKey(String(row.workspace_key)), taskType: String(row.task_type),
    status: String(row.status) as BrainTaskRecord["status"], progress: Number(row.progress),
    requestId: String(row.request_id), idempotencyKey: String(row.idempotency_key), attempt: Number(row.attempt),
    maxAttempts: Number(row.max_attempts), errorCode: String(row.error_code), errorDetail: String(row.error_detail),
    startedAt: String(row.started_at || ""), finishedAt: String(row.finished_at || ""), heartbeatAt: String(row.heartbeat_at || "")
  };
}

function mapArtifact(row: Record<string, unknown>): BrainArtifactRecord {
  return {
    id: String(row.id), projectId: String(row.project_id), taskId: String(row.task_id || ""),
    sourceFileId: String(row.source_file_id || ""), artifactType: String(row.artifact_type),
    storageKey: String(row.storage_key), contentHash: String(row.content_hash),
    validationStatus: String(row.validation_status), createdAt: String(row.created_at)
  };
}

export class BrainWorkspaceStorage {
  readonly path: string;
  readonly backupRoot: string;
  private readonly database: DatabaseSync;

  constructor(root: string) {
    this.path = join(root, "brain.db");
    this.backupRoot = join(root, "backups");
    const existed = existsSync(this.path);
    let database: DatabaseSync;
    try {
      database = openDatabase(this.path);
      const integrity = database.prepare("PRAGMA quick_check").get() as { quick_check?: string } | undefined;
      if (integrity && String(integrity.quick_check || "ok").toLowerCase() !== "ok") {
        database.close();
        throw new BrainStorageError("BRAIN_DATABASE_CORRUPT", "Local BRAIN database failed integrity checking");
      }
    } catch (error) {
      if (!existed || !this.restoreLatestBackup()) throw error;
      database = openDatabase(this.path);
    }
    const currentVersion = currentMigrationVersion(database);
    if (existed && currentVersion < latestMigrationVersion) {
      database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      database.close();
      const backupPath = `${this.path}.v${currentVersion}-before-v${latestMigrationVersion}.bak`;
      if (!existsSync(backupPath)) copyFileSync(this.path, backupPath);
      database = openDatabase(this.path);
    }
    this.database = database;
    try {
      applyMigration(this.database, 1, "BRAIN local-first workspace schema", migrationOneSql());
      this.seedWorkspaces();
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  close() {
    try { this.createBackup("shutdown"); } catch { /* Closing must continue even if a snapshot cannot be created. */ }
    this.database.close();
  }

  verifyIntegrity() {
    const rows = this.database.prepare("PRAGMA integrity_check").all() as Array<Record<string, unknown>>;
    const messages = rows.flatMap((row) => Object.values(row).map(String));
    return { ok: messages.length === 1 && messages[0]?.toLowerCase() === "ok", messages };
  }

  createBackup(reason = "manual") {
    const integrity = this.verifyIntegrity();
    if (!integrity.ok) throw new BrainStorageError("BRAIN_DATABASE_CORRUPT", integrity.messages.join("; "));
    mkdirSync(this.backupRoot, { recursive: true });
    this.database.exec("PRAGMA wal_checkpoint(FULL)");
    const safeReason = reason.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 32) || "manual";
    const backupPath = join(this.backupRoot, `brain-${new Date().toISOString().replace(/[:.]/g, "-")}-${safeReason}.db`);
    copyFileSync(this.path, backupPath);
    const backups = readdirSync(this.backupRoot)
      .filter((name) => /^brain-.*\.db$/i.test(name))
      .sort()
      .reverse();
    for (const stale of backups.slice(5)) unlinkSync(join(this.backupRoot, stale));
    return backupPath;
  }

  private restoreLatestBackup() {
    if (!existsSync(this.backupRoot)) return false;
    const latest = readdirSync(this.backupRoot)
      .filter((name) => /^brain-.*\.db$/i.test(name))
      .sort()
      .reverse()[0];
    if (!latest) return false;
    const corruptPath = `${this.path}.corrupt-${Date.now()}`;
    renameSync(this.path, corruptPath);
    copyFileSync(join(this.backupRoot, latest), this.path);
    return true;
  }

  listWorkspaces(): BrainWorkspaceRecord[] {
    return (this.database.prepare("SELECT * FROM brain_workspace ORDER BY sort_order, workspace_key").all() as Record<string, unknown>[])
      .map(mapWorkspace);
  }

  createProject(input: { ownerId: string; name: string; primaryWorkspaceKey: string }): BrainProjectRecord {
    const ownerId = requireText(input.ownerId, "ownerId");
    const name = requireText(input.name, "name");
    const workspaceKey = requireWorkspaceKey(input.primaryWorkspaceKey);
    const workspace = this.database.prepare("SELECT enabled FROM brain_workspace WHERE workspace_key = ?").get(workspaceKey) as { enabled: number } | undefined;
    if (!workspace || Number(workspace.enabled) !== 1) {
      throw new BrainStorageError("BRAIN_WORKSPACE_DISABLED", `Workspace is disabled: ${workspaceKey}`);
    }
    const id = `project_${randomUUID()}`;
    const timestamp = nowIso();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        INSERT INTO brain_project(id, owner_id, name, primary_workspace_key, status, created_at, updated_at, last_opened_at)
        VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
      `).run(id, ownerId, name, workspaceKey, timestamp, timestamp, timestamp);
      this.database.prepare("INSERT INTO brain_project_workspace(project_id, workspace_key, enabled) VALUES (?, ?, 1)")
        .run(id, workspaceKey);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getProject(ownerId, id);
  }

  getProject(ownerId: string, projectId: string): BrainProjectRecord {
    const row = this.database.prepare("SELECT * FROM brain_project WHERE id = ?").get(projectId) as Record<string, unknown> | undefined;
    if (!row) throw new BrainStorageError("BRAIN_PROJECT_NOT_FOUND", "Project was not found");
    if (String(row.owner_id) !== requireText(ownerId, "ownerId")) {
      throw new BrainStorageError("BRAIN_PROJECT_FORBIDDEN", "Project belongs to another local owner");
    }
    return mapProject(row);
  }

  listProjects(input: { ownerId: string; workspaceKey?: string; includeArchived?: boolean }): BrainProjectRecord[] {
    const ownerId = requireText(input.ownerId, "ownerId");
    const workspaceKey = input.workspaceKey ? requireWorkspaceKey(input.workspaceKey) : null;
    const statusClause = input.includeArchived ? "" : " AND status = 'ACTIVE'";
    const rows = workspaceKey
      ? this.database.prepare(`SELECT * FROM brain_project WHERE owner_id = ? AND primary_workspace_key = ?${statusClause} ORDER BY last_opened_at DESC`)
        .all(ownerId, workspaceKey)
      : this.database.prepare(`SELECT * FROM brain_project WHERE owner_id = ?${statusClause} ORDER BY last_opened_at DESC`)
        .all(ownerId);
    return (rows as Record<string, unknown>[]).map(mapProject);
  }

  updateProject(input: { ownerId: string; projectId: string; name?: string; status?: BrainProjectStatus }): BrainProjectRecord {
    const current = this.getProject(input.ownerId, input.projectId);
    const name = input.name === undefined ? current.name : requireText(input.name, "name");
    const status = input.status ?? current.status;
    if (status !== "ACTIVE" && status !== "ARCHIVED") {
      throw new BrainStorageError("BRAIN_INPUT_INVALID", `Unsupported project status: ${status}`);
    }
    const timestamp = nowIso();
    this.database.prepare("UPDATE brain_project SET name = ?, status = ?, updated_at = ?, last_opened_at = ? WHERE id = ? AND owner_id = ?")
      .run(name, status, timestamp, timestamp, input.projectId, input.ownerId);
    return this.getProject(input.ownerId, input.projectId);
  }

  setProjectWorkspace(input: { ownerId: string; projectId: string; workspaceKey: string; enabled: boolean }) {
    this.getProject(input.ownerId, input.projectId);
    const workspaceKey = requireWorkspaceKey(input.workspaceKey);
    this.database.prepare(`
      INSERT INTO brain_project_workspace(project_id, workspace_key, enabled) VALUES (?, ?, ?)
      ON CONFLICT(project_id, workspace_key) DO UPDATE SET enabled = excluded.enabled
    `).run(input.projectId, workspaceKey, input.enabled ? 1 : 0);
  }

  createConversation(input: { ownerId: string; projectId: string; title: string; workspaceKey?: string }): BrainConversationRecord {
    const project = this.getProject(input.ownerId, input.projectId);
    const workspaceKey = requireWorkspaceKey(input.workspaceKey ?? project.primaryWorkspaceKey);
    const id = `conversation_${randomUUID()}`;
    const timestamp = nowIso();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        INSERT INTO brain_conversation(id, project_id, owner_id, title, workspace_snapshot, status, created_at, updated_at, last_message_at)
        VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
      `).run(id, project.id, project.ownerId, requireText(input.title, "title"), workspaceKey, timestamp, timestamp, timestamp);
      this.database.prepare("UPDATE brain_project SET last_conversation_id = ?, updated_at = ?, last_opened_at = ? WHERE id = ?")
        .run(id, timestamp, timestamp, project.id);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getConversation(input.ownerId, id);
  }

  getConversation(ownerId: string, conversationId: string): BrainConversationRecord {
    const row = this.database.prepare("SELECT * FROM brain_conversation WHERE id = ?").get(conversationId) as Record<string, unknown> | undefined;
    if (!row) throw new BrainStorageError("BRAIN_CONVERSATION_NOT_FOUND", "Conversation was not found");
    if (String(row.owner_id) !== requireText(ownerId, "ownerId")) {
      throw new BrainStorageError("BRAIN_PROJECT_FORBIDDEN", "Conversation belongs to another local owner");
    }
    return mapConversation(row);
  }

  listConversations(input: { ownerId: string; projectId?: string; workspaceKey?: string; includeArchived?: boolean }): BrainConversationRecord[] {
    const ownerId = requireText(input.ownerId, "ownerId");
    const projectId = input.projectId ? requireText(input.projectId, "projectId") : null;
    if (projectId) this.getProject(ownerId, projectId);
    const workspaceKey = input.workspaceKey ? requireWorkspaceKey(input.workspaceKey) : null;
    const conditions = ["owner_id = ?"];
    const parameters: string[] = [ownerId];
    if (projectId) {
      conditions.push("project_id = ?");
      parameters.push(projectId);
    }
    if (workspaceKey) {
      conditions.push("workspace_snapshot = ?");
      parameters.push(workspaceKey);
    }
    if (!input.includeArchived) conditions.push("status = 'ACTIVE'");
    const rows = this.database.prepare(`
      SELECT * FROM brain_conversation
      WHERE ${conditions.join(" AND ")}
      ORDER BY last_message_at DESC, updated_at DESC, id DESC
    `).all(...parameters) as Record<string, unknown>[];
    return rows.map(mapConversation);
  }

  appendMessage(input: Omit<BrainMessageRecord, "id" | "createdAt"> & { ownerId: string }): BrainMessageRecord {
    const conversation = this.getConversation(input.ownerId, input.conversationId);
    if (!["system", "user", "assistant", "tool"].includes(input.role)) {
      throw new BrainStorageError("BRAIN_INPUT_INVALID", `Unsupported message role: ${input.role}`);
    }
    const message: BrainMessageRecord = {
      id: `message_${randomUUID()}`,
      conversationId: conversation.id,
      role: input.role,
      content: input.content,
      toolCallsJson: input.toolCallsJson || "[]",
      sourceRefsJson: input.sourceRefsJson || "[]",
      requestId: input.requestId || "",
      createdAt: nowIso()
    };
    JSON.parse(message.toolCallsJson);
    JSON.parse(message.sourceRefsJson);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        INSERT INTO brain_message(id, conversation_id, role, content, tool_calls_json, source_refs_json, request_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(message.id, message.conversationId, message.role, message.content, message.toolCallsJson,
        message.sourceRefsJson, message.requestId, message.createdAt);
      this.database.prepare("UPDATE brain_conversation SET updated_at = ?, last_message_at = ? WHERE id = ?")
        .run(message.createdAt, message.createdAt, message.conversationId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return message;
  }

  listMessages(ownerId: string, conversationId: string): BrainMessageRecord[] {
    this.getConversation(ownerId, conversationId);
    return (this.database.prepare("SELECT * FROM brain_message WHERE conversation_id = ? ORDER BY created_at, id")
      .all(conversationId) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      conversationId: String(row.conversation_id),
      role: String(row.role) as BrainMessageRecord["role"],
      content: String(row.content),
      toolCallsJson: String(row.tool_calls_json),
      sourceRefsJson: String(row.source_refs_json),
      requestId: String(row.request_id),
      createdAt: String(row.created_at)
    }));
  }

  saveDraft(input: { ownerId: string; projectId: string; conversationId: string; content: string }) {
    const conversation = this.getConversation(input.ownerId, input.conversationId);
    if (conversation.projectId !== input.projectId) {
      throw new BrainStorageError("BRAIN_PROJECT_FORBIDDEN", "Draft project does not own the conversation");
    }
    this.database.prepare(`
      INSERT INTO brain_draft(owner_id, project_id, conversation_id, content, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, conversation_id) DO UPDATE SET
        project_id = excluded.project_id, content = excluded.content, updated_at = excluded.updated_at
    `).run(input.ownerId, input.projectId, input.conversationId, input.content, nowIso());
  }

  readDraft(ownerId: string, conversationId: string) {
    this.getConversation(ownerId, conversationId);
    const row = this.database.prepare("SELECT content, updated_at FROM brain_draft WHERE owner_id = ? AND conversation_id = ?")
      .get(ownerId, conversationId) as { content: string; updated_at: string } | undefined;
    return row ? { content: row.content, updatedAt: row.updated_at } : null;
  }

  registerFile(input: {
    ownerId: string; projectId: string; logicalName: string; mimeType: string; sizeBytes: number;
    contentHash: string; storageKey: string; versionNo?: number;
  }): BrainFileRecord {
    const project = this.getProject(input.ownerId, input.projectId);
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) {
      throw new BrainStorageError("BRAIN_INPUT_INVALID", "sizeBytes must be a non-negative integer");
    }
    const versionNo = input.versionNo ?? 1;
    if (!Number.isSafeInteger(versionNo) || versionNo < 1) {
      throw new BrainStorageError("BRAIN_INPUT_INVALID", "versionNo must be a positive integer");
    }
    const record: BrainFileRecord = {
      id: `file_${randomUUID()}`, projectId: project.id, ownerId: project.ownerId,
      logicalName: requireText(input.logicalName, "logicalName"), mimeType: requireText(input.mimeType, "mimeType"),
      sizeBytes: input.sizeBytes, contentHash: requireText(input.contentHash, "contentHash"),
      storageKey: requireText(input.storageKey, "storageKey"), versionNo,
      parseStatus: "PENDING", validationStatus: "PENDING", createdAt: nowIso()
    };
    this.database.prepare(`
      INSERT INTO brain_file(
        id, project_id, owner_id, logical_name, mime_type, size_bytes, content_hash, storage_key,
        version_no, parse_status, validation_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.projectId, record.ownerId, record.logicalName, record.mimeType, record.sizeBytes,
      record.contentHash, record.storageKey, record.versionNo, record.parseStatus, record.validationStatus, record.createdAt);
    return record;
  }

  listFiles(ownerId: string, projectId: string): BrainFileRecord[] {
    this.getProject(ownerId, projectId);
    return (this.database.prepare(`
      SELECT * FROM brain_file WHERE project_id = ? AND owner_id = ? ORDER BY created_at DESC, id DESC
    `).all(projectId, ownerId) as Record<string, unknown>[]).map(mapFile);
  }

  createAnnotation(input: { ownerId: string; projectId: string; fileId: string; fileVersion: number; pageOrSheet?: string; annotationType: string; geometryJson?: string; structuralAnchorJson?: string; selectedText?: string }): BrainAnnotationRecord {
    this.getProject(input.ownerId, input.projectId);
    const file = this.database.prepare("SELECT id FROM brain_file WHERE id = ? AND project_id = ? AND owner_id = ?").get(input.fileId, input.projectId, input.ownerId);
    if (!file) throw new BrainStorageError("BRAIN_FILE_NOT_FOUND", "Annotation file does not belong to project");
    if (!Number.isSafeInteger(input.fileVersion) || input.fileVersion < 1) throw new BrainStorageError("BRAIN_INPUT_INVALID", "fileVersion must be positive");
    const record: BrainAnnotationRecord = { id: `annotation_${randomUUID()}`, fileId: input.fileId, fileVersion: input.fileVersion, pageOrSheet: input.pageOrSheet || "", annotationType: requireText(input.annotationType, "annotationType"), geometryJson: input.geometryJson || "{}", structuralAnchorJson: input.structuralAnchorJson || "{}", selectedText: input.selectedText || "", createdBy: input.ownerId, createdAt: nowIso() };
    this.database.prepare("INSERT INTO brain_annotation(id, file_id, file_version, page_or_sheet, annotation_type, geometry_json, structural_anchor_json, selected_text, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(record.id, record.fileId, record.fileVersion, record.pageOrSheet, record.annotationType, record.geometryJson, record.structuralAnchorJson, record.selectedText, record.createdBy, record.createdAt);
    return record;
  }

  listAnnotations(ownerId: string, projectId: string): BrainAnnotationRecord[] {
    this.getProject(ownerId, projectId);
    return (this.database.prepare("SELECT a.* FROM brain_annotation a JOIN brain_file f ON f.id = a.file_id WHERE f.project_id = ? AND f.owner_id = ? ORDER BY a.created_at DESC, a.id DESC").all(projectId, ownerId) as Record<string, unknown>[]).map(mapAnnotation);
  }

  createTask(input: {
    ownerId: string; projectId: string; conversationId?: string; workspaceKey: string; taskType: string;
    requestId?: string; idempotencyKey: string; maxAttempts?: number; resourceLimitsJson?: string;
  }): BrainTaskRecord {
    this.getProject(input.ownerId, input.projectId);
    if (input.conversationId) {
      const conversation = this.getConversation(input.ownerId, input.conversationId);
      if (conversation.projectId !== input.projectId) throw new BrainStorageError("BRAIN_PROJECT_FORBIDDEN", "Task conversation belongs to another project");
    }
    const workspaceKey = requireWorkspaceKey(input.workspaceKey);
    const idempotencyKey = requireText(input.idempotencyKey, "idempotencyKey");
    const existing = this.database.prepare("SELECT * FROM brain_task WHERE project_id = ? AND idempotency_key = ?")
      .get(input.projectId, idempotencyKey) as Record<string, unknown> | undefined;
    if (existing) return mapTask(existing);
    const maxAttempts = input.maxAttempts ?? 1;
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
      throw new BrainStorageError("BRAIN_INPUT_INVALID", "maxAttempts must be between 1 and 10");
    }
    const resourceLimitsJson = input.resourceLimitsJson || "{}";
    JSON.parse(resourceLimitsJson);
    const id = `task_${randomUUID()}`;
    this.database.prepare(`
      INSERT INTO brain_task(
        id, project_id, conversation_id, workspace_key, task_type, status, request_id,
        idempotency_key, max_attempts, resource_limits_json
      ) VALUES (?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?)
    `).run(id, input.projectId, input.conversationId || null, workspaceKey, requireText(input.taskType, "taskType"),
      input.requestId || "", idempotencyKey, maxAttempts, resourceLimitsJson);
    return this.getTask(input.ownerId, id);
  }

  getTask(ownerId: string, taskId: string): BrainTaskRecord {
    const row = this.database.prepare("SELECT * FROM brain_task WHERE id = ?").get(taskId) as Record<string, unknown> | undefined;
    if (!row) throw new BrainStorageError("BRAIN_TASK_NOT_FOUND", "Task was not found");
    this.getProject(ownerId, String(row.project_id));
    return mapTask(row);
  }

  listTasks(ownerId: string, projectId: string): BrainTaskRecord[] {
    this.getProject(ownerId, projectId);
    return (this.database.prepare("SELECT * FROM brain_task WHERE project_id = ? ORDER BY COALESCE(heartbeat_at, started_at, '') DESC, id DESC")
      .all(projectId) as Record<string, unknown>[]).map(mapTask);
  }

  updateTask(input: { ownerId: string; taskId: string; status: BrainTaskRecord["status"]; progress?: number; errorCode?: string; errorDetail?: string }): BrainTaskRecord {
    const current = this.getTask(input.ownerId, input.taskId);
    const statuses: BrainTaskRecord["status"][] = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"];
    if (!statuses.includes(input.status)) throw new BrainStorageError("BRAIN_INPUT_INVALID", "Unsupported task status");
    const progress = input.progress ?? current.progress;
    if (!Number.isFinite(progress) || progress < 0 || progress > 1) throw new BrainStorageError("BRAIN_INPUT_INVALID", "progress must be between 0 and 1");
    const timestamp = nowIso();
    const terminal = ["SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(input.status);
    const startedAt = input.status === "RUNNING" && !current.startedAt ? timestamp : (current.startedAt || null);
    const finishedAt = terminal ? timestamp : null;
    this.database.prepare(`
      UPDATE brain_task SET status = ?, progress = ?, error_code = ?, error_detail = ?,
        started_at = ?, finished_at = ?, heartbeat_at = ? WHERE id = ?
    `).run(input.status, progress, input.errorCode || "", input.errorDetail || "", startedAt, finishedAt, timestamp, input.taskId);
    return this.getTask(input.ownerId, input.taskId);
  }

  registerArtifact(input: {
    ownerId: string; projectId: string; taskId?: string; sourceFileId?: string; artifactType: string;
    storageKey: string; contentHash: string; validationStatus?: string;
  }): BrainArtifactRecord {
    this.getProject(input.ownerId, input.projectId);
    if (input.taskId && this.getTask(input.ownerId, input.taskId).projectId !== input.projectId) {
      throw new BrainStorageError("BRAIN_PROJECT_FORBIDDEN", "Artifact task belongs to another project");
    }
    if (input.sourceFileId) {
      const file = this.database.prepare("SELECT project_id, owner_id FROM brain_file WHERE id = ?").get(input.sourceFileId) as { project_id: string; owner_id: string } | undefined;
      if (!file || file.owner_id !== input.ownerId || file.project_id !== input.projectId) {
        throw new BrainStorageError("BRAIN_PROJECT_FORBIDDEN", "Artifact source file belongs to another project");
      }
    }
    const record: BrainArtifactRecord = {
      id: `artifact_${randomUUID()}`, projectId: input.projectId, taskId: input.taskId || "",
      sourceFileId: input.sourceFileId || "", artifactType: requireText(input.artifactType, "artifactType"),
      storageKey: requireText(input.storageKey, "storageKey"), contentHash: requireText(input.contentHash, "contentHash"),
      validationStatus: input.validationStatus?.trim() || "PENDING", createdAt: nowIso()
    };
    this.database.prepare(`
      INSERT INTO brain_artifact(id, project_id, task_id, source_file_id, artifact_type, storage_key, content_hash, validation_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.projectId, record.taskId || null, record.sourceFileId || null, record.artifactType,
      record.storageKey, record.contentHash, record.validationStatus, record.createdAt);
    return record;
  }

  listArtifacts(ownerId: string, projectId: string): BrainArtifactRecord[] {
    this.getProject(ownerId, projectId);
    return (this.database.prepare("SELECT * FROM brain_artifact WHERE project_id = ? ORDER BY created_at DESC, id DESC")
      .all(projectId) as Record<string, unknown>[]).map(mapArtifact);
  }

  private seedWorkspaces() {
    const timestamp = nowIso();
    const statement = this.database.prepare(`
      INSERT INTO brain_workspace(workspace_key, display_name, enabled, capabilities_json, default_model_route, sort_order, created_at, updated_at)
      VALUES (?, ?, 1, '[]', 'auto', ?, ?, ?)
      ON CONFLICT(workspace_key) DO UPDATE SET display_name = excluded.display_name, sort_order = excluded.sort_order
    `);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const [key, name, order] of workspaceDefinitions) statement.run(key, name, order, timestamp, timestamp);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}
