import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  brainWorkspaceKeys,
  brainWorkspaceModes,
  normalizeAnnotationGeometry,
  validateAnnotationGeometry,
  type AnnotationGeometry,
  type BrainWorkspaceKey
} from "@codex-forge/protocol";
import { validateDocumentAnchor, type DocumentAnchor } from "@codex-forge/protocol/document-anchor";
import type { ChinaExchange, QuantStrategyExecution, QuantStrategyRun, QuantStrategySchedule, QuantStrategyScheduleStore } from "./quant-strategy-scheduler.ts";
import type { BrainVideoClip, BrainVideoTimeline } from "@codex-forge/protocol";
import type { BrainMusicClip, BrainMusicTimeline } from "@codex-forge/protocol/music-types";
import type { BrainDataset } from "@codex-forge/protocol/data-types";
import type { FlowAuditEvent, FlowDefinition } from "./flow-runtime.ts";
import {
  DEFAULT_BRAIN_RETENTION,
  selectRetentionVictims,
  type RetentionCandidate
} from "./brain-retention-policy.ts";

export { brainWorkspaceKeys } from "@codex-forge/protocol";
export type { BrainWorkspaceKey } from "@codex-forge/protocol";
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
  localWorkspaceId: string;
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
  anchor: DocumentAnchor; geometry: AnnotationGeometry; instruction: string; status: "OPEN" | "APPLIED" | "DISMISSED";
  supersedesAnnotationId: string; selectedText: string; createdBy: string; createdAt: string;
}
export interface BrainChangeSetRecord { id: string; annotationId: string; taskId: string; baseFileVersion: number; resultFileVersion: number; changeSummary: string; diffJson: string; status: "PROPOSED" | "ACCEPTED" | "REJECTED" | "REVERTED"; createdAt: string; reviewedAt: string; }

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
  taskType: string; status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  progress: number; requestId: string; idempotencyKey: string; attempt: number; maxAttempts: number;
  resourceLimitsJson: string; resultJson: string;
  errorCode: string; errorDetail: string; startedAt: string; finishedAt: string; heartbeatAt: string;
}

export interface BrainFlowRecord { id: string; projectId: string; name: string; definition: FlowDefinition; createdAt: string; updatedAt: string }
export interface BrainFlowRunRecord { id: string; flowId: string; projectId: string; status: "QUEUED" | "RUNNING" | "WAITING_APPROVAL" | "SUCCEEDED" | "FAILED" | "DECLINED" | "INTERRUPTED"; currentNodeId: string; values: Record<string, unknown>; audit: FlowAuditEvent[]; errorCode: string; startedAt: string; updatedAt: string; finishedAt: string }
export interface BrainFlowScheduleRecord { id: string; ownerId: string; projectId: string; flowId: string; timezone: string; runAt: string; enabled: boolean; createdAt: string; updatedAt: string }

export interface BrainArtifactRecord {
  id: string; projectId: string; taskId: string; sourceFileId: string; sourceWorkspaceKey: BrainWorkspaceKey | "";
  artifactType: string; storageKey: string; contentHash: string; validationStatus: string; createdAt: string;
}

export interface BrainEngineRuntimeRecord {
  ownerId: string; engineId: string; executable: string; source: "system" | "managed"; version: string;
  installedAt: string; updatedAt: string;
}

export interface BrainWorkspaceSectionRecord {
  schemaVersion: 1;
  projectId: string;
  workspaceKey: BrainWorkspaceKey;
  sectionKey: string;
  content: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export class BrainStorageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BrainStorageError";
    this.code = code;
  }
}

const latestMigrationVersion = 19;
const maxWorkspaceSectionBytes = 1024 * 1024;
const workspaceDefinitions: ReadonlyArray<readonly [BrainWorkspaceKey, string, number]> =
  brainWorkspaceModes.map((workspace) => [workspace.workspaceKey, workspace.displayName, workspace.sortOrder]);

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

function migrationTwoSql() {
  return `
    ALTER TABLE brain_annotation ADD COLUMN anchor_json TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE brain_annotation ADD COLUMN instruction TEXT NOT NULL DEFAULT '';
    ALTER TABLE brain_annotation ADD COLUMN status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'APPLIED', 'DISMISSED'));
    ALTER TABLE brain_annotation ADD COLUMN supersedes_annotation_id TEXT NOT NULL DEFAULT '';
    CREATE INDEX idx_brain_annotation_file_version_created
      ON brain_annotation(file_id, file_version, created_at DESC);
  `;
}

function migrationThreeSql() {
  return `
    ALTER TABLE brain_project ADD COLUMN local_workspace_id TEXT NOT NULL DEFAULT '';
    CREATE INDEX idx_brain_project_owner_local_workspace
      ON brain_project(owner_id, local_workspace_id);
  `;
}

function migrationFourSql() {
  return `
    CREATE TABLE brain_quant_state (
      project_id TEXT PRIMARY KEY REFERENCES brain_project(id) ON DELETE CASCADE,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `;
}

function migrationFiveSql() {
  return `
    CREATE TABLE brain_quant_strategy_schedule (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES brain_project(id) ON DELETE CASCADE,
      skill_id TEXT NOT NULL,
      exchange TEXT NOT NULL CHECK(exchange IN ('SSE', 'SZSE', 'BSE')),
      timezone TEXT NOT NULL CHECK(timezone = 'Asia/Shanghai'),
      run_at TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, skill_id, exchange, run_at)
    );
    CREATE INDEX idx_brain_quant_schedule_enabled ON brain_quant_strategy_schedule(enabled, project_id);
    CREATE TABLE brain_quant_strategy_run (
      schedule_id TEXT NOT NULL REFERENCES brain_quant_strategy_schedule(id) ON DELETE CASCADE,
      trading_date TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK(status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
      attempt INTEGER NOT NULL DEFAULT 1,
      error_code TEXT NOT NULL DEFAULT '',
      error_detail TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      finished_at TEXT,
      PRIMARY KEY(schedule_id, trading_date)
    );
  `;
}

function migrationSixSql() {
  return `
    ALTER TABLE brain_quant_strategy_schedule ADD COLUMN symbol TEXT NOT NULL DEFAULT '600519';
    ALTER TABLE brain_quant_strategy_schedule ADD COLUMN quantity INTEGER NOT NULL DEFAULT 100 CHECK(quantity > 0);
    ALTER TABLE brain_task ADD COLUMN result_json TEXT NOT NULL DEFAULT '{}';
  `;
}

function migrationSevenSql() {
  return `
    CREATE TABLE brain_video_timeline (
      project_id TEXT PRIMARY KEY REFERENCES brain_project(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      width INTEGER NOT NULL CHECK(width > 0),
      height INTEGER NOT NULL CHECK(height > 0),
      fps REAL NOT NULL CHECK(fps > 0),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE brain_video_clip (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES brain_project(id) ON DELETE CASCADE,
      track_type TEXT NOT NULL CHECK(track_type IN ('video', 'audio', 'subtitle')),
      source_file_id TEXT NOT NULL,
      start_ms INTEGER NOT NULL CHECK(start_ms >= 0),
      duration_ms INTEGER NOT NULL CHECK(duration_ms > 0),
      source_in_ms INTEGER NOT NULL CHECK(source_in_ms >= 0),
      volume REAL NOT NULL DEFAULT 1 CHECK(volume >= 0 AND volume <= 2),
      text TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX idx_brain_video_clip_project_start ON brain_video_clip(project_id, start_ms, id);
  `;
}
function migrationEightSql() { return `
CREATE TABLE IF NOT EXISTS brain_music_timeline (project_id TEXT PRIMARY KEY REFERENCES brain_project(id) ON DELETE CASCADE, title TEXT NOT NULL, sample_rate INTEGER NOT NULL, channels INTEGER NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS brain_music_clip (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES brain_project(id) ON DELETE CASCADE, track_type TEXT NOT NULL, source_file_id TEXT NOT NULL, start_ms INTEGER NOT NULL, duration_ms INTEGER NOT NULL, source_in_ms INTEGER NOT NULL, gain REAL NOT NULL, pan REAL NOT NULL);
CREATE INDEX IF NOT EXISTS idx_brain_music_clip_project_start ON brain_music_clip(project_id, start_ms, id);` }
function migrationNineSql() { return `CREATE TABLE IF NOT EXISTS brain_dataset (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES brain_project(id) ON DELETE CASCADE, name TEXT NOT NULL, columns_json TEXT NOT NULL, row_count INTEGER NOT NULL, source_file_id TEXT, content_hash TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_brain_dataset_project ON brain_dataset(project_id, updated_at);`; }
function migrationTenSql() { return `CREATE TABLE IF NOT EXISTS brain_data_analysis (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES brain_project(id) ON DELETE CASCADE, dataset_id TEXT NOT NULL REFERENCES brain_dataset(id) ON DELETE CASCADE, operation TEXT NOT NULL, input_hash TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(dataset_id, operation, input_hash)); CREATE INDEX IF NOT EXISTS idx_brain_data_analysis_dataset ON brain_data_analysis(dataset_id, created_at DESC);`; }
function migrationElevenSql() { return `ALTER TABLE brain_dataset ADD COLUMN source_sheet TEXT;`; }
function migrationTwelveSql() { return `
CREATE TABLE brain_flow (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES brain_project(id) ON DELETE CASCADE, name TEXT NOT NULL, definition_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX idx_brain_flow_project_updated ON brain_flow(project_id, updated_at DESC);
CREATE TABLE brain_flow_run (id TEXT PRIMARY KEY, flow_id TEXT NOT NULL REFERENCES brain_flow(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES brain_project(id) ON DELETE CASCADE, status TEXT NOT NULL CHECK(status IN ('QUEUED','RUNNING','WAITING_APPROVAL','SUCCEEDED','FAILED','DECLINED','INTERRUPTED')), current_node_id TEXT NOT NULL DEFAULT '', values_json TEXT NOT NULL DEFAULT '{}', audit_json TEXT NOT NULL DEFAULT '[]', error_code TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT NOT NULL DEFAULT '');
CREATE INDEX idx_brain_flow_run_project_updated ON brain_flow_run(project_id, updated_at DESC);
`; }
function migrationThirteenSql() { return `
CREATE TABLE brain_flow_schedule (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES brain_project(id) ON DELETE CASCADE, flow_id TEXT NOT NULL REFERENCES brain_flow(id) ON DELETE CASCADE, timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai', run_at TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(project_id, flow_id, timezone, run_at));
CREATE TABLE brain_flow_schedule_occurrence (schedule_id TEXT NOT NULL REFERENCES brain_flow_schedule(id) ON DELETE CASCADE, occurrence TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('RUNNING','SUCCEEDED','FAILED')), error_code TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, finished_at TEXT NOT NULL DEFAULT '', PRIMARY KEY(schedule_id, occurrence));
CREATE INDEX idx_brain_flow_schedule_project ON brain_flow_schedule(project_id, enabled, run_at);
`; }

function migrationFourteenSql() { return `
UPDATE brain_project
SET primary_workspace_key = 'document'
WHERE primary_workspace_key IS NULL
   OR TRIM(primary_workspace_key) = ''
   OR primary_workspace_key NOT IN (SELECT workspace_key FROM brain_workspace);
UPDATE brain_conversation
SET workspace_snapshot = COALESCE(
  (SELECT project.primary_workspace_key FROM brain_project project WHERE project.id = brain_conversation.project_id),
  'document'
);
INSERT OR IGNORE INTO brain_project_workspace(project_id, workspace_key, enabled)
SELECT id, primary_workspace_key, 1 FROM brain_project;
`; }

function migrationFifteenSql() { return `
UPDATE brain_task
SET status = 'FAILED',
    error_code = CASE WHEN error_code = '' THEN 'BRAIN_LEGACY_TIMEOUT_MIGRATED' ELSE error_code END,
    error_detail = CASE WHEN error_detail = '' THEN 'Legacy timeout state migrated to FAILED; current BRAIN execution has no fixed deadline.' ELSE error_detail END
WHERE status = 'TIMED_OUT';
`; }

function migrationSixteenSql() { return `
CREATE TABLE brain_workspace_section (
  project_id TEXT NOT NULL REFERENCES brain_project(id) ON DELETE CASCADE,
  workspace_key TEXT NOT NULL REFERENCES brain_workspace(workspace_key),
  section_key TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  revision_no INTEGER NOT NULL DEFAULT 1 CHECK(revision_no > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id, workspace_key, section_key)
);
CREATE INDEX idx_brain_workspace_section_project_updated
  ON brain_workspace_section(project_id, workspace_key, updated_at DESC);
`; }

function migrationSeventeenSql() { return `
ALTER TABLE brain_artifact ADD COLUMN source_workspace_key TEXT NOT NULL DEFAULT '';
`; }

function migrationEighteenSql() { return `
CREATE TABLE brain_engine_runtime (
  owner_id TEXT NOT NULL,
  engine_id TEXT NOT NULL,
  executable TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('system', 'managed')),
  version TEXT NOT NULL DEFAULT '',
  installed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(owner_id, engine_id)
);
CREATE INDEX idx_brain_engine_runtime_owner ON brain_engine_runtime(owner_id, updated_at DESC);
`; }

function migrationNineteenSql() { return `
ALTER TABLE brain_quant_strategy_schedule ADD COLUMN strategy_id TEXT NOT NULL DEFAULT 'trend-following'
  CHECK(strategy_id IN ('trend-following', 'mean-reversion'));
`; }

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
  const geometry = normalizeAnnotationGeometry(JSON.parse(String(row.geometry_json || "{}")));
  return {
    id: String(row.id), fileId: String(row.file_id), fileVersion: Number(row.file_version),
    pageOrSheet: String(row.page_or_sheet), annotationType: String(row.annotation_type),
    anchor: JSON.parse(String(row.anchor_json || row.structural_anchor_json || "{}")) as DocumentAnchor,
    geometry,
    instruction: String(row.instruction || ""),
    status: String(row.status || "OPEN") as BrainAnnotationRecord["status"],
    supersedesAnnotationId: String(row.supersedes_annotation_id || ""),
    selectedText: String(row.selected_text), createdBy: String(row.created_by), createdAt: String(row.created_at)
  };
}
function mapChangeSet(row: Record<string, unknown>): BrainChangeSetRecord { return { id: String(row.id), annotationId: String(row.annotation_id), taskId: String(row.task_id || ""), baseFileVersion: Number(row.base_file_version), resultFileVersion: Number(row.result_file_version || 0), changeSummary: String(row.change_summary), diffJson: String(row.diff_json), status: String(row.status) as BrainChangeSetRecord["status"], createdAt: String(row.created_at), reviewedAt: String(row.reviewed_at || "") }; }

function mapProject(row: Record<string, unknown>): BrainProjectRecord {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    name: String(row.name),
    localWorkspaceId: String(row.local_workspace_id || ""),
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
    maxAttempts: Number(row.max_attempts), resourceLimitsJson: String(row.resource_limits_json || "{}"),
    resultJson: String(row.result_json || "{}"),
    errorCode: String(row.error_code), errorDetail: String(row.error_detail),
    startedAt: String(row.started_at || ""), finishedAt: String(row.finished_at || ""), heartbeatAt: String(row.heartbeat_at || "")
  };
}

function mapArtifact(row: Record<string, unknown>): BrainArtifactRecord {
  const sourceWorkspaceKey = String(row.source_workspace_key || "").trim();
  return {
    id: String(row.id), projectId: String(row.project_id), taskId: String(row.task_id || ""),
    sourceFileId: String(row.source_file_id || ""),
    sourceWorkspaceKey: sourceWorkspaceKey ? requireWorkspaceKey(sourceWorkspaceKey) : "",
    artifactType: String(row.artifact_type), storageKey: String(row.storage_key), contentHash: String(row.content_hash),
    validationStatus: String(row.validation_status), createdAt: String(row.created_at)
  };
}

function mapEngineRuntime(row: Record<string, unknown>): BrainEngineRuntimeRecord {
  const source = String(row.source);
  if (source !== "system" && source !== "managed") throw new BrainStorageError("BRAIN_INPUT_INVALID", "engine runtime source is invalid");
  return {
    ownerId: String(row.owner_id), engineId: String(row.engine_id), executable: String(row.executable), source,
    version: String(row.version || ""), installedAt: String(row.installed_at), updatedAt: String(row.updated_at)
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
      applyMigration(this.database, 2, "Structured immutable document annotations", migrationTwoSql());
      applyMigration(this.database, 3, "Bind BRAIN projects to authorized local workspaces", migrationThreeSql());
      applyMigration(this.database, 4, "Persist isolated quantitative simulation ledgers", migrationFourSql());
      applyMigration(this.database, 5, "Schedule idempotent quantitative strategy simulations", migrationFiveSql());
      applyMigration(this.database, 6, "Bind quantitative schedules to symbols and target quantities", migrationSixSql());
      applyMigration(this.database, 7, "Persist video timelines and clips", migrationSevenSql());
      applyMigration(this.database, 8, "Persist music timelines and clips", migrationEightSql());
      applyMigration(this.database, 9, "Persist data decision datasets", migrationNineSql());
      applyMigration(this.database, 10, "Persist reproducible data analysis artifacts", migrationTenSql());
      applyMigration(this.database, 11, "Persist selected XLSX worksheet", migrationElevenSql());
      applyMigration(this.database, 12, "Persist auditable Flow definitions and checkpoints", migrationTwelveSql());
      applyMigration(this.database, 13, "Persist Flow schedules and idempotent occurrences", migrationThirteenSql());
      applyMigration(this.database, 14, "Bind legacy projects and conversations to document workspace", migrationFourteenSql());
      applyMigration(this.database, 15, "Migrate legacy timeout task states to failed", migrationFifteenSql());
      applyMigration(this.database, 16, "Persist project-scoped workspace section documents", migrationSixteenSql());
      applyMigration(this.database, 17, "Track artifact source workspace for cross-scene lineage", migrationSeventeenSql());
      applyMigration(this.database, 18, "Persist managed and discovered engine runtimes", migrationEighteenSql());
      applyMigration(this.database, 19, "Separate quantitative portfolio Skill identity from signal strategy", migrationNineteenSql());
      this.seedWorkspaces();
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  getWorkspaceSection(input: { ownerId: string; projectId: string; workspaceKey: string; sectionKey: string }): BrainWorkspaceSectionRecord {
    const project = this.getProject(input.ownerId, input.projectId);
    const workspaceKey = requireWorkspaceKey(input.workspaceKey);
    const sectionKey = this.requireSectionKey(input.sectionKey);
    if (project.primaryWorkspaceKey !== workspaceKey) {
      throw new BrainStorageError("BRAIN_WORKSPACE_SECTION_MISMATCH", "Section workspace does not match its project");
    }
    const row = this.database.prepare("SELECT * FROM brain_workspace_section WHERE project_id = ? AND workspace_key = ? AND section_key = ?")
      .get(project.id, workspaceKey, sectionKey) as Record<string, unknown> | undefined;
    if (!row) return { schemaVersion: 1, projectId: project.id, workspaceKey, sectionKey, content: "", revision: 0, createdAt: "", updatedAt: "" };
    return {
      schemaVersion: 1, projectId: String(row.project_id), workspaceKey: requireWorkspaceKey(String(row.workspace_key)),
      sectionKey: String(row.section_key), content: String(row.content), revision: Number(row.revision_no),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at)
    };
  }

  saveWorkspaceSection(input: { ownerId: string; projectId: string; workspaceKey: string; sectionKey: string; content: string; expectedRevision: number }): BrainWorkspaceSectionRecord {
    const current = this.getWorkspaceSection(input);
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new BrainStorageError("BRAIN_WORKSPACE_SECTION_INVALID", "Expected revision must be a non-negative integer");
    }
    if (current.revision !== input.expectedRevision) {
      throw new BrainStorageError("BRAIN_WORKSPACE_SECTION_CONFLICT", "Section was changed by another editor");
    }
    if (typeof input.content !== "string" || Buffer.byteLength(input.content, "utf8") > maxWorkspaceSectionBytes) {
      throw new BrainStorageError("BRAIN_WORKSPACE_SECTION_TOO_LARGE", "Section content exceeds the local editor limit");
    }
    const timestamp = nowIso();
    const nextRevision = current.revision + 1;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const latest = this.getWorkspaceSection(input);
      if (latest.revision !== input.expectedRevision) {
        throw new BrainStorageError("BRAIN_WORKSPACE_SECTION_CONFLICT", "Section was changed by another editor");
      }
      this.database.prepare(`INSERT INTO brain_workspace_section(project_id, workspace_key, section_key, content, revision_no, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, workspace_key, section_key) DO UPDATE SET content=excluded.content, revision_no=excluded.revision_no, updated_at=excluded.updated_at`)
        .run(input.projectId, current.workspaceKey, current.sectionKey, input.content, nextRevision, current.createdAt || timestamp, timestamp);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getWorkspaceSection(input);
  }

  private requireSectionKey(value: string) {
    const sectionKey = requireText(value, "sectionKey");
    const normalized = sectionKey.toLowerCase().replace(/[^a-z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 64);
    if (!normalized || !/^[a-z]/u.test(normalized)) return "default";
    return normalized;
  }

  getVideoTimeline(ownerId: string, projectId: string): BrainVideoTimeline | null {
    const project = this.getProject(ownerId, projectId);
    if (project.primaryWorkspaceKey !== "video") throw new BrainStorageError("BRAIN_VIDEO_WORKSPACE_REQUIRED", "Project is not a video workspace");
    const row = this.database.prepare("SELECT * FROM brain_video_timeline WHERE project_id = ?").get(projectId) as Record<string, unknown> | undefined;
    if (!row) return null;
    const clips = this.database.prepare("SELECT * FROM brain_video_clip WHERE project_id = ? ORDER BY start_ms, id").all(projectId) as Record<string, unknown>[];
    return {
      schemaVersion: 1, projectId, title: String(row.title), width: Number(row.width), height: Number(row.height), fps: Number(row.fps),
      durationMs: clips.reduce((max, clip) => Math.max(max, Number(clip.start_ms) + Number(clip.duration_ms)), 0),
      clips: clips.map((clip) => ({ id: String(clip.id), trackType: String(clip.track_type) as BrainVideoClip["trackType"], sourceFileId: String(clip.source_file_id), startMs: Number(clip.start_ms), durationMs: Number(clip.duration_ms), sourceInMs: Number(clip.source_in_ms), volume: Number(clip.volume), text: String(clip.text || "") })),
      updatedAt: String(row.updated_at)
    };
  }

  saveVideoTimeline(input: { ownerId: string; projectId: string; title: string; width: number; height: number; fps: number }): BrainVideoTimeline {
    const project = this.getProject(input.ownerId, input.projectId);
    if (project.primaryWorkspaceKey !== "video") throw new BrainStorageError("BRAIN_VIDEO_WORKSPACE_REQUIRED", "Project is not a video workspace");
    if (!input.title.trim() || !Number.isInteger(input.width) || input.width < 1 || !Number.isInteger(input.height) || input.height < 1 || !Number.isFinite(input.fps) || input.fps <= 0) throw new BrainStorageError("BRAIN_VIDEO_TIMELINE_INVALID", "Video timeline settings are invalid");
    const timestamp = nowIso();
    this.database.prepare(`INSERT INTO brain_video_timeline(project_id, title, width, height, fps, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET title=excluded.title, width=excluded.width, height=excluded.height, fps=excluded.fps, updated_at=excluded.updated_at`).run(input.projectId, input.title.trim(), input.width, input.height, input.fps, timestamp);
    return this.getVideoTimeline(input.ownerId, input.projectId)!;
  }

  addVideoClip(input: { ownerId: string; projectId: string; clip: BrainVideoClip }): BrainVideoTimeline {
    this.getProject(input.ownerId, input.projectId);
    const clip = input.clip;
    const needsSource = clip.trackType !== "subtitle";
    if (!/^video$|^audio$|^subtitle$/.test(clip.trackType) || (needsSource && !clip.sourceFileId.trim()) || !Number.isInteger(clip.startMs) || clip.startMs < 0 || !Number.isInteger(clip.durationMs) || clip.durationMs <= 0 || !Number.isInteger(clip.sourceInMs) || clip.sourceInMs < 0 || !Number.isFinite(clip.volume) || clip.volume < 0 || clip.volume > 2) throw new BrainStorageError("BRAIN_VIDEO_CLIP_INVALID", "Video clip values are invalid");
    this.database.prepare("INSERT INTO brain_video_clip(id, project_id, track_type, source_file_id, start_ms, duration_ms, source_in_ms, volume, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(clip.id, input.projectId, clip.trackType, clip.sourceFileId.trim(), clip.startMs, clip.durationMs, clip.sourceInMs, clip.volume, clip.text || "");
    return this.getVideoTimeline(input.ownerId, input.projectId)!;
  }

  replaceVideoSubtitleClips(input: { ownerId: string; projectId: string; clips: BrainVideoClip[] }): BrainVideoTimeline {
    this.getProject(input.ownerId, input.projectId);
    this.database.prepare("DELETE FROM brain_video_clip WHERE project_id = ? AND track_type = 'subtitle'").run(input.projectId);
    for (const clip of input.clips) {
      if (clip.trackType !== "subtitle") throw new BrainStorageError("BRAIN_VIDEO_CLIP_INVALID", "Only subtitle clips are allowed in replaceVideoSubtitleClips");
      this.database.prepare("INSERT INTO brain_video_clip(id, project_id, track_type, source_file_id, start_ms, duration_ms, source_in_ms, volume, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(clip.id, input.projectId, clip.trackType, "", clip.startMs, clip.durationMs, 0, 1, clip.text || "");
    }
    this.database.prepare("UPDATE brain_video_timeline SET updated_at = ? WHERE project_id = ?").run(nowIso(), input.projectId);
    return this.getVideoTimeline(input.ownerId, input.projectId)!;
  }

  getMusicTimeline(ownerId: string, projectId: string): BrainMusicTimeline | null {
    const project = this.getProject(ownerId, projectId);
    if (project.primaryWorkspaceKey !== "music") throw new BrainStorageError("BRAIN_MUSIC_WORKSPACE_REQUIRED", "Project is not a music workspace");
    const row = this.database.prepare("SELECT * FROM brain_music_timeline WHERE project_id = ?").get(projectId) as Record<string, unknown> | undefined;
    if (!row) return null;
    const clips = this.database.prepare("SELECT * FROM brain_music_clip WHERE project_id = ? ORDER BY start_ms, id").all(projectId) as Record<string, unknown>[];
    return { schemaVersion: 1, projectId, title: String(row.title), sampleRate: Number(row.sample_rate), channels: Number(row.channels) as 1 | 2, durationMs: clips.reduce((max, clip) => Math.max(max, Number(clip.start_ms) + Number(clip.duration_ms)), 0), clips: clips.map((clip) => ({ id: String(clip.id), trackType: String(clip.track_type) as BrainMusicClip["trackType"], sourceFileId: String(clip.source_file_id), startMs: Number(clip.start_ms), durationMs: Number(clip.duration_ms), sourceInMs: Number(clip.source_in_ms), gain: Number(clip.gain), pan: Number(clip.pan) })), updatedAt: String(row.updated_at) };
  }

  saveMusicTimeline(input: { ownerId: string; projectId: string; title: string; sampleRate: number; channels: 1 | 2 }): BrainMusicTimeline {
    const project = this.getProject(input.ownerId, input.projectId);
    if (project.primaryWorkspaceKey !== "music") throw new BrainStorageError("BRAIN_MUSIC_WORKSPACE_REQUIRED", "Project is not a music workspace");
    if (!input.title.trim() || !Number.isInteger(input.sampleRate) || input.sampleRate < 8_000 || (input.channels !== 1 && input.channels !== 2)) throw new BrainStorageError("BRAIN_MUSIC_TIMELINE_INVALID", "Music timeline settings are invalid");
    this.database.prepare("INSERT INTO brain_music_timeline(project_id, title, sample_rate, channels, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET title=excluded.title, sample_rate=excluded.sample_rate, channels=excluded.channels, updated_at=excluded.updated_at").run(input.projectId, input.title.trim(), input.sampleRate, input.channels, nowIso());
    return this.getMusicTimeline(input.ownerId, input.projectId)!;
  }

  addMusicClip(input: { ownerId: string; projectId: string; clip: BrainMusicClip }): BrainMusicTimeline {
    this.getProject(input.ownerId, input.projectId);
    const clip = input.clip;
    if (!/^audio$|^midi$/.test(clip.trackType) || !clip.sourceFileId.trim() || !Number.isInteger(clip.startMs) || clip.startMs < 0 || !Number.isInteger(clip.durationMs) || clip.durationMs <= 0 || !Number.isInteger(clip.sourceInMs) || clip.sourceInMs < 0 || !Number.isFinite(clip.gain) || !Number.isFinite(clip.pan) || clip.pan < -1 || clip.pan > 1) throw new BrainStorageError("BRAIN_MUSIC_CLIP_INVALID", "Music clip values are invalid");
    this.database.prepare("INSERT INTO brain_music_clip(id, project_id, track_type, source_file_id, start_ms, duration_ms, source_in_ms, gain, pan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(clip.id, input.projectId, clip.trackType, clip.sourceFileId.trim(), clip.startMs, clip.durationMs, clip.sourceInMs, clip.gain, clip.pan);
    return this.getMusicTimeline(input.ownerId, input.projectId)!;
  }

  saveDataset(input: { ownerId: string; dataset: BrainDataset }): BrainDataset {
    const project = this.getProject(input.ownerId, input.dataset.projectId);
    if (project.primaryWorkspaceKey !== "data") throw new BrainStorageError("BRAIN_DATA_WORKSPACE_REQUIRED", "Project is not a data workspace");
    this.database.prepare("INSERT INTO brain_dataset(id, project_id, name, columns_json, row_count, source_file_id, source_sheet, content_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, columns_json=excluded.columns_json, row_count=excluded.row_count, source_file_id=excluded.source_file_id, source_sheet=excluded.source_sheet, content_hash=excluded.content_hash, updated_at=excluded.updated_at").run(input.dataset.id, input.dataset.projectId, input.dataset.name, JSON.stringify(input.dataset.columns), input.dataset.rowCount, input.dataset.sourceFileId || null, input.dataset.sourceSheet || null, input.dataset.contentHash, input.dataset.updatedAt);
    return input.dataset;
  }

  listDatasets(ownerId: string, projectId: string): BrainDataset[] {
    const project = this.getProject(ownerId, projectId);
    if (project.primaryWorkspaceKey !== "data") throw new BrainStorageError("BRAIN_DATA_WORKSPACE_REQUIRED", "Project is not a data workspace");
    const rows = this.database.prepare("SELECT * FROM brain_dataset WHERE project_id = ? ORDER BY updated_at DESC, id").all(projectId) as Record<string, unknown>[];
    return rows.map((row) => ({ schemaVersion: 1, id: String(row.id), projectId: String(row.project_id), name: String(row.name), columns: JSON.parse(String(row.columns_json)), rowCount: Number(row.row_count), sourceFileId: row.source_file_id ? String(row.source_file_id) : undefined, sourceSheet: row.source_sheet ? String(row.source_sheet) : undefined, contentHash: String(row.content_hash), updatedAt: String(row.updated_at) }));
  }

  saveDataAnalysis(input: { ownerId: string; projectId: string; datasetId: string; operation: string; inputHash: string; result: unknown; createdAt: string }) {
    const project = this.getProject(input.ownerId, input.projectId);
    if (project.primaryWorkspaceKey !== "data") throw new BrainStorageError("BRAIN_DATA_WORKSPACE_REQUIRED", "Project is not a data workspace");
    if (!input.operation.trim() || !/^[a-f0-9]{64}$/u.test(input.inputHash)) throw new BrainStorageError("BRAIN_DATA_ANALYSIS_INVALID", "Analysis identity is invalid");
    const dataset = this.database.prepare("SELECT id FROM brain_dataset WHERE id = ? AND project_id = ?").get(input.datasetId, input.projectId);
    if (!dataset) throw new BrainStorageError("BRAIN_DATASET_NOT_FOUND", "Dataset does not belong to project");
    const id = `analysis_${input.datasetId}_${input.operation}_${input.inputHash.slice(0, 16)}`;
    this.database.prepare("INSERT INTO brain_data_analysis(id, project_id, dataset_id, operation, input_hash, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(dataset_id, operation, input_hash) DO UPDATE SET result_json=excluded.result_json, created_at=excluded.created_at").run(id, input.projectId, input.datasetId, input.operation.trim(), input.inputHash, JSON.stringify(input.result), input.createdAt);
    return { id, projectId: input.projectId, datasetId: input.datasetId, operation: input.operation.trim(), inputHash: input.inputHash, result: input.result, createdAt: input.createdAt };
  }

  listDataAnalyses(ownerId: string, projectId: string, datasetId: string) {
    const project = this.getProject(ownerId, projectId);
    if (project.primaryWorkspaceKey !== "data") throw new BrainStorageError("BRAIN_DATA_WORKSPACE_REQUIRED", "Project is not a data workspace");
    return (this.database.prepare("SELECT * FROM brain_data_analysis WHERE project_id = ? AND dataset_id = ? ORDER BY created_at DESC").all(projectId, datasetId) as Array<Record<string, unknown>>).map((row) => ({ id: String(row.id), projectId: String(row.project_id), datasetId: String(row.dataset_id), operation: String(row.operation), inputHash: String(row.input_hash), result: JSON.parse(String(row.result_json)), createdAt: String(row.created_at) }));
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

  createProject(input: { ownerId: string; name: string; primaryWorkspaceKey: string; localWorkspaceId?: string }): BrainProjectRecord {
    const ownerId = requireText(input.ownerId, "ownerId");
    const name = requireText(input.name, "name");
    const workspaceKey = requireWorkspaceKey(input.primaryWorkspaceKey);
    const workspace = this.database.prepare("SELECT enabled FROM brain_workspace WHERE workspace_key = ?").get(workspaceKey) as { enabled: number } | undefined;
    if (!workspace || Number(workspace.enabled) !== 1) {
      throw new BrainStorageError("BRAIN_WORKSPACE_DISABLED", `Workspace is disabled: ${workspaceKey}`);
    }
    const id = `project_${randomUUID()}`;
    const localWorkspaceId = input.localWorkspaceId?.trim() ?? "";
    const timestamp = nowIso();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        INSERT INTO brain_project(id, owner_id, name, local_workspace_id, primary_workspace_key, status, created_at, updated_at, last_opened_at)
        VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
      `).run(id, ownerId, name, localWorkspaceId, workspaceKey, timestamp, timestamp, timestamp);
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

  importUnboundCatalog(input: {
    ownerId: string;
    workspaces: ReadonlyArray<{
      id?: string;
      name?: string;
      brainWorkspaceKey?: string;
      threads?: ReadonlyArray<{
        id?: string;
        title?: string;
        updatedAt?: string;
        archived?: boolean;
      }>;
    }>;
  }): { importedProjects: number; importedConversations: number } {
    const ownerId = requireText(input.ownerId, "ownerId");
    const existing = this.listProjects({ ownerId, includeArchived: true });
    const byLocalId = new Map(existing.filter((project) => project.localWorkspaceId).map((project) => [project.localWorkspaceId, project]));
    let importedProjects = 0;
    let importedConversations = 0;
    for (const workspace of input.workspaces) {
      const localWorkspaceId = String(workspace.id || "").trim();
      if (!localWorkspaceId) continue;
      const workspaceKey = requireWorkspaceKey(
        typeof workspace.brainWorkspaceKey === "string" && workspace.brainWorkspaceKey.trim()
          ? workspace.brainWorkspaceKey.trim()
          : "document"
      );
      let project = byLocalId.get(localWorkspaceId);
      if (!project) {
        project = this.createProject({
          ownerId,
          name: String(workspace.name || "").trim() || "未命名项目",
          primaryWorkspaceKey: workspaceKey,
          localWorkspaceId
        });
        byLocalId.set(localWorkspaceId, project);
        importedProjects += 1;
      } else if (project.primaryWorkspaceKey !== workspaceKey) {
        if (project.primaryWorkspaceKey === "document" && workspaceKey !== "document") {
          project = this.setProjectPrimaryWorkspaceKey({ ownerId, projectId: project.id, workspaceKey });
          byLocalId.set(localWorkspaceId, project);
        } else {
          continue;
        }
      }
      const knownIds = new Set(this.listConversations({ ownerId, projectId: project.id, includeArchived: true }).map((item) => item.id));
      for (const thread of workspace.threads || []) {
        const threadId = String(thread.id || "").trim();
        if (!threadId) continue;
        const conversationId = this.resolveLegacyConversationId(ownerId, threadId);
        if (!conversationId || knownIds.has(conversationId)) continue;
        this.createConversation({
          ownerId,
          projectId: project.id,
          title: String(thread.title || "").trim() || "对话",
          workspaceKey,
          conversationId,
          status: thread.archived ? "ARCHIVED" : "ACTIVE",
          lastMessageAt: String(thread.updatedAt || "").trim() || undefined
        });
        knownIds.add(conversationId);
        importedConversations += 1;
      }
    }
    return { importedProjects, importedConversations };
  }

  /**
   * Resolve a stable catalog-import conversation id that stays unique per local owner.
   * Prefer the historical unscoped id when free or already owned by the current account.
   */
  private resolveLegacyConversationId(ownerId: string, threadId: string): string | null {
    const legacyId = `conversation_legacy_${threadId}`;
    const existing = this.database.prepare("SELECT owner_id FROM brain_conversation WHERE id = ?").get(legacyId) as
      | { owner_id?: unknown }
      | undefined;
    if (!existing) return legacyId;
    if (String(existing.owner_id) === ownerId) return legacyId;
    const scopedOwner = ownerId.replace(/[^a-zA-Z0-9._:-]+/g, "_");
    const scopedId = `conversation_legacy_${scopedOwner}_${threadId}`;
    const scopedExisting = this.database.prepare("SELECT owner_id FROM brain_conversation WHERE id = ?").get(scopedId) as
      | { owner_id?: unknown }
      | undefined;
    if (!scopedExisting) return scopedId;
    if (String(scopedExisting.owner_id) === ownerId) return scopedId;
    return null;
  }

  setProjectPrimaryWorkspaceKey(input: { ownerId: string; projectId: string; workspaceKey: string }): BrainProjectRecord {
    const ownerId = requireText(input.ownerId, "ownerId");
    const projectId = requireText(input.projectId, "projectId");
    const workspaceKey = requireWorkspaceKey(input.workspaceKey);
    const current = this.getProject(ownerId, projectId);
    if (current.primaryWorkspaceKey === workspaceKey) return current;
    const workspace = this.database.prepare("SELECT enabled FROM brain_workspace WHERE workspace_key = ?").get(workspaceKey) as { enabled: number } | undefined;
    if (!workspace || Number(workspace.enabled) !== 1) {
      throw new BrainStorageError("BRAIN_WORKSPACE_DISABLED", `Workspace is disabled: ${workspaceKey}`);
    }
    const timestamp = nowIso();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("UPDATE brain_project SET primary_workspace_key = ?, updated_at = ?, last_opened_at = ? WHERE id = ? AND owner_id = ?")
        .run(workspaceKey, timestamp, timestamp, projectId, ownerId);
      this.database.prepare("DELETE FROM brain_project_workspace WHERE project_id = ?").run(projectId);
      this.database.prepare("INSERT INTO brain_project_workspace(project_id, workspace_key, enabled) VALUES (?, ?, 1)")
        .run(projectId, workspaceKey);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getProject(ownerId, projectId);
  }

  updateProject(input: { ownerId: string; projectId: string; name?: string; status?: BrainProjectStatus; localWorkspaceId?: string }): BrainProjectRecord {
    const current = this.getProject(input.ownerId, input.projectId);
    const name = input.name === undefined ? current.name : requireText(input.name, "name");
    const status = input.status ?? current.status;
    const localWorkspaceId = input.localWorkspaceId === undefined ? current.localWorkspaceId : input.localWorkspaceId.trim();
    if (status !== "ACTIVE" && status !== "ARCHIVED") {
      throw new BrainStorageError("BRAIN_INPUT_INVALID", `Unsupported project status: ${status}`);
    }
    const timestamp = nowIso();
    this.database.prepare("UPDATE brain_project SET name = ?, local_workspace_id = ?, status = ?, updated_at = ?, last_opened_at = ? WHERE id = ? AND owner_id = ?")
      .run(name, localWorkspaceId, status, timestamp, timestamp, input.projectId, input.ownerId);
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

  createConversation(input: {
    ownerId: string;
    projectId: string;
    title: string;
    workspaceKey?: string;
    conversationId?: string;
    status?: BrainConversationStatus;
    lastMessageAt?: string;
  }): BrainConversationRecord {
    const project = this.getProject(input.ownerId, input.projectId);
    const workspaceKey = requireWorkspaceKey(input.workspaceKey ?? project.primaryWorkspaceKey);
    if (workspaceKey !== project.primaryWorkspaceKey) {
      throw new BrainStorageError("BRAIN_CONVERSATION_WORKSPACE_MISMATCH", "Conversation must inherit its project workspace");
    }
    const requestedId = input.conversationId?.trim();
    if (requestedId) {
      const existing = this.database.prepare("SELECT * FROM brain_conversation WHERE id = ?").get(requestedId) as Record<string, unknown> | undefined;
      if (existing) {
        if (String(existing.owner_id) !== project.ownerId) {
          throw new BrainStorageError("BRAIN_PROJECT_FORBIDDEN", "Conversation belongs to another local owner");
        }
        return mapConversation(existing);
      }
    }
    const id = requestedId || `conversation_${randomUUID()}`;
    const status = input.status ?? "ACTIVE";
    if (status !== "ACTIVE" && status !== "ARCHIVED") {
      throw new BrainStorageError("BRAIN_INPUT_INVALID", `Unsupported conversation status: ${status}`);
    }
    const timestamp = nowIso();
    const lastMessageAt = input.lastMessageAt?.trim() || timestamp;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        INSERT INTO brain_conversation(id, project_id, owner_id, title, workspace_snapshot, status, created_at, updated_at, last_message_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, project.id, project.ownerId, requireText(input.title, "title"), workspaceKey, status, timestamp, timestamp, lastMessageAt);
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

  getFile(ownerId: string, projectId: string, fileId: string): BrainFileRecord {
    this.getProject(ownerId, projectId);
    const row = this.database.prepare("SELECT * FROM brain_file WHERE id = ? AND project_id = ? AND owner_id = ?")
      .get(fileId, projectId, ownerId) as Record<string, unknown> | undefined;
    if (!row) throw new BrainStorageError("BRAIN_FILE_NOT_FOUND", "File does not belong to project");
    return mapFile(row);
  }

  recordFileIngestResult(input: {
    ownerId: string; projectId: string; fileId: string; format: string; text: string;
    anchors: Array<{ anchorId?: string; objectId?: string; format?: string }>; warnings: string[];
  }): BrainFileRecord {
    const file = this.getFile(input.ownerId, input.projectId, input.fileId);
    const anchorCount = input.anchors.length;
    const textSize = Buffer.byteLength(input.text, "utf8");
    const parseStatus = anchorCount > 0 || textSize > 0 ? "READY" : "UNSUPPORTED";
    const validationStatus = input.warnings.length ? "WARNINGS" : "VALID";
    const pageSlideSheetCount = input.format === "xlsx"
      ? new Set(input.anchors.map((anchor) => String(anchor.objectId || "").split("!")[0]).filter(Boolean)).size || anchorCount
      : anchorCount;
    this.database.prepare(`
      UPDATE brain_file
      SET parse_status = ?, validation_status = ?, extractor_name = ?, page_slide_sheet_count = ?, extracted_text_size = ?
      WHERE id = ? AND project_id = ? AND owner_id = ?
    `).run(parseStatus, validationStatus, `document-worker:${input.format}`, pageSlideSheetCount, textSize,
      file.id, file.projectId, file.ownerId);
    const preview = input.text.slice(0, 8192);
    const extractHash = createHash("sha256").update(preview).digest("hex");
    this.database.prepare(`
      INSERT INTO brain_file_extract(
        id, file_id, file_version, unit_type, unit_index, plain_text, structure_json, source_anchor_json, content_hash, created_at
      ) VALUES (?, ?, ?, 'summary', 0, ?, '{}', '{}', ?, ?)
      ON CONFLICT(file_id, file_version, unit_type, unit_index) DO UPDATE SET
        plain_text = excluded.plain_text,
        content_hash = excluded.content_hash,
        created_at = excluded.created_at
    `).run(`extract_${file.id}_v${file.versionNo}`, file.id, file.versionNo, preview, extractHash, nowIso());
    return this.getFile(input.ownerId, input.projectId, input.fileId);
  }

  upsertEngineRuntime(input: {
    ownerId: string; engineId: string; executable: string; source: "system" | "managed"; version?: string;
  }): BrainEngineRuntimeRecord {
    const ownerId = requireText(input.ownerId, "ownerId");
    const engineId = requireText(input.engineId, "engineId");
    const executable = requireText(input.executable, "executable");
    const timestamp = nowIso();
    const existing = this.database.prepare("SELECT installed_at FROM brain_engine_runtime WHERE owner_id = ? AND engine_id = ?")
      .get(ownerId, engineId) as { installed_at: string } | undefined;
    this.database.prepare(`
      INSERT INTO brain_engine_runtime(owner_id, engine_id, executable, source, version, installed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, engine_id) DO UPDATE SET
        executable = excluded.executable,
        source = excluded.source,
        version = excluded.version,
        updated_at = excluded.updated_at
    `).run(ownerId, engineId, executable, input.source, input.version?.trim() || "", existing?.installed_at || timestamp, timestamp);
    return mapEngineRuntime(this.database.prepare("SELECT * FROM brain_engine_runtime WHERE owner_id = ? AND engine_id = ?").get(ownerId, engineId) as Record<string, unknown>);
  }

  getEngineRuntime(ownerId: string, engineId: string): BrainEngineRuntimeRecord | null {
    const row = this.database.prepare("SELECT * FROM brain_engine_runtime WHERE owner_id = ? AND engine_id = ?")
      .get(requireText(ownerId, "ownerId"), requireText(engineId, "engineId")) as Record<string, unknown> | undefined;
    return row ? mapEngineRuntime(row) : null;
  }

  listEngineRuntimes(ownerId: string): BrainEngineRuntimeRecord[] {
    return (this.database.prepare("SELECT * FROM brain_engine_runtime WHERE owner_id = ? ORDER BY updated_at DESC")
      .all(requireText(ownerId, "ownerId")) as Record<string, unknown>[]).map(mapEngineRuntime);
  }

  createAnnotation(input: {
    ownerId: string; projectId: string; fileId: string; fileVersion: number;
    anchor: DocumentAnchor; instruction: string; geometry?: Partial<AnnotationGeometry> & { style?: Partial<AnnotationGeometry["style"]> };
    status?: "OPEN" | "APPLIED" | "DISMISSED"; supersedesAnnotationId?: string;
  }): BrainAnnotationRecord {
    this.getProject(input.ownerId, input.projectId);
    const file = this.database.prepare("SELECT id, version_no FROM brain_file WHERE id = ? AND project_id = ? AND owner_id = ?")
      .get(input.fileId, input.projectId, input.ownerId) as { id: string; version_no: number } | undefined;
    if (!file) throw new BrainStorageError("BRAIN_FILE_NOT_FOUND", "Annotation file does not belong to project");
    if (!Number.isSafeInteger(input.fileVersion) || input.fileVersion < 1) throw new BrainStorageError("BRAIN_INPUT_INVALID", "fileVersion must be positive");
    if (Number(file.version_no) !== input.fileVersion) throw new BrainStorageError("BRAIN_FILE_VERSION_CONFLICT", "Annotation file version is stale");
    try { validateDocumentAnchor(input.anchor); } catch (error) {
      throw new BrainStorageError("BRAIN_ANNOTATION_INVALID", error instanceof Error ? error.message : "Annotation anchor is invalid");
    }
    const instruction = requireText(input.instruction, "instruction");
    const status = input.status ?? "OPEN";
    if (!["OPEN", "APPLIED", "DISMISSED"].includes(status)) throw new BrainStorageError("BRAIN_INPUT_INVALID", "annotation status is invalid");
    const supersedesAnnotationId = input.supersedesAnnotationId?.trim() ?? "";
    if (supersedesAnnotationId) {
      const predecessor = this.database.prepare("SELECT id FROM brain_annotation WHERE id = ? AND file_id = ? AND file_version = ?")
        .get(supersedesAnnotationId, input.fileId, input.fileVersion);
      if (!predecessor) throw new BrainStorageError("BRAIN_ANNOTATION_NOT_FOUND", "Superseded annotation does not belong to this file version");
    }
    const pageOrSheet = input.anchor.format === "xlsx"
      ? input.anchor.sheet
      : "page" in input.anchor ? String(input.anchor.page) : "";
    const displayIndex = Number((this.database.prepare(
      "SELECT COUNT(*) AS total FROM brain_annotation WHERE file_id = ? AND file_version = ?"
    ).get(input.fileId, input.fileVersion) as { total: number }).total) + 1;
    const geometry: AnnotationGeometry = {
      style: {
        tool: input.geometry?.style?.tool === "highlight" ? "highlight" : "select-rect",
        color: input.geometry?.style?.color?.trim() || normalizeAnnotationGeometry(undefined).style.color
      },
      displayIndex,
      ...(typeof input.geometry?.snapshotPath === "string" && input.geometry.snapshotPath.trim()
        ? { snapshotPath: input.geometry.snapshotPath.trim() }
        : {}),
      ...(typeof input.geometry?.snapshotUrl === "string" && input.geometry.snapshotUrl.trim()
        ? { snapshotUrl: input.geometry.snapshotUrl.trim() }
        : {}),
    };
    try { validateAnnotationGeometry(geometry); } catch (error) {
      throw new BrainStorageError("BRAIN_ANNOTATION_INVALID", error instanceof Error ? error.message : "Annotation geometry is invalid");
    }
    const record: BrainAnnotationRecord = {
      id: `annotation_${randomUUID()}`, fileId: input.fileId, fileVersion: input.fileVersion,
      pageOrSheet, annotationType: input.anchor.locator.kind, anchor: structuredClone(input.anchor),
      geometry, instruction, status, supersedesAnnotationId, selectedText: input.anchor.selectedText ?? "",
      createdBy: input.ownerId, createdAt: nowIso()
    };
    this.database.prepare(`
      INSERT INTO brain_annotation(
        id, file_id, file_version, page_or_sheet, annotation_type, geometry_json,
        structural_anchor_json, selected_text, created_by, created_at,
        anchor_json, instruction, status, supersedes_annotation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.fileId, record.fileVersion, record.pageOrSheet, record.annotationType,
      JSON.stringify(record.geometry), JSON.stringify(record.anchor), record.selectedText, record.createdBy, record.createdAt,
      JSON.stringify(record.anchor), record.instruction, record.status, record.supersedesAnnotationId);
    return record;
  }

  updateAnnotationStatus(input: {
    ownerId: string; projectId: string; annotationId: string;
    status: BrainAnnotationRecord["status"];
  }): BrainAnnotationRecord {
    this.getProject(input.ownerId, input.projectId);
    const row = this.database.prepare("SELECT a.* FROM brain_annotation a JOIN brain_file f ON f.id = a.file_id WHERE a.id = ? AND f.project_id = ? AND f.owner_id = ?")
      .get(input.annotationId, input.projectId, input.ownerId) as Record<string, unknown> | undefined;
    if (!row) throw new BrainStorageError("BRAIN_ANNOTATION_NOT_FOUND", "Annotation does not belong to project");
    if (!["OPEN", "APPLIED", "DISMISSED"].includes(input.status)) {
      throw new BrainStorageError("BRAIN_INPUT_INVALID", "annotation status is invalid");
    }
    this.database.prepare("UPDATE brain_annotation SET status = ? WHERE id = ?").run(input.status, input.annotationId);
    return mapAnnotation({ ...row, status: input.status });
  }

  listAnnotations(ownerId: string, projectId: string): BrainAnnotationRecord[] {
    this.getProject(ownerId, projectId);
    return (this.database.prepare("SELECT a.* FROM brain_annotation a JOIN brain_file f ON f.id = a.file_id WHERE f.project_id = ? AND f.owner_id = ? ORDER BY a.created_at DESC, a.id DESC").all(projectId, ownerId) as Record<string, unknown>[]).map(mapAnnotation);
  }

  getAnnotation(ownerId: string, projectId: string, annotationId: string): BrainAnnotationRecord {
    this.getProject(ownerId, projectId);
    const row = this.database.prepare("SELECT a.* FROM brain_annotation a JOIN brain_file f ON f.id = a.file_id WHERE a.id = ? AND f.project_id = ? AND f.owner_id = ?")
      .get(annotationId, projectId, ownerId) as Record<string, unknown> | undefined;
    if (!row) throw new BrainStorageError("BRAIN_ANNOTATION_NOT_FOUND", "Annotation does not belong to project");
    return mapAnnotation(row);
  }

  createChangeSet(input: { ownerId: string; projectId: string; annotationId: string; taskId?: string; baseFileVersion: number; changeSummary: string; diffJson?: string }): BrainChangeSetRecord {
    this.getProject(input.ownerId, input.projectId);
    const valid = this.database.prepare("SELECT a.id FROM brain_annotation a JOIN brain_file f ON f.id = a.file_id WHERE a.id = ? AND f.project_id = ? AND f.owner_id = ?").get(input.annotationId, input.projectId, input.ownerId);
    if (!valid) throw new BrainStorageError("BRAIN_ANNOTATION_NOT_FOUND", "Change set annotation does not belong to project");
    const record: BrainChangeSetRecord = { id: `change_${randomUUID()}`, annotationId: input.annotationId, taskId: input.taskId || "", baseFileVersion: input.baseFileVersion, resultFileVersion: 0, changeSummary: requireText(input.changeSummary, "changeSummary"), diffJson: input.diffJson || "{}", status: "PROPOSED", createdAt: nowIso(), reviewedAt: "" };
    this.database.prepare("INSERT INTO brain_change_set(id, annotation_id, task_id, base_file_version, result_file_version, change_summary, diff_json, status, created_at, reviewed_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL)").run(record.id, record.annotationId, record.taskId || null, record.baseFileVersion, record.changeSummary, record.diffJson, record.status, record.createdAt);
    return record;
  }

  listChangeSets(ownerId: string, projectId: string): BrainChangeSetRecord[] {
    this.getProject(ownerId, projectId);
    return (this.database.prepare("SELECT c.* FROM brain_change_set c JOIN brain_annotation a ON a.id = c.annotation_id JOIN brain_file f ON f.id = a.file_id WHERE f.project_id = ? AND f.owner_id = ? ORDER BY c.created_at DESC, c.id DESC").all(projectId, ownerId) as Record<string, unknown>[]).map(mapChangeSet);
  }

  getChangeSet(ownerId: string, projectId: string, changeSetId: string): BrainChangeSetRecord {
    this.getProject(ownerId, projectId);
    const row = this.database.prepare("SELECT c.* FROM brain_change_set c JOIN brain_annotation a ON a.id = c.annotation_id JOIN brain_file f ON f.id = a.file_id WHERE c.id = ? AND f.project_id = ? AND f.owner_id = ?")
      .get(changeSetId, projectId, ownerId) as Record<string, unknown> | undefined;
    if (!row) throw new BrainStorageError("BRAIN_CHANGE_SET_NOT_FOUND", "Change set does not belong to project");
    return mapChangeSet(row);
  }

  updateChangeSet(input: { ownerId: string; projectId: string; changeSetId: string; status: "ACCEPTED" | "REJECTED" | "REVERTED"; resultFileVersion?: number }): BrainChangeSetRecord {
    this.getProject(input.ownerId, input.projectId);
    const row = this.database.prepare("SELECT c.* FROM brain_change_set c JOIN brain_annotation a ON a.id = c.annotation_id JOIN brain_file f ON f.id = a.file_id WHERE c.id = ? AND f.project_id = ? AND f.owner_id = ?").get(input.changeSetId, input.projectId, input.ownerId) as Record<string, unknown> | undefined;
    if (!row) throw new BrainStorageError("BRAIN_CHANGE_SET_NOT_FOUND", "Change set does not belong to project");
    const reviewedAt = nowIso();
    this.database.prepare("UPDATE brain_change_set SET status = ?, result_file_version = ?, reviewed_at = ? WHERE id = ?").run(input.status, input.resultFileVersion ?? null, reviewedAt, input.changeSetId);
    return mapChangeSet({ ...row, status: input.status, result_file_version: input.resultFileVersion ?? null, reviewed_at: reviewedAt });
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

  saveFlow(input: { ownerId: string; projectId: string; id?: string; name: string; definition: FlowDefinition }): BrainFlowRecord {
    const project = this.getProject(input.ownerId, input.projectId);
    if (!["software", "data"].includes(project.primaryWorkspaceKey)) throw new BrainStorageError("BRAIN_FLOW_WORKSPACE_REQUIRED", "Flow belongs to a software or data workspace");
    const id = input.id || `flow-${randomUUID()}`;
    const timestamp = nowIso();
    this.database.prepare(`INSERT INTO brain_flow(id, project_id, name, definition_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, definition_json = excluded.definition_json, updated_at = excluded.updated_at WHERE project_id = excluded.project_id`)
      .run(id, input.projectId, requireText(input.name, "name"), JSON.stringify(input.definition), timestamp, timestamp);
    return this.getFlow(input.ownerId, id);
  }

  getFlow(ownerId: string, flowId: string): BrainFlowRecord {
    const row = this.database.prepare("SELECT * FROM brain_flow WHERE id = ?").get(flowId) as Record<string, unknown> | undefined;
    if (!row) throw new BrainStorageError("BRAIN_FLOW_NOT_FOUND", "Flow was not found");
    this.getProject(ownerId, String(row.project_id));
    return { id: String(row.id), projectId: String(row.project_id), name: String(row.name), definition: JSON.parse(String(row.definition_json)) as FlowDefinition, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
  }

  listFlows(ownerId: string, projectId: string): BrainFlowRecord[] {
    this.getProject(ownerId, projectId);
    return (this.database.prepare("SELECT * FROM brain_flow WHERE project_id = ? ORDER BY updated_at DESC, id").all(projectId) as Array<Record<string, unknown>>)
      .map((row) => ({
        id: String(row.id),
        projectId: String(row.project_id),
        name: String(row.name),
        definition: JSON.parse(String(row.definition_json)) as FlowDefinition,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at)
      }));
  }

  getLatestFlowRun(ownerId: string, projectId: string): BrainFlowRunRecord | null {
    this.getProject(ownerId, projectId);
    const row = this.database.prepare("SELECT * FROM brain_flow_run WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1").get(projectId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      flowId: String(row.flow_id),
      projectId: String(row.project_id),
      status: String(row.status) as BrainFlowRunRecord["status"],
      currentNodeId: String(row.current_node_id),
      values: JSON.parse(String(row.values_json)),
      audit: JSON.parse(String(row.audit_json)),
      errorCode: String(row.error_code),
      startedAt: String(row.started_at),
      updatedAt: String(row.updated_at),
      finishedAt: String(row.finished_at)
    };
  }

  createFlowSchedule(input: { ownerId: string; projectId: string; flowId: string; timezone?: string; runAt: string; enabled?: boolean }): BrainFlowScheduleRecord {
    const project = this.getProject(input.ownerId, input.projectId);
    this.getFlow(input.ownerId, input.flowId);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(input.runAt)) throw new BrainStorageError("BRAIN_FLOW_SCHEDULE_TIME_INVALID", "Flow schedule time is invalid");
    const id = `flow-schedule-${randomUUID()}`; const timestamp = nowIso(); const timezone = input.timezone || "Asia/Shanghai";
    this.database.prepare("INSERT INTO brain_flow_schedule(id, project_id, flow_id, timezone, run_at, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, project.id, input.flowId, timezone, input.runAt, input.enabled === false ? 0 : 1, timestamp, timestamp);
    return this.getFlowSchedule(input.ownerId, id);
  }

  getFlowSchedule(ownerId: string, scheduleId: string): BrainFlowScheduleRecord {
    const row = this.database.prepare("SELECT schedule.*, project.owner_id FROM brain_flow_schedule schedule JOIN brain_project project ON project.id = schedule.project_id WHERE schedule.id = ?").get(scheduleId) as Record<string, unknown> | undefined;
    if (!row) throw new BrainStorageError("BRAIN_FLOW_SCHEDULE_NOT_FOUND", "Flow schedule was not found");
    if (String(row.owner_id) !== ownerId) throw new BrainStorageError("BRAIN_PROJECT_OWNER_MISMATCH", "Flow schedule belongs to another local owner");
    return { id: String(row.id), ownerId, projectId: String(row.project_id), flowId: String(row.flow_id), timezone: String(row.timezone), runAt: String(row.run_at), enabled: Number(row.enabled) === 1, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
  }

  listFlowSchedules(ownerId: string, projectId: string): BrainFlowScheduleRecord[] {
    this.getProject(ownerId, projectId);
    return (this.database.prepare("SELECT schedule.* FROM brain_flow_schedule schedule JOIN brain_project project ON project.id = schedule.project_id WHERE schedule.project_id = ? AND project.owner_id = ? ORDER BY schedule.run_at, schedule.id").all(projectId, ownerId) as Array<Record<string, unknown>>).map((row) => ({ id: String(row.id), ownerId, projectId: String(row.project_id), flowId: String(row.flow_id), timezone: String(row.timezone), runAt: String(row.run_at), enabled: Number(row.enabled) === 1, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }));
  }

  listEnabledFlowSchedules(ownerId: string): BrainFlowScheduleRecord[] {
    return (this.database.prepare("SELECT schedule.* FROM brain_flow_schedule schedule JOIN brain_project project ON project.id = schedule.project_id WHERE project.owner_id = ? AND schedule.enabled = 1 ORDER BY schedule.run_at, schedule.id").all(ownerId) as Array<Record<string, unknown>>).map((row) => ({ id: String(row.id), ownerId, projectId: String(row.project_id), flowId: String(row.flow_id), timezone: String(row.timezone), runAt: String(row.run_at), enabled: true, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }));
  }

  claimFlowScheduleOccurrence(input: { ownerId: string; scheduleId: string; occurrence: string }): boolean {
    const schedule = this.getFlowSchedule(input.ownerId, input.scheduleId); const timestamp = nowIso();
    const result = this.database.prepare("INSERT OR IGNORE INTO brain_flow_schedule_occurrence(schedule_id, occurrence, status, started_at) VALUES (?, ?, 'RUNNING', ?)").run(schedule.id, input.occurrence, timestamp);
    return Number(result.changes) === 1;
  }

  completeFlowScheduleOccurrence(ownerId: string, scheduleId: string, occurrence: string, errorCode = ""): void {
    this.getFlowSchedule(ownerId, scheduleId); this.database.prepare("UPDATE brain_flow_schedule_occurrence SET status = ?, error_code = ?, finished_at = ? WHERE schedule_id = ? AND occurrence = ? AND status = 'RUNNING'").run(errorCode ? "FAILED" : "SUCCEEDED", errorCode, nowIso(), scheduleId, occurrence);
  }

  createFlowRun(input: { ownerId: string; flowId: string; values?: Record<string, unknown> }): BrainFlowRunRecord {
    const flow = this.getFlow(input.ownerId, input.flowId);
    const id = `flow-run-${randomUUID()}`;
    const timestamp = nowIso();
    this.database.prepare(`INSERT INTO brain_flow_run(id, flow_id, project_id, status, values_json, started_at, updated_at) VALUES (?, ?, ?, 'QUEUED', ?, ?, ?)`)
      .run(id, flow.id, flow.projectId, JSON.stringify(input.values || {}), timestamp, timestamp);
    return this.getFlowRun(input.ownerId, id);
  }

  checkpointFlowRun(input: { ownerId: string; runId: string; status: BrainFlowRunRecord["status"]; currentNodeId?: string; values?: Record<string, unknown>; audit?: FlowAuditEvent[]; errorCode?: string }): BrainFlowRunRecord {
    const current = this.getFlowRun(input.ownerId, input.runId);
    const terminal = ["SUCCEEDED", "FAILED", "DECLINED", "INTERRUPTED"].includes(input.status);
    const timestamp = nowIso();
    this.database.prepare(`UPDATE brain_flow_run SET status = ?, current_node_id = ?, values_json = ?, audit_json = ?, error_code = ?, updated_at = ?, finished_at = ? WHERE id = ?`)
      .run(input.status, input.currentNodeId ?? current.currentNodeId, JSON.stringify(input.values ?? current.values), JSON.stringify(input.audit ?? current.audit), input.errorCode ?? current.errorCode, timestamp, terminal ? timestamp : "", input.runId);
    return this.getFlowRun(input.ownerId, input.runId);
  }

  getFlowRun(ownerId: string, runId: string): BrainFlowRunRecord {
    const row = this.database.prepare("SELECT * FROM brain_flow_run WHERE id = ?").get(runId) as Record<string, unknown> | undefined;
    if (!row) throw new BrainStorageError("BRAIN_FLOW_RUN_NOT_FOUND", "Flow run was not found");
    this.getProject(ownerId, String(row.project_id));
    return { id: String(row.id), flowId: String(row.flow_id), projectId: String(row.project_id), status: String(row.status) as BrainFlowRunRecord["status"], currentNodeId: String(row.current_node_id), values: JSON.parse(String(row.values_json)), audit: JSON.parse(String(row.audit_json)), errorCode: String(row.error_code), startedAt: String(row.started_at), updatedAt: String(row.updated_at), finishedAt: String(row.finished_at) };
  }

  reconcileInterruptedFlowRuns(): number {
    const timestamp = nowIso();
    const result = this.database.prepare(`UPDATE brain_flow_run SET status = 'INTERRUPTED', error_code = 'BRAIN_FLOW_INTERRUPTED', updated_at = ?, finished_at = ? WHERE status = 'RUNNING'`).run(timestamp, timestamp);
    return Number(result.changes);
  }

  reconcileInterruptedGamePreviews(): number {
    const timestamp = nowIso();
    const resultJson = JSON.stringify({
      schemaVersion: 1,
      status: "FAILED",
      errorCode: "BRAIN_GAME_PREVIEW_INTERRUPTED",
      replayed: false,
      recoveredAt: timestamp
    });
    const result = this.database.prepare(`UPDATE brain_task SET
      status = 'FAILED', error_code = 'BRAIN_GAME_PREVIEW_INTERRUPTED',
      error_detail = 'The desktop application stopped before the preview process completed.',
      result_json = ?, finished_at = ?, heartbeat_at = ?
      WHERE task_type = 'game.preview' AND status IN ('QUEUED', 'RUNNING')`).run(resultJson, timestamp, timestamp);
    return Number(result.changes);
  }

  reconcileInterruptedMediaRenders(): number {
    const timestamp = nowIso();
    const resultJson = JSON.stringify({
      schemaVersion: 1,
      status: "FAILED",
      errorCode: "BRAIN_MEDIA_RENDER_INTERRUPTED",
      replayed: false,
      recoveredAt: timestamp
    });
    const result = this.database.prepare(`UPDATE brain_task SET
      status = 'FAILED', error_code = 'BRAIN_MEDIA_RENDER_INTERRUPTED',
      error_detail = 'The desktop application stopped before the media render completed.',
      result_json = ?, finished_at = ?, heartbeat_at = ?
      WHERE task_type IN ('video_render', 'music_render') AND status IN ('QUEUED', 'RUNNING')`).run(resultJson, timestamp, timestamp);
    return Number(result.changes);
  }

  reconcileInterruptedSoftwareTasks(): number {
    const timestamp = nowIso();
    const tasks = this.database.prepare(`SELECT id, idempotency_key, project_id, request_id, task_type, result_json
      FROM brain_task WHERE task_type LIKE 'software.%' AND status IN ('QUEUED', 'RUNNING')`).all() as Array<Record<string, unknown>>;
    const update = this.database.prepare(`UPDATE brain_task SET
      status = 'FAILED', progress = 0.5, error_code = 'BRAIN_SOFTWARE_TASK_INTERRUPTED',
      error_detail = 'The desktop application stopped before the software task completed.',
      result_json = ?, finished_at = ?, heartbeat_at = ?
      WHERE id = ? AND status IN ('QUEUED', 'RUNNING')`);
    let changed = 0;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const task of tasks) {
        let previous: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(String(task.result_json || "{}"));
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) previous = parsed as Record<string, unknown>;
        } catch { /* Corrupt task evidence must not prevent safe reconciliation. */ }
        const resultJson = JSON.stringify({
          ...previous,
          schemaVersion: 1,
          id: String(previous.id || task.idempotency_key),
          projectId: String(previous.projectId || task.project_id),
          operation: String(previous.operation || task.task_type).replace(/^software\./u, ""),
          status: "FAILED",
          requestId: String(previous.requestId || task.request_id),
          finishedAt: timestamp,
          errorCode: "BRAIN_SOFTWARE_TASK_INTERRUPTED",
          replayed: false,
          recoveredAt: timestamp
        });
        const result = update.run(resultJson, timestamp, timestamp, String(task.id));
        changed += Number(result.changes);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return changed;
  }

  updateTask(input: { ownerId: string; taskId: string; status: BrainTaskRecord["status"]; progress?: number; errorCode?: string; errorDetail?: string; resultJson?: string }): BrainTaskRecord {
    const current = this.getTask(input.ownerId, input.taskId);
    const statuses: BrainTaskRecord["status"][] = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"];
    if (!statuses.includes(input.status)) throw new BrainStorageError("BRAIN_INPUT_INVALID", "Unsupported task status");
    const progress = input.progress ?? current.progress;
    if (!Number.isFinite(progress) || progress < 0 || progress > 1) throw new BrainStorageError("BRAIN_INPUT_INVALID", "progress must be between 0 and 1");
    const timestamp = nowIso();
    const terminal = ["SUCCEEDED", "FAILED", "CANCELLED"].includes(input.status);
    const startedAt = input.status === "RUNNING" && !current.startedAt ? timestamp : (current.startedAt || null);
    const finishedAt = terminal ? timestamp : null;
    this.database.prepare(`
      UPDATE brain_task SET status = ?, progress = ?, error_code = ?, error_detail = ?, result_json = ?,
        started_at = ?, finished_at = ?, heartbeat_at = ? WHERE id = ?
    `).run(input.status, progress, input.errorCode || "", input.errorDetail || "", input.resultJson ?? current.resultJson,
      startedAt, finishedAt, timestamp, input.taskId);
    return this.getTask(input.ownerId, input.taskId);
  }

  listRunnableQuantStrategyTasks(ownerId: string): BrainTaskRecord[] {
    return (this.database.prepare(`SELECT task.* FROM brain_task task
        JOIN brain_project project ON project.id = task.project_id
        WHERE project.owner_id = ? AND task.task_type LIKE 'quant.strategy.%'
          AND task.status IN ('QUEUED', 'FAILED') AND task.attempt < task.max_attempts
        ORDER BY COALESCE(task.heartbeat_at, task.started_at, '') ASC, task.id ASC`)
      .all(requireText(ownerId, "ownerId")) as Record<string, unknown>[]).map(mapTask);
  }

  claimQuantStrategyTask(ownerId: string, taskId: string): BrainTaskRecord | null {
    const normalizedOwnerId = requireText(ownerId, "ownerId");
    const normalizedTaskId = requireText(taskId, "taskId");
    const timestamp = nowIso();
    const claimed = this.database.prepare(`UPDATE brain_task SET
        status = 'RUNNING', attempt = attempt + 1, progress = 0.05,
        error_code = '', error_detail = '', started_at = COALESCE(started_at, ?),
        finished_at = NULL, heartbeat_at = ?
      WHERE id = ? AND task_type LIKE 'quant.strategy.%'
        AND status IN ('QUEUED', 'FAILED') AND attempt < max_attempts
        AND EXISTS (SELECT 1 FROM brain_project project WHERE project.id = brain_task.project_id AND project.owner_id = ?)`)
      .run(timestamp, timestamp, normalizedTaskId, normalizedOwnerId);
    if (Number(claimed.changes) !== 1) return null;
    return this.getTask(normalizedOwnerId, normalizedTaskId);
  }

  registerArtifact(input: {
    ownerId: string; projectId: string; taskId?: string; sourceFileId?: string; sourceWorkspaceKey?: BrainWorkspaceKey;
    artifactType: string; storageKey: string; contentHash: string; validationStatus?: string;
  }): BrainArtifactRecord {
    this.getProject(input.ownerId, input.projectId);
    let sourceWorkspaceKey = input.sourceWorkspaceKey?.trim() || "";
    if (input.taskId) {
      const task = this.getTask(input.ownerId, input.taskId);
      if (task.projectId !== input.projectId) throw new BrainStorageError("BRAIN_PROJECT_FORBIDDEN", "Artifact task belongs to another project");
      if (!sourceWorkspaceKey) sourceWorkspaceKey = task.workspaceKey;
    }
    if (input.sourceFileId) {
      const file = this.database.prepare("SELECT project_id, owner_id FROM brain_file WHERE id = ?").get(input.sourceFileId) as { project_id: string; owner_id: string } | undefined;
      if (!file || file.owner_id !== input.ownerId || file.project_id !== input.projectId) {
        throw new BrainStorageError("BRAIN_PROJECT_FORBIDDEN", "Artifact source file belongs to another project");
      }
    }
    const record: BrainArtifactRecord = {
      id: `artifact_${randomUUID()}`, projectId: input.projectId, taskId: input.taskId || "",
      sourceFileId: input.sourceFileId || "", sourceWorkspaceKey: sourceWorkspaceKey ? requireWorkspaceKey(sourceWorkspaceKey) : "",
      artifactType: requireText(input.artifactType, "artifactType"), storageKey: requireText(input.storageKey, "storageKey"),
      contentHash: requireText(input.contentHash, "contentHash"), validationStatus: input.validationStatus?.trim() || "PENDING",
      createdAt: nowIso()
    };
    this.database.prepare(`
      INSERT INTO brain_artifact(
        id, project_id, task_id, source_file_id, source_workspace_key, artifact_type, storage_key, content_hash, validation_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.projectId, record.taskId || null, record.sourceFileId || null, record.sourceWorkspaceKey || "",
      record.artifactType, record.storageKey, record.contentHash, record.validationStatus, record.createdAt);
    return record;
  }

  listArtifacts(ownerId: string, projectId: string): BrainArtifactRecord[] {
    this.getProject(ownerId, projectId);
    return (this.database.prepare("SELECT * FROM brain_artifact WHERE project_id = ? ORDER BY created_at DESC, id DESC")
      .all(projectId) as Record<string, unknown>[]).map(mapArtifact);
  }

  pruneRetention(input: {
    nowMs?: number;
    budgets?: Partial<typeof DEFAULT_BRAIN_RETENTION>;
  } = {}): { projectMetadata: number; cache: number; artifacts: number } {
    const nowMs = input.nowMs ?? Date.now();
    const budgets = { ...DEFAULT_BRAIN_RETENTION, ...input.budgets };
    let projectMetadata = 0;
    let cache = 0;
    let artifacts = 0;

    const terminalTasks = (this.database.prepare(`SELECT id, COALESCE(finished_at, started_at, '') AS created_at
      FROM brain_task WHERE status IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT')`).all() as RetentionCandidate[]);
    const taskVictims = selectRetentionVictims(terminalTasks, budgets.projectMetadata, nowMs);
    if (taskVictims.length) {
      const deleteTask = this.database.prepare("DELETE FROM brain_task WHERE id = ? AND status IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT')");
      this.database.exec("BEGIN IMMEDIATE");
      try {
        for (const id of taskVictims) projectMetadata += Number(deleteTask.run(id).changes);
        this.database.exec("COMMIT");
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    }

    const extracts = (this.database.prepare(`SELECT id, created_at AS created_at FROM brain_file_extract`).all() as RetentionCandidate[]);
    const extractVictims = selectRetentionVictims(extracts, budgets.cache, nowMs);
    if (extractVictims.length) {
      const deleteExtract = this.database.prepare("DELETE FROM brain_file_extract WHERE id = ?");
      this.database.exec("BEGIN IMMEDIATE");
      try {
        for (const id of extractVictims) cache += Number(deleteExtract.run(id).changes);
        this.database.exec("COMMIT");
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    }

    const artifactRows = (this.database.prepare(`SELECT id, created_at AS created_at FROM brain_artifact`).all() as RetentionCandidate[]);
    const artifactVictims = selectRetentionVictims(artifactRows, budgets.artifacts, nowMs);
    if (artifactVictims.length) {
      const deleteArtifact = this.database.prepare("DELETE FROM brain_artifact WHERE id = ?");
      this.database.exec("BEGIN IMMEDIATE");
      try {
        for (const id of artifactVictims) artifacts += Number(deleteArtifact.run(id).changes);
        this.database.exec("COMMIT");
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    }

    return { projectMetadata, cache, artifacts };
  }

  restoreWorkspaceAfterRestart(input?: {
    resolveArtifactPath?: (projectId: string, storageKey: string) => string | null;
  }): {
    interruptedFlowRuns: number;
    interruptedGamePreviews: number;
    interruptedSoftwareTasks: number;
    interruptedMediaRenders: number;
    artifactsVerified: number;
    artifactsInvalidated: number;
    cancelledTasks: number;
  } {
    const interruptedFlowRuns = this.reconcileInterruptedFlowRuns();
    const interruptedGamePreviews = this.reconcileInterruptedGamePreviews();
    const interruptedSoftwareTasks = this.reconcileInterruptedSoftwareTasks();
    const interruptedMediaRenders = this.reconcileInterruptedMediaRenders();
    const cancelledTasks = Number((this.database.prepare(`SELECT COUNT(*) AS count FROM brain_task WHERE status = 'CANCELLED'`).get() as { count: number }).count);
    let artifactsVerified = 0;
    let artifactsInvalidated = 0;
    if (input?.resolveArtifactPath) {
      const rows = this.database.prepare(`SELECT id, project_id, storage_key, validation_status FROM brain_artifact`).all() as Array<{
        id: string; project_id: string; storage_key: string; validation_status: string;
      }>;
      const update = this.database.prepare(`UPDATE brain_artifact SET validation_status = ? WHERE id = ?`);
      for (const row of rows) {
        const resolved = input.resolveArtifactPath(String(row.project_id), String(row.storage_key));
        const exists = Boolean(resolved && existsSync(resolved));
        if (exists) {
          if (row.validation_status !== "VALID") update.run("VALID", row.id);
          artifactsVerified += 1;
        } else {
          if (row.validation_status !== "MISSING_AFTER_RESTART") update.run("MISSING_AFTER_RESTART", row.id);
          artifactsInvalidated += 1;
        }
      }
    }
    return {
      interruptedFlowRuns,
      interruptedGamePreviews,
      interruptedSoftwareTasks,
      interruptedMediaRenders,
      artifactsVerified,
      artifactsInvalidated,
      cancelledTasks
    };
  }

  loadQuantState(projectId: string): string | null {
    const row = this.database.prepare("SELECT state_json FROM brain_quant_state WHERE project_id = ?")
      .get(requireText(projectId, "projectId")) as { state_json: string } | undefined;
    return row?.state_json ?? null;
  }

  saveQuantState(projectId: string, stateJson: string): void {
    const normalizedProjectId = requireText(projectId, "projectId");
    const normalizedState = requireText(stateJson, "stateJson");
    const project = this.database.prepare("SELECT id FROM brain_project WHERE id = ?").get(normalizedProjectId);
    if (!project) throw new BrainStorageError("BRAIN_PROJECT_NOT_FOUND", "Project not found");
    this.database.prepare(`
      INSERT INTO brain_quant_state(project_id, state_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at
    `).run(normalizedProjectId, normalizedState, nowIso());
  }

  createQuantStrategySchedule(input: { ownerId: string; projectId: string; skillId: string; strategyId?: "trend-following" | "mean-reversion"; exchange: ChinaExchange; runAt: string; symbol: string; quantity: number }): QuantStrategySchedule {
    this.getProject(input.ownerId, input.projectId);
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(input.runAt)) throw new BrainStorageError("BRAIN_INPUT_INVALID", "runAt must use HH:mm");
    if (!(["SSE", "SZSE", "BSE"] as const).includes(input.exchange)) throw new BrainStorageError("BRAIN_INPUT_INVALID", "exchange is invalid");
    const skillId = requireText(input.skillId, "skillId");
    const strategyId = input.strategyId ?? (skillId === "mean-reversion" ? "mean-reversion" : "trend-following");
    const symbol = requireText(input.symbol, "symbol");
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new BrainStorageError("BRAIN_INPUT_INVALID", "quantity must be a positive integer");
    const existing = this.database.prepare(`SELECT * FROM brain_quant_strategy_schedule
      WHERE project_id = ? AND skill_id = ? AND exchange = ? AND run_at = ?`)
      .get(input.projectId, skillId, input.exchange, input.runAt) as Record<string, unknown> | undefined;
    if (existing) {
      this.database.prepare("UPDATE brain_quant_strategy_schedule SET symbol = ?, quantity = ?, strategy_id = ?, updated_at = ? WHERE id = ?")
        .run(symbol, input.quantity, strategyId, nowIso(), String(existing.id));
      return {
        id: String(existing.id), projectId: String(existing.project_id), skillId: String(existing.skill_id), strategyId,
        exchange: String(existing.exchange) as ChinaExchange, timezone: "Asia/Shanghai", runAt: String(existing.run_at),
        enabled: Number(existing.enabled) === 1, symbol, quantity: input.quantity
      };
    }
    const timestamp = nowIso();
    const record: QuantStrategySchedule = {
      id: `quant_schedule_${randomUUID()}`, projectId: input.projectId, skillId, strategyId,
      exchange: input.exchange, timezone: "Asia/Shanghai", runAt: input.runAt, enabled: true, symbol, quantity: input.quantity
    };
    this.database.prepare(`
      INSERT INTO brain_quant_strategy_schedule(id, project_id, skill_id, strategy_id, exchange, timezone, run_at, enabled, symbol, quantity, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    `).run(record.id, record.projectId, record.skillId, record.strategyId, record.exchange, record.timezone, record.runAt, record.symbol, record.quantity, timestamp, timestamp);
    return record;
  }

  listQuantStrategySchedules(ownerId: string, projectId: string): QuantStrategySchedule[] {
    this.getProject(ownerId, projectId);
    return (this.database.prepare("SELECT * FROM brain_quant_strategy_schedule WHERE project_id = ? ORDER BY created_at, id")
      .all(projectId) as Record<string, unknown>[]).map((row) => ({
        id: String(row.id), projectId: String(row.project_id), skillId: String(row.skill_id), strategyId: String(row.strategy_id || "trend-following") as QuantStrategySchedule["strategyId"],
        exchange: String(row.exchange) as ChinaExchange, timezone: "Asia/Shanghai", runAt: String(row.run_at), enabled: Number(row.enabled) === 1,
        symbol: String(row.symbol), quantity: Number(row.quantity)
      }));
  }

  setQuantStrategyScheduleEnabled(input: { ownerId: string; projectId: string; scheduleId: string; enabled: boolean }): QuantStrategySchedule {
    this.getProject(input.ownerId, input.projectId);
    const result = this.database.prepare("UPDATE brain_quant_strategy_schedule SET enabled = ?, updated_at = ? WHERE id = ? AND project_id = ?")
      .run(input.enabled ? 1 : 0, nowIso(), requireText(input.scheduleId, "scheduleId"), input.projectId);
    if (Number(result.changes) !== 1) throw new BrainStorageError("BRAIN_QUANT_SCHEDULE_NOT_FOUND", "Quant strategy schedule was not found");
    const schedule = this.listQuantStrategySchedules(input.ownerId, input.projectId).find((item) => item.id === input.scheduleId);
    if (!schedule) throw new BrainStorageError("BRAIN_QUANT_SCHEDULE_NOT_FOUND", "Quant strategy schedule was not found");
    return schedule;
  }

  listQuantStrategyRuns(ownerId: string, projectId: string, scheduleId?: string): QuantStrategyRun[] {
    this.getProject(ownerId, projectId);
    const rows = scheduleId
      ? this.database.prepare(`SELECT run.* FROM brain_quant_strategy_run run
          JOIN brain_quant_strategy_schedule schedule ON schedule.id = run.schedule_id
          WHERE schedule.project_id = ? AND schedule.id = ? ORDER BY run.started_at DESC, run.trading_date DESC`).all(projectId, requireText(scheduleId, "scheduleId"))
      : this.database.prepare(`SELECT run.* FROM brain_quant_strategy_run run
          JOIN brain_quant_strategy_schedule schedule ON schedule.id = run.schedule_id
          WHERE schedule.project_id = ? ORDER BY run.started_at DESC, run.trading_date DESC`).all(projectId);
    return (rows as Record<string, unknown>[]).map((row) => ({
      scheduleId: String(row.schedule_id), tradingDate: String(row.trading_date), idempotencyKey: String(row.idempotency_key),
      status: String(row.status) as QuantStrategyRun["status"], attempt: Number(row.attempt), errorCode: String(row.error_code || ""),
      errorDetail: String(row.error_detail || ""), startedAt: String(row.started_at), finishedAt: String(row.finished_at || "")
    }));
  }

  quantStrategyScheduleStore(): QuantStrategyScheduleStore {
    return {
      listEnabled: (ownerId) => (this.database.prepare(`SELECT schedule.* FROM brain_quant_strategy_schedule schedule
          JOIN brain_project project ON project.id = schedule.project_id
          WHERE schedule.enabled = 1 AND project.owner_id = ? ORDER BY schedule.id`)
        .all(requireText(ownerId, "ownerId")) as Record<string, unknown>[]).map((row) => ({
          id: String(row.id), projectId: String(row.project_id), skillId: String(row.skill_id),
          exchange: String(row.exchange) as ChinaExchange, timezone: "Asia/Shanghai", runAt: String(row.run_at), enabled: true,
          symbol: String(row.symbol), quantity: Number(row.quantity)
        })),
      claim: (scheduleId, tradingDate, idempotencyKey) => {
        const timestamp = nowIso();
        const inserted = this.database.prepare(`
          INSERT OR IGNORE INTO brain_quant_strategy_run(schedule_id, trading_date, idempotency_key, status, started_at)
          VALUES (?, ?, ?, 'RUNNING', ?)
        `).run(scheduleId, tradingDate, idempotencyKey, timestamp);
        if (Number(inserted.changes) === 1) return true;
        const retried = this.database.prepare(`
          UPDATE brain_quant_strategy_run SET status = 'RUNNING', attempt = attempt + 1, error_code = '', error_detail = '', started_at = ?, finished_at = NULL
          WHERE schedule_id = ? AND trading_date = ? AND idempotency_key = ? AND status = 'FAILED'
        `).run(timestamp, scheduleId, tradingDate, idempotencyKey);
        return Number(retried.changes) === 1;
      },
      complete: (scheduleId, tradingDate, idempotencyKey) => {
        this.database.prepare(`UPDATE brain_quant_strategy_run SET status = 'SUCCEEDED', finished_at = ?
          WHERE schedule_id = ? AND trading_date = ? AND idempotency_key = ? AND status = 'RUNNING'`)
          .run(nowIso(), scheduleId, tradingDate, idempotencyKey);
      },
      fail: (scheduleId, tradingDate, idempotencyKey, errorCode, errorDetail) => {
        this.database.prepare(`UPDATE brain_quant_strategy_run SET status = 'FAILED', error_code = ?, error_detail = ?, finished_at = ?
          WHERE schedule_id = ? AND trading_date = ? AND idempotency_key = ? AND status = 'RUNNING'`)
          .run(errorCode.slice(0, 120), errorDetail.slice(0, 2_000), nowIso(), scheduleId, tradingDate, idempotencyKey);
      }
    };
  }

  enqueueQuantStrategyExecution(input: QuantStrategyExecution): BrainTaskRecord {
    const project = this.database.prepare("SELECT owner_id FROM brain_project WHERE id = ?").get(input.projectId) as { owner_id: string } | undefined;
    if (!project) throw new BrainStorageError("BRAIN_PROJECT_NOT_FOUND", "Project not found");
    return this.createTask({
      ownerId: project.owner_id,
      projectId: input.projectId,
      workspaceKey: "quant",
      taskType: `quant.strategy.${input.skillId}`,
      requestId: input.idempotencyKey,
      idempotencyKey: input.idempotencyKey,
      maxAttempts: 3,
      resourceLimitsJson: JSON.stringify({ exchange: input.exchange, tradingDate: input.tradingDate, symbol: input.symbol, quantity: input.quantity, strategyId: input.strategyId, simulationOnly: true })
    });
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
