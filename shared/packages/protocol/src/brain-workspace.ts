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
} as const;
