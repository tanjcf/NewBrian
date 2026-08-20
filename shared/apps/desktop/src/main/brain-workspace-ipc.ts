import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";
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
  type BrainTaskCreateInput,
  type BrainTaskUpdateInput,
  type BrainWorkspaceKey
} from "@codex-forge/protocol";
import type { DocumentAnchor } from "@codex-forge/protocol/document-anchor";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.js";
import { BrainDocumentRevisionService } from "./brain-document-revision-service.js";
import { inspectGameProject } from "./game-project-inspector.js";
import { GamePreviewService, type GamePreviewRustClient } from "./game-preview-service.js";
import type { QuantSimulationService } from "./quant-simulation-service.ts";
import type { VideoTimelineService } from "./video-timeline-service.ts";
import type { VideoRenderService } from "./video-render-service.ts";
import type { MusicTimelineService } from "./music-timeline-service.ts";
import { normalizeDataset } from "./data-dataset-policy.ts";
import type { BrainDataset } from "@codex-forge/protocol/data-types";
import type { DataImportService } from "./data-import-service.ts";
import type { DocumentWorkerResponse } from "@codex-forge/protocol/document-worker";

interface BrainWorkspaceIpcDependencies {
  storage: BrainWorkspaceStorage;
  resolveOwnerId: () => Promise<string> | string;
  resolveWorkspaceRoot: (workspaceId: string) => Promise<string>;
  quant?: QuantSimulationService;
  video?: VideoTimelineService;
  videoRender?: VideoRenderService;
  music?: MusicTimelineService;
  dataImport?: DataImportService;
  ingestDocument?: (input: { requestId: string; projectRoot: string; relativePath: string; maxBytes: number }) => Promise<DocumentWorkerResponse>;
  acquireRustCore?: (binding: { projectId: string; projectRoot: string; workspaceType: "game" | "video" }) => Promise<GamePreviewRustClient>;
  confirmGamePreview?: (input: { projectName: string; projectRoot: string; command: string }) => Promise<boolean>;
  platform?: NodeJS.Platform;
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
  rejectUnexpectedKeys(input, ["projectId", "outputRelativePath"], "Video render start");
  return { projectId: requireString(input.projectId, "projectId"), outputRelativePath: requireString(input.outputRelativePath, "outputRelativePath") };
}
function parseMusicProject(value: unknown) { const input = requireRecord(value, "Music timeline"); rejectUnexpectedKeys(input, ["projectId"], "Music timeline"); return { projectId: requireString(input.projectId, "projectId") }; }
function parseMusicSave(value: unknown) { const input = requireRecord(value, "Music timeline save"); rejectUnexpectedKeys(input, ["projectId", "title", "sampleRate", "channels"], "Music timeline save"); if (input.channels !== 1 && input.channels !== 2) throw new TypeError("channels must be 1 or 2."); return { projectId: requireString(input.projectId, "projectId"), title: requireString(input.title, "title"), sampleRate: requireFiniteNumber(input.sampleRate, "sampleRate"), channels: input.channels as 1 | 2 }; }
function parseMusicClip(value: unknown) { const input = requireRecord(value, "Music clip add"); rejectUnexpectedKeys(input, ["projectId", "trackType", "sourceFileId", "startMs", "durationMs", "sourceInMs", "gain", "pan"], "Music clip add"); return { projectId: requireString(input.projectId, "projectId"), trackType: input.trackType, sourceFileId: requireString(input.sourceFileId, "sourceFileId"), startMs: requireFiniteNumber(input.startMs, "startMs"), durationMs: requireFiniteNumber(input.durationMs, "durationMs"), sourceInMs: requireFiniteNumber(input.sourceInMs, "sourceInMs"), gain: requireFiniteNumber(input.gain, "gain"), pan: requireFiniteNumber(input.pan, "pan") }; }
function parseDataset(value: unknown): BrainDataset { const input = requireRecord(value, "Dataset save"); rejectUnexpectedKeys(input, ["id", "projectId", "name", "columns", "rowCount", "sourceFileId", "contentHash", "updatedAt"], "Dataset save"); return normalizeDataset({ id: requireString(input.id, "id"), projectId: requireString(input.projectId, "projectId"), name: requireString(input.name, "name"), columns: input.columns as BrainDataset["columns"], rowCount: requireFiniteNumber(input.rowCount, "rowCount"), sourceFileId: optionalString(input.sourceFileId, "sourceFileId"), contentHash: requireString(input.contentHash, "contentHash"), updatedAt: requireString(input.updatedAt, "updatedAt") }); }

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
  const statuses = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"];
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
    sourceFileId: optionalString(input.sourceFileId, "sourceFileId"), artifactType: requireString(input.artifactType, "artifactType"),
    storageKey: requireString(input.storageKey, "storageKey"), contentHash: requireString(input.contentHash, "contentHash"),
    validationStatus: optionalString(input.validationStatus, "validationStatus")
  };
}

function withoutOwner<T extends { ownerId: string }>(value: T): Omit<T, "ownerId"> {
  const { ownerId: _ownerId, ...safe } = value;
  return safe;
}

export function registerBrainWorkspaceIpcHandlers(dependencies: BrainWorkspaceIpcDependencies) {
  const ownerId = () => Promise.resolve(dependencies.resolveOwnerId()).then((value) => requireString(value, "ownerId"));
  const revisions = new BrainDocumentRevisionService(dependencies);
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
  if (gamePreviews) dependencies.storage.reconcileInterruptedGamePreviews();
  ipcMain.handle(brainWorkspaceIpcChannels.workspaceList, () => dependencies.storage.listWorkspaces());
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
    return inspectGameProject(await dependencies.resolveWorkspaceRoot(project.localWorkspaceId));
  });
  if (gamePreviews) {
    ipcMain.handle(brainWorkspaceIpcChannels.gamePreviewStart, async (_event, value: unknown) =>
      gamePreviews.start(await ownerId(), parseGamePreviewStart(value)));
    ipcMain.handle(brainWorkspaceIpcChannels.gamePreviewStatus, async (_event, value: unknown) =>
      gamePreviews.status(await ownerId(), parseGamePreviewProject(value).projectId));
    ipcMain.handle(brainWorkspaceIpcChannels.gamePreviewStop, async (_event, value: unknown) =>
      gamePreviews.stop(await ownerId(), parseGamePreviewProject(value).projectId));
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
      const mediaRelativePaths = timeline.clips.filter((clip) => clip.trackType === "video").map((clip) => dependencies.storage.getFile(owner, input.projectId, clip.sourceFileId).storageKey);
      return dependencies.videoRender!.start(owner, { projectId: input.projectId, projectRoot, timeline, outputRelativePath: input.outputRelativePath, mediaRelativePaths });
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
  if (dependencies.music) {
    ipcMain.handle(brainWorkspaceIpcChannels.musicTimelineGet, async (_event, value: unknown) => { const input = parseMusicProject(value); return dependencies.music!.getTimeline(await ownerId(), input.projectId); });
    ipcMain.handle(brainWorkspaceIpcChannels.musicTimelineSave, async (_event, value: unknown) => { const input = parseMusicSave(value); return dependencies.music!.ensureTimeline(await ownerId(), input.projectId, { title: input.title, sampleRate: input.sampleRate, channels: input.channels }); });
    ipcMain.handle(brainWorkspaceIpcChannels.musicClipAdd, async (_event, value: unknown) => { const input = parseMusicClip(value); if (input.trackType !== "audio" && input.trackType !== "midi") throw new TypeError("trackType is unsupported."); return dependencies.music!.addClip(await ownerId(), input.projectId, input); });
  }
  ipcMain.handle(brainWorkspaceIpcChannels.dataDatasetList, async (_event, value: unknown) => { const input = parseProjectGet(value); return dependencies.storage.listDatasets(await ownerId(), input.projectId); });
  ipcMain.handle(brainWorkspaceIpcChannels.dataDatasetSave, async (_event, value: unknown) => { const dataset = parseDataset(value); return dependencies.storage.saveDataset({ ownerId: await ownerId(), dataset }); });
  if (dependencies.dataImport) ipcMain.handle("brain:data:dataset-import-csv", async (_event, value: unknown) => { const input = requireRecord(value, "Dataset import"); rejectUnexpectedKeys(input, ["projectId", "fileId", "datasetId", "name", "updatedAt"], "Dataset import"); return dependencies.dataImport!.importCsv(await ownerId(), { projectId: requireString(input.projectId, "projectId"), fileId: requireString(input.fileId, "fileId"), datasetId: requireString(input.datasetId, "datasetId"), name: requireString(input.name, "name"), updatedAt: requireString(input.updatedAt, "updatedAt") }); });
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
    return dependencies.storage.createChangeSet({
      ownerId: await ownerId(), projectId: requireString(input.projectId, "projectId"), annotationId: requireString(input.annotationId, "annotationId"),
      taskId: typeof input.taskId === "string" ? input.taskId : undefined, baseFileVersion: Number(input.baseFileVersion),
      changeSummary: requireString(input.changeSummary, "changeSummary"), diffJson: typeof input.diffJson === "string" ? input.diffJson : "{}"
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
    ipcMain.handle(brainWorkspaceIpcChannels.quantOrderExecute, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant order");
      return dependencies.quant!.executeOrder(await authorizeQuantProject(input), input.order as any);
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantSnapshot, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant snapshot");
      return dependencies.quant!.snapshot(await authorizeQuantProject(input), (input.prices || {}) as Record<string, number>);
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantSkillPerformance, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant performance");
      return dependencies.quant!.performance(await authorizeQuantProject(input), requireString(input.skillId, "skillId"));
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
  }
}
