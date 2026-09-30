import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AnswerGoalQuestionInput,
  ActivateWorkspaceThreadInput,
  AddFeatureItemInput,
  AddWorkspaceInput,
  AddWorkspaceThreadInput,
  ArchiveWorkspaceThreadInput,
  AutomationSpec,
  BrainConversationCreateInput,
  BrainConversationDto,
  BrainConversationGetInput,
  BrainConversationListInput,
  BrainArtifactDto,
  BrainArtifactRegisterInput,
  BrainChangeSetExportResult,
  BrainChangeSetPreviewInput,
  BrainChangeSetPreviewResult,
  BrainChangeSetDto,
  BrainChangeSetUpdateInput,
  BrainDraftSaveInput,
  BrainFileDto,
  BrainFileRegisterInput,
  BrainGameProjectInspection,
  BrainGamePreviewState,
  BrainFlowIdInput,
  BrainFlowRunIdInput,
  BrainFlowScheduleCreateInput,
  BrainFlowScheduleListInput,
  BrainFlowSaveInput,
  BrainFlowStartInput,
  BrainDocumentIngestInput,
  BrainDocumentIngestResult,
  BrainMessageAppendInput,
  BrainMessageDto,
  BrainProjectCreateInput,
  BrainProjectDto,
  BrainProjectGetInput,
  BrainProjectListInput,
  BrainProjectUpdateInput,
  BrainProjectWorkspaceInput,
  BrainWorkspaceDto,
  BrainWorkspaceSectionDto,
  BrainWorkspaceSectionGetInput,
  BrainWorkspaceSectionSaveInput,
  BrainTaskCreateInput,
  BrainTaskDto,
  BrainTaskUpdateInput,
  ExportWorkspaceThreadHtmlInput,
  ExportWorkspaceThreadHtmlResult,
  CreateGoalInput,
  CancelModelRequestInput,
  CreateGoalQuestionInput,
  CreateUsageExceptionFeedbackPreviewInput,
  CreateBlankWorkspaceInput,
  ComposerAttachment,
  DesktopAppUpdateStartResult,
  DesktopAppUpdateStatus,
  DesktopAppUpdateVerifyInput,
  DesktopAppUpdateVerifyResult,
  DesktopBootstrapStatus,
  DesktopAuthChangeEmailInput,
  DesktopAuthChangePasswordInput,
  DesktopAuthLoginInput,
  DesktopAuthSendCodeInput,
  DesktopAuthStatus,
  DesktopPreferences,
  DesktopPolicyRule,
  DeleteFeatureItemInput,
  FeatureConfigPayload,
  GoalThreadInput,
  GovernmentWritingSpecificationGoalInput,
  SaveGovernmentWritingSpecificationInput,
  ConfirmGovernmentWritingSpecificationInput,
  SaveGovernmentWritingSuggestionsInput,
  ApplyGovernmentWritingSuggestionsInput,
  GuideModelRequestInput,
  ConfirmUsageExceptionFeedbackInput,
  HolonFeedbackInput,
  HolonKnowledgeSnapshot,
  HolonKnowledgeSnapshotInput,
  HolonSyncStatus,
  HolonWorkItemIdInput,
  GeneratePatchInput,
  ForkWorkspaceThreadInput,
  McpDiscoveredTool,
  McpServerConfig,
  McpServerHealth,
  McpServerInspection,
  McpToolCallResult,
  McpToolCallInput,
  CreateWorkspaceWorktreeInput,
  ListDelegatedAgentsInput,
  LearningCandidateInput,
  LearningListInput,
  LearningRollbackInput,
  LearningSearchInput,
  MergeDelegatedAgentResultsInput,
  MobilePairingState,
  ModelConfig,
  ModelChatInput,
  OpenClawSkillInstallClawHubInput,
  OpenClawSkillInstallPathInput,
  OpenClawSkillInstallResultPayload,
  OpenClawSkillInspectPathInput,
  OpenClawSkillExportZipInput,
  OpenClawSkillExportZipResult,
  OpenClawSkillSearchHit,
  OpenClawSkillSearchInput,
  OpenClawSkillSelectInstallInput,
  OpenWorkspaceFilePreviewEvent,
  UninstallWritingSkillsInput,
  UninstallWritingSkillsResult,
  OpenLogLocationResult,
  OpenComposerAttachmentInput,
  OpenSkillLocationInput,
  OpenSystemToolInput,
  PhaseOneSnapshot,
  PluginSpec,
  PluginCatalogQuery,
  PluginCatalogSnapshot,
  PluginInstallInput,
  PluginKeyInput,
  PluginOperationResult,
  PluginSetEnabledInput,
  SearchResultSpec,
  ShowAppMenuInput,
  ReplaceGoalPlanInput,
  RespondApprovalInput,
  RenameWorkspaceInput,
  RenameWorkspaceThreadInput,
  RecordMessageFeedbackInput,
  ResearchWritingExportInput,
  ResearchWritingIntakeInput,
  ResearchWritingPayload,
  RendererDiagnosticInput,
  RendererFailureInput,
  SynthesizeNovelSpeechInput,
  SynthesizeNovelSpeechResult,
  SaveComposerClipboardFileInput,
  RespondDelegatedAgentApprovalInput,
  RunDelegatedAgentInput,
  SetGoalPausedInput,
  SkillSpec,
  SystemToolEntry,
  StartHolonWorkItemInput,
  TerminalSessionSnapshot,
  UpdateGoalInput,
  UpdateFeatureItemInput,
  UpdateGoalObjectiveInput,
  OpenWorkspaceLocationInput,
  WorkspaceIdInput,
  WorkspaceThreadInput,
  WorkspaceFileActionInput,
  WorkspaceArtifactPreview,
  WorkspaceFileInput,
  WorkspaceReviewInput,
  SwitchWorkspaceBranchInput,
  WorkspaceBranchStatus,
  WorkspaceCatalogItem,
  WorkspaceHeaderStatus,
  WindowControlAction,
  WorkspaceReviewChanges,
  UsageExceptionFeedbackPreview,
  UsageExceptionFeedbackSubmissionResult
} from "@codex-forge/protocol";
import { brainWorkspaceIpcChannels, desktopIpcChannels } from "@codex-forge/protocol";

contextBridge.exposeInMainWorld("newbrain", {
  listBrainWorkspaces: (): Promise<BrainWorkspaceDto[]> => ipcRenderer.invoke(brainWorkspaceIpcChannels.workspaceList),
  listBrainProjects: (input: BrainProjectListInput = {}): Promise<BrainProjectDto[]> => ipcRenderer.invoke(brainWorkspaceIpcChannels.projectList, input),
  createBrainProject: (input: BrainProjectCreateInput): Promise<BrainProjectDto> => ipcRenderer.invoke(brainWorkspaceIpcChannels.projectCreate, input),
  getBrainProject: (input: BrainProjectGetInput): Promise<BrainProjectDto> => ipcRenderer.invoke(brainWorkspaceIpcChannels.projectGet, input),
  updateBrainProject: (input: BrainProjectUpdateInput): Promise<BrainProjectDto> => ipcRenderer.invoke(brainWorkspaceIpcChannels.projectUpdate, input),
  setBrainProjectWorkspace: (input: BrainProjectWorkspaceInput): Promise<{ ok: boolean }> => ipcRenderer.invoke(brainWorkspaceIpcChannels.projectWorkspaceEnable, input),
  getBrainWorkspaceSection: (input: BrainWorkspaceSectionGetInput): Promise<BrainWorkspaceSectionDto> => ipcRenderer.invoke(brainWorkspaceIpcChannels.workspaceSectionGet, input),
  saveBrainWorkspaceSection: (input: BrainWorkspaceSectionSaveInput): Promise<BrainWorkspaceSectionDto> => ipcRenderer.invoke(brainWorkspaceIpcChannels.workspaceSectionSave, input),
  createBrainConversation: (input: BrainConversationCreateInput): Promise<BrainConversationDto> => ipcRenderer.invoke(brainWorkspaceIpcChannels.conversationCreate, input),
  listBrainConversations: (input: BrainConversationListInput = {}): Promise<BrainConversationDto[]> => ipcRenderer.invoke(brainWorkspaceIpcChannels.conversationList, input),
  getBrainConversation: (input: BrainConversationGetInput): Promise<BrainConversationDto> => ipcRenderer.invoke(brainWorkspaceIpcChannels.conversationGet, input),
  listBrainMessages: (input: BrainConversationGetInput): Promise<BrainMessageDto[]> => ipcRenderer.invoke(brainWorkspaceIpcChannels.messageList, input),
  appendBrainMessage: (input: BrainMessageAppendInput): Promise<BrainMessageDto> => ipcRenderer.invoke(brainWorkspaceIpcChannels.messageAppend, input),
  rustConversation: (input: { projectId: string; workspaceType: string; operation: `conversation.${string}`; payload: Record<string, unknown> }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.rustConversation, input),
  getBrainDraft: (input: BrainConversationGetInput): Promise<{ content: string; updatedAt: string } | null> => ipcRenderer.invoke(brainWorkspaceIpcChannels.draftGet, input),
  saveBrainDraft: (input: BrainDraftSaveInput): Promise<{ ok: boolean }> => ipcRenderer.invoke(brainWorkspaceIpcChannels.draftSave, input),
  listBrainFiles: (input: BrainProjectGetInput): Promise<BrainFileDto[]> => ipcRenderer.invoke(brainWorkspaceIpcChannels.fileList, input),
  registerBrainFile: (input: BrainFileRegisterInput): Promise<BrainFileDto> => ipcRenderer.invoke(brainWorkspaceIpcChannels.fileRegister, input),
  ingestBrainFile: (input: BrainDocumentIngestInput): Promise<BrainDocumentIngestResult> => ipcRenderer.invoke(brainWorkspaceIpcChannels.fileIngest, input),
  listBrainTasks: (input: BrainProjectGetInput): Promise<BrainTaskDto[]> => ipcRenderer.invoke(brainWorkspaceIpcChannels.taskList, input),
  createBrainTask: (input: BrainTaskCreateInput): Promise<BrainTaskDto> => ipcRenderer.invoke(brainWorkspaceIpcChannels.taskCreate, input),
  updateBrainTask: (input: BrainTaskUpdateInput): Promise<BrainTaskDto> => ipcRenderer.invoke(brainWorkspaceIpcChannels.taskUpdate, input),
  listBrainArtifacts: (input: BrainProjectGetInput): Promise<BrainArtifactDto[]> => ipcRenderer.invoke(brainWorkspaceIpcChannels.artifactList, input),
  registerBrainArtifact: (input: BrainArtifactRegisterInput): Promise<BrainArtifactDto> => ipcRenderer.invoke(brainWorkspaceIpcChannels.artifactRegister, input),
  inspectBrainGameProject: (input: BrainProjectGetInput): Promise<BrainGameProjectInspection> => ipcRenderer.invoke(brainWorkspaceIpcChannels.gameProjectInspect, input),
  startBrainGamePreview: (input: { projectId: string; conversationId?: string }): Promise<BrainGamePreviewState> => ipcRenderer.invoke(brainWorkspaceIpcChannels.gamePreviewStart, input),
  getBrainGamePreviewStatus: (input: BrainProjectGetInput): Promise<BrainGamePreviewState> => ipcRenderer.invoke(brainWorkspaceIpcChannels.gamePreviewStatus, input),
  stopBrainGamePreview: (input: BrainProjectGetInput): Promise<BrainGamePreviewState> => ipcRenderer.invoke(brainWorkspaceIpcChannels.gamePreviewStop, input),
  createBrainGameWebTemplate: (input: BrainProjectGetInput): Promise<{ engine: "web"; previewCommand: string; previewUrl: string }> => ipcRenderer.invoke(brainWorkspaceIpcChannels.gameWebTemplateCreate, input),
  exportBrainGameDesign: (input: BrainProjectGetInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.gameDesignExport, input),
  getBrainGameLevelEditor: (input: BrainProjectGetInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.gameLevelEditorGet, input),
  saveBrainGameLevelEditor: (input: { projectId: string; state: unknown }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.gameLevelEditorSave, input),
  spawnBrainGameActor: (input: { projectId: string; kind: "enemy" | "boss" | "npc"; levelIndex?: number }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.gameSpawnActor, input),
  getBrainGameContentTree: (input: BrainProjectGetInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.gameContentTree, input),
  getBrainVideoPipeline: (input: BrainProjectGetInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.videoPipelineGet, input),
  saveBrainVideoPipeline: (input: { projectId: string; state: unknown }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.videoPipelineSave, input),
  markBrainVideoShot: (input: { projectId: string; shotIndex: number; ready: boolean }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.videoMarkShot, input),
  cookBrainVideoPipeline: (input: BrainProjectGetInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.videoPipelineCook, input),
  generateBrainSceneMedia: (input: {
    projectId: string;
    kind: "video" | "music" | "image";
    prompt: string;
    model?: string;
    shotIndex?: number;
    size?: string;
    imageUrl?: string;
    lastFrameImageUrl?: string;
  }) =>
    ipcRenderer.invoke(brainWorkspaceIpcChannels.sceneMediaGenerate, input),
  getBrainMusicDaw: (input: BrainProjectGetInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.musicDawGet, input),
  saveBrainMusicDaw: (input: { projectId: string; state: unknown }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.musicDawSave, input),
  cookBrainMusicDaw: (input: BrainProjectGetInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.musicDawCook, input),
  getBrainDataAnalysis: (input: BrainProjectGetInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.dataAnalysisGet, input),
  saveBrainDataAnalysis: (input: { projectId: string; state: unknown }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.dataAnalysisSave, input),
  cookBrainDataAnalysis: (input: BrainProjectGetInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.dataAnalysisCook, input),
  discoverBrainEngines: (): Promise<Array<{ engineId: string; executable: string; source: string; version: string }>> => ipcRenderer.invoke(brainWorkspaceIpcChannels.environmentDiscover),
  ensureBrainEngine: (input: { engineId: string }): Promise<{ engineId: string; executable: string; source: string; version: string }> => ipcRenderer.invoke(brainWorkspaceIpcChannels.environmentEnsure, input),
  ensureBrainEnginesForScene: (input: { workspaceKey: string }): Promise<Array<{ engineId: string; executable: string; source: string; version: string }>> => ipcRenderer.invoke(brainWorkspaceIpcChannels.environmentEnsureScene, input),
  getBrainFilePreviewUrl: (input: { projectId: string; fileId: string }): Promise<string> => ipcRenderer.invoke(brainWorkspaceIpcChannels.filePreviewUrl, input),
  importBrainMedia: (input: {
    projectId: string;
    sourcePath?: string;
    fileName?: string;
    mimeType?: string;
    bytesBase64?: string;
    folder?: "imports" | "audio" | "clips" | "refs";
  }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.mediaImport, input),
  peelBrainMedia: (input: {
    projectId: string;
    relativePath?: string;
    fileId?: string;
    mode?: "unlink" | "probe";
  }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.mediaPeel, input),
  importVideoSubtitles: (input: { projectId: string; srt: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.videoSubtitleImport, input),
  exportVideoSubtitles: (input: { projectId: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.videoSubtitleExport, input),
  listBrainAnnotations: (input: { projectId: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.annotationList, input),
  createBrainAnnotation: (input: Record<string, unknown>) => ipcRenderer.invoke(brainWorkspaceIpcChannels.annotationCreate, input),
  listBrainChangeSets: (input: BrainProjectGetInput): Promise<BrainChangeSetDto[]> => ipcRenderer.invoke(brainWorkspaceIpcChannels.changeSetList, input),
  createBrainChangeSet: (input: Record<string, unknown>) => ipcRenderer.invoke(brainWorkspaceIpcChannels.changeSetCreate, input),
  updateBrainChangeSet: (input: BrainChangeSetUpdateInput): Promise<BrainChangeSetDto> => ipcRenderer.invoke(brainWorkspaceIpcChannels.changeSetUpdate, input),
  previewBrainChangeSet: (input: BrainChangeSetPreviewInput): Promise<BrainChangeSetPreviewResult> => ipcRenderer.invoke(brainWorkspaceIpcChannels.changeSetPreview, input),
  exportBrainChangeSet: (input: BrainChangeSetPreviewInput): Promise<BrainChangeSetExportResult> => ipcRenderer.invoke(brainWorkspaceIpcChannels.changeSetExport, input),
  createQuantSession: (input: { projectId: string; initialCash?: number }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.quantSessionCreate, input),
  queryQuantBars: (input: { projectId: string; query: unknown }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.quantBarsQuery, input),
  queryQuantMarketOverview: (input: { projectId: string; limit?: number }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.quantMarketOverview, input),
  queryQuantMarketScreener: (input: { projectId: string; criteria: Record<string, unknown> }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.quantMarketScreener, input),
  executeQuantOrder: (input: { projectId: string; order: unknown }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.quantOrderExecute, input),
  getQuantSnapshot: (input: { projectId: string; prices: Record<string, number> }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.quantSnapshot, input),
  getQuantActivity: (input: { projectId: string; prices: Record<string, number> }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.quantActivity, input),
  getQuantSkillPerformance: (input: { projectId: string; skillId: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.quantSkillPerformance, input),
  runQuantSkillSimulation: (input: {
    projectId: string;
    skillId: string;
    symbol: string;
    quantity: number;
    query: unknown;
    reset?: boolean;
  }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.quantSkillRunSimulation, input),
  getQuantSkillActivity: (input: { projectId: string; skillId: string; prices: Record<string, number> }) =>
    ipcRenderer.invoke(brainWorkspaceIpcChannels.quantSkillActivity, input),
  listQuantStrategySchedules: (input: { projectId: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.quantScheduleList, input),
  createQuantStrategySchedule: (input: { projectId: string; skillId: string; exchange: "SSE" | "SZSE" | "BSE"; runAt: string; symbol: string; quantity: number }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.quantScheduleCreate, input),
  setQuantStrategyScheduleEnabled: (input: { projectId: string; scheduleId: string; enabled: boolean }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.quantScheduleSetEnabled, input),
  listQuantStrategyRuns: (input: { projectId: string; scheduleId?: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.quantScheduleRunList, input),
  getVideoTimeline: (input: { projectId: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.videoTimelineGet, input),
  saveVideoTimeline: (input: { projectId: string; title: string; width: number; height: number; fps: number }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.videoTimelineSave, input),
  addVideoClip: (input: { projectId: string; trackType: "video" | "audio" | "subtitle"; sourceFileId: string; startMs: number; durationMs: number; sourceInMs: number; volume?: number; text?: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.videoClipAdd, input),
  startVideoRender: (input: { projectId: string; outputRelativePath: string; source?: "timeline" | "pipeline"; mediaRelativePaths?: string[] }) =>
    ipcRenderer.invoke(brainWorkspaceIpcChannels.videoRenderStart, input),
  getVideoRenderStatus: (input: { renderId: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.videoRenderStatus, input),
  cancelVideoRender: (input: { renderId: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.videoRenderCancel, input),
  getMusicTimeline: (input: { projectId: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.musicTimelineGet, input),
  saveMusicTimeline: (input: { projectId: string; title: string; sampleRate: number; channels: 1 | 2 }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.musicTimelineSave, input),
  addMusicClip: (input: { projectId: string; trackType: "audio" | "midi"; sourceFileId: string; startMs: number; durationMs: number; sourceInMs: number; gain: number; pan: number }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.musicClipAdd, input),
  listDataDatasets: (input: { projectId: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.dataDatasetList, input),
  saveDataDataset: (input: Record<string, unknown>) => ipcRenderer.invoke(brainWorkspaceIpcChannels.dataDatasetSave, input),
  importDataCsv: (input: { projectId: string; fileId: string; datasetId: string; name: string; updatedAt: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.dataDatasetImportCsv, input),
  importDataXlsx: (input: { projectId: string; fileId: string; datasetId: string; name: string; updatedAt: string; sheetName?: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.dataDatasetImportXlsx, input),
  listDataXlsxSheets: (input: { projectId: string; fileId: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.dataDatasetXlsxSheets, input),
  readDataRows: (input: { projectId: string; datasetId: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.dataDatasetRows, input),
  summarizeData: (input: { projectId: string; datasetId: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.dataAnalysisSummarize, input),
  aggregateData: (input: { projectId: string; datasetId: string; groupBy: string[]; metrics: Array<{ column: string; operation: "sum" | "count" | "avg" | "min" | "max"; as?: string }>; topN?: number; orderBy?: { metric: string; direction: "asc" | "desc" }; periodColumn?: string; compareMetric?: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.dataAnalysisAggregate, input),
  listDataAnalyses: (input: { projectId: string; datasetId: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.dataAnalysisList, input),
  listSoftwareScripts: (input: { projectId: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.softwareScriptsList, input),
  startSoftwareTask: (input: { projectId: string; scriptId: string; conversationId?: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.softwareTaskStart, input),
  getSoftwareTaskStatus: (input: { taskId: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.softwareTaskStatus, input),
  cancelSoftwareTask: (input: { taskId: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.softwareTaskCancel, input),
  openSoftwareProjectTerminal: (input: BrainProjectGetInput): Promise<{ ok: boolean }> => ipcRenderer.invoke(brainWorkspaceIpcChannels.softwareTerminalOpen, input),
  saveBrainFlow: (input: BrainFlowSaveInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.flowSave, input),
  getBrainFlow: (input: BrainFlowIdInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.flowGet, input),
  listBrainFlows: (input: BrainProjectGetInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.flowList, input),
  getLatestBrainFlowRun: (input: BrainProjectGetInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.flowRunLatest, input),
  startBrainFlow: (input: BrainFlowStartInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.flowRunStart, input),
  getBrainFlowRun: (input: BrainFlowRunIdInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.flowRunGet, input),
  cancelBrainFlow: (input: BrainFlowRunIdInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.flowRunCancel, input),
  createBrainFlowSchedule: (input: BrainFlowScheduleCreateInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.flowScheduleCreate, input),
  listBrainFlowSchedules: (input: BrainFlowScheduleListInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.flowScheduleList, input),
  inspectMusicMedia: (input: { projectId: string; sourceFileId: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.musicMediaInspect, input),
  startMusicRender: (input: { projectId: string; outputRelativePath: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.musicRenderStart, input),
  getMusicRenderStatus: (input: { renderId: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.musicRenderStatus, input),
  cancelMusicRender: (input: { renderId: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.musicRenderCancel, input),
  bootstrap: () => ipcRenderer.invoke(desktopIpcChannels.core.bootstrap),
  getSnapshot: () => ipcRenderer.invoke(desktopIpcChannels.core.getSnapshot),
  getGoal: (input?: { threadId?: string }) => ipcRenderer.invoke(desktopIpcChannels.goal.get, input),
  getGoalExecution: (input?: GoalThreadInput) => ipcRenderer.invoke(desktopIpcChannels.goal.getExecution, input),
  createGoal: (input: CreateGoalInput) => ipcRenderer.invoke(desktopIpcChannels.goal.create, input),
  updateGoal: (input: UpdateGoalInput) => ipcRenderer.invoke(desktopIpcChannels.goal.update, input),
  setGoalPaused: (input: SetGoalPausedInput) => ipcRenderer.invoke(desktopIpcChannels.goal.setPaused, input),
  updateGoalObjective: (input: UpdateGoalObjectiveInput) => ipcRenderer.invoke(desktopIpcChannels.goal.updateObjective, input),
  deleteGoal: (input?: GoalThreadInput) => ipcRenderer.invoke(desktopIpcChannels.goal.delete, input),
  replaceGoalPlan: (input: ReplaceGoalPlanInput) => ipcRenderer.invoke(desktopIpcChannels.goal.replacePlan, input),
  createGoalQuestion: (input: CreateGoalQuestionInput) => ipcRenderer.invoke(desktopIpcChannels.goal.createQuestion, input),
  answerGoalQuestion: (input: AnswerGoalQuestionInput) => ipcRenderer.invoke(desktopIpcChannels.goal.answerQuestion, input),
  getGovernmentWritingSpecification: (input: GovernmentWritingSpecificationGoalInput) =>
    ipcRenderer.invoke(desktopIpcChannels.governmentWritingSpecification.get, input),
  saveGovernmentWritingSpecification: (input: SaveGovernmentWritingSpecificationInput) =>
    ipcRenderer.invoke(desktopIpcChannels.governmentWritingSpecification.save, input),
  saveGovernmentWritingSuggestions: (input: SaveGovernmentWritingSuggestionsInput) =>
    ipcRenderer.invoke(desktopIpcChannels.governmentWritingSpecification.saveSuggestions, input),
  applyGovernmentWritingSuggestions: (input: ApplyGovernmentWritingSuggestionsInput) =>
    ipcRenderer.invoke(desktopIpcChannels.governmentWritingSpecification.applySuggestions, input),
  confirmGovernmentWritingSpecification: (input: ConfirmGovernmentWritingSpecificationInput) =>
    ipcRenderer.invoke(desktopIpcChannels.governmentWritingSpecification.confirm, input),
  getAuthStatus: (): Promise<DesktopAuthStatus> => ipcRenderer.invoke(desktopIpcChannels.auth.getStatus),
  getBillingSubscription: (): Promise<Record<string, unknown>> => ipcRenderer.invoke(desktopIpcChannels.auth.getBillingSubscription),
  sendLoginCode: (input: DesktopAuthSendCodeInput): Promise<Record<string, unknown>> => ipcRenderer.invoke(desktopIpcChannels.auth.sendLoginCode, input),
  loginAuth: (input: DesktopAuthLoginInput): Promise<DesktopAuthStatus> => ipcRenderer.invoke(desktopIpcChannels.auth.login, input),
  changeAuthPassword: (input: DesktopAuthChangePasswordInput): Promise<{ ok: boolean; detail: string }> => ipcRenderer.invoke(desktopIpcChannels.auth.changePassword, input),
  changeAuthEmail: (input: DesktopAuthChangeEmailInput): Promise<{ ok: boolean; detail: string; email: string }> => ipcRenderer.invoke(desktopIpcChannels.auth.changeEmail, input),
  logoutAuth: (): Promise<DesktopAuthStatus> => ipcRenderer.invoke(desktopIpcChannels.auth.logout),
  getNextWorkItem: () => ipcRenderer.invoke(desktopIpcChannels.holon.getNextWorkItem),
  startWorkItem: (input: StartHolonWorkItemInput) => ipcRenderer.invoke(desktopIpcChannels.holon.startWorkItem, input),
  cancelWorkItem: (input: HolonWorkItemIdInput) => ipcRenderer.invoke(desktopIpcChannels.holon.cancelWorkItem, input),
  getWorkItemState: (input: HolonWorkItemIdInput) => ipcRenderer.invoke(desktopIpcChannels.holon.getWorkItemState, input),
  getKnowledgeSnapshot: (input: HolonKnowledgeSnapshotInput): Promise<HolonKnowledgeSnapshot> =>
    ipcRenderer.invoke(desktopIpcChannels.holon.getKnowledgeSnapshot, input),
  getHolonSyncStatus: (): Promise<HolonSyncStatus> => ipcRenderer.invoke(desktopIpcChannels.holon.getSyncStatus),
  listLearningCandidates: (input?: LearningListInput) => ipcRenderer.invoke(desktopIpcChannels.learning.listCandidates, input),
  searchPrivateKnowledge: (input: LearningSearchInput) => ipcRenderer.invoke(desktopIpcChannels.learning.searchPrivateKnowledge, input),
  approveLearningCandidate: (input: LearningCandidateInput) => ipcRenderer.invoke(desktopIpcChannels.learning.approveCandidate, input),
  rejectLearningCandidate: (input: LearningCandidateInput) => ipcRenderer.invoke(desktopIpcChannels.learning.rejectCandidate, input),
  rollbackPrivateSkill: (input: LearningRollbackInput) => ipcRenderer.invoke(desktopIpcChannels.learning.rollbackPrivateSkill, input),
  syncUserKnowledge: (input?: { projectWorkspacePath?: string; projectKey?: string; forceFullPull?: boolean }) =>
    ipcRenderer.invoke(desktopIpcChannels.knowledge.sync, input ?? {}),
  submitHolonFeedback: (input: HolonFeedbackInput) => ipcRenderer.invoke(desktopIpcChannels.holon.submitFeedback, input),
  queueWorkspaceScan: () => ipcRenderer.invoke(desktopIpcChannels.core.queueWorkspaceScan),
  queueGitStatus: () => ipcRenderer.invoke(desktopIpcChannels.core.queueGitStatus),
  queueShellCommand: (command: string) => ipcRenderer.invoke(desktopIpcChannels.core.queueShellCommand, command),
  openSystemTerminal: (cwd: string) => ipcRenderer.invoke(desktopIpcChannels.terminal.openSystem, cwd),
  respondApproval: (input: RespondApprovalInput) => ipcRenderer.invoke(desktopIpcChannels.core.respondApproval, input),
  generatePatch: (input: GeneratePatchInput) =>
    ipcRenderer.invoke(desktopIpcChannels.core.generatePatch, input),
  applyPatch: () => ipcRenderer.invoke(desktopIpcChannels.core.applyPatch),
  getModelConfig: (): Promise<ModelConfig> => ipcRenderer.invoke(desktopIpcChannels.model.getConfig),
  generateResearchWritingIntake: (input: ResearchWritingIntakeInput) => ipcRenderer.invoke(desktopIpcChannels.researchWriting.generateIntake, input),
  reviewResearchWriting: (payload: ResearchWritingPayload) =>
    ipcRenderer.invoke(desktopIpcChannels.researchWriting.review, payload),
  exportResearchWriting: (input: ResearchWritingExportInput) =>
    ipcRenderer.invoke(desktopIpcChannels.researchWriting.export, input),
  getDesktopPreferences: (): Promise<DesktopPreferences> => ipcRenderer.invoke(desktopIpcChannels.preferences.get),
  saveDesktopPreferences: (preferences: DesktopPreferences): Promise<DesktopPreferences> =>
    ipcRenderer.invoke(desktopIpcChannels.preferences.save, preferences),
  getDesktopBootstrapStatus: (): Promise<DesktopBootstrapStatus> => ipcRenderer.invoke(desktopIpcChannels.bootstrap.getStatus),
  startDesktopBootstrap: (): Promise<DesktopBootstrapStatus> => ipcRenderer.invoke(desktopIpcChannels.bootstrap.start),
  retryDesktopCondaBootstrap: (): Promise<DesktopBootstrapStatus> => ipcRenderer.invoke(desktopIpcChannels.bootstrap.retryConda),
  getMcpServers: (): Promise<McpServerConfig[]> => ipcRenderer.invoke(desktopIpcChannels.mcp.getServers),
  getFeatureConfig: (): Promise<FeatureConfigPayload> => ipcRenderer.invoke(desktopIpcChannels.features.getConfig),
  listRepositoryPlugins: (input: PluginCatalogQuery = {}): Promise<PluginCatalogSnapshot> =>
    ipcRenderer.invoke(desktopIpcChannels.plugins.list, input),
  getRepositoryPlugin: (input: PluginKeyInput): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke(desktopIpcChannels.plugins.get, input),
  installRepositoryPlugin: (input: PluginInstallInput): Promise<PluginOperationResult> =>
    ipcRenderer.invoke(desktopIpcChannels.plugins.install, input),
  setRepositoryPluginEnabled: (input: PluginSetEnabledInput): Promise<PluginOperationResult> =>
    ipcRenderer.invoke(desktopIpcChannels.plugins.setEnabled, input),
  removeRepositoryPlugin: (input: PluginKeyInput): Promise<PluginOperationResult> =>
    ipcRenderer.invoke(desktopIpcChannels.plugins.remove, input),
  reconcileRepositoryPlugins: (): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke(desktopIpcChannels.plugins.reconcile),
  addFeatureItem: (input: AddFeatureItemInput): Promise<FeatureConfigPayload> => ipcRenderer.invoke(desktopIpcChannels.features.addItem, input),
  updateFeatureItem: (input: UpdateFeatureItemInput): Promise<FeatureConfigPayload> => ipcRenderer.invoke(desktopIpcChannels.features.updateItem, input),
  deleteFeatureItem: (input: DeleteFeatureItemInput): Promise<FeatureConfigPayload> => ipcRenderer.invoke(desktopIpcChannels.features.deleteItem, input),
  searchOpenClawSkills: (input: OpenClawSkillSearchInput = {}): Promise<OpenClawSkillSearchHit[]> =>
    ipcRenderer.invoke(desktopIpcChannels.openclawSkills.search, input),
  installOpenClawSkillFromClawHub: (input: OpenClawSkillInstallClawHubInput): Promise<OpenClawSkillInstallResultPayload> =>
    ipcRenderer.invoke(desktopIpcChannels.openclawSkills.installClawHub, input),
  installOpenClawSkillFromPath: (input: OpenClawSkillInstallPathInput): Promise<OpenClawSkillInstallResultPayload> =>
    ipcRenderer.invoke(desktopIpcChannels.openclawSkills.installPath, input),
  selectAndInstallOpenClawSkill: (input: OpenClawSkillSelectInstallInput = {}): Promise<OpenClawSkillInstallResultPayload | null> =>
    ipcRenderer.invoke(desktopIpcChannels.openclawSkills.selectAndInstall, input),
  inspectOpenClawSkillPath: (input: OpenClawSkillInspectPathInput): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke(desktopIpcChannels.openclawSkills.inspectPath, input),
  exportOpenClawSkillZip: (input: OpenClawSkillExportZipInput): Promise<OpenClawSkillExportZipResult> =>
    ipcRenderer.invoke(desktopIpcChannels.openclawSkills.exportZip, input),
  uninstallWritingSkills: (input: UninstallWritingSkillsInput = {}): Promise<UninstallWritingSkillsResult> =>
    ipcRenderer.invoke(desktopIpcChannels.openclawSkills.uninstallWritingSkills, input),
  searchWorkspaces: (query: string): Promise<SearchResultSpec[]> => ipcRenderer.invoke(desktopIpcChannels.search.workspaces, query),
  readWorkspaceFile: (input: WorkspaceFileInput): Promise<{
    path: string;
    name: string;
    language: string;
    content: string;
    binary: boolean;
    truncated: boolean;
    size: number;
  }> => ipcRenderer.invoke(desktopIpcChannels.workspaceFiles.read, input),
  previewWorkspaceFile: (input: WorkspaceFileInput): Promise<WorkspaceArtifactPreview> =>
    ipcRenderer.invoke(desktopIpcChannels.workspaceFiles.preview, input),
  openWorkspaceFile: (input: WorkspaceFileInput): Promise<{ ok: boolean; detail: string; path: string }> =>
    ipcRenderer.invoke(desktopIpcChannels.workspaceFiles.open, input),
  performWorkspaceFileAction: (input: WorkspaceFileActionInput): Promise<{ ok: boolean; detail: string; content?: string }> =>
    ipcRenderer.invoke(desktopIpcChannels.workspaceFiles.performAction, input),
  startMobilePairing: (): Promise<MobilePairingState> => ipcRenderer.invoke(desktopIpcChannels.mobile.startPairing),
  getMobilePairingStatus: (): Promise<MobilePairingState> => ipcRenderer.invoke(desktopIpcChannels.mobile.getPairingStatus),
  stopMobilePairing: (): Promise<MobilePairingState> => ipcRenderer.invoke(desktopIpcChannels.mobile.stopPairing),
  listWorkspaces: (): Promise<WorkspaceCatalogItem[]> => ipcRenderer.invoke(desktopIpcChannels.workspace.list),
  addWorkspace: (input: AddWorkspaceInput): Promise<WorkspaceCatalogItem[]> =>
    ipcRenderer.invoke(desktopIpcChannels.workspace.add, input),
  createBlankWorkspace: (input: CreateBlankWorkspaceInput): Promise<WorkspaceCatalogItem[]> =>
    ipcRenderer.invoke(desktopIpcChannels.workspace.createBlank, input),
  selectWorkspaceFolder: (): Promise<string | null> =>
    ipcRenderer.invoke(desktopIpcChannels.workspace.selectFolder),
  selectComposerImages: (): Promise<{
    attachments: ComposerAttachment[];
    skipped: Array<{ name: string; reason: string }>;
    detail: string;
  }> => ipcRenderer.invoke(desktopIpcChannels.composer.selectImages),
  openComposerAttachment: (input: OpenComposerAttachmentInput): Promise<{ ok: boolean; detail: string }> =>
    ipcRenderer.invoke(desktopIpcChannels.composer.openAttachment, input),
  showInputContextMenu: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(desktopIpcChannels.window.showInputContextMenu),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  saveComposerClipboardFile: (input: SaveComposerClipboardFileInput): Promise<ComposerAttachment> =>
    ipcRenderer.invoke(desktopIpcChannels.composer.saveClipboardFile, input),
  renameWorkspace: (input: RenameWorkspaceInput): Promise<WorkspaceCatalogItem[]> =>
    ipcRenderer.invoke(desktopIpcChannels.workspace.rename, input),
  removeWorkspace: (input: WorkspaceIdInput): Promise<WorkspaceCatalogItem[]> =>
    ipcRenderer.invoke(desktopIpcChannels.workspace.remove, input),
  openWorkspaceLocation: (input: OpenWorkspaceLocationInput): Promise<{ ok: boolean; detail: string }> =>
    ipcRenderer.invoke(desktopIpcChannels.workspace.openLocation, input),
  openSkillLocation: (input: OpenSkillLocationInput): Promise<{ ok: boolean; detail: string }> =>
    ipcRenderer.invoke(desktopIpcChannels.system.openSkillLocation, input),
  reportRendererFailure: (input: RendererFailureInput): Promise<{ ok: boolean; id: string }> =>
    ipcRenderer.invoke(desktopIpcChannels.system.reportRendererFailure, input),
  reportRendererDiagnostic: (input: RendererDiagnosticInput): Promise<{ ok: boolean; id: string }> =>
    ipcRenderer.invoke(desktopIpcChannels.system.reportRendererDiagnostic, input),
  synthesizeNovelSpeech: (input: SynthesizeNovelSpeechInput): Promise<SynthesizeNovelSpeechResult> =>
    ipcRenderer.invoke(desktopIpcChannels.system.synthesizeNovelSpeech, input),
  cancelNovelSpeech: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(desktopIpcChannels.system.cancelNovelSpeech),
  createUsageExceptionFeedbackPreview: (
    input: CreateUsageExceptionFeedbackPreviewInput
  ): Promise<UsageExceptionFeedbackPreview> =>
    ipcRenderer.invoke(desktopIpcChannels.usageExceptionFeedback.createPreview, input),
  confirmUsageExceptionFeedback: (
    input: ConfirmUsageExceptionFeedbackInput
  ): Promise<UsageExceptionFeedbackSubmissionResult> =>
    ipcRenderer.invoke(desktopIpcChannels.usageExceptionFeedback.confirm, input),
  getAppUpdateStatus: (): Promise<DesktopAppUpdateStatus> =>
    ipcRenderer.invoke(desktopIpcChannels.appUpdate.getStatus),
  startAppUpdate: (): Promise<DesktopAppUpdateStartResult> =>
    ipcRenderer.invoke(desktopIpcChannels.appUpdate.start),
  applyAppUpdate: (): Promise<DesktopAppUpdateStartResult> =>
    ipcRenderer.invoke(desktopIpcChannels.appUpdate.apply),
  getAppliedAppUpdate: (): Promise<import("@codex-forge/protocol").DesktopAppUpdateAppliedInfo | null> =>
    ipcRenderer.invoke(desktopIpcChannels.appUpdate.getApplied),
  dismissAppliedAppUpdate: (): Promise<void> =>
    ipcRenderer.invoke(desktopIpcChannels.appUpdate.dismissApplied),
  skipAppUpdateVersion: (version?: string): Promise<{ ok: boolean; detail: string }> =>
    ipcRenderer.invoke(desktopIpcChannels.appUpdate.skipVersion, version),
  verifyAppUpdate: (input?: DesktopAppUpdateVerifyInput): Promise<DesktopAppUpdateVerifyResult> =>
    ipcRenderer.invoke(desktopIpcChannels.appUpdate.verify, input),
  onAppUpdateProgress: (
    listener: (progress: import("@codex-forge/protocol").DesktopAppUpdateProgress) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: import("@codex-forge/protocol").DesktopAppUpdateProgress
    ) => listener(progress);
    ipcRenderer.on(desktopIpcChannels.appUpdate.progress, handler);
    return () => ipcRenderer.removeListener(desktopIpcChannels.appUpdate.progress, handler);
  },
  openLogLocation: (): Promise<OpenLogLocationResult> => ipcRenderer.invoke(desktopIpcChannels.system.openLogLocation),
  getWorkspaceHeaderStatus: (workspaceId: string): Promise<WorkspaceHeaderStatus> =>
    ipcRenderer.invoke(desktopIpcChannels.workspaceGit.getHeaderStatus, workspaceId),
  getReviewChanges: (input: WorkspaceReviewInput): Promise<WorkspaceReviewChanges> => ipcRenderer.invoke(desktopIpcChannels.workspaceGit.getReviewChanges, input),
  getWorkspaceBranches: (workspaceId: string): Promise<WorkspaceBranchStatus> => ipcRenderer.invoke(desktopIpcChannels.workspaceGit.getBranches, workspaceId),
  switchWorkspaceBranch: (input: SwitchWorkspaceBranchInput): Promise<WorkspaceBranchStatus> => ipcRenderer.invoke(desktopIpcChannels.workspaceGit.switchBranch, input),
  recordMessageFeedback: (input: RecordMessageFeedbackInput): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(desktopIpcChannels.workspaceGit.recordFeedback, input),
  addWorkspaceThread: (input: AddWorkspaceThreadInput): Promise<WorkspaceCatalogItem[]> => ipcRenderer.invoke(desktopIpcChannels.workspace.addThread, input),
  forkWorkspaceThread: (input: ForkWorkspaceThreadInput): Promise<WorkspaceCatalogItem[]> => ipcRenderer.invoke(desktopIpcChannels.workspace.forkThread, input),
  runDelegatedAgent: (input: RunDelegatedAgentInput) => ipcRenderer.invoke(desktopIpcChannels.collaboration.run, input),
  listDelegatedAgents: (input: ListDelegatedAgentsInput) => ipcRenderer.invoke(desktopIpcChannels.collaboration.list, input),
  respondDelegatedAgentApproval: (input: RespondDelegatedAgentApprovalInput) => ipcRenderer.invoke(desktopIpcChannels.collaboration.respondApproval, input),
  mergeDelegatedAgentResults: (input: MergeDelegatedAgentResultsInput) => ipcRenderer.invoke(desktopIpcChannels.collaboration.mergeResults, input),
  // Reserved for the worktree settings flow. Keep this exposed only while the
  // main-process handler remains audited for workspace-id validation.
  createWorkspaceWorktree: (input: CreateWorkspaceWorktreeInput): Promise<{ ok: boolean; detail: string; path: string }> =>
    ipcRenderer.invoke(desktopIpcChannels.workspaceGit.createWorktree, input),
  renameWorkspaceThread: (input: RenameWorkspaceThreadInput): Promise<WorkspaceCatalogItem[]> => ipcRenderer.invoke(desktopIpcChannels.workspace.renameThread, input),
  archiveWorkspaceThread: (input: ArchiveWorkspaceThreadInput): Promise<WorkspaceCatalogItem[]> => ipcRenderer.invoke(desktopIpcChannels.workspace.archiveThread, input),
  deleteWorkspaceThread: (input: WorkspaceThreadInput): Promise<WorkspaceCatalogItem[]> => ipcRenderer.invoke(desktopIpcChannels.workspace.deleteThread, input),
  activateWorkspaceThread: (input: ActivateWorkspaceThreadInput) => ipcRenderer.invoke(desktopIpcChannels.workspace.activateThread, input),
  exportWorkspaceThreadHtml: (input: ExportWorkspaceThreadHtmlInput): Promise<ExportWorkspaceThreadHtmlResult> =>
    ipcRenderer.invoke(desktopIpcChannels.workspace.exportThreadHtml, input),
  saveModelConfig: (config: ModelConfig): Promise<ModelConfig> =>
    ipcRenderer.invoke(desktopIpcChannels.model.saveConfig, config),
  listCustomModelEndpoints: () => ipcRenderer.invoke(desktopIpcChannels.customModels.list),
  saveCustomModelEndpoint: (input: { label: string; baseUrl: string; apiKey: string; model: string }) =>
    ipcRenderer.invoke(desktopIpcChannels.customModels.save, input),
  deleteCustomModelEndpoint: (input: { id: string }) => ipcRenderer.invoke(desktopIpcChannels.customModels.delete, input),
  selectCustomModelEndpoint: (input: { id: string }) => ipcRenderer.invoke(desktopIpcChannels.customModels.select, input),
  saveMcpServers: (servers: McpServerConfig[]) => ipcRenderer.invoke(desktopIpcChannels.mcp.saveServers, servers),
  testMcpServer: (server: McpServerConfig): Promise<McpServerHealth> => ipcRenderer.invoke(desktopIpcChannels.mcp.testServer, server),
  startMcpServer: (server: McpServerConfig): Promise<McpServerHealth> => ipcRenderer.invoke(desktopIpcChannels.mcp.startServer, server),
  stopMcpServer: (server: McpServerConfig): Promise<McpServerHealth> => ipcRenderer.invoke(desktopIpcChannels.mcp.stopServer, server),
  getMcpServerLogs: (serverId: string): Promise<string[]> => ipcRenderer.invoke(desktopIpcChannels.mcp.getLogs, serverId),
  clearMcpServerLogs: (serverId: string): Promise<string[]> => ipcRenderer.invoke(desktopIpcChannels.mcp.clearLogs, serverId),
  inspectMcpServer: (server: McpServerConfig): Promise<McpServerInspection> => ipcRenderer.invoke(desktopIpcChannels.mcp.inspectServer, server),
  getMcpDiscoveredTools: (): Promise<McpDiscoveredTool[]> => ipcRenderer.invoke(desktopIpcChannels.mcp.getDiscoveredTools),
  getSystemTools: (): Promise<SystemToolEntry[]> => ipcRenderer.invoke(desktopIpcChannels.system.getTools),
  getPolicyRules: (): Promise<DesktopPolicyRule[]> => ipcRenderer.invoke(desktopIpcChannels.policy.getRules),
  savePolicyRules: (rules: DesktopPolicyRule[]): Promise<DesktopPolicyRule[]> =>
    ipcRenderer.invoke(desktopIpcChannels.policy.saveRules, rules),
  openSystemTool: (input: string | OpenSystemToolInput): Promise<{ ok: boolean; detail: string }> =>
    ipcRenderer.invoke(desktopIpcChannels.system.openTool, input),
  openBrowserPreview: (url?: string): Promise<{ ok: boolean; url: string }> => ipcRenderer.invoke(desktopIpcChannels.browser.openPreview, url),
  closeBrowserPreview: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(desktopIpcChannels.browser.closePreview),
  captureBrowserPreview: (): Promise<{ ok: boolean; path: string; url: string }> => ipcRenderer.invoke(desktopIpcChannels.browser.capturePreview),
  clearBrowserBrowsingData: (): Promise<{ ok: boolean; detail: string }> =>
    ipcRenderer.invoke(desktopIpcChannels.browser.clearBrowsingData),
  listBrowserHistory: (): Promise<Array<{ id: string; url: string; title: string; visitedAt: string }>> =>
    ipcRenderer.invoke(desktopIpcChannels.browser.listHistory),
  removeBrowserHistoryEntry: (id: string): Promise<Array<{ id: string; url: string; title: string; visitedAt: string }>> =>
    ipcRenderer.invoke(desktopIpcChannels.browser.removeHistoryEntry, id),
  clearBrowserHistory: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(desktopIpcChannels.browser.clearHistory),
  selectBrowserDownloadDir: (): Promise<{ path: string } | null> =>
    ipcRenderer.invoke(desktopIpcChannels.browser.selectDownloadDir),
  listBrowserCredentials: (): Promise<Array<{ id: string; origin: string; username: string; hasPassword: boolean; updatedAt: string }>> =>
    ipcRenderer.invoke(desktopIpcChannels.browser.listCredentials),
  upsertBrowserCredential: (input: {
    origin: string;
    username: string;
    password: string;
    id?: string;
  }): Promise<Array<{ id: string; origin: string; username: string; hasPassword: boolean; updatedAt: string }>> =>
    ipcRenderer.invoke(desktopIpcChannels.browser.upsertCredential, input),
  removeBrowserCredential: (
    id: string
  ): Promise<Array<{ id: string; origin: string; username: string; hasPassword: boolean; updatedAt: string }>> =>
    ipcRenderer.invoke(desktopIpcChannels.browser.removeCredential, id),
  listBrowserContacts: (): Promise<Array<{ id: string; name: string; email: string; phone: string; updatedAt: string }>> =>
    ipcRenderer.invoke(desktopIpcChannels.browser.listContacts),
  upsertBrowserContact: (input: {
    name: string;
    email?: string;
    phone?: string;
    id?: string;
  }): Promise<Array<{ id: string; name: string; email: string; phone: string; updatedAt: string }>> =>
    ipcRenderer.invoke(desktopIpcChannels.browser.upsertContact, input),
  removeBrowserContact: (
    id: string
  ): Promise<Array<{ id: string; name: string; email: string; phone: string; updatedAt: string }>> =>
    ipcRenderer.invoke(desktopIpcChannels.browser.removeContact, id),
  getBrowserCdpAccess: (): Promise<{ enabled: boolean; partition: string; detail: string }> =>
    ipcRenderer.invoke(desktopIpcChannels.browser.getCdpAccess),
  probeBrowserSiteTools: (): Promise<{ origin: string; enabled: boolean; endpoints: string[]; detail: string }> =>
    ipcRenderer.invoke(desktopIpcChannels.browser.probeSiteTools),
  controlWindow: (action: WindowControlAction): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(desktopIpcChannels.window.control, action),
  showAppMenu: (input: ShowAppMenuInput): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(desktopIpcChannels.window.showAppMenu, input),
  onAppCommand: (listener: (command: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, command: string) => listener(command);
    ipcRenderer.on(desktopIpcChannels.window.appCommand, handler);
    return () => ipcRenderer.removeListener(desktopIpcChannels.window.appCommand, handler);
  },
  onDictationCommand: (
    listener: (command: { action: "start" | "toggle"; source: "hold" | "toggle" }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      command: { action: "start" | "toggle"; source: "hold" | "toggle" }
    ) => listener(command);
    ipcRenderer.on(desktopIpcChannels.window.dictationCommand, handler);
    return () => ipcRenderer.removeListener(desktopIpcChannels.window.dictationCommand, handler);
  },
  onMobileAction: (
    listener: (action: { action: string; workspaceId?: string; threadId?: string }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      action: { action: string; workspaceId?: string; threadId?: string }
    ) => listener(action);
    ipcRenderer.on(desktopIpcChannels.mobile.action, handler);
    return () => ipcRenderer.removeListener(desktopIpcChannels.mobile.action, handler);
  },
  onAssistantActivity: (
    listener: (activity: { type: "patch" | "run" | "complete"; title: string; detail: string; requestId?: string; [key: string]: unknown }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      activity: { type: "patch" | "run" | "complete"; title: string; detail: string; requestId?: string; [key: string]: unknown }
    ) => listener(activity);
    ipcRenderer.on(desktopIpcChannels.events.assistantActivity, handler);
    return () => ipcRenderer.removeListener(desktopIpcChannels.events.assistantActivity, handler);
  },
  onOpenWorkspaceFilePreview: (
    listener: (event: OpenWorkspaceFilePreviewEvent) => void
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: OpenWorkspaceFilePreviewEvent) => listener(payload);
    ipcRenderer.on(desktopIpcChannels.events.openWorkspaceFilePreview, handler);
    return () => ipcRenderer.removeListener(desktopIpcChannels.events.openWorkspaceFilePreview, handler);
  },
  onModelStreamDelta: (
    listener: (update: { requestId: string; delta: string; reset?: boolean }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      update: { requestId: string; delta: string; reset?: boolean }
    ) => listener(update);
    ipcRenderer.on(desktopIpcChannels.model.streamDelta, handler);
    return () => ipcRenderer.removeListener(desktopIpcChannels.model.streamDelta, handler);
  },
  onModelReasoningDelta: (
    listener: (update: { requestId: string; delta: string; reset?: boolean }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      update: { requestId: string; delta: string; reset?: boolean }
    ) => listener(update);
    ipcRenderer.on(desktopIpcChannels.events.modelReasoningDelta, handler);
    return () => ipcRenderer.removeListener(desktopIpcChannels.events.modelReasoningDelta, handler);
  },
  onSnapshotUpdate: (listener: (snapshot: PhaseOneSnapshot) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: PhaseOneSnapshot) => listener(snapshot);
    ipcRenderer.on(desktopIpcChannels.events.snapshotUpdate, handler);
    return () => ipcRenderer.removeListener(desktopIpcChannels.events.snapshotUpdate, handler);
  },
  onQuantMarketUpdated: (listener: (payload: { projectId: string; query: unknown; bars: unknown[] }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { projectId: string; query: unknown; bars: unknown[] }) => listener(payload);
    ipcRenderer.on(desktopIpcChannels.events.quantMarketUpdated, handler);
    return () => ipcRenderer.removeListener(desktopIpcChannels.events.quantMarketUpdated, handler);
  },
  onQuantScreenerUpdated: (listener: (payload: { projectId: string; result: unknown }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { projectId: string; result: unknown }) => listener(payload);
    ipcRenderer.on(desktopIpcChannels.events.quantScreenerUpdated, handler);
    return () => ipcRenderer.removeListener(desktopIpcChannels.events.quantScreenerUpdated, handler);
  },
  onQuantPortfolioUpdated: (listener: (payload: { projectId: string; skillId?: string; title?: string; activity?: unknown; deleted?: boolean; schedule?: unknown; note?: unknown }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { projectId: string; skillId?: string; title?: string; activity?: unknown; deleted?: boolean; schedule?: unknown; note?: unknown }) => listener(payload);
    ipcRenderer.on(desktopIpcChannels.events.quantPortfolioUpdated, handler);
    return () => ipcRenderer.removeListener(desktopIpcChannels.events.quantPortfolioUpdated, handler);
  },
  onDataWorkspaceUpdated: (listener: (payload: { projectId: string; reason?: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { projectId: string; reason?: string }) => listener(payload);
    ipcRenderer.on(desktopIpcChannels.events.dataWorkspaceUpdated, handler);
    return () => ipcRenderer.removeListener(desktopIpcChannels.events.dataWorkspaceUpdated, handler);
  },
  getTerminalSession: (): Promise<TerminalSessionSnapshot> => ipcRenderer.invoke(desktopIpcChannels.terminal.getSession),
  writeTerminalInput: (input: string): Promise<TerminalSessionSnapshot> => ipcRenderer.invoke(desktopIpcChannels.terminal.writeInput, input),
  restartTerminalSession: (): Promise<TerminalSessionSnapshot> => ipcRenderer.invoke(desktopIpcChannels.terminal.restartSession),
  onTerminalUpdate: (listener: (snapshot: TerminalSessionSnapshot) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, snapshot: TerminalSessionSnapshot) => listener(snapshot);
    ipcRenderer.on(desktopIpcChannels.terminal.update, subscription);
    return () => ipcRenderer.removeListener(desktopIpcChannels.terminal.update, subscription);
  },
  callMcpTool: (input: McpToolCallInput): Promise<McpToolCallResult> =>
    ipcRenderer.invoke(desktopIpcChannels.mcp.callTool, input),
  chatWithModel: (input: ModelChatInput) => ipcRenderer.invoke(desktopIpcChannels.model.chat, input),
  cancelModelRequest: (input?: CancelModelRequestInput) => ipcRenderer.invoke(desktopIpcChannels.model.cancelRequest, input),
  guideModelRequest: (input: GuideModelRequestInput) => ipcRenderer.invoke(desktopIpcChannels.model.guideRequest, input)
});
