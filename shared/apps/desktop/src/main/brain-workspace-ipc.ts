import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  brainWorkspaceIpcChannels,
  brainWorkspaceKeys,
  type BrainConversationCreateInput,
  type BrainConversationListInput,
  type BrainConversationGetInput,
  type BrainDraftSaveInput,
  type BrainArtifactRegisterInput,
  type BrainFileRegisterInput,
  type BrainMessageAppendInput,
  type BrainProjectCreateInput,
  type BrainProjectGetInput,
  type BrainProjectListInput,
  type BrainProjectUpdateInput,
  type BrainProjectWorkspaceInput,
  type BrainGameUnrealTemplateCreateInput,
  type BrainWorkspaceSectionGetInput,
  type BrainWorkspaceSectionSaveInput,
  type BrainTaskCreateInput,
  type BrainTaskUpdateInput,
  type BrainWorkspaceKey
} from "@codex-forge/protocol";
import type { BrainFlowDefinition } from "@codex-forge/protocol";
import type { DocumentAnchor } from "@codex-forge/protocol/document-anchor";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.js";
import { BrainDocumentRevisionService } from "./brain-document-revision-service.js";
import { inspectGameProject } from "./game-project-inspector.js";
import { GameRuntimeService } from "./game-runtime-service.js";
import { VideoRuntimeService } from "./video-runtime-service.js";
import { MusicRuntimeService } from "./music-runtime-service.js";
import { DataRuntimeService } from "./data-runtime-service.js";
import { buildWorkspaceArtifactPreviewUrl } from "./workspace-artifact-protocol.js";
import { ensureEnginesForWorkspaceKey } from "./engine-bootstrap-service.js";
import { GamePreviewService, type GamePreviewRustClient } from "./game-preview-service.js";
import type { QuantSimulationService } from "./quant-simulation-service.ts";
import type { VideoTimelineService } from "./video-timeline-service.ts";
import type { VideoRenderService } from "./video-render-service.ts";
import type { MusicTimelineService } from "./music-timeline-service.ts";
import type { MusicMediaService } from "./music-media-service.ts";
import type { MusicRenderService } from "./music-render-service.ts";
import { normalizeDataset } from "./data-dataset-policy.ts";
import type { BrainDataset } from "@codex-forge/protocol/data-types";
import { discoverSoftwareScripts } from "./software-script-discovery.ts";
import { SoftwareTaskService, type SoftwareTaskRustClient } from "./software-task-service.ts";
import type { DocumentWorkerResponse } from "@codex-forge/protocol/document-worker";
import { validateDocumentOperation } from "@codex-forge/protocol/document-operation";
import type { DataAnalysisService } from "./data-analysis-service.ts";
import { FlowExecutionService } from "./flow-execution-service.ts";
import { validateFlowDefinition } from "./flow-runtime.ts";

interface BrainWorkspaceIpcDependencies {
  storage: BrainWorkspaceStorage;
  resolveOwnerId: () => Promise<string> | string;
  resolveWorkspaceRoot: (workspaceId: string) => Promise<string>;
  quant?: QuantSimulationService;
  queryQuantMarketOverview?: (limit: number) => Promise<unknown>;
  queryQuantMarketScreener?: (criteria: Record<string, unknown>) => Promise<unknown>;
  video?: VideoTimelineService;
  videoRender?: VideoRenderService;
  music?: MusicTimelineService;
  musicMedia?: MusicMediaService;
  musicRender?: MusicRenderService;
  ingestDocument?: (input: { requestId: string; projectRoot: string; relativePath: string; maxBytes: number }) => Promise<DocumentWorkerResponse>;
  acquireRustCore?: (binding: { projectId: string; projectRoot: string; workspaceType: "game" | "video" | "music" | "data" | "software" }) => Promise<GamePreviewRustClient | SoftwareTaskRustClient>;
  rustConversation?: (input: { projectId: string; projectRoot: string; workspaceType: string; operation: `conversation.${string}`; payload: Record<string, unknown> }) => Promise<unknown>;
  confirmGamePreview?: (input: { projectName: string; projectRoot: string; command: string }) => Promise<boolean>;
  confirmSoftwareTask?: (input: { projectId: string; script: import("@codex-forge/protocol").BrainSoftwareScript; projectRoot: string }) => Promise<boolean>;
  openSoftwareTerminal?: (input: { projectId: string; projectRoot: string }) => Promise<{ ok: boolean }>;
  platform?: NodeJS.Platform;
  dataAnalysis?: DataAnalysisService;
  flowExecution?: FlowExecutionService;
  confirmFlowApproval?: (input: { ownerId: string; projectId: string; flowId: string; runId: string; nodeId: string }) => Promise<boolean>;
  readWorkspaceCatalog?: () => Promise<{
    workspaces: Array<{
      id: string;
      name: string;
      threads?: Array<{ id: string; title?: string; updatedAt?: string; archived?: boolean }>;
    }>;
  }>;
  discoverEngines?: () => Promise<Array<{ engineId: string; executable: string; source: string; version: string }>>;
  ensureEngine?: (engineId: string) => Promise<{ engineId: string; executable: string; source: string; version: string }>;
  ensureEnginesForScene?: (workspaceKey: BrainWorkspaceKey) => Promise<Array<{ engineId: string; executable: string; source: string; version: string }>>;
  runSceneMediaGeneration?: (input: {
    projectId: string;
    kind: "video" | "music" | "image";
    prompt: string;
    model?: string;
    shotIndex?: number;
  }) => Promise<{ content: string; kind: string }>;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} payload is invalid.`);
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown, label: string) {
  return value === undefined || value === null ? {} : requireRecord(value, label);
}

function requireString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  return value.trim();
}

function optionalString(value: unknown, field: string) {
  if (value === undefined) return undefined;
  return requireString(value, field);
}

function rejectUnexpectedKeys(input: Record<string, unknown>, allowed: readonly string[], label: string) {
  const unexpected = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new TypeError(`${label} contains unsupported fields: ${unexpected.join(", ")}`);
}

function parseGamePreviewStart(value: unknown) {
  const input = requireRecord(value, "Game preview start");
  rejectUnexpectedKeys(input, ["projectId", "conversationId"], "Game preview start");
  return {
    projectId: requireString(input.projectId, "projectId"),
    conversationId: optionalString(input.conversationId, "conversationId")
  };
}

function parseFlowSave(value: unknown) {
  const input = requireRecord(value, "Flow save");
  rejectUnexpectedKeys(input, ["projectId", "id", "name", "definition"], "Flow save");
  const definition = input.definition as BrainFlowDefinition;
  validateFlowDefinition(definition);
  return { projectId: requireString(input.projectId, "projectId"), id: optionalString(input.id, "id"), name: requireString(input.name, "name"), definition };
}

function parseFlowStart(value: unknown) {
  const input = requireRecord(value, "Flow start");
  rejectUnexpectedKeys(input, ["flowId", "values"], "Flow start");
  const values = input.values === undefined ? undefined : requireRecord(input.values, "values");
  if (JSON.stringify(values || {}).length > 64 * 1024) throw new TypeError("Flow values exceed the allowed size.");
  return { flowId: requireString(input.flowId, "flowId"), values };
}

function parseFlowId(value: unknown, field: "flowId" | "runId") {
  const input = requireRecord(value, "Flow identifier");
  rejectUnexpectedKeys(input, [field], "Flow identifier");
  return requireString(input[field], field);
}
function parseFlowScheduleCreate(value: unknown) {
  const input = requireRecord(value, "Flow schedule create");
  rejectUnexpectedKeys(input, ["projectId", "flowId", "timezone", "runAt", "enabled"], "Flow schedule create");
  const runAt = requireString(input.runAt, "runAt");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(runAt)) throw new TypeError("runAt must use HH:mm.");
  const timezone = input.timezone === undefined ? undefined : requireString(input.timezone, "timezone");
  const enabled = input.enabled === undefined ? undefined : input.enabled === true;
  return { projectId: requireString(input.projectId, "projectId"), flowId: requireString(input.flowId, "flowId"), runAt, ...(timezone ? { timezone } : {}), ...(enabled === undefined ? {} : { enabled }) };
}

function parseGamePreviewProject(value: unknown) {
  const input = requireRecord(value, "Game preview");
  rejectUnexpectedKeys(input, ["projectId"], "Game preview");
  return { projectId: requireString(input.projectId, "projectId") };
}

function parseVideoTimelineProject(value: unknown) {
  const input = requireRecord(value, "Video timeline");
  rejectUnexpectedKeys(input, ["projectId"], "Video timeline");
  return { projectId: requireString(input.projectId, "projectId") };
}

function parseVideoTimelineSave(value: unknown) {
  const input = requireRecord(value, "Video timeline save");
  rejectUnexpectedKeys(input, ["projectId", "title", "width", "height", "fps"], "Video timeline save");
  return {
    projectId: requireString(input.projectId, "projectId"),
    title: requireString(input.title, "title"),
    width: requireFiniteNumber(input.width, "width"),
    height: requireFiniteNumber(input.height, "height"),
    fps: requireFiniteNumber(input.fps, "fps")
  };
}

function parseVideoClipAdd(value: unknown) {
  const input = requireRecord(value, "Video clip add");
  rejectUnexpectedKeys(input, ["projectId", "trackType", "sourceFileId", "startMs", "durationMs", "sourceInMs", "volume", "text"], "Video clip add");
  return {
    projectId: requireString(input.projectId, "projectId"),
    trackType: input.trackType,
    sourceFileId: requireString(input.sourceFileId, "sourceFileId"),
    startMs: requireFiniteNumber(input.startMs, "startMs"),
    durationMs: requireFiniteNumber(input.durationMs, "durationMs"),
    sourceInMs: requireFiniteNumber(input.sourceInMs, "sourceInMs"),
    volume: input.volume === undefined ? undefined : requireFiniteNumber(input.volume, "volume"),
    text: input.text === undefined ? undefined : requireString(input.text, "text")
  };
}

function parseVideoRenderStart(value: unknown) {
  const input = requireRecord(value, "Video render start");
  rejectUnexpectedKeys(input, ["projectId", "outputRelativePath", "source", "mediaRelativePaths"], "Video render start");
  const sourceRaw = input.source === undefined ? "timeline" : requireString(input.source, "source");
  if (sourceRaw !== "timeline" && sourceRaw !== "pipeline") throw new TypeError("source must be timeline or pipeline.");
  let mediaRelativePaths: string[] | undefined;
  if (input.mediaRelativePaths !== undefined) {
    if (!Array.isArray(input.mediaRelativePaths)) throw new TypeError("mediaRelativePaths must be an array.");
    mediaRelativePaths = input.mediaRelativePaths.map((item, index) => requireString(item, `mediaRelativePaths[${index}]`));
  }
  return {
    projectId: requireString(input.projectId, "projectId"),
    outputRelativePath: requireString(input.outputRelativePath, "outputRelativePath"),
    source: sourceRaw as "timeline" | "pipeline",
    mediaRelativePaths
  };
}

function parseSceneMediaGenerate(value: unknown) {
  const input = requireRecord(value, "Scene media generate");
  rejectUnexpectedKeys(input, ["projectId", "kind", "prompt", "model", "shotIndex"], "Scene media generate");
  const kind = requireString(input.kind, "kind");
  if (kind !== "video" && kind !== "music" && kind !== "image") throw new TypeError("kind must be video, music, or image.");
  const shotIndex = input.shotIndex === undefined ? undefined : requireFiniteNumber(input.shotIndex, "shotIndex");
  if (shotIndex !== undefined && (!Number.isInteger(shotIndex) || shotIndex < 0)) {
    throw new TypeError("shotIndex must be a non-negative integer.");
  }
  return {
    projectId: requireString(input.projectId, "projectId"),
    kind: kind as "video" | "music" | "image",
    prompt: requireString(input.prompt, "prompt"),
    model: optionalString(input.model, "model"),
    shotIndex
  };
}
function parseMusicProject(value: unknown) { const input = requireRecord(value, "Music timeline"); rejectUnexpectedKeys(input, ["projectId"], "Music timeline"); return { projectId: requireString(input.projectId, "projectId") }; }
function parseMusicSave(value: unknown) { const input = requireRecord(value, "Music timeline save"); rejectUnexpectedKeys(input, ["projectId", "title", "sampleRate", "channels"], "Music timeline save"); if (input.channels !== 1 && input.channels !== 2) throw new TypeError("channels must be 1 or 2."); return { projectId: requireString(input.projectId, "projectId"), title: requireString(input.title, "title"), sampleRate: requireFiniteNumber(input.sampleRate, "sampleRate"), channels: input.channels as 1 | 2 }; }
function parseMusicClip(value: unknown) { const input = requireRecord(value, "Music clip add"); rejectUnexpectedKeys(input, ["projectId", "trackType", "sourceFileId", "startMs", "durationMs", "sourceInMs", "gain", "pan"], "Music clip add"); return { projectId: requireString(input.projectId, "projectId"), trackType: input.trackType, sourceFileId: requireString(input.sourceFileId, "sourceFileId"), startMs: requireFiniteNumber(input.startMs, "startMs"), durationMs: requireFiniteNumber(input.durationMs, "durationMs"), sourceInMs: requireFiniteNumber(input.sourceInMs, "sourceInMs"), gain: requireFiniteNumber(input.gain, "gain"), pan: requireFiniteNumber(input.pan, "pan") }; }
function parseDataset(value: unknown): BrainDataset { const input = requireRecord(value, "Dataset save"); rejectUnexpectedKeys(input, ["id", "projectId", "name", "columns", "rowCount", "sourceFileId", "sourceSheet", "contentHash", "updatedAt"], "Dataset save"); return normalizeDataset({ id: requireString(input.id, "id"), projectId: requireString(input.projectId, "projectId"), name: requireString(input.name, "name"), columns: input.columns as BrainDataset["columns"], rowCount: requireFiniteNumber(input.rowCount, "rowCount"), sourceFileId: optionalString(input.sourceFileId, "sourceFileId"), sourceSheet: optionalString(input.sourceSheet, "sourceSheet"), contentHash: requireString(input.contentHash, "contentHash"), updatedAt: requireString(input.updatedAt, "updatedAt") }); }

function requireWorkspaceKey(value: unknown): BrainWorkspaceKey {
  if (typeof value === "string" && (brainWorkspaceKeys as readonly string[]).includes(value)) return value as BrainWorkspaceKey;
  throw new TypeError("workspaceKey is unsupported.");
}

function optionalWorkspaceKey(value: unknown) {
  return value === undefined ? undefined : requireWorkspaceKey(value);
}

function parseProjectList(value: unknown): BrainProjectListInput {
  const input = optionalRecord(value, "Project list");
  if (input.includeArchived !== undefined && typeof input.includeArchived !== "boolean") {
    throw new TypeError("includeArchived must be boolean.");
  }
  return {
    workspaceKey: optionalWorkspaceKey(input.workspaceKey),
    includeArchived: input.includeArchived === true
  };
}

function parseProjectCreate(value: unknown): BrainProjectCreateInput {
  const input = requireRecord(value, "Project create");
  return {
    name: requireString(input.name, "name"),
    primaryWorkspaceKey: requireWorkspaceKey(input.primaryWorkspaceKey),
    localWorkspaceId: optionalString(input.localWorkspaceId, "localWorkspaceId")
  };
}

function parseProjectGet(value: unknown): BrainProjectGetInput {
  const input = requireRecord(value, "Project");
  return { projectId: requireString(input.projectId, "projectId") };
}

function parseGameUnrealTemplateCreate(value: unknown): BrainGameUnrealTemplateCreateInput {
  const input = requireRecord(value, "Unreal template");
  rejectUnexpectedKeys(input, ["projectId", "projectName", "engineAssociation"], "Unreal template");
  return {
    projectId: requireString(input.projectId, "projectId"),
    projectName: optionalString(input.projectName, "projectName"),
    engineAssociation: optionalString(input.engineAssociation, "engineAssociation")
  };
}

const gameDesignSectionKeys = ["design", "world", "level", "combat"] as const;

function loadGameDesignSections(storage: BrainWorkspaceStorage, ownerId: string, projectId: string) {
  return gameDesignSectionKeys.map((sectionKey) => {
    const section = storage.getWorkspaceSection({ ownerId, projectId, workspaceKey: "game", sectionKey });
    return { sectionKey, content: section.content, revision: section.revision };
  });
}

function parseWorkspaceSectionGet(value: unknown): BrainWorkspaceSectionGetInput {
  const input = requireRecord(value, "Workspace section");
  rejectUnexpectedKeys(input, ["projectId", "workspaceKey", "sectionKey"], "Workspace section");
  return {
    projectId: requireString(input.projectId, "projectId"),
    workspaceKey: requireWorkspaceKey(input.workspaceKey),
    sectionKey: requireString(input.sectionKey, "sectionKey")
  };
}

function parseWorkspaceSectionSave(value: unknown): BrainWorkspaceSectionSaveInput {
  const input = requireRecord(value, "Workspace section save");
  rejectUnexpectedKeys(input, ["projectId", "workspaceKey", "sectionKey", "content", "expectedRevision"], "Workspace section save");
  if (typeof input.content !== "string") throw new TypeError("content must be a string.");
  const expectedRevision = requireFiniteNumber(input.expectedRevision, "expectedRevision");
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new TypeError("expectedRevision must be a non-negative integer.");
  return {
    projectId: requireString(input.projectId, "projectId"),
    workspaceKey: requireWorkspaceKey(input.workspaceKey),
    sectionKey: requireString(input.sectionKey, "sectionKey"),
    content: input.content,
    expectedRevision
  };
}

function parseProjectUpdate(value: unknown): BrainProjectUpdateInput {
  const input = requireRecord(value, "Project update");
  const status = input.status;
  if (status !== undefined && status !== "ACTIVE" && status !== "ARCHIVED") throw new TypeError("status is unsupported.");
  return {
    projectId: requireString(input.projectId, "projectId"), name: optionalString(input.name, "name"), status,
    localWorkspaceId: optionalString(input.localWorkspaceId, "localWorkspaceId")
  };
}

function parseProjectWorkspace(value: unknown): BrainProjectWorkspaceInput {
  const input = requireRecord(value, "Project workspace");
  if (typeof input.enabled !== "boolean") throw new TypeError("enabled must be boolean.");
  return {
    projectId: requireString(input.projectId, "projectId"),
    workspaceKey: requireWorkspaceKey(input.workspaceKey),
    enabled: input.enabled
  };
}

function parseConversationCreate(value: unknown): BrainConversationCreateInput {
  const input = requireRecord(value, "Conversation create");
  return {
    projectId: requireString(input.projectId, "projectId"),
    title: requireString(input.title, "title"),
    workspaceKey: optionalWorkspaceKey(input.workspaceKey)
  };
}

function parseConversationList(value: unknown): BrainConversationListInput {
  const input = optionalRecord(value, "Conversation list");
  if (input.includeArchived !== undefined && typeof input.includeArchived !== "boolean") {
    throw new TypeError("includeArchived must be boolean.");
  }
  return {
    projectId: optionalString(input.projectId, "projectId"),
    workspaceKey: optionalWorkspaceKey(input.workspaceKey),
    includeArchived: input.includeArchived === true
  };
}

function parseConversationGet(value: unknown): BrainConversationGetInput {
  const input = requireRecord(value, "Conversation");
  return { conversationId: requireString(input.conversationId, "conversationId") };
}

function parseMessageAppend(value: unknown): BrainMessageAppendInput {
  const input = requireRecord(value, "Message append");
  if (input.role !== "system" && input.role !== "user" && input.role !== "assistant" && input.role !== "tool") {
    throw new TypeError("role is unsupported.");
  }
  return {
    conversationId: requireString(input.conversationId, "conversationId"),
    role: input.role,
    content: typeof input.content === "string" ? input.content : (() => { throw new TypeError("content must be a string."); })(),
    toolCallsJson: input.toolCallsJson === undefined ? undefined : requireString(input.toolCallsJson, "toolCallsJson"),
    sourceRefsJson: input.sourceRefsJson === undefined ? undefined : requireString(input.sourceRefsJson, "sourceRefsJson"),
    requestId: input.requestId === undefined ? undefined : requireString(input.requestId, "requestId")
  };
}

function parseDraftSave(value: unknown): BrainDraftSaveInput {
  const input = requireRecord(value, "Draft save");
  if (typeof input.content !== "string") throw new TypeError("content must be a string.");
  return {
    projectId: requireString(input.projectId, "projectId"),
    conversationId: requireString(input.conversationId, "conversationId"),
    content: input.content
  };
}

function requireFiniteNumber(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${field} must be a finite number.`);
  return value;
}

function parseFileRegister(value: unknown): BrainFileRegisterInput {
  const input = requireRecord(value, "File register");
  return {
    projectId: requireString(input.projectId, "projectId"), logicalName: requireString(input.logicalName, "logicalName"),
    mimeType: requireString(input.mimeType, "mimeType"), sizeBytes: requireFiniteNumber(input.sizeBytes, "sizeBytes"),
    contentHash: requireString(input.contentHash, "contentHash"), storageKey: requireString(input.storageKey, "storageKey"),
    versionNo: input.versionNo === undefined ? undefined : requireFiniteNumber(input.versionNo, "versionNo")
  };
}

function parseTaskCreate(value: unknown): BrainTaskCreateInput {
  const input = requireRecord(value, "Task create");
  return {
    projectId: requireString(input.projectId, "projectId"),
    conversationId: optionalString(input.conversationId, "conversationId"),
    workspaceKey: requireWorkspaceKey(input.workspaceKey), taskType: requireString(input.taskType, "taskType"),
    requestId: optionalString(input.requestId, "requestId"), idempotencyKey: requireString(input.idempotencyKey, "idempotencyKey"),
    maxAttempts: input.maxAttempts === undefined ? undefined : requireFiniteNumber(input.maxAttempts, "maxAttempts"),
    resourceLimitsJson: optionalString(input.resourceLimitsJson, "resourceLimitsJson")
  };
}

function parseTaskUpdate(value: unknown): BrainTaskUpdateInput {
  const input = requireRecord(value, "Task update");
  const statuses = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"];
  if (typeof input.status !== "string" || !statuses.includes(input.status)) throw new TypeError("status is unsupported.");
  return {
    taskId: requireString(input.taskId, "taskId"), status: input.status as BrainTaskUpdateInput["status"],
    progress: input.progress === undefined ? undefined : requireFiniteNumber(input.progress, "progress"),
    errorCode: optionalString(input.errorCode, "errorCode"), errorDetail: optionalString(input.errorDetail, "errorDetail")
  };
}

function parseArtifactRegister(value: unknown): BrainArtifactRegisterInput {
  const input = requireRecord(value, "Artifact register");
  return {
    projectId: requireString(input.projectId, "projectId"), taskId: optionalString(input.taskId, "taskId"),
    sourceFileId: optionalString(input.sourceFileId, "sourceFileId"),
    sourceWorkspaceKey: input.sourceWorkspaceKey === undefined ? undefined : requireWorkspaceKey(String(input.sourceWorkspaceKey)),
    artifactType: requireString(input.artifactType, "artifactType"),
    storageKey: requireString(input.storageKey, "storageKey"), contentHash: requireString(input.contentHash, "contentHash"),
    validationStatus: optionalString(input.validationStatus, "validationStatus")
  };
}

function withoutOwner<T extends { ownerId: string }>(value: T): Omit<T, "ownerId"> {
  const { ownerId: _ownerId, ...safe } = value;
  return safe;
}

export function registerBrainWorkspaceIpcHandlers(dependencies: BrainWorkspaceIpcDependencies): FlowExecutionService | undefined {
  const ownerId = () => Promise.resolve(dependencies.resolveOwnerId()).then((value) => requireString(value, "ownerId"));
  /** Resolve a project's on-disk root, rebinding catalog workspace by name when the stored id is stale. */
  const resolveBoundProjectRoot = async (owner: string, project: { id: string; name: string; localWorkspaceId: string }) => {
    const catalog = dependencies.readWorkspaceCatalog
      ? await dependencies.readWorkspaceCatalog()
      : { workspaces: [] as Array<{ id: string; name: string; path: string }> };
    const workspaces = Array.isArray(catalog.workspaces) ? catalog.workspaces : [];
    if (dependencies.readWorkspaceCatalog) {
      dependencies.storage.importUnboundCatalog({ ownerId: owner, workspaces });
    }
    const tryResolve = (workspaceId: string) => dependencies.resolveWorkspaceRoot(workspaceId);
    const boundId = String(project.localWorkspaceId || "").trim();
    if (boundId) {
      try {
        return await tryResolve(boundId);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "BRAIN_LOCAL_WORKSPACE_NOT_AUTHORIZED") throw error;
      }
    }
    const normalizedName = project.name.trim().toLowerCase();
    const matched = workspaces.find((item) => String(item.name || "").trim().toLowerCase() === normalizedName)
      || workspaces.find((item) => String(item.path || "").replace(/\\/g, "/").toLowerCase().endsWith(`/${normalizedName}`));
    if (!matched?.id) {
      throw new Error(boundId ? "BRAIN_LOCAL_WORKSPACE_NOT_AUTHORIZED" : "BRAIN_LOCAL_WORKSPACE_REQUIRED");
    }
    if (matched.id !== boundId) {
      dependencies.storage.updateProject({ ownerId: owner, projectId: project.id, localWorkspaceId: matched.id });
    }
    return tryResolve(matched.id);
  };
  const revisions = new BrainDocumentRevisionService(dependencies);
  const flowExecution = dependencies.flowExecution ?? (dependencies.confirmFlowApproval ? new FlowExecutionService({
    storage: dependencies.storage,
    confirmApproval: (input) => dependencies.confirmFlowApproval!({ ...input, nodeId: input.node.id }),
    tools: {
      "software.inspect-scripts": { execute: async (_input, _context, binding) => {
        const project = dependencies.storage.getProject(binding.ownerId, binding.projectId);
        if (!project.localWorkspaceId) throw new Error("BRAIN_LOCAL_WORKSPACE_REQUIRED");
        return discoverSoftwareScripts(await dependencies.resolveWorkspaceRoot(project.localWorkspaceId));
      } },
      "software.delay": { execute: async (input, _context, binding) => {
        const milliseconds = typeof input === "number" ? input : (input && typeof input === "object" && "milliseconds" in input ? Number((input as { milliseconds?: unknown }).milliseconds) : NaN);
        if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > 30_000) throw new Error("FLOW_DELAY_INPUT_INVALID");
        if (binding.signal.aborted) throw binding.signal.reason ?? new Error("BRAIN_FLOW_CANCELLED");
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, milliseconds);
          const abort = () => { clearTimeout(timer); reject(binding.signal.reason ?? new Error("BRAIN_FLOW_CANCELLED")); };
          binding.signal.addEventListener("abort", abort, { once: true });
        });
        return { delayedMs: milliseconds };
      } }
    }
  }) : null);
  const gameRuntime = dependencies.acquireRustCore
    ? new GameRuntimeService((binding) => dependencies.acquireRustCore!(binding) as any)
    : null;
  const videoRuntime = dependencies.acquireRustCore
    ? new VideoRuntimeService((binding) => dependencies.acquireRustCore!(binding) as any)
    : null;
  const musicRuntime = dependencies.acquireRustCore
    ? new MusicRuntimeService((binding) => dependencies.acquireRustCore!(binding) as any)
    : null;
  const dataRuntime = dependencies.acquireRustCore
    ? new DataRuntimeService((binding) => dependencies.acquireRustCore!(binding) as any)
    : null;
  const gamePreviews = dependencies.acquireRustCore && dependencies.confirmGamePreview
    ? new GamePreviewService({
      storage: dependencies.storage,
      resolveWorkspaceRoot: dependencies.resolveWorkspaceRoot,
      acquireRustCore: dependencies.acquireRustCore,
      confirmStart: dependencies.confirmGamePreview,
      inspectProject: inspectGameProject,
      platform: dependencies.platform
    })
    : null;
  const softwareTasks = dependencies.acquireRustCore && dependencies.confirmSoftwareTask
    ? new SoftwareTaskService({ storage: dependencies.storage, resolveWorkspaceRoot: dependencies.resolveWorkspaceRoot, acquireRustCore: dependencies.acquireRustCore as any, confirmRun: dependencies.confirmSoftwareTask, platform: dependencies.platform })
    : null;
  if (gamePreviews || softwareTasks || dependencies.videoRender || dependencies.musicRender) {
    // Reconcile game preview tasks before rebuilding the broader workspace state.
    // The storage operation is idempotent; restoreWorkspaceAfterRestart also covers
    // the aggregate recovery path used by non-game task owners.
    if (gamePreviews) dependencies.storage.reconcileInterruptedGamePreviews();
    dependencies.storage.restoreWorkspaceAfterRestart();
  }
  dependencies.storage.pruneRetention();
  ipcMain.handle(brainWorkspaceIpcChannels.workspaceList, async () => {
    if (dependencies.readWorkspaceCatalog) {
      const catalog = await dependencies.readWorkspaceCatalog();
      dependencies.storage.importUnboundCatalog({
        ownerId: await ownerId(),
        workspaces: catalog.workspaces || []
      });
    }
    return dependencies.storage.listWorkspaces();
  });
  ipcMain.handle(brainWorkspaceIpcChannels.projectList, async (_event, value: unknown) =>
    dependencies.storage.listProjects({ ownerId: await ownerId(), ...parseProjectList(value) }).map(withoutOwner));
  ipcMain.handle(brainWorkspaceIpcChannels.projectCreate, async (_event, value: unknown) => {
    const input = parseProjectCreate(value);
    if (input.localWorkspaceId) await dependencies.resolveWorkspaceRoot(input.localWorkspaceId);
    return withoutOwner(dependencies.storage.createProject({ ownerId: await ownerId(), ...input }));
  });
  ipcMain.handle(brainWorkspaceIpcChannels.projectGet, async (_event, value: unknown) =>
    withoutOwner(dependencies.storage.getProject(await ownerId(), parseProjectGet(value).projectId)));
  ipcMain.handle(brainWorkspaceIpcChannels.projectUpdate, async (_event, value: unknown) => {
    const input = parseProjectUpdate(value);
    if (input.localWorkspaceId) await dependencies.resolveWorkspaceRoot(input.localWorkspaceId);
    return withoutOwner(dependencies.storage.updateProject({ ownerId: await ownerId(), ...input }));
  });
  ipcMain.handle(brainWorkspaceIpcChannels.projectWorkspaceEnable, async (_event, value: unknown) => {
    dependencies.storage.setProjectWorkspace({ ownerId: await ownerId(), ...parseProjectWorkspace(value) });
    return { ok: true };
  });
  ipcMain.handle(brainWorkspaceIpcChannels.workspaceSectionGet, async (_event, value: unknown) =>
    dependencies.storage.getWorkspaceSection({ ownerId: await ownerId(), ...parseWorkspaceSectionGet(value) }));
  ipcMain.handle(brainWorkspaceIpcChannels.workspaceSectionSave, async (_event, value: unknown) =>
    dependencies.storage.saveWorkspaceSection({ ownerId: await ownerId(), ...parseWorkspaceSectionSave(value) }));
  ipcMain.handle(brainWorkspaceIpcChannels.conversationCreate, async (_event, value: unknown) =>
    withoutOwner(dependencies.storage.createConversation({ ownerId: await ownerId(), ...parseConversationCreate(value) })));
  ipcMain.handle(brainWorkspaceIpcChannels.conversationList, async (_event, value: unknown) =>
    dependencies.storage.listConversations({ ownerId: await ownerId(), ...parseConversationList(value) }).map(withoutOwner));
  ipcMain.handle(brainWorkspaceIpcChannels.conversationGet, async (_event, value: unknown) =>
    withoutOwner(dependencies.storage.getConversation(await ownerId(), parseConversationGet(value).conversationId)));
  ipcMain.handle(brainWorkspaceIpcChannels.messageList, async (_event, value: unknown) => {
    const input = parseConversationGet(value);
    return dependencies.storage.listMessages(await ownerId(), input.conversationId);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.messageAppend, async (_event, value: unknown) => {
    const input = parseMessageAppend(value);
    return dependencies.storage.appendMessage({
      ownerId: await ownerId(),
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      toolCallsJson: input.toolCallsJson ?? "[]",
      sourceRefsJson: input.sourceRefsJson ?? "[]",
      requestId: input.requestId ?? ""
    });
  });
  const rustConversation = dependencies.rustConversation;
  if (rustConversation) {
    ipcMain.handle(brainWorkspaceIpcChannels.rustConversation, async (_event, value: unknown) => {
      const input = requireRecord(value, "Rust conversation");
      const projectId = requireString(input.projectId, "projectId");
      const project = dependencies.storage.getProject(await ownerId(), projectId);
      if (!project.localWorkspaceId) throw new Error("BRAIN_LOCAL_WORKSPACE_REQUIRED");
      const projectRoot = await dependencies.resolveWorkspaceRoot(project.localWorkspaceId);
      return rustConversation({ projectId, projectRoot, workspaceType: requireString(input.workspaceType, "workspaceType"), operation: requireString(input.operation, "operation") as `conversation.${string}`, payload: requireRecord(input.payload, "payload") });
    });
  }
  ipcMain.handle(brainWorkspaceIpcChannels.draftGet, async (_event, value: unknown) => {
    const input = parseConversationGet(value);
    return dependencies.storage.readDraft(await ownerId(), input.conversationId);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.draftSave, async (_event, value: unknown) => {
    dependencies.storage.saveDraft({ ownerId: await ownerId(), ...parseDraftSave(value) });
    return { ok: true };
  });
  ipcMain.handle(brainWorkspaceIpcChannels.fileList, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    return dependencies.storage.listFiles(await ownerId(), input.projectId).map(withoutOwner);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.fileRegister, async (_event, value: unknown) =>
    withoutOwner(dependencies.storage.registerFile({ ownerId: await ownerId(), ...parseFileRegister(value) })));
  if (dependencies.ingestDocument) {
    ipcMain.handle(brainWorkspaceIpcChannels.fileIngest, async (_event, value: unknown) => {
      const input = requireRecord(value, "File ingest");
      const projectId = requireString(input.projectId, "projectId");
      const fileId = requireString(input.fileId, "fileId");
      const owner = await ownerId();
      const project = dependencies.storage.getProject(owner, projectId);
      if (!project.localWorkspaceId) throw new Error("BRAIN_LOCAL_WORKSPACE_REQUIRED");
      const file = dependencies.storage.getFile(owner, projectId, fileId);
      const projectRoot = await dependencies.resolveWorkspaceRoot(project.localWorkspaceId);
      const requestedMax = input.maxBytes === undefined ? 5 * 1024 * 1024 : requireFiniteNumber(input.maxBytes, "maxBytes");
      const maxBytes = Math.min(Math.max(Math.floor(requestedMax), 1), 20 * 1024 * 1024);
      const result = await dependencies.ingestDocument({ requestId: `brain-document-${randomUUID()}`, projectRoot, relativePath: file.storageKey, maxBytes });
      if (result.status !== "completed" || !result.format || result.text === undefined || !result.anchors || !result.warnings) {
        throw new Error(result.error_code || "BRAIN_DOCUMENT_INGEST_FAILED");
      }
      dependencies.storage.recordFileIngestResult({
        ownerId: owner, projectId, fileId, format: result.format, text: result.text,
        anchors: result.anchors, warnings: result.warnings
      });
      return { format: result.format, text: result.text, anchors: result.anchors, warnings: result.warnings };
    });
  }
  ipcMain.handle(brainWorkspaceIpcChannels.taskList, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    return dependencies.storage.listTasks(await ownerId(), input.projectId);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.taskCreate, async (_event, value: unknown) =>
    dependencies.storage.createTask({ ownerId: await ownerId(), ...parseTaskCreate(value) }));
  ipcMain.handle(brainWorkspaceIpcChannels.taskUpdate, async (_event, value: unknown) =>
    dependencies.storage.updateTask({ ownerId: await ownerId(), ...parseTaskUpdate(value) }));
  ipcMain.handle(brainWorkspaceIpcChannels.artifactList, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    return dependencies.storage.listArtifacts(await ownerId(), input.projectId);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.artifactRegister, async (_event, value: unknown) =>
    dependencies.storage.registerArtifact({ ownerId: await ownerId(), ...parseArtifactRegister(value) }));
  ipcMain.handle(brainWorkspaceIpcChannels.gameProjectInspect, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    const owner = await ownerId();
    const project = dependencies.storage.getProject(owner, input.projectId);
    const gameProjects = dependencies.storage.listProjects({ ownerId: owner, workspaceKey: "game", includeArchived: false });
    if (!gameProjects.some((candidate) => candidate.id === project.id)) throw new Error("BRAIN_GAME_WORKSPACE_REQUIRED");
    if (!project.localWorkspaceId) throw new Error("BRAIN_LOCAL_WORKSPACE_REQUIRED");
    const projectRoot = await dependencies.resolveWorkspaceRoot(project.localWorkspaceId);
    if (gameRuntime) {
      const core = await gameRuntime.inspect({ projectId: project.id, projectRoot });
      const legacy = await inspectGameProject(projectRoot).catch(() => null);
      return {
        schemaVersion: 1 as const,
        engine: core.engine,
        displayName: core.displayName,
        markers: core.markers,
        assets: core.assets,
        preview: legacy?.preview ?? { supported: false, requiresApproval: true },
        warnings: legacy?.warnings ?? (core.engine === "unreal" ? ["未配置可验证的 Unreal Editor，暂不生成试玩命令。"] : []),
        scannedEntries: core.scannedEntries,
        skippedEntries: legacy?.skippedEntries ?? 0,
        truncated: core.truncated
      };
    }
    if (dependencies.ensureEngine) {
      try {
        const { readdir } = await import("node:fs/promises");
        const entries = await readdir(projectRoot, { withFileTypes: true });
        const hasUproject = entries.some((entry) => entry.isFile() && entry.name.endsWith(".uproject"));
        const hasGodot = entries.some((entry) => entry.isFile() && entry.name === "project.godot");
        const hasWeb = entries.some((entry) => entry.isFile() && entry.name === "package.json");
        if (hasUproject) await dependencies.ensureEngine("epic-launcher").catch(() => undefined);
        if (hasGodot) {
          const resolved = await dependencies.ensureEngine("godot").catch(() => null);
          if (resolved?.executable) process.env.BRAIN_GODOT_EXECUTABLE = resolved.executable;
        }
        if (hasWeb) await dependencies.ensureEngine("node").catch(() => undefined);
      } catch { /* inspection still proceeds */ }
    }
    return inspectGameProject(projectRoot);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.filePreviewUrl, async (_event, value: unknown) => {
    const input = requireRecord(value, "File preview url");
    rejectUnexpectedKeys(input, ["projectId", "fileId"], "File preview url");
    const owner = await ownerId();
    const project = dependencies.storage.getProject(owner, requireString(input.projectId, "projectId"));
    if (!project.localWorkspaceId) throw new Error("BRAIN_LOCAL_WORKSPACE_REQUIRED");
    const file = dependencies.storage.getFile(owner, project.id, requireString(input.fileId, "fileId"));
    return buildWorkspaceArtifactPreviewUrl(project.localWorkspaceId, file.storageKey);
  });
  if (gamePreviews) {
    ipcMain.handle(brainWorkspaceIpcChannels.gamePreviewStart, async (_event, value: unknown) =>
      gamePreviews.start(await ownerId(), parseGamePreviewStart(value)));
    ipcMain.handle(brainWorkspaceIpcChannels.gamePreviewStatus, async (_event, value: unknown) =>
      gamePreviews.status(await ownerId(), parseGamePreviewProject(value).projectId));
    ipcMain.handle(brainWorkspaceIpcChannels.gamePreviewStop, async (_event, value: unknown) =>
      gamePreviews.stop(await ownerId(), parseGamePreviewProject(value).projectId));
  }
  ipcMain.handle(brainWorkspaceIpcChannels.gameWebTemplateCreate, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    const owner = await ownerId();
    const project = dependencies.storage.getProject(owner, input.projectId);
    const projectRoot = await resolveBoundProjectRoot(owner, project);
    if (!gameRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    return gameRuntime.scaffoldWeb({ projectId: project.id, projectRoot });
  });
  ipcMain.handle(brainWorkspaceIpcChannels.gameUnrealTemplateCreate, async (_event, value: unknown) => {
    const input = parseGameUnrealTemplateCreate(value);
    const owner = await ownerId();
    const project = dependencies.storage.getProject(owner, input.projectId);
    const projectRoot = await resolveBoundProjectRoot(owner, project);
    if (!gameRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    const sections = loadGameDesignSections(dependencies.storage, owner, project.id).map((section) => ({
      sectionKey: section.sectionKey as "design" | "world" | "level" | "combat",
      content: section.content,
      revision: section.revision
    }));
    return gameRuntime.scaffoldUnreal(
      { projectId: project.id, projectRoot },
      {
        projectName: input.projectName || project.name,
        engineAssociation: input.engineAssociation,
        sections,
        runCook: true
      }
    );
  });
  ipcMain.handle(brainWorkspaceIpcChannels.gameDesignExport, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    const owner = await ownerId();
    const project = dependencies.storage.getProject(owner, input.projectId);
    const projectRoot = await resolveBoundProjectRoot(owner, project);
    if (!gameRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    const sections = loadGameDesignSections(dependencies.storage, owner, project.id).map((section) => ({
      sectionKey: section.sectionKey as "design" | "world" | "level" | "combat",
      content: section.content,
      revision: section.revision
    }));
    return gameRuntime.cook({ projectId: project.id, projectRoot }, { sections });
  });
  ipcMain.handle(brainWorkspaceIpcChannels.gameLevelEditorGet, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    const owner = await ownerId();
    const project = dependencies.storage.getProject(owner, input.projectId);
    const projectRoot = await resolveBoundProjectRoot(owner, project);
    if (!gameRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    return gameRuntime.levelEditorGet({ projectId: project.id, projectRoot });
  });
  ipcMain.handle(brainWorkspaceIpcChannels.gameLevelEditorSave, async (_event, value: unknown) => {
    const input = requireRecord(value, "Game level editor save");
    rejectUnexpectedKeys(input, ["projectId", "state"], "Game level editor save");
    const owner = await ownerId();
    const project = dependencies.storage.getProject(owner, requireString(input.projectId, "projectId"));
    const projectRoot = await resolveBoundProjectRoot(owner, project);
    if (!gameRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    const state = requireRecord(input.state, "state");
    return gameRuntime.levelEditorSave({ projectId: project.id, projectRoot }, state as any);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.gameSpawnActor, async (_event, value: unknown) => {
    const input = requireRecord(value, "Game spawn actor");
    rejectUnexpectedKeys(input, ["projectId", "kind", "levelIndex"], "Game spawn actor");
    const kind = requireString(input.kind, "kind");
    if (kind !== "enemy" && kind !== "boss" && kind !== "npc") throw new TypeError("kind is unsupported.");
    const owner = await ownerId();
    const project = dependencies.storage.getProject(owner, requireString(input.projectId, "projectId"));
    const projectRoot = await resolveBoundProjectRoot(owner, project);
    if (!gameRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    const levelIndex = input.levelIndex == null ? 0 : Number(input.levelIndex);
    if (!Number.isInteger(levelIndex) || levelIndex < 0) throw new TypeError("levelIndex is invalid.");
    return gameRuntime.spawnActor({ projectId: project.id, projectRoot }, { kind, levelIndex });
  });
  ipcMain.handle(brainWorkspaceIpcChannels.gameContentTree, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    const owner = await ownerId();
    const project = dependencies.storage.getProject(owner, input.projectId);
    const projectRoot = await resolveBoundProjectRoot(owner, project);
    if (!gameRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    return gameRuntime.contentTree({ projectId: project.id, projectRoot });
  });
  const resolveRuntimeBinding = async (value: unknown, label: string) => {
    const input = requireRecord(value, label);
    const owner = await ownerId();
    const project = dependencies.storage.getProject(owner, requireString(input.projectId, "projectId"));
    return {
      input,
      binding: {
        projectId: project.id,
        projectRoot: await resolveBoundProjectRoot(owner, project)
      }
    };
  };
  ipcMain.handle(brainWorkspaceIpcChannels.videoPipelineGet, async (_event, value: unknown) => {
    const { input, binding } = await resolveRuntimeBinding(value, "Video pipeline get");
    rejectUnexpectedKeys(input, ["projectId"], "Video pipeline get");
    if (!videoRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    return videoRuntime.pipelineGet(binding);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.videoPipelineSave, async (_event, value: unknown) => {
    const { input, binding } = await resolveRuntimeBinding(value, "Video pipeline save");
    rejectUnexpectedKeys(input, ["projectId", "state"], "Video pipeline save");
    if (!videoRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    return videoRuntime.pipelineSave(binding, requireRecord(input.state, "state") as any);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.videoMarkShot, async (_event, value: unknown) => {
    const { input, binding } = await resolveRuntimeBinding(value, "Video mark shot");
    rejectUnexpectedKeys(input, ["projectId", "shotIndex", "ready"], "Video mark shot");
    const shotIndex = requireFiniteNumber(input.shotIndex, "shotIndex");
    if (!Number.isInteger(shotIndex) || shotIndex < 0) throw new TypeError("shotIndex must be a non-negative integer.");
    if (typeof input.ready !== "boolean") throw new TypeError("ready must be boolean.");
    if (!videoRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    return videoRuntime.markShot(binding, shotIndex, input.ready);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.videoPipelineCook, async (_event, value: unknown) => {
    const { input, binding } = await resolveRuntimeBinding(value, "Video pipeline cook");
    rejectUnexpectedKeys(input, ["projectId"], "Video pipeline cook");
    if (!videoRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    return videoRuntime.cook(binding);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.musicDawGet, async (_event, value: unknown) => {
    const { input, binding } = await resolveRuntimeBinding(value, "Music DAW get");
    rejectUnexpectedKeys(input, ["projectId"], "Music DAW get");
    if (!musicRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    return musicRuntime.dawGet(binding);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.musicDawSave, async (_event, value: unknown) => {
    const { input, binding } = await resolveRuntimeBinding(value, "Music DAW save");
    rejectUnexpectedKeys(input, ["projectId", "state"], "Music DAW save");
    if (!musicRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    return musicRuntime.dawSave(binding, requireRecord(input.state, "state") as any);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.musicDawCook, async (_event, value: unknown) => {
    const { input, binding } = await resolveRuntimeBinding(value, "Music DAW cook");
    rejectUnexpectedKeys(input, ["projectId"], "Music DAW cook");
    if (!musicRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    return musicRuntime.cook(binding);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.dataAnalysisGet, async (_event, value: unknown) => {
    const { input, binding } = await resolveRuntimeBinding(value, "Data analysis get");
    rejectUnexpectedKeys(input, ["projectId"], "Data analysis get");
    if (!dataRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    return dataRuntime.analysisGet(binding);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.dataAnalysisSave, async (_event, value: unknown) => {
    const { input, binding } = await resolveRuntimeBinding(value, "Data analysis save");
    rejectUnexpectedKeys(input, ["projectId", "state"], "Data analysis save");
    if (!dataRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    return dataRuntime.analysisSave(binding, requireRecord(input.state, "state") as any);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.dataAnalysisCook, async (_event, value: unknown) => {
    const { input, binding } = await resolveRuntimeBinding(value, "Data analysis cook");
    rejectUnexpectedKeys(input, ["projectId"], "Data analysis cook");
    if (!dataRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    return dataRuntime.cook(binding);
  });
  if (dependencies.discoverEngines) {
    ipcMain.handle(brainWorkspaceIpcChannels.environmentDiscover, async () => dependencies.discoverEngines!());
  }
  if (dependencies.ensureEngine) {
    ipcMain.handle(brainWorkspaceIpcChannels.environmentEnsure, async (_event, value: unknown) => {
      const input = requireRecord(value, "Environment ensure");
      return dependencies.ensureEngine!(requireString(input.engineId, "engineId"));
    });
  }
  if (dependencies.ensureEnginesForScene) {
    ipcMain.handle(brainWorkspaceIpcChannels.environmentEnsureScene, async (_event, value: unknown) => {
      const input = requireRecord(value, "Environment ensure scene");
      rejectUnexpectedKeys(input, ["workspaceKey"], "Environment ensure scene");
      const workspaceKey = requireString(input.workspaceKey, "workspaceKey") as BrainWorkspaceKey;
      if (!brainWorkspaceKeys.includes(workspaceKey)) throw new TypeError("workspaceKey is unsupported.");
      return dependencies.ensureEnginesForScene!(workspaceKey);
    });
  }
  if (dependencies.video) {
    ipcMain.handle(brainWorkspaceIpcChannels.videoTimelineGet, async (_event, value: unknown) => {
      const input = parseVideoTimelineProject(value);
      return dependencies.video!.getTimeline(await ownerId(), input.projectId);
    });
    ipcMain.handle(brainWorkspaceIpcChannels.videoTimelineSave, async (_event, value: unknown) => {
      const input = parseVideoTimelineSave(value);
      return dependencies.video!.ensureTimeline(await ownerId(), input.projectId, {
        title: input.title, width: input.width, height: input.height, fps: input.fps
      });
    });
    ipcMain.handle(brainWorkspaceIpcChannels.videoClipAdd, async (_event, value: unknown) => {
      const input = parseVideoClipAdd(value);
      if (input.trackType !== "video" && input.trackType !== "audio" && input.trackType !== "subtitle") {
        throw new TypeError("trackType is unsupported.");
      }
      return dependencies.video!.addClip(await ownerId(), input.projectId, {
        trackType: input.trackType,
        sourceFileId: input.sourceFileId,
        startMs: input.startMs,
        durationMs: input.durationMs,
        sourceInMs: input.sourceInMs,
        volume: input.volume,
        text: input.text
      });
    });
    ipcMain.handle(brainWorkspaceIpcChannels.videoSubtitleImport, async (_event, value: unknown) => {
      const input = requireRecord(value, "Video subtitle import");
      rejectUnexpectedKeys(input, ["projectId", "srt"], "Video subtitle import");
      const owner = await ownerId();
      return dependencies.video!.importSubtitlesFromSrt(
        owner,
        requireString(input.projectId, "projectId"),
        requireString(input.srt, "srt")
      );
    });
    ipcMain.handle(brainWorkspaceIpcChannels.videoSubtitleExport, async (_event, value: unknown) => {
      const input = parseVideoTimelineProject(value);
      return { srt: dependencies.video!.exportSubtitlesToSrt(await ownerId(), input.projectId) };
    });
  }
  if (dependencies.videoRender && dependencies.video) {
    ipcMain.handle(brainWorkspaceIpcChannels.videoRenderStart, async (_event, value: unknown) => {
      const input = parseVideoRenderStart(value);
      const owner = await ownerId();
      const project = dependencies.storage.getProject(owner, input.projectId);
      if (project.primaryWorkspaceKey !== "video") throw new Error("BRAIN_VIDEO_WORKSPACE_REQUIRED");
      if (!project.localWorkspaceId) throw new Error("BRAIN_LOCAL_WORKSPACE_REQUIRED");
      const projectRoot = await dependencies.resolveWorkspaceRoot(project.localWorkspaceId);
      const timeline = dependencies.video!.getTimeline(owner, input.projectId);
      let mediaRelativePaths = input.mediaRelativePaths;
      let allowSyntheticMedia = false;
      if (input.source === "pipeline") {
        allowSyntheticMedia = true;
        if (!mediaRelativePaths) {
          if (!videoRuntime) throw new Error("BRAIN_CORE_REQUIRED");
          const pipeline = await videoRuntime.pipelineGet({ projectId: project.id, projectRoot });
          const candidates = (pipeline.state?.shots || []).map((shot) => {
            const clip = String(shot.clip || "").replaceAll("\\", "/");
            const name = basename(clip) || clip;
            return name.includes("/") ? name : `media/clips/${name}`;
          }).filter(Boolean);
          mediaRelativePaths = [];
          for (const relative of candidates) {
            try {
              await access(join(projectRoot, relative));
              mediaRelativePaths.push(relative);
            } catch {
              // clip not on disk yet — skip
            }
          }
        }
      } else if (!mediaRelativePaths) {
        mediaRelativePaths = timeline.clips
          .filter((clip) => clip.trackType === "video")
          .map((clip) => dependencies.storage.getFile(owner, input.projectId, clip.sourceFileId).storageKey);
      }
      return dependencies.videoRender!.start(owner, {
        projectId: input.projectId,
        projectRoot,
        timeline,
        outputRelativePath: input.outputRelativePath,
        mediaRelativePaths,
        allowSyntheticMedia
      });
    });
    ipcMain.handle(brainWorkspaceIpcChannels.videoRenderStatus, async (_event, value: unknown) => {
      const input = requireRecord(value, "Video render status");
      rejectUnexpectedKeys(input, ["renderId"], "Video render status");
      return dependencies.videoRender!.status(await ownerId(), requireString(input.renderId, "renderId"));
    });
    ipcMain.handle(brainWorkspaceIpcChannels.videoRenderCancel, async (_event, value: unknown) => {
      const input = requireRecord(value, "Video render cancel");
      rejectUnexpectedKeys(input, ["renderId"], "Video render cancel");
      return dependencies.videoRender!.cancel(await ownerId(), requireString(input.renderId, "renderId"));
    });
  }
  if (dependencies.runSceneMediaGeneration) {
    ipcMain.handle(brainWorkspaceIpcChannels.sceneMediaGenerate, async (_event, value: unknown) => {
      const input = parseSceneMediaGenerate(value);
      const owner = await ownerId();
      dependencies.storage.getProject(owner, input.projectId);
      return dependencies.runSceneMediaGeneration!(input);
    });
  }
  if (dependencies.music) {
    ipcMain.handle(brainWorkspaceIpcChannels.musicTimelineGet, async (_event, value: unknown) => { const input = parseMusicProject(value); return dependencies.music!.getTimeline(await ownerId(), input.projectId); });
    ipcMain.handle(brainWorkspaceIpcChannels.musicTimelineSave, async (_event, value: unknown) => { const input = parseMusicSave(value); return dependencies.music!.ensureTimeline(await ownerId(), input.projectId, { title: input.title, sampleRate: input.sampleRate, channels: input.channels }); });
    ipcMain.handle(brainWorkspaceIpcChannels.musicClipAdd, async (_event, value: unknown) => { const input = parseMusicClip(value); if (input.trackType !== "audio" && input.trackType !== "midi") throw new TypeError("trackType is unsupported."); return dependencies.music!.addClip(await ownerId(), input.projectId, input); });
    if (dependencies.musicMedia) ipcMain.handle(brainWorkspaceIpcChannels.musicMediaInspect, async (_event, value: unknown) => { const input = requireRecord(value, "Music media inspect"); rejectUnexpectedKeys(input, ["projectId", "sourceFileId"], "Music media inspect"); return dependencies.musicMedia!.inspect(await ownerId(), requireString(input.projectId, "projectId"), requireString(input.sourceFileId, "sourceFileId")); });
    if (dependencies.musicRender) {
      ipcMain.handle(brainWorkspaceIpcChannels.musicRenderStart, async (_event, value: unknown) => {
        const input = requireRecord(value, "Music render start");
        rejectUnexpectedKeys(input, ["projectId", "outputRelativePath"], "Music render start");
        const owner = await ownerId();
        const project = dependencies.storage.getProject(owner, requireString(input.projectId, "projectId"));
        if (!project.localWorkspaceId) throw new Error("BRAIN_LOCAL_WORKSPACE_REQUIRED");
        const timeline = dependencies.music!.getTimeline(owner, project.id);
        const mediaRelativePaths = timeline.clips
          .filter((clip) => clip.trackType === "audio")
          .map((clip) => dependencies.storage.getFile(owner, project.id, clip.sourceFileId).storageKey);
        return dependencies.musicRender!.start(owner, {
          projectId: project.id,
          outputRelativePath: requireString(input.outputRelativePath, "outputRelativePath"),
          artifactType: "mix",
          timeline,
          mediaRelativePaths,
          projectRoot: await dependencies.resolveWorkspaceRoot(project.localWorkspaceId)
        });
      });
      ipcMain.handle(brainWorkspaceIpcChannels.musicRenderStatus, async (_event, value: unknown) => { const input = requireRecord(value, "Music render status"); return dependencies.musicRender!.status(await ownerId(), requireString(input.renderId, "renderId")); });
      ipcMain.handle(brainWorkspaceIpcChannels.musicRenderCancel, async (_event, value: unknown) => { const input = requireRecord(value, "Music render cancel"); return dependencies.musicRender!.cancel(await ownerId(), requireString(input.renderId, "renderId")); });
    }
  }
  ipcMain.handle(brainWorkspaceIpcChannels.dataDatasetList, async (_event, value: unknown) => { const input = parseProjectGet(value); return dependencies.storage.listDatasets(await ownerId(), input.projectId); });
  ipcMain.handle(brainWorkspaceIpcChannels.dataDatasetSave, async (_event, value: unknown) => { const dataset = parseDataset(value); return dependencies.storage.saveDataset({ ownerId: await ownerId(), dataset }); });
  if (dependencies.dataAnalysis) {
    ipcMain.handle(brainWorkspaceIpcChannels.dataAnalysisSummarize, async (_event, value: unknown) => { const input = requireRecord(value, "Data analysis summarize"); rejectUnexpectedKeys(input, ["projectId", "datasetId"], "Data analysis summarize"); return dependencies.dataAnalysis!.summarize(await ownerId(), requireString(input.projectId, "projectId"), requireString(input.datasetId, "datasetId")); });
    ipcMain.handle(brainWorkspaceIpcChannels.dataAnalysisList, async (_event, value: unknown) => { const input = requireRecord(value, "Data analysis list"); rejectUnexpectedKeys(input, ["projectId", "datasetId"], "Data analysis list"); return dependencies.dataAnalysis!.list(await ownerId(), requireString(input.projectId, "projectId"), requireString(input.datasetId, "datasetId")); });
  }
  ipcMain.handle(brainWorkspaceIpcChannels.softwareScriptsList, async (_event, value: unknown) => { const input = parseProjectGet(value); const owner = await ownerId(); const project = dependencies.storage.getProject(owner, input.projectId); if (project.primaryWorkspaceKey !== "software") throw new Error("BRAIN_SOFTWARE_WORKSPACE_REQUIRED"); if (!project.localWorkspaceId) throw new Error("BRAIN_LOCAL_WORKSPACE_REQUIRED"); const root = await dependencies.resolveWorkspaceRoot(project.localWorkspaceId); return discoverSoftwareScripts(root); });
  if (softwareTasks) {
    ipcMain.handle(brainWorkspaceIpcChannels.softwareTaskStart, async (_event, value: unknown) => { const input = requireRecord(value, "Software task start"); rejectUnexpectedKeys(input, ["projectId", "scriptId", "conversationId"], "Software task start"); return softwareTasks.start(await ownerId(), { projectId: requireString(input.projectId, "projectId"), scriptId: requireString(input.scriptId, "scriptId"), conversationId: optionalString(input.conversationId, "conversationId") }); });
    ipcMain.handle(brainWorkspaceIpcChannels.softwareTaskStatus, async (_event, value: unknown) => { const input = requireRecord(value, "Software task status"); rejectUnexpectedKeys(input, ["taskId"], "Software task status"); return softwareTasks.status(await ownerId(), requireString(input.taskId, "taskId")); });
    ipcMain.handle(brainWorkspaceIpcChannels.softwareTaskCancel, async (_event, value: unknown) => { const input = requireRecord(value, "Software task cancel"); rejectUnexpectedKeys(input, ["taskId"], "Software task cancel"); return softwareTasks.cancel(await ownerId(), requireString(input.taskId, "taskId")); });
  }
  if (dependencies.openSoftwareTerminal) {
    ipcMain.handle(brainWorkspaceIpcChannels.softwareTerminalOpen, async (_event, value: unknown) => {
      const input = parseProjectGet(value);
      const owner = await ownerId();
      const project = dependencies.storage.getProject(owner, input.projectId);
      if (project.primaryWorkspaceKey !== "software") throw new Error("BRAIN_SOFTWARE_WORKSPACE_REQUIRED");
      if (!project.localWorkspaceId) throw new Error("BRAIN_LOCAL_WORKSPACE_REQUIRED");
      return dependencies.openSoftwareTerminal!({ projectId: project.id, projectRoot: await dependencies.resolveWorkspaceRoot(project.localWorkspaceId) });
    });
  }
  ipcMain.handle(brainWorkspaceIpcChannels.flowSave, async (_event, value: unknown) => dependencies.storage.saveFlow({ ownerId: await ownerId(), ...parseFlowSave(value) }));
  ipcMain.handle(brainWorkspaceIpcChannels.flowGet, async (_event, value: unknown) => dependencies.storage.getFlow(await ownerId(), parseFlowId(value, "flowId")));
  ipcMain.handle(brainWorkspaceIpcChannels.flowList, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    return dependencies.storage.listFlows(await ownerId(), input.projectId);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.flowRunLatest, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    return dependencies.storage.getLatestFlowRun(await ownerId(), input.projectId);
  });
  if (flowExecution) {
    ipcMain.handle(brainWorkspaceIpcChannels.flowRunStart, async (_event, value: unknown) => flowExecution.start(await ownerId(), parseFlowStart(value)));
    ipcMain.handle(brainWorkspaceIpcChannels.flowRunGet, async (_event, value: unknown) => flowExecution.get(await ownerId(), parseFlowId(value, "runId")));
    ipcMain.handle(brainWorkspaceIpcChannels.flowRunCancel, async (_event, value: unknown) => flowExecution.cancel(await ownerId(), parseFlowId(value, "runId")));
  }
  ipcMain.handle(brainWorkspaceIpcChannels.flowScheduleCreate, async (_event, value: unknown) => dependencies.storage.createFlowSchedule({ ownerId: await ownerId(), ...parseFlowScheduleCreate(value) }));
  ipcMain.handle(brainWorkspaceIpcChannels.flowScheduleList, async (_event, value: unknown) => { const input = requireRecord(value, "Flow schedule list"); rejectUnexpectedKeys(input, ["projectId"], "Flow schedule list"); return dependencies.storage.listFlowSchedules(await ownerId(), requireString(input.projectId, "projectId")); });
  ipcMain.handle(brainWorkspaceIpcChannels.annotationList, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    return dependencies.storage.listAnnotations(await ownerId(), input.projectId);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.annotationCreate, async (_event, value: unknown) => {
    const input = requireRecord(value, "Annotation create");
    const status = input.status;
    if (status !== undefined && status !== "OPEN" && status !== "APPLIED" && status !== "DISMISSED") {
      throw new TypeError("annotation status is invalid");
    }
    return dependencies.storage.createAnnotation({
      ownerId: await ownerId(), projectId: requireString(input.projectId, "projectId"), fileId: requireString(input.fileId, "fileId"),
      fileVersion: Number(input.fileVersion), anchor: input.anchor as DocumentAnchor,
      instruction: requireString(input.instruction, "instruction"), status,
      supersedesAnnotationId: typeof input.supersedesAnnotationId === "string" ? input.supersedesAnnotationId : undefined
    });
  });
  ipcMain.handle(brainWorkspaceIpcChannels.changeSetList, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    return dependencies.storage.listChangeSets(await ownerId(), input.projectId);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.changeSetCreate, async (_event, value: unknown) => {
    const input = requireRecord(value, "Change set create");
    const diffJson = typeof input.diffJson === "string" ? input.diffJson : "{}";
    try { const parsed = JSON.parse(diffJson); if (parsed && typeof parsed === "object" && "format" in parsed) validateDocumentOperation(parsed); } catch (error) { throw new TypeError(error instanceof Error ? error.message : "document operation is invalid"); }
    return dependencies.storage.createChangeSet({
      ownerId: await ownerId(), projectId: requireString(input.projectId, "projectId"), annotationId: requireString(input.annotationId, "annotationId"),
      taskId: typeof input.taskId === "string" ? input.taskId : undefined, baseFileVersion: Number(input.baseFileVersion),
      changeSummary: requireString(input.changeSummary, "changeSummary"), diffJson
    });
  });
  ipcMain.handle(brainWorkspaceIpcChannels.changeSetUpdate, async (_event, value: unknown) => {
    const input = requireRecord(value, "Change set update");
    const status = input.status;
    if (status !== "ACCEPTED" && status !== "REJECTED" && status !== "REVERTED") throw new TypeError("status is invalid");
    return dependencies.storage.updateChangeSet({ ownerId: await ownerId(), projectId: requireString(input.projectId, "projectId"), changeSetId: requireString(input.changeSetId, "changeSetId"), status });
  });
  ipcMain.handle(brainWorkspaceIpcChannels.changeSetPreview, async (_event, value: unknown) => {
    const input = requireRecord(value, "Change set preview");
    return revisions.preview(await ownerId(), requireString(input.projectId, "projectId"), requireString(input.changeSetId, "changeSetId"));
  });
  ipcMain.handle(brainWorkspaceIpcChannels.changeSetExport, async (_event, value: unknown) => {
    const input = requireRecord(value, "Change set export");
    return revisions.export(await ownerId(), requireString(input.projectId, "projectId"), requireString(input.changeSetId, "changeSetId"));
  });
  if (dependencies.quant) {
    const authorizeQuantProject = async (input: Record<string, unknown>) => {
      const projectId = requireString(input.projectId, "projectId");
      dependencies.storage.getProject(await ownerId(), projectId);
      return projectId;
    };
    ipcMain.handle(brainWorkspaceIpcChannels.quantSessionCreate, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant session");
      dependencies.quant!.createSession(await authorizeQuantProject(input), typeof input.initialCash === "number" ? input.initialCash : 100_000);
      return { ok: true };
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantBarsQuery, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant bars");
      return dependencies.quant!.queryBarsAsync(await authorizeQuantProject(input), input.query as any);
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantMarketOverview, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant market overview");
      await authorizeQuantProject(input);
      if (!dependencies.queryQuantMarketOverview) throw new Error("MARKET_OVERVIEW_UNAVAILABLE");
      const requestedLimit = input.limit === undefined ? 20 : Number(input.limit);
      if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
        throw new TypeError("limit must be an integer between 1 and 100");
      }
      return dependencies.queryQuantMarketOverview(requestedLimit);
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantMarketScreener, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant market screener");
      await authorizeQuantProject(input);
      if (!dependencies.queryQuantMarketScreener) throw new Error("MARKET_SCREENER_UNAVAILABLE");
      const criteria = requireRecord(input.criteria, "Quant market screener criteria");
      return dependencies.queryQuantMarketScreener(criteria);
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantOrderExecute, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant order");
      return dependencies.quant!.executeOrder(await authorizeQuantProject(input), input.order as any);
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantSnapshot, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant snapshot");
      return dependencies.quant!.snapshot(await authorizeQuantProject(input), (input.prices || {}) as Record<string, number>);
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantActivity, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant activity");
      return dependencies.quant!.activity(await authorizeQuantProject(input), (input.prices || {}) as Record<string, number>);
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantSkillPerformance, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant performance");
      return dependencies.quant!.performance(await authorizeQuantProject(input), requireString(input.skillId, "skillId"));
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantSkillRunSimulation, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant skill simulation");
      const projectId = await authorizeQuantProject(input);
      const quantity = Number(input.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) throw new TypeError("quantity must be a positive integer");
      const query = requireRecord(input.query, "Quant skill simulation query");
      return dependencies.quant!.runSkillSimulation(projectId, {
        skillId: requireString(input.skillId, "skillId"),
        symbol: requireString(input.symbol, "symbol"),
        quantity,
        query: query as any,
        reset: input.reset !== false
      });
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantSkillActivity, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant skill activity");
      return dependencies.quant!.skillActivity(
        await authorizeQuantProject(input),
        requireString(input.skillId, "skillId"),
        (input.prices || {}) as Record<string, number>
      );
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantScheduleList, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant schedule list");
      return dependencies.storage.listQuantStrategySchedules(await ownerId(), requireString(input.projectId, "projectId"));
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantScheduleCreate, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant schedule create");
      const exchange = requireString(input.exchange, "exchange");
      if (exchange !== "SSE" && exchange !== "SZSE" && exchange !== "BSE") throw new TypeError("exchange is invalid");
      const quantity = Number(input.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) throw new TypeError("quantity must be a positive integer");
      return dependencies.storage.createQuantStrategySchedule({
        ownerId: await ownerId(), projectId: requireString(input.projectId, "projectId"),
        skillId: requireString(input.skillId, "skillId"), exchange, runAt: requireString(input.runAt, "runAt"),
        symbol: requireString(input.symbol, "symbol"), quantity
      });
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantScheduleSetEnabled, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant schedule state");
      if (typeof input.enabled !== "boolean") throw new TypeError("enabled must be a boolean");
      return dependencies.storage.setQuantStrategyScheduleEnabled({ ownerId: await ownerId(), projectId: requireString(input.projectId, "projectId"), scheduleId: requireString(input.scheduleId, "scheduleId"), enabled: input.enabled });
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantScheduleRunList, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant schedule run list");
      return dependencies.storage.listQuantStrategyRuns(await ownerId(), requireString(input.projectId, "projectId"), typeof input.scheduleId === "string" ? input.scheduleId : undefined);
    });
  }
  return flowExecution;
}
