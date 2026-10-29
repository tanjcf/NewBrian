import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
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
  MobilePairingState,
  PhaseOneSnapshot,
  PluginSpec,
  RendererDiagnosticInput,
  RendererFailureInput,
  SearchResultSpec,
  SkillSpec,
  SynthesizeNovelSpeechInput,
  SynthesizeNovelSpeechResult,
  WorkspaceCatalogItem
} from "@codex-forge/protocol";
import { brainWorkspaceIpcChannels, desktopIpcChannels } from "@codex-forge/protocol";

interface McpServerConfig {
  id: string;
  name: string;
  transport: "stdio" | "sse";
  command: string;
  args: string[];
  url: string;
  env: Record<string, string>;
  enabled: boolean;
}

interface McpServerHealth {
  ok: boolean;
  code?: string;
  detail: string;
  checkedAt: string;
  running?: boolean;
}

interface McpServerInspection {
  ok: boolean;
  detail: string;
  checkedAt: string;
  serverInfo?: string;
  protocolVersion?: string;
  tools: Array<{ name: string; description: string; inputSchema?: Record<string, unknown> }>;
}

interface McpDiscoveredTool {
  id: string;
  serverId: string;
  serverName: string;
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  protocolVersion?: string;
  discoveredAt: string;
}

interface McpToolCallResult {
  ok: boolean;
  toolName: string;
  serverName: string;
  detail: string;
  content: string;
}

interface SystemToolEntry {
  id: string;
  label: string;
  kind: "developer" | "system";
  icon: string;
  available: boolean;
}

interface TerminalSessionSnapshot {
  cwd: string;
  shell: string;
  prompt: string;
  isRunning: boolean;
  lines: string[];
  launchedAt?: string;
  lastExitCode?: number | null;
}

interface DesktopAgreementConfig {
  enabled: boolean;
  tos_title?: string;
  tos_content_html?: string;
  policy_title?: string;
  policy_content_html?: string;
}

interface DesktopAuthStatus {
  authenticated: boolean;
  loading: boolean;
  mode: "session_cookie" | "desktop_token" | "none";
  base_url: string;
  user?: {
    email: string;
    display_name: string;
    role: string;
    plan: string;
    avatar_text: string;
  };
  agreement?: DesktopAgreementConfig;
  last_error?: string;
  last_checked_at?: string;
}

interface DesktopBootstrapStatus {
  overall: {
    status: "ready" | "manual_required" | "pending" | "running";
    currentTaskId?: string;
    message?: string;
    updatedAt?: string;
    totalTasks: number;
    completedTasks: number;
    progressPercent: number;
  };
  tasks: Array<{
    id: string;
    label: string;
    status: "pending" | "running" | "ready" | "manual_required";
    detail?: string;
    startedAt?: string;
    completedAt?: string;
  }>;
  conda: {
    status: "ready" | "manual_required" | "pending";
    initializedAt?: string;
    updatedAt?: string;
    source?: "system" | "managed";
    condaPath?: string;
    reason?: string;
  };
}

interface DesktopPreferences {
  appearance: {
    theme: "light" | "dark" | "system";
    density: "comfortable" | "compact";
    reduceMotion: boolean;
    accentColor: string;
    backgroundColor: string;
    foregroundColor: string;
    uiFontFamily: string;
    codeFontFamily: string;
    contrast: number;
    uiFontSize: number;
    codeFontSize: number;
    sidebarTranslucent: boolean;
    pointerCursor: boolean;
    diffMarks: "color" | "marks";
  };
  configuration: {
    requireApprovalForShell: boolean;
    saveResponses: boolean;
    telemetryEnabled: boolean;
  };
  personalization: {
    workMode: "coding" | "everyday";
    proactiveUpdates: boolean;
    includeVerificationSummary: boolean;
    reviewFindingsFirst: boolean;
  };
  permissions: {
    fullAccess: boolean;
  };
  hooks: {
    beforeCommand: boolean;
    afterCommand: boolean;
    beforeCommit: boolean;
    afterTask: boolean;
    beforeCommandScript: string;
    afterCommandScript: string;
    beforeCommitScript: string;
    afterTaskScript: string;
  };
  git: {
    statusCommand: string;
    branchPrefix: string;
    showDiffBeforeCommit: boolean;
    confirmBeforePush: boolean;
    pullRequestMergeMethod: "merge" | "squash";
    forcePushWithLease: boolean;
    createDraftPullRequests: boolean;
    autoDeleteOldWorktrees: boolean;
    autoDeleteWorktreeLimit: number;
    commitInstructions: string;
  };
  environment: {
    defaultOpenTarget: "visual-studio" | "system" | "explorer";
    terminalShell: string;
    extraEnv: Record<string, string>;
    autoBootstrapConda: boolean;
  };
  editor: {
    language: "auto" | "zh-CN" | "en-US";
    sendShortcut: "enter" | "mod-enter";
    followBehavior: "queue" | "guide";
  };
  popup: {
    shortcut: string;
    defaultProjectlessChat: boolean;
  };
  dictation: {
    microphone: "system" | "default";
    holdShortcut: string;
    toggleShortcut: string;
    keepBarVisible: boolean;
    dictionaryOpen: boolean;
    dictionaryEntries: Array<{ timestamp: string; phrase: string }>;
  };
  worktree: {
    defaultIsolated: boolean;
    keepArchived: boolean;
    rootDir: string;
  };
  browser: {
    autoOpenPreview: boolean;
    preserveTabs: boolean;
    highResScreenshots: boolean;
    previewUrl: string;
  };
  shortcuts: Record<string, string>;
}

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
  exportBrainGameDesign: (input: BrainProjectGetInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.gameDesignExport, input),
  getBrainGameLevelEditor: (input: BrainProjectGetInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.gameLevelEditorGet, input),
  saveBrainGameLevelEditor: (input: { projectId: string; state: unknown }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.gameLevelEditorSave, input),
  spawnBrainGameActor: (input: { projectId: string; kind: "enemy" | "boss" | "npc"; levelIndex?: number }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.gameSpawnActor, input),
  getBrainGameContentTree: (input: BrainProjectGetInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.gameContentTree, input),
  getBrainVideoPipeline: (input: BrainProjectGetInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.videoPipelineGet, input),
  saveBrainVideoPipeline: (input: { projectId: string; state: unknown }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.videoPipelineSave, input),
  markBrainVideoShot: (input: { projectId: string; shotIndex: number; ready: boolean }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.videoMarkShot, input),
  cookBrainVideoPipeline: (input: BrainProjectGetInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.videoPipelineCook, input),
  getBrainMusicDaw: (input: BrainProjectGetInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.musicDawGet, input),
  saveBrainMusicDaw: (input: { projectId: string; state: unknown }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.musicDawSave, input),
  cookBrainMusicDaw: (input: BrainProjectGetInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.musicDawCook, input),
  getBrainDataAnalysis: (input: BrainProjectGetInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.dataAnalysisGet, input),
  saveBrainDataAnalysis: (input: { projectId: string; state: unknown }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.dataAnalysisSave, input),
  cookBrainDataAnalysis: (input: BrainProjectGetInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.dataAnalysisCook, input),
  listSoftwareScripts: (input: { projectId: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.softwareScriptsList, input),
  startSoftwareTask: (input: { projectId: string; scriptId: string; conversationId?: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.softwareTaskStart, input),
  getSoftwareTaskStatus: (input: { taskId: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.softwareTaskStatus, input),
  cancelSoftwareTask: (input: { taskId: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.softwareTaskCancel, input),
  openSoftwareProjectTerminal: (input: BrainProjectGetInput): Promise<{ ok: boolean }> => ipcRenderer.invoke(brainWorkspaceIpcChannels.softwareTerminalOpen, input),
  saveBrainFlow: (input: BrainFlowSaveInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.flowSave, input),
  getBrainFlow: (input: BrainFlowIdInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.flowGet, input),
  startBrainFlow: (input: BrainFlowStartInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.flowRunStart, input),
  getBrainFlowRun: (input: BrainFlowRunIdInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.flowRunGet, input),
  cancelBrainFlow: (input: BrainFlowRunIdInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.flowRunCancel, input),
  createBrainFlowSchedule: (input: BrainFlowScheduleCreateInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.flowScheduleCreate, input),
  listBrainFlowSchedules: (input: BrainFlowScheduleListInput) => ipcRenderer.invoke(brainWorkspaceIpcChannels.flowScheduleList, input),
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
  listQuantProjectSkills: (input: { projectId: string }) => ipcRenderer.invoke(brainWorkspaceIpcChannels.quantSkillList, input),
  runQuantSkillSimulation: (input: {
    projectId: string;
    skillId: string;
    title?: string;
    strategyId?: string;
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
  bootstrap: () => ipcRenderer.invoke("phase1:bootstrap"),
  getSnapshot: () => ipcRenderer.invoke("phase1:get-snapshot"),
  getGoal: (input?: { threadId?: string }) => ipcRenderer.invoke("phase1:get-goal", input),
  createGoal: (input: { objective: string; tokenBudget?: number; threadId: string }) => ipcRenderer.invoke("phase1:create-goal", input),
  updateGoal: (input: { status: "complete" | "blocked"; tokensUsed?: number; timeUsedSeconds?: number; threadId: string }) =>
    ipcRenderer.invoke("phase1:update-goal", input),
  getAuthStatus: (): Promise<DesktopAuthStatus> => ipcRenderer.invoke("phase1:get-auth-status"),
  getBillingSubscription: (): Promise<Record<string, unknown>> => ipcRenderer.invoke("phase1:get-billing-subscription"),
  sendLoginCode: (input: {
    email: string;
  }): Promise<Record<string, unknown>> => ipcRenderer.invoke("phase1:send-login-code", input),
  loginAuth: (input: {
    email: string;
    password?: string;
    agreement_accepted: boolean;
    captcha?: string;
  }): Promise<DesktopAuthStatus> => ipcRenderer.invoke("phase1:login-auth", input),
  loadRememberedLogin: () => ipcRenderer.invoke("phase1:load-remembered-login"),
  saveRememberedLogin: (input: {
    version: 1;
    channel: "email" | "phone";
    email: string;
    phone: string;
    password: string;
  }) => ipcRenderer.invoke("phase1:save-remembered-login", input),
  clearRememberedLogin: () => ipcRenderer.invoke("phase1:clear-remembered-login"),
  logoutAuth: (): Promise<DesktopAuthStatus> => ipcRenderer.invoke("phase1:logout-auth"),
  queueWorkspaceScan: () => ipcRenderer.invoke("phase1:queue-workspace-scan"),
  queueGitStatus: () => ipcRenderer.invoke("phase1:queue-git-status"),
  queueShellCommand: (command: string) => ipcRenderer.invoke("phase1:queue-shell-command", command),
  openSystemTerminal: (cwd: string) => ipcRenderer.invoke("phase1:open-system-terminal", cwd),
  respondApproval: (input: boolean | { approved: boolean; requestId?: string }) => ipcRenderer.invoke("phase1:respond-approval", input),
  generatePatch: (input: { filePath: string; searchText: string; replaceText: string }) =>
    ipcRenderer.invoke("phase1:generate-patch", input),
  applyPatch: () => ipcRenderer.invoke("phase1:apply-patch"),
  getModelConfig: () => ipcRenderer.invoke("phase1:get-model-config"),
  getDesktopPreferences: (): Promise<DesktopPreferences> => ipcRenderer.invoke("phase1:get-desktop-preferences"),
  saveDesktopPreferences: (preferences: DesktopPreferences): Promise<DesktopPreferences> =>
    ipcRenderer.invoke("phase1:save-desktop-preferences", preferences),
  getDesktopBootstrapStatus: (): Promise<DesktopBootstrapStatus> => ipcRenderer.invoke("phase1:get-desktop-bootstrap-status"),
  startDesktopBootstrap: (): Promise<DesktopBootstrapStatus> => ipcRenderer.invoke("phase1:start-desktop-bootstrap"),
  retryDesktopCondaBootstrap: (): Promise<DesktopBootstrapStatus> => ipcRenderer.invoke("phase1:retry-desktop-conda-bootstrap"),
  getMcpServers: (): Promise<McpServerConfig[]> => ipcRenderer.invoke("phase1:get-mcp-servers"),
  getFeatureConfig: (): Promise<{
    skills: SkillSpec[];
    plugins: PluginSpec[];
    automations: AutomationSpec[];
  }> => ipcRenderer.invoke("phase1:get-feature-config"),
  addFeatureItem: (input: {
    kind: "skills" | "plugins" | "automations";
    item: Record<string, string>;
  }) => ipcRenderer.invoke("phase1:add-feature-item", input),
  updateFeatureItem: (input: {
    kind: "skills" | "plugins" | "automations";
    id: string;
    item: Record<string, string>;
  }) => ipcRenderer.invoke("phase1:update-feature-item", input),
  deleteFeatureItem: (input: {
    kind: "skills" | "plugins" | "automations";
    id: string;
  }) => ipcRenderer.invoke("phase1:delete-feature-item", input),
  searchWorkspaces: (query: string): Promise<SearchResultSpec[]> => ipcRenderer.invoke("phase1:search-workspaces", query),
  readWorkspaceFile: (input: { workspaceId: string; filePath: string }): Promise<{
    path: string;
    name: string;
    language: string;
    content: string;
    binary: boolean;
    truncated: boolean;
    size: number;
  }> => ipcRenderer.invoke("phase1:read-workspace-file", input),
  startMobilePairing: (): Promise<MobilePairingState> => ipcRenderer.invoke("phase1:start-mobile-pairing"),
  getMobilePairingStatus: (): Promise<MobilePairingState> => ipcRenderer.invoke("phase1:get-mobile-pairing-status"),
  stopMobilePairing: (): Promise<MobilePairingState> => ipcRenderer.invoke("phase1:stop-mobile-pairing"),
  listWorkspaces: (): Promise<WorkspaceCatalogItem[]> => ipcRenderer.invoke("phase1:list-workspaces"),
  addWorkspace: (input: { name: string; path: string }): Promise<WorkspaceCatalogItem[]> =>
    ipcRenderer.invoke("phase1:add-workspace", input),
  createBlankWorkspace: (input: { name: string }): Promise<WorkspaceCatalogItem[]> =>
    ipcRenderer.invoke("phase1:create-blank-workspace", input),
  selectWorkspaceFolder: (): Promise<string | null> =>
    ipcRenderer.invoke("phase1:select-workspace-folder"),
  selectComposerImages: (): Promise<Array<{ name: string; path: string; url: string }>> =>
    ipcRenderer.invoke("phase1:select-composer-images"),
  importComposerAttachments: (input: { paths: string[] }): Promise<Array<{ name: string; path: string; url: string }>> =>
    ipcRenderer.invoke("phase1:import-composer-attachments", input),
  showInputContextMenu: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("phase1:show-input-context-menu"),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  saveComposerClipboardFile: (input: { name: string; mimeType: string; data: ArrayBuffer }): Promise<{ name: string; path: string; url: string }> =>
    ipcRenderer.invoke("phase1:save-composer-clipboard-file", input),
  renameWorkspace: (input: { workspaceId: string; name: string }): Promise<WorkspaceCatalogItem[]> =>
    ipcRenderer.invoke("phase1:rename-workspace", input),
  removeWorkspace: (input: { workspaceId: string }): Promise<WorkspaceCatalogItem[]> =>
    ipcRenderer.invoke("phase1:remove-workspace", input),
  openWorkspaceLocation: (input: { workspaceId: string; target: "finder" | "vscode" | "system" }): Promise<{ ok: boolean; detail: string }> =>
    ipcRenderer.invoke("phase1:open-workspace-location", input),
  openSkillLocation: (input: { id?: string; name?: string }): Promise<{ ok: boolean; detail: string }> =>
    ipcRenderer.invoke("phase1:open-skill-location", input),
  openLogLocation: (): Promise<{
    ok: boolean;
    detail: string;
    path: string;
    files: { debug: string; diagnostics: string; auth: string; sqlite: string };
  }> => ipcRenderer.invoke("phase1:open-log-location"),
  reportRendererFailure: (input: RendererFailureInput): Promise<{ ok: boolean; id: string }> =>
    ipcRenderer.invoke(desktopIpcChannels.system.reportRendererFailure, input),
  reportRendererDiagnostic: (input: RendererDiagnosticInput): Promise<{ ok: boolean; id: string }> =>
    ipcRenderer.invoke(desktopIpcChannels.system.reportRendererDiagnostic, input),
  synthesizeNovelSpeech: (input: SynthesizeNovelSpeechInput): Promise<SynthesizeNovelSpeechResult> =>
    ipcRenderer.invoke(desktopIpcChannels.system.synthesizeNovelSpeech, input),
  cancelNovelSpeech: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(desktopIpcChannels.system.cancelNovelSpeech),
  getWorkspaceHeaderStatus: (workspaceId: string): Promise<{ branch: string; changes: number; additions: number; deletions: number; githubCliAvailable: boolean }> =>
    ipcRenderer.invoke("phase1:get-workspace-header-status", workspaceId),
  getReviewChanges: (input: { workspaceId?: string; threadId?: string }): Promise<{
    workspaceId: string;
    threadId: string;
    files: Array<{ filePath: string; status: string; additions: number; deletions: number; diff: string; source: string }>;
    additions: number;
    deletions: number;
  }> => ipcRenderer.invoke("phase1:get-review-changes", input),
  getWorkspaceBranches: (workspaceId: string): Promise<{ current: string; branches: string[]; changedFiles: number }> => ipcRenderer.invoke("phase1:get-workspace-branches", workspaceId),
  switchWorkspaceBranch: (input: { workspaceId: string; branch: string; create?: boolean }): Promise<{ current: string; branches: string[]; changedFiles: number }> => ipcRenderer.invoke("phase1:switch-workspace-branch", input),
  recordMessageFeedback: (input: { workspaceId?: string; threadId?: string; messageId: string; rating: "helpful" | "unhelpful" }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("phase1:record-message-feedback", input),
  addWorkspaceThread: (input: {
    workspaceId: string;
    title: string;
    summary: string;
    scope?: "project" | "chat";
  }): Promise<WorkspaceCatalogItem[]> => ipcRenderer.invoke("phase1:add-workspace-thread", input),
  forkWorkspaceThread: (input: {
    workspaceId: string;
    sourceThreadId: string;
    title: string;
  }): Promise<WorkspaceCatalogItem[]> => ipcRenderer.invoke("phase1:fork-workspace-thread", input),
  runDelegatedAgent: (input: { workspaceId: string; childThreadId: string }) =>
    ipcRenderer.invoke("phase1:run-delegated-agent", input),
  mergeDelegatedAgentResults: (input: { workspaceId: string; parentThreadId: string; childThreadIds: string[] }) =>
    ipcRenderer.invoke("phase1:merge-delegated-agent-results", input),
  // Reserved for the worktree settings flow. Keep this exposed only while the
  // main-process handler remains audited for workspace-id validation.
  createWorkspaceWorktree: (input: { workspaceId: string; branchName?: string }): Promise<{ ok: boolean; detail: string; path: string }> =>
    ipcRenderer.invoke("phase1:create-workspace-worktree", input),
  renameWorkspaceThread: (input: {
    workspaceId: string;
    threadId: string;
    title: string;
    summary: string;
  }): Promise<WorkspaceCatalogItem[]> => ipcRenderer.invoke("phase1:rename-workspace-thread", input),
  deleteWorkspaceThread: (input: {
    workspaceId: string;
    threadId: string;
  }): Promise<WorkspaceCatalogItem[]> => ipcRenderer.invoke("phase1:delete-workspace-thread", input),
  activateWorkspaceThread: (input: { workspaceId: string; threadId: string }) =>
    ipcRenderer.invoke("phase1:activate-workspace-thread", input),
  listCustomModelEndpoints: () => ipcRenderer.invoke(desktopIpcChannels.customModels.list),
  saveCustomModelEndpoint: (input: { label: string; baseUrl: string; apiKey: string; model: string }) =>
    ipcRenderer.invoke(desktopIpcChannels.customModels.save, input),
  deleteCustomModelEndpoint: (input: { id: string }) => ipcRenderer.invoke(desktopIpcChannels.customModels.delete, input),
  selectCustomModelEndpoint: (input: { id: string }) => ipcRenderer.invoke(desktopIpcChannels.customModels.select, input),
  saveModelConfig: (config: {
    provider: string;
    baseUrl: string;
    apiKey: string;
    wireApi: "responses" | "chat.completions";
    model: string;
    reviewModel: string;
    reasoningEffort: "low" | "medium" | "high" | "xhigh";
    disableResponseStorage: boolean;
    systemPrompt: string;
    toolContext?: string;
  }) => ipcRenderer.invoke("phase1:save-model-config", config),
  saveMcpServers: (servers: McpServerConfig[]) => ipcRenderer.invoke("phase1:save-mcp-servers", servers),
  testMcpServer: (server: McpServerConfig): Promise<McpServerHealth> => ipcRenderer.invoke("phase1:test-mcp-server", server),
  startMcpServer: (server: McpServerConfig): Promise<McpServerHealth> => ipcRenderer.invoke("phase1:start-mcp-server", server),
  stopMcpServer: (server: McpServerConfig): Promise<McpServerHealth> => ipcRenderer.invoke("phase1:stop-mcp-server", server),
  getMcpServerLogs: (serverId: string): Promise<string[]> => ipcRenderer.invoke("phase1:get-mcp-server-logs", serverId),
  clearMcpServerLogs: (serverId: string): Promise<string[]> => ipcRenderer.invoke("phase1:clear-mcp-server-logs", serverId),
  inspectMcpServer: (server: McpServerConfig): Promise<McpServerInspection> => ipcRenderer.invoke("phase1:inspect-mcp-server", server),
  getMcpDiscoveredTools: (): Promise<McpDiscoveredTool[]> => ipcRenderer.invoke("phase1:get-mcp-discovered-tools"),
  getSystemTools: (): Promise<SystemToolEntry[]> => ipcRenderer.invoke("phase1:get-system-tools"),
  getPolicyRules: () => ipcRenderer.invoke("phase1:get-policy-rules"),
  savePolicyRules: (rules: Array<{
    id?: string;
    toolName?: string;
    commandPrefix?: string;
    decision: "allow" | "ask" | "deny";
    enabled?: boolean;
    reason?: string;
  }>) => ipcRenderer.invoke("phase1:save-policy-rules", rules),
  openSystemTool: (input: string | { toolId: string; workspaceId?: string }): Promise<{ ok: boolean; detail: string }> =>
    ipcRenderer.invoke("phase1:open-system-tool", input),
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
  controlWindow: (action: "minimize" | "maximize" | "close"): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("phase1:window-control", action),
  showAppMenu: (input: { menu: "file" | "edit" | "view" | "window" | "help"; x: number; y: number }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("phase1:show-app-menu", input),
  onAppCommand: (listener: (command: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, command: string) => listener(command);
    ipcRenderer.on("phase1:app-command", handler);
    return () => ipcRenderer.removeListener("phase1:app-command", handler);
  },
  onDictationCommand: (
    listener: (command: { action: "start" | "toggle"; source: "hold" | "toggle" }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      command: { action: "start" | "toggle"; source: "hold" | "toggle" }
    ) => listener(command);
    ipcRenderer.on("phase1:dictation-command", handler);
    return () => ipcRenderer.removeListener("phase1:dictation-command", handler);
  },
  onMobileAction: (
    listener: (action: { action: string; workspaceId?: string; threadId?: string }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      action: { action: string; workspaceId?: string; threadId?: string }
    ) => listener(action);
    ipcRenderer.on("phase1:mobile-action", handler);
    return () => ipcRenderer.removeListener("phase1:mobile-action", handler);
  },
  onAssistantActivity: (
    listener: (activity: { type: "patch" | "run" | "complete"; title: string; detail: string; requestId?: string }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      activity: { type: "patch" | "run" | "complete"; title: string; detail: string; requestId?: string }
    ) => listener(activity);
    ipcRenderer.on("phase1:assistant-activity", handler);
    return () => ipcRenderer.removeListener("phase1:assistant-activity", handler);
  },
  onOpenWorkspaceFilePreview: (
    listener: (event: {
      workspaceId: string;
      filePath: string;
      kind?: "image" | "video" | "pdf" | "docx" | "pptx" | "html" | "text";
    }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: {
        workspaceId: string;
        filePath: string;
        kind?: "image" | "video" | "pdf" | "docx" | "pptx" | "html" | "text";
      }
    ) => listener(payload);
    ipcRenderer.on(desktopIpcChannels.events.openWorkspaceFilePreview, handler);
    return () => ipcRenderer.removeListener(desktopIpcChannels.events.openWorkspaceFilePreview, handler);
  },
  onModelStreamDelta: (
    listener: (update: { requestId: string; delta: string }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      update: { requestId: string; delta: string }
    ) => listener(update);
    ipcRenderer.on("phase1:model-stream-delta", handler);
    return () => ipcRenderer.removeListener("phase1:model-stream-delta", handler);
  },
  onSnapshotUpdate: (listener: (snapshot: PhaseOneSnapshot) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: PhaseOneSnapshot) => listener(snapshot);
    ipcRenderer.on("phase1:snapshot-update", handler);
    return () => ipcRenderer.removeListener("phase1:snapshot-update", handler);
  },
  getTerminalSession: (): Promise<TerminalSessionSnapshot> => ipcRenderer.invoke("phase1:get-terminal-session"),
  writeTerminalInput: (input: string): Promise<TerminalSessionSnapshot> => ipcRenderer.invoke("phase1:write-terminal-input", input),
  restartTerminalSession: (): Promise<TerminalSessionSnapshot> => ipcRenderer.invoke("phase1:restart-terminal-session"),
  onTerminalUpdate: (listener: (snapshot: TerminalSessionSnapshot) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, snapshot: TerminalSessionSnapshot) => listener(snapshot);
    ipcRenderer.on("phase1:terminal-update", subscription);
    return () => ipcRenderer.removeListener("phase1:terminal-update", subscription);
  },
  callMcpTool: (input: { toolId: string; query: string; args?: Record<string, unknown> }): Promise<McpToolCallResult> =>
    ipcRenderer.invoke("phase1:call-mcp-tool", input),
  chatWithModel: (input: {
    requestId: string;
    workspaceId?: string;
    threadId?: string;
    provider: string;
    baseUrl: string;
    apiKey: string;
    wireApi: "responses" | "chat.completions";
    model: string;
    reviewModel: string;
    reasoningEffort: "low" | "medium" | "high" | "xhigh";
    disableResponseStorage: boolean;
    systemPrompt: string;
    messages: Array<{
      id?: string;
      role: "system" | "user" | "assistant";
      content: string;
      createdAt?: string;
      attachments?: Array<{ name: string; path: string; url: string }>;
    }>;
  }) => ipcRenderer.invoke("phase1:chat-with-model", input),
  cancelModelRequest: (input?: { requestId?: string }) => ipcRenderer.invoke("phase1:cancel-model-request", input)
});
