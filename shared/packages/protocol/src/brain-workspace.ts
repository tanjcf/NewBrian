import type { DocumentAnchor } from "./document-anchor.js";
import type { BrainWorkspaceKey } from "./workspace-types.js";
export { brainWorkspaceKeys } from "./workspace-types.js";
export type { BrainWorkspaceKey } from "./workspace-types.js";

export interface BrainWorkspaceDto {
  workspaceKey: BrainWorkspaceKey;
  displayName: string;
  enabled: boolean;
  capabilities: string[];
  defaultModelRoute: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface BrainProjectDto {
  id: string;
  name: string;
  localWorkspaceId: string;
  primaryWorkspaceKey: BrainWorkspaceKey;
  status: "ACTIVE" | "ARCHIVED";
  lastConversationId: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
}

export interface BrainConversationDto {
  id: string;
  projectId: string;
  title: string;
  workspaceSnapshot: BrainWorkspaceKey;
  status: "ACTIVE" | "ARCHIVED";
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
}

export interface BrainMessageDto {
  id: string;
  conversationId: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallsJson: string;
  sourceRefsJson: string;
  requestId: string;
  createdAt: string;
}

export interface BrainProjectListInput {
  workspaceKey?: BrainWorkspaceKey;
  includeArchived?: boolean;
}

export interface BrainProjectCreateInput {
  name: string;
  primaryWorkspaceKey: BrainWorkspaceKey;
  localWorkspaceId?: string;
}

export interface BrainProjectGetInput { projectId: string }

export type BrainGameEngine = "web" | "godot" | "unity" | "unreal" | "unknown";

export interface BrainGameProjectInspection {
  schemaVersion: 1;
  engine: BrainGameEngine;
  displayName: string;
  markers: string[];
  assets: { scripts: number; scenes: number; images: number; audio: number; video: number; models: number; other: number };
  preview: { supported: boolean; command?: string; args?: string[]; url?: string; requiresApproval: true };
  warnings: string[];
  scannedEntries: number;
  skippedEntries: number;
  truncated: boolean;
}

export type BrainGamePreviewStatus = "STARTING" | "RUNNING" | "READY" | "STOPPING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "TIMED_OUT";

export interface BrainGamePreviewState {
  schemaVersion: 1;
  sessionId: string;
  projectId: string;
  taskId: string;
  status: BrainGamePreviewStatus;
  command: string;
  previewUrl: string;
  startedAt: string;
  readyAt: string;
  finishedAt: string;
  errorCode: string;
  output: string;
}

export type BrainVideoTrackType = "video" | "audio" | "subtitle";
export interface BrainVideoClip {
  id: string;
  trackType: BrainVideoTrackType;
  sourceFileId: string;
  startMs: number;
  durationMs: number;
  sourceInMs: number;
  volume: number;
  text: string;
}
export interface BrainVideoTimeline {
  schemaVersion: 1;
  projectId: string;
  title: string;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  clips: BrainVideoClip[];
  updatedAt: string;
}

export type BrainVideoRenderStatus = "STARTING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
export interface BrainVideoRenderState {
  schemaVersion: 1;
  renderId: string;
  projectId: string;
  taskId: string;
  status: BrainVideoRenderStatus;
  outputFileId: string;
  outputPath: string;
  errorCode: string;
  output: string;
  startedAt: string;
  finishedAt: string;
}

export interface BrainProjectUpdateInput extends BrainProjectGetInput {
  name?: string;
  status?: "ACTIVE" | "ARCHIVED";
  localWorkspaceId?: string;
}

export interface BrainProjectWorkspaceInput extends BrainProjectGetInput {
  workspaceKey: BrainWorkspaceKey;
  enabled: boolean;
}

export interface BrainConversationCreateInput extends BrainProjectGetInput {
  title: string;
  workspaceKey?: BrainWorkspaceKey;
}

export interface BrainConversationListInput {
  projectId?: string;
  workspaceKey?: BrainWorkspaceKey;
  includeArchived?: boolean;
}

export interface BrainConversationGetInput { conversationId: string }

export interface BrainMessageAppendInput extends BrainConversationGetInput {
  role: BrainMessageDto["role"];
  content: string;
  toolCallsJson?: string;
  sourceRefsJson?: string;
  requestId?: string;
}

export interface BrainDraftSaveInput extends BrainConversationGetInput, BrainProjectGetInput {
  content: string;
}

export interface BrainFileDto {
  id: string;
  projectId: string;
  logicalName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  storageKey: string;
  versionNo: number;
  parseStatus: string;
  validationStatus: string;
  createdAt: string;
}

export interface BrainFileRegisterInput extends BrainProjectGetInput {
  logicalName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  storageKey: string;
  versionNo?: number;
}

export interface BrainDocumentIngestInput extends BrainProjectGetInput {
  fileId: string;
  maxBytes?: number;
}

export interface BrainDocumentIngestResult {
  format: import("./document-anchor.js").DocumentFormat;
  text: string;
  anchors: DocumentAnchor[];
  warnings: string[];
}

export interface BrainTaskDto {
  id: string;
  projectId: string;
  conversationId: string;
  workspaceKey: BrainWorkspaceKey;
  taskType: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
  progress: number;
  requestId: string;
  idempotencyKey: string;
  attempt: number;
  maxAttempts: number;
  resourceLimitsJson: string;
  resultJson: string;
  errorCode: string;
  errorDetail: string;
  startedAt: string;
  finishedAt: string;
  heartbeatAt: string;
}

export interface BrainTaskCreateInput extends BrainProjectGetInput {
  conversationId?: string;
  workspaceKey: BrainWorkspaceKey;
  taskType: string;
  requestId?: string;
  idempotencyKey: string;
  maxAttempts?: number;
  resourceLimitsJson?: string;
}

export interface BrainTaskUpdateInput {
  taskId: string;
  status: BrainTaskDto["status"];
  progress?: number;
  errorCode?: string;
  errorDetail?: string;
}

export interface BrainArtifactDto {
  id: string;
  projectId: string;
  taskId: string;
  sourceFileId: string;
  artifactType: string;
  storageKey: string;
  contentHash: string;
  validationStatus: string;
  createdAt: string;
}

export interface BrainArtifactRegisterInput extends BrainProjectGetInput {
  taskId?: string;
  sourceFileId?: string;
  artifactType: string;
  storageKey: string;
  contentHash: string;
  validationStatus?: string;
}

export interface BrainAnnotationDto {
  id: string; fileId: string; fileVersion: number; pageOrSheet: string; annotationType: string;
  anchor: DocumentAnchor; instruction: string; status: "OPEN" | "APPLIED" | "DISMISSED";
  supersedesAnnotationId: string; selectedText: string; createdBy: string; createdAt: string;
}

export interface BrainAnnotationCreateInput extends BrainProjectGetInput {
  fileId: string; fileVersion: number; anchor: DocumentAnchor; instruction: string;
  status?: "OPEN" | "APPLIED" | "DISMISSED"; supersedesAnnotationId?: string;
}

export interface BrainChangeSetDto { id: string; annotationId: string; taskId: string; baseFileVersion: number; resultFileVersion: number; changeSummary: string; diffJson: string; status: "PROPOSED" | "ACCEPTED" | "REJECTED" | "REVERTED"; createdAt: string; reviewedAt: string; }
export interface BrainChangeSetUpdateInput { projectId: string; changeSetId: string; status: "ACCEPTED" | "REJECTED" | "REVERTED"; }
export interface BrainChangeSetPreviewInput extends BrainProjectGetInput { changeSetId: string; }
export interface BrainChangeSetPreviewResult {
  changeSetId: string; annotationId: string; fileId: string; fileVersion: number;
  relativePath: string; contentHash: string; before: string; after: string;
  operations: Array<{ start: number; end: number; replacement: string }>;
}
export interface BrainChangeSetExportResult {
  changeSet: BrainChangeSetDto;
  file: BrainFileDto;
  relativePath: string;
}

export const brainWorkspaceIpcChannels = {
  workspaceList: "brain:workspace:list",
  projectList: "brain:project:list",
  projectCreate: "brain:project:create",
  projectGet: "brain:project:get",
  projectUpdate: "brain:project:update",
  projectWorkspaceEnable: "brain:project:workspace-enable",
  conversationCreate: "brain:conversation:create",
  conversationList: "brain:conversation:list",
  conversationGet: "brain:conversation:get",
  messageList: "brain:message:list",
  messageAppend: "brain:message:append",
  draftGet: "brain:draft:get",
  draftSave: "brain:draft:save",
  fileList: "brain:file:list",
  fileRegister: "brain:file:register",
  fileIngest: "brain:file:ingest",
  taskList: "brain:task:list",
  taskCreate: "brain:task:create",
  taskUpdate: "brain:task:update",
  artifactList: "brain:artifact:list",
  artifactRegister: "brain:artifact:register",
  gameProjectInspect: "brain:game:project-inspect",
  gamePreviewStart: "brain:game:preview-start",
  gamePreviewStatus: "brain:game:preview-status",
  gamePreviewStop: "brain:game:preview-stop",
  quantSessionCreate: "brain:quant:session-create",
  quantBarsQuery: "brain:quant:bars-query",
  quantOrderExecute: "brain:quant:order-execute",
  quantSnapshot: "brain:quant:snapshot",
  quantSkillPerformance: "brain:quant:skill-performance",
  quantScheduleList: "brain:quant:schedule-list",
  quantScheduleCreate: "brain:quant:schedule-create",
  annotationList: "brain:annotation:list",
  annotationCreate: "brain:annotation:create",
  changeSetList: "brain:change-set:list",
  changeSetCreate: "brain:change-set:create",
  changeSetUpdate: "brain:change-set:update",
  changeSetPreview: "brain:change-set:preview",
  changeSetExport: "brain:change-set:export"
  ,videoTimelineGet: "brain:video:timeline-get"
  ,videoTimelineSave: "brain:video:timeline-save"
  ,videoClipAdd: "brain:video:clip-add"
  ,videoRenderStart: "brain:video:render-start"
  ,videoRenderStatus: "brain:video:render-status"
  ,videoRenderCancel: "brain:video:render-cancel"
  ,musicTimelineGet: "brain:music:timeline-get"
  ,musicTimelineSave: "brain:music:timeline-save"
  ,musicClipAdd: "brain:music:clip-add"
  ,dataDatasetList: "brain:data:dataset-list"
  ,dataDatasetSave: "brain:data:dataset-save"
} as const;
