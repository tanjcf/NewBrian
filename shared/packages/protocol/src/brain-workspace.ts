import type { AnnotationGeometry } from "./annotation-geometry.js";
import type { DocumentAnchor } from "./document-anchor.js";
import type { BrainWorkspaceKey } from "./workspace-types.js";
export { brainWorkspaceKeys } from "./workspace-types.js";
export type { BrainWorkspaceKey } from "./workspace-types.js";
export type {
  AnnotationGeometry,
  AnnotationGeometryStyle,
  AnnotationMarkingColor,
  AnnotationMarkingTool
} from "./annotation-geometry.js";
export {
  ANNOTATION_MARKING_COLORS,
  DEFAULT_ANNOTATION_GEOMETRY,
  linesFromPreviewRect,
  normalizeAnnotationGeometry,
  validateAnnotationGeometry
} from "./annotation-geometry.js";

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

export interface BrainGameUnrealTemplateCreateInput extends BrainProjectGetInput {
  projectName?: string;
  engineAssociation?: string;
}

export interface BrainGameUnrealTemplateCreateResult {
  engine: "unreal";
  projectName: string;
  uprojectPath: string;
  engineAssociation: string;
  docsRoot: string;
}

export interface BrainGameDesignExportResult {
  docsRoot: string;
  exportedFiles: string[];
  manifestPath: string;
}

export interface BrainWorkspaceSectionDto {
  schemaVersion: 1;
  projectId: string;
  workspaceKey: BrainWorkspaceKey;
  sectionKey: string;
  content: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface BrainWorkspaceSectionGetInput extends BrainProjectGetInput {
  workspaceKey: BrainWorkspaceKey;
  sectionKey: string;
}

export interface BrainWorkspaceSectionSaveInput extends BrainWorkspaceSectionGetInput {
  content: string;
  expectedRevision: number;
}

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

export type BrainGamePreviewStatus = "STARTING" | "RUNNING" | "READY" | "STOPPING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

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

export type BrainVideoRenderStatus = "STARTING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
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
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
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
  sourceWorkspaceKey: BrainWorkspaceKey | "";
  artifactType: string;
  storageKey: string;
  contentHash: string;
  validationStatus: string;
  createdAt: string;
}

export interface BrainArtifactRegisterInput extends BrainProjectGetInput {
  taskId?: string;
  sourceFileId?: string;
  sourceWorkspaceKey?: BrainWorkspaceKey;
  artifactType: string;
  storageKey: string;
  contentHash: string;
  validationStatus?: string;
}

export interface BrainAnnotationDto {
  id: string; fileId: string; fileVersion: number; pageOrSheet: string; annotationType: string;
  anchor: DocumentAnchor; geometry: AnnotationGeometry; instruction: string; status: "OPEN" | "APPLIED" | "DISMISSED";
  supersedesAnnotationId: string; selectedText: string; createdBy: string; createdAt: string;
}

export interface BrainAnnotationCreateInput extends BrainProjectGetInput {
  fileId: string; fileVersion: number; anchor: DocumentAnchor; instruction: string;
  geometry?: Partial<AnnotationGeometry> & { style?: Partial<AnnotationGeometry["style"]> };
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

export type BrainFlowConditionOperator = "truthy" | "equals" | "notEquals" | "exists" | "greaterThan" | "lessThan" | "contains";
export type BrainFlowScalar = string | number | boolean | null;
export type BrainFlowNode =
  | { id: string; type: "start" | "end"; next?: string }
  | { id: string; type: "tool"; tool: string; input?: unknown; next?: string; maxAttempts?: number }
  | { id: string; type: "condition"; valueKey: string; operator?: BrainFlowConditionOperator; expected?: BrainFlowScalar; onTrue: string; onFalse: string }
  | { id: string; type: "assign"; targetKey: string; valueKey?: string; value?: unknown; next?: string }
  | { id: string; type: "aggregate"; targetKey: string; sources: Record<string, string>; next?: string }
  | { id: string; type: "approval"; next: string };
export interface BrainFlowDefinition { schemaVersion: 1; nodes: BrainFlowNode[]; maxSteps?: number }
export interface BrainFlowSaveInput { projectId: string; id?: string; name: string; definition: BrainFlowDefinition }
export interface BrainFlowStartInput { flowId: string; values?: Record<string, unknown> }
export interface BrainFlowIdInput { flowId: string }
export interface BrainFlowRunIdInput { runId: string }
export interface BrainFlowScheduleCreateInput { projectId: string; flowId: string; timezone?: string; runAt: string; enabled?: boolean }
export interface BrainFlowScheduleListInput { projectId: string }
export interface BrainRustConversationInput {
  projectId: string;
  workspaceType: string;
  operation: `conversation.${string}`;
  payload: Record<string, unknown>;
}

export const brainWorkspaceIpcChannels = {
  workspaceList: "brain:workspace:list",
  projectList: "brain:project:list",
  projectCreate: "brain:project:create",
  projectGet: "brain:project:get",
  projectUpdate: "brain:project:update",
  projectWorkspaceEnable: "brain:project:workspace-enable",
  workspaceSectionGet: "brain:workspace-section:get",
  workspaceSectionSave: "brain:workspace-section:save",
  conversationCreate: "brain:conversation:create",
  conversationList: "brain:conversation:list",
  conversationGet: "brain:conversation:get",
  messageList: "brain:message:list",
  messageAppend: "brain:message:append",
  rustConversation: "brain:rust:conversation",
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
  quantMarketOverview: "brain:quant:market-overview",
  quantMarketScreener: "brain:quant:market-screener",
  quantOrderExecute: "brain:quant:order-execute",
  quantSnapshot: "brain:quant:snapshot",
  quantActivity: "brain:quant:activity",
  quantSkillPerformance: "brain:quant:skill-performance",
  quantSkillRunSimulation: "brain:quant:skill-run-simulation",
  quantSkillActivity: "brain:quant:skill-activity",
  quantScheduleList: "brain:quant:schedule-list",
  quantScheduleCreate: "brain:quant:schedule-create",
  quantScheduleSetEnabled: "brain:quant:schedule-set-enabled",
  quantScheduleRunList: "brain:quant:schedule-run-list",
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
  ,videoSubtitleImport: "brain:video:subtitle-import"
  ,videoSubtitleExport: "brain:video:subtitle-export"
  ,videoRenderStart: "brain:video:render-start"
  ,videoRenderStatus: "brain:video:render-status"
  ,videoRenderCancel: "brain:video:render-cancel"
  ,musicTimelineGet: "brain:music:timeline-get"
  ,musicTimelineSave: "brain:music:timeline-save"
  ,musicClipAdd: "brain:music:clip-add"
  ,dataDatasetList: "brain:data:dataset-list"
  ,dataDatasetSave: "brain:data:dataset-save"
  ,dataDatasetImportCsv: "brain:data:dataset-import-csv"
  ,dataDatasetImportXlsx: "brain:data:dataset-import-xlsx"
  ,dataDatasetXlsxSheets: "brain:data:dataset-xlsx-sheets"
  ,dataDatasetRows: "brain:data:dataset-rows"
  ,dataAnalysisSummarize: "brain:data:analysis-summarize"
  ,dataAnalysisAggregate: "brain:data:analysis-aggregate"
  ,dataAnalysisList: "brain:data:analysis-list"
  ,softwareScriptsList: "brain:software:scripts-list"
  ,softwareTaskStart: "brain:software:task-start"
  ,softwareTaskStatus: "brain:software:task-status"
  ,softwareTaskCancel: "brain:software:task-cancel"
  ,softwareTerminalOpen: "brain:software:terminal-open"
  ,flowSave: "brain:flow:save"
  ,flowGet: "brain:flow:get"
  ,flowList: "brain:flow:list"
  ,flowRunLatest: "brain:flow:run-latest"
  ,flowRunStart: "brain:flow:run-start"
  ,flowRunGet: "brain:flow:run-get"
  ,flowRunCancel: "brain:flow:run-cancel"
  ,flowScheduleCreate: "brain:flow:schedule-create"
  ,flowScheduleList: "brain:flow:schedule-list"
  ,musicMediaInspect: "brain:music:media-inspect"
  ,musicRenderStart: "brain:music:render-start"
  ,musicRenderStatus: "brain:music:render-status"
  ,musicRenderCancel: "brain:music:render-cancel"
  ,environmentDiscover: "brain:environment:discover"
  ,environmentEnsure: "brain:environment:ensure"
  ,environmentEnsureScene: "brain:environment:ensure-scene"
  ,filePreviewUrl: "brain:file:preview-url"
  ,mediaImport: "brain:media:import"
  ,mediaPeel: "brain:media:peel"
  ,gameWebTemplateCreate: "brain:game:web-template-create"
  ,gameUnrealTemplateCreate: "brain:game:unreal-template-create"
  ,gameDesignExport: "brain:game:design-export"
  ,gameLevelEditorGet: "brain:game:level-editor-get"
  ,gameLevelEditorSave: "brain:game:level-editor-save"
  ,gameSpawnActor: "brain:game:spawn-actor"
  ,gameContentTree: "brain:game:content-tree"
  ,videoPipelineGet: "brain:video:pipeline-get"
  ,videoPipelineSave: "brain:video:pipeline-save"
  ,videoMarkShot: "brain:video:mark-shot"
  ,videoPipelineCook: "brain:video:pipeline-cook"
  ,musicDawGet: "brain:music:daw-get"
  ,musicDawSave: "brain:music:daw-save"
  ,musicDawCook: "brain:music:daw-cook"
  ,dataAnalysisGet: "brain:data:analysis-get"
  ,dataAnalysisSave: "brain:data:analysis-save"
  ,dataAnalysisCook: "brain:data:analysis-cook"
  ,sceneMediaGenerate: "brain:media:scene-generate"
} as const;
