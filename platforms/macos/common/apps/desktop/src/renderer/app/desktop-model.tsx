import type {
  AutomationSpec,
  BrainConversationCreateInput,
  BrainConversationDto,
  BrainConversationGetInput,
  BrainConversationListInput,
  BrainArtifactDto,
  BrainArtifactRegisterInput,
  BrainAnnotationCreateInput,
  BrainAnnotationDto,
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
  BrainSoftwareScript,
  BrainSoftwareTaskState,
  BrainTaskCreateInput,
  BrainTaskDto,
  BrainTaskUpdateInput,
  MobilePairingState,
  PhaseOneSnapshot,
  PluginSpec,
  SearchResultSpec,
  SkillSpec,
  WorkspaceCatalogItem,
  WorkspaceEntry,
  WorkspaceThreadRecord,
  WorkspaceTimelineEvent
} from "@codex-forge/protocol";

export interface BootstrapPayload {
  appName: string;
  platform: string;
  phase: string;
  shell: string;
  workspacePath: string;
}

export interface PatchFormState {
  filePath: string;
  searchText: string;
  replaceText: string;
}

export interface ModelConfigState {
  provider: string;
  baseUrl: string;
  apiKey: string;
  wireApi: "responses" | "chat.completions";
  model: string;
  reviewModel: string;
  reasoningEffort: "low" | "medium" | "high" | "xhigh";
  disableResponseStorage: boolean;
  systemPrompt: string;
}

export interface DesktopPreferencesState {
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
    defaultOpenTarget: "system" | "finder" | "vscode";
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
  notifications: {
    turnComplete: "never" | "when-unfocused" | "always";
    permission: boolean;
    question: boolean;
  };
  shortcuts: Record<string, string>;
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
  market: {
    directClawhubAllowed: boolean;
  };
  brain: {
    selectedWorkspaceKey: string;
  };
  launchAtLogin: boolean;
}

export type ChatMessageRole = "user" | "assistant";

export interface DesktopAgreementConfig {
  enabled: boolean;
  tos_title?: string;
  tos_content_html?: string;
  policy_title?: string;
  policy_content_html?: string;
}

export interface DesktopAuthStatusState {
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

export type { LoginFormState, LoginChannel, LoginEmailAuthMode } from "./login-form";
export {
  initialLoginForm,
  isCnMobile,
  normalizeCnMobileInput,
  resolveLoginIdentifier,
  shouldUseLoginCode,
  canSubmitLoginForm,
  authServiceStatusLabel
} from "./login-form";

export interface ModelChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  createdAt?: string;
  toolName?: string;
  attachments?: Array<{
    name: string;
    path: string;
    url: string;
  }>;
}

export interface McpServerState {
  id: string;
  name: string;
  transport: "stdio" | "sse";
  command: string;
  args: string;
  url: string;
  env: string;
  enabled: boolean;
}

export interface McpServerHealthState {
  ok: boolean;
  code?: string;
  detail: string;
  checkedAt: string;
  running?: boolean;
}

export interface McpServerInspectionState {
  ok: boolean;
  detail: string;
  checkedAt: string;
  serverInfo?: string;
  protocolVersion?: string;
  tools: Array<{ name: string; description: string }>;
}

export interface McpDiscoveredToolState {
  id: string;
  serverId: string;
  serverName: string;
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  protocolVersion?: string;
  discoveredAt: string;
}

export interface SystemToolState {
  id: string;
  label: string;
  kind: "developer" | "system";
  icon: string;
  available: boolean;
}

export interface TerminalSessionState {
  cwd: string;
  shell: string;
  prompt: string;
  isRunning: boolean;
  lines: string[];
  launchedAt?: string;
  lastExitCode?: number | null;
}

export interface ComposerToolFieldValueMap {
  [key: string]: unknown;
}

export interface ComposerToolChip {
  id: string;
  label: string;
  detail: string;
  serverName?: string;
  inputSchema?: Record<string, unknown>;
  fieldValues?: ComposerToolFieldValueMap;
}

export interface FeatureConfigPayload {
  skills: SkillSpec[];
  plugins: PluginSpec[];
  automations: AutomationSpec[];
}

export interface DesktopBootstrapStatusState {
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

export interface TreeNode {
  key: string;
  name: string;
  path: string;
  kind: "file" | "directory";
  children: TreeNode[];
}

export type FeatureTab = "new-chat" | "search" | "extensions" | "skills" | "plugins" | "experts" | "automation" | "mobile" | "mcp" | "settings";
export type ManagedFeatureKind = "skills" | "plugins" | "automations";
export type PreviewMode = "empty" | "workspace" | "review" | "terminal" | "browser" | "files" | "chat";
export type PreviewPlacement = "hidden" | "side" | "center";

export interface ThreadContextMenuState {
  x: number;
  y: number;
  workspace: WorkspaceCatalogItem;
  thread: WorkspaceThreadRecord;
}

export interface ConversationTurn {
  id: string;
  user?: ModelChatMessage;
  tools?: ModelChatMessage[];
  assistant?: ModelChatMessage;
}

export interface FeatureItem {
  id: FeatureTab;
  label: string;
  icon: string;
  description: string;
}

export interface ManagedFeatureDraft {
  id?: string;
  name: string;
  summary: string;
  status: string;
  version?: string;
  source?: string;
  manifestPath?: string;
  path?: string;
  icon?: string;
  capabilities?: string[];
  trigger: string;
  title: string;
  workspaceId: string;
  threadId: string;
  action: string;
  intervalMinutes: string;
  dailyTime: string;
  runtime: string;
  targetType: string;
  schedule: string;
  model: string;
  reasoning: string;
  template: string;
  prompt: string;
  sandboxRule: string;
}

export type SettingsSection =
  | "account"
  | "billing"
  | "model"
  | "appearance"
  | "configuration"
  | "personalization"
  | "workspace"
  | "desktop"
  | "mcp"
  | "hooks"
  | "git"
  | "environment"
  | "worktree"
  | "browser"
  | "computer"
  | "shortcuts"
  | "archived";

export type SettingsNavIconName =
  | "gear"
  | "sun"
  | "dial"
  | "clock"
  | "anchor"
  | "git"
  | "screen"
  | "worktree"
  | "browser"
  | "spark"
  | "archive"
  | "user"
  | "card"
  | "link"
  | "keyboard";

declare global {
  interface Window {
    newbrain?: {
      listBrainWorkspaces: () => Promise<BrainWorkspaceDto[]>;
      listBrainProjects: (input?: BrainProjectListInput) => Promise<BrainProjectDto[]>;
      createBrainProject: (input: BrainProjectCreateInput) => Promise<BrainProjectDto>;
      getBrainProject: (input: BrainProjectGetInput) => Promise<BrainProjectDto>;
      updateBrainProject: (input: BrainProjectUpdateInput) => Promise<BrainProjectDto>;
      setBrainProjectWorkspace: (input: BrainProjectWorkspaceInput) => Promise<{ ok: boolean }>;
      getBrainWorkspaceSection: (input: { projectId: string; workspaceKey: string; sectionKey: string }) => Promise<BrainWorkspaceSectionDto>;
      saveBrainWorkspaceSection: (input: { projectId: string; workspaceKey: string; sectionKey: string; content: string; expectedRevision: number }) => Promise<BrainWorkspaceSectionDto>;
      listSoftwareScripts: (input: { projectId: string }) => Promise<BrainSoftwareScript[]>;
      startSoftwareTask: (input: { projectId: string; scriptId: string; conversationId?: string }) => Promise<BrainSoftwareTaskState>;
      getSoftwareTaskStatus: (input: { taskId: string }) => Promise<BrainSoftwareTaskState>;
      cancelSoftwareTask: (input: { taskId: string }) => Promise<BrainSoftwareTaskState>;
      openSoftwareProjectTerminal: (input: BrainProjectGetInput) => Promise<{ ok: boolean }>;
      createBrainConversation: (input: BrainConversationCreateInput) => Promise<BrainConversationDto>;
      listBrainConversations: (input?: BrainConversationListInput) => Promise<BrainConversationDto[]>;
      getBrainConversation: (input: BrainConversationGetInput) => Promise<BrainConversationDto>;
      listBrainMessages: (input: BrainConversationGetInput) => Promise<BrainMessageDto[]>;
      appendBrainMessage: (input: BrainMessageAppendInput) => Promise<BrainMessageDto>;
      getBrainDraft: (input: BrainConversationGetInput) => Promise<{ content: string; updatedAt: string } | null>;
      saveBrainDraft: (input: BrainDraftSaveInput) => Promise<{ ok: boolean }>;
      listBrainFiles: (input: BrainProjectGetInput) => Promise<BrainFileDto[]>;
      registerBrainFile: (input: BrainFileRegisterInput) => Promise<BrainFileDto>;
      ingestBrainFile: (input: BrainDocumentIngestInput) => Promise<BrainDocumentIngestResult>;
      listBrainAnnotations: (input: BrainProjectGetInput) => Promise<BrainAnnotationDto[]>;
      createBrainAnnotation: (input: BrainAnnotationCreateInput) => Promise<BrainAnnotationDto>;
      listBrainChangeSets: (input: BrainProjectGetInput) => Promise<BrainChangeSetDto[]>;
      updateBrainChangeSet: (input: BrainChangeSetUpdateInput) => Promise<BrainChangeSetDto>;
      previewBrainChangeSet: (input: BrainChangeSetPreviewInput) => Promise<BrainChangeSetPreviewResult>;
      exportBrainChangeSet: (input: BrainChangeSetPreviewInput) => Promise<BrainChangeSetExportResult>;
      listBrainTasks: (input: BrainProjectGetInput) => Promise<BrainTaskDto[]>;
      createBrainTask: (input: BrainTaskCreateInput) => Promise<BrainTaskDto>;
      updateBrainTask: (input: BrainTaskUpdateInput) => Promise<BrainTaskDto>;
      listBrainArtifacts: (input: BrainProjectGetInput) => Promise<BrainArtifactDto[]>;
      registerBrainArtifact: (input: BrainArtifactRegisterInput) => Promise<BrainArtifactDto>;
      inspectBrainGameProject: (input: BrainProjectGetInput) => Promise<BrainGameProjectInspection>;
      startBrainGamePreview: (input: { projectId: string; conversationId?: string }) => Promise<BrainGamePreviewState>;
      getBrainGamePreviewStatus: (input: BrainProjectGetInput) => Promise<BrainGamePreviewState>;
      stopBrainGamePreview: (input: BrainProjectGetInput) => Promise<BrainGamePreviewState>;
      getBrainVideoPipeline: (input: BrainProjectGetInput) => Promise<any>;
      saveBrainVideoPipeline: (input: { projectId: string; state: unknown }) => Promise<any>;
      markBrainVideoShot: (input: { projectId: string; shotIndex: number; ready: boolean }) => Promise<any>;
      cookBrainVideoPipeline: (input: BrainProjectGetInput) => Promise<any>;
      getBrainMusicDaw: (input: BrainProjectGetInput) => Promise<any>;
      saveBrainMusicDaw: (input: { projectId: string; state: unknown }) => Promise<any>;
      cookBrainMusicDaw: (input: BrainProjectGetInput) => Promise<any>;
      getBrainDataAnalysis: (input: BrainProjectGetInput) => Promise<any>;
      saveBrainDataAnalysis: (input: { projectId: string; state: unknown }) => Promise<any>;
      cookBrainDataAnalysis: (input: BrainProjectGetInput) => Promise<any>;
      bootstrap: () => Promise<BootstrapPayload>;
      getSnapshot: () => Promise<PhaseOneSnapshot>;
      getGoal: (input?: { threadId?: string }) => Promise<ThreadGoalState | null>;
      createGoal: (input: { objective: string; tokenBudget?: number; threadId: string }) => Promise<ThreadGoalState>;
      updateGoal: (input: { status: "complete" | "blocked"; tokensUsed?: number; timeUsedSeconds?: number; threadId: string }) => Promise<ThreadGoalState>;
      getAuthStatus: () => Promise<DesktopAuthStatusState>;
      getBillingSubscription: () => Promise<Record<string, unknown>>;
      sendLoginCode: (input: {
        email?: string;
        phone?: string;
      }) => Promise<Record<string, unknown>>;
      loginAuth: (input: {
        email: string;
        password: string;
        agreement_accepted: boolean;
        captcha?: string;
      }) => Promise<DesktopAuthStatusState>;
      logoutAuth: () => Promise<DesktopAuthStatusState>;
      queueWorkspaceScan: () => Promise<PhaseOneSnapshot>;
      queueGitStatus: () => Promise<PhaseOneSnapshot>;
      queueShellCommand: (command: string) => Promise<PhaseOneSnapshot>;
      respondApproval: (input: boolean | { approved: boolean; requestId?: string }) => Promise<PhaseOneSnapshot>;
      generatePatch: (input: PatchFormState) => Promise<PhaseOneSnapshot>;
      applyPatch: () => Promise<PhaseOneSnapshot>;
      getModelConfig: () => Promise<ModelConfigState>;
      listCustomModelEndpoints?: () => Promise<{
        endpoints: Array<{ id: string; label: string; baseUrl: string; model: string; wireApi: "chat.completions" | "responses" }>;
        selectedId: string;
      }>;
      saveCustomModelEndpoint?: (input: { label: string; baseUrl: string; apiKey: string; model: string }) => Promise<{
        endpoints: Array<{ id: string; label: string; baseUrl: string; model: string; wireApi: "chat.completions" | "responses" }>;
        selectedId: string;
      }>;
      deleteCustomModelEndpoint?: (input: { id: string }) => Promise<{
        endpoints: Array<{ id: string; label: string; baseUrl: string; model: string; wireApi: "chat.completions" | "responses" }>;
        selectedId: string;
      }>;
      selectCustomModelEndpoint?: (input: { id: string }) => Promise<{
        endpoints: Array<{ id: string; label: string; baseUrl: string; model: string; wireApi: "chat.completions" | "responses" }>;
        selectedId: string;
      }>;
      getDesktopPreferences: () => Promise<DesktopPreferencesState>;
      saveDesktopPreferences: (preferences: DesktopPreferencesState) => Promise<DesktopPreferencesState>;
      getDesktopBootstrapStatus: () => Promise<DesktopBootstrapStatusState>;
      startDesktopBootstrap: () => Promise<DesktopBootstrapStatusState>;
      retryDesktopCondaBootstrap: () => Promise<DesktopBootstrapStatusState>;
      getMcpServers: () => Promise<Array<{
        id: string;
        name: string;
        transport: "stdio" | "sse";
        command: string;
        args: string[];
        url: string;
        env: Record<string, string>;
        enabled: boolean;
      }>>;
      getFeatureConfig: () => Promise<FeatureConfigPayload>;
      addFeatureItem: (input: {
        kind: ManagedFeatureKind;
        item: Record<string, string>;
      }) => Promise<FeatureConfigPayload>;
      updateFeatureItem: (input: {
        kind: ManagedFeatureKind;
        id: string;
        item: Record<string, string>;
      }) => Promise<FeatureConfigPayload>;
      deleteFeatureItem: (input: {
        kind: ManagedFeatureKind;
        id: string;
      }) => Promise<FeatureConfigPayload>;
      searchWorkspaces: (query: string) => Promise<SearchResultSpec[]>;
      readWorkspaceFile: (input: { workspaceId: string; filePath: string }) => Promise<{
        path: string;
        name: string;
        language: string;
        content: string;
        binary: boolean;
        truncated: boolean;
        size: number;
      }>;
      getTerminalSession: () => Promise<{ cwd: string; shell: string; prompt: string; isRunning: boolean; lines: string[] }>;
      writeTerminalInput: (input: string) => Promise<{ cwd: string; shell: string; prompt: string; isRunning: boolean; lines: string[] }>;
      onTerminalUpdate: (listener: (snapshot: { cwd: string; shell: string; prompt: string; isRunning: boolean; lines: string[] }) => void) => () => void;
      startMobilePairing: () => Promise<MobilePairingState>;
      getMobilePairingStatus: () => Promise<MobilePairingState>;
      stopMobilePairing: () => Promise<MobilePairingState>;
      saveModelConfig: (config: ModelConfigState) => Promise<ModelConfigState>;
      saveMcpServers: (servers: Array<{
        id: string;
        name: string;
        transport: "stdio" | "sse";
        command: string;
        args: string[];
        url: string;
        env: Record<string, string>;
        enabled: boolean;
      }>) => Promise<Array<{
        id: string;
        name: string;
        transport: "stdio" | "sse";
        command: string;
        args: string[];
        url: string;
        env: Record<string, string>;
        enabled: boolean;
      }>>;
      testMcpServer: (server: {
        id: string;
        name: string;
        transport: "stdio" | "sse";
        command: string;
        args: string[];
        url: string;
        env: Record<string, string>;
        enabled: boolean;
      }) => Promise<McpServerHealthState>;
      startMcpServer: (server: {
        id: string;
        name: string;
        transport: "stdio" | "sse";
        command: string;
        args: string[];
        url: string;
        env: Record<string, string>;
        enabled: boolean;
      }) => Promise<McpServerHealthState>;
      stopMcpServer: (server: {
        id: string;
        name: string;
        transport: "stdio" | "sse";
        command: string;
        args: string[];
        url: string;
        env: Record<string, string>;
        enabled: boolean;
      }) => Promise<McpServerHealthState>;
      getMcpServerLogs: (serverId: string) => Promise<string[]>;
      clearMcpServerLogs: (serverId: string) => Promise<string[]>;
      inspectMcpServer: (server: {
        id: string;
        name: string;
        transport: "stdio" | "sse";
        command: string;
        args: string[];
        url: string;
        env: Record<string, string>;
        enabled: boolean;
      }) => Promise<McpServerInspectionState>;
      getMcpDiscoveredTools: () => Promise<McpDiscoveredToolState[]>;
      callMcpTool: (input: { toolId: string; query: string; args?: Record<string, unknown> }) => Promise<{
        ok: boolean;
        toolName: string;
        serverName: string;
        detail: string;
        content: string;
      }>;
      listWorkspaces: () => Promise<WorkspaceCatalogItem[]>;
      addWorkspace: (input: { name: string; path: string }) => Promise<WorkspaceCatalogItem[]>;
      createBlankWorkspace: (input: { name: string }) => Promise<WorkspaceCatalogItem[]>;
      selectWorkspaceFolder: () => Promise<string | null>;
      selectComposerImages: () => Promise<Array<{ name: string; path: string; url: string }>>;
      importComposerAttachments: (input: { paths: string[] }) => Promise<Array<{ name: string; path: string; url: string }>>;
      showInputContextMenu: () => Promise<{ ok: boolean }>;
      getPathForFile: (file: File) => string;
      saveComposerClipboardFile: (input: { name: string; mimeType: string; data: ArrayBuffer }) => Promise<{ name: string; path: string; url: string }>;
      renameWorkspace: (input: { workspaceId: string; name: string }) => Promise<WorkspaceCatalogItem[]>;
      removeWorkspace: (input: { workspaceId: string }) => Promise<WorkspaceCatalogItem[]>;
      openWorkspaceLocation: (input: { workspaceId: string; target: "finder" | "vscode" | "system" }) => Promise<{ ok: boolean; detail: string }>;
      openLogLocation: () => Promise<{
        ok: boolean;
        detail: string;
        path: string;
        files: { debug: string; diagnostics: string; auth: string; sqlite: string };
      }>;
      reportRendererFailure: (input: {
        kind: "renderer_error" | "renderer_unhandled_rejection" | "renderer_bootstrap_error";
        message: string;
        stackTrace?: string;
        context?: Record<string, unknown>;
      }) => Promise<{ ok: boolean; id: string }>;
      reportRendererDiagnostic: (input: {
        kind: string;
        message: string;
        stackTrace?: string;
        context?: Record<string, unknown>;
      }) => Promise<{ ok: boolean; id: string }>;
      synthesizeNovelSpeech: (input: {
        text: string;
        voiceId: string;
        voiceLabel?: string;
      }) => Promise<{
        ok: boolean;
        audioBase64?: string;
        mimeType?: string;
        detail?: string;
        provider?: string;
        playingInMain?: boolean;
        durationMs?: number;
      }>;
      cancelNovelSpeech: () => Promise<{ ok: boolean }>;
      getWorkspaceHeaderStatus: (workspaceId: string) => Promise<{ branch: string; changes: number; additions: number; deletions: number; githubCliAvailable: boolean }>;
      getReviewChanges: (input: { workspaceId?: string; threadId?: string }) => Promise<{
        workspaceId: string;
        threadId: string;
        files: Array<{ filePath: string; status: string; additions: number; deletions: number; diff: string; source: string }>;
        additions: number;
        deletions: number;
      }>;
      getWorkspaceBranches: (workspaceId: string) => Promise<{ current: string; branches: string[]; changedFiles: number }>;
      switchWorkspaceBranch: (input: { workspaceId: string; branch: string; create?: boolean }) => Promise<{ current: string; branches: string[]; changedFiles: number }>;
      recordMessageFeedback: (input: { workspaceId?: string; threadId?: string; messageId: string; rating: "helpful" | "unhelpful" }) => Promise<{ ok: boolean }>;
      addWorkspaceThread: (input: {
        workspaceId: string;
        title: string;
        summary: string;
        scope?: "project" | "chat";
        brainWorkspaceKey?: import("@codex-forge/protocol").BrainWorkspaceKey;
      }) => Promise<WorkspaceCatalogItem[]>;
      forkWorkspaceThread: (input: {
        workspaceId: string;
        sourceThreadId: string;
        title: string;
      }) => Promise<WorkspaceCatalogItem[]>;
      createWorkspaceWorktree: (input: {
        workspaceId: string;
        branchName?: string;
      }) => Promise<{ ok: boolean; detail: string; path: string }>;
      renameWorkspaceThread: (input: {
        workspaceId: string;
        threadId: string;
        title: string;
        summary: string;
      }) => Promise<WorkspaceCatalogItem[]>;
      deleteWorkspaceThread: (input: {
        workspaceId: string;
        threadId: string;
      }) => Promise<WorkspaceCatalogItem[]>;
      activateWorkspaceThread: (input: { workspaceId: string; threadId: string }) => Promise<PhaseOneSnapshot>;
      openBrowserPreview: (url?: string) => Promise<{ ok: boolean; url: string }>;
      closeBrowserPreview: () => Promise<{ ok: boolean }>;
      captureBrowserPreview: () => Promise<{ ok: boolean; path: string; url: string }>;
      clearBrowserBrowsingData?: () => Promise<{ ok: boolean; detail: string }>;
      listBrowserHistory?: () => Promise<Array<{ id: string; url: string; title: string; visitedAt: string }>>;
      removeBrowserHistoryEntry?: (id: string) => Promise<Array<{ id: string; url: string; title: string; visitedAt: string }>>;
      clearBrowserHistory?: () => Promise<{ ok: boolean }>;
      selectBrowserDownloadDir?: () => Promise<{ path: string } | null>;
      listBrowserCredentials?: () => Promise<Array<{ id: string; origin: string; username: string; hasPassword: boolean; updatedAt: string }>>;
      upsertBrowserCredential?: (input: {
        origin: string;
        username: string;
        password: string;
        id?: string;
      }) => Promise<Array<{ id: string; origin: string; username: string; hasPassword: boolean; updatedAt: string }>>;
      removeBrowserCredential?: (id: string) => Promise<Array<{ id: string; origin: string; username: string; hasPassword: boolean; updatedAt: string }>>;
      listBrowserContacts?: () => Promise<Array<{ id: string; name: string; email: string; phone: string; updatedAt: string }>>;
      upsertBrowserContact?: (input: {
        name: string;
        email?: string;
        phone?: string;
        id?: string;
      }) => Promise<Array<{ id: string; name: string; email: string; phone: string; updatedAt: string }>>;
      removeBrowserContact?: (id: string) => Promise<Array<{ id: string; name: string; email: string; phone: string; updatedAt: string }>>;
      getBrowserCdpAccess?: () => Promise<{ enabled: boolean; partition: string; detail: string }>;
      probeBrowserSiteTools?: () => Promise<{ origin: string; enabled: boolean; endpoints: string[]; detail: string }>;
      getSystemTools: () => Promise<SystemToolState[]>;
      openSystemTool: (input: string | { toolId: string; workspaceId?: string }) => Promise<{ ok: boolean; detail: string }>;
      controlWindow: (action: "minimize" | "maximize" | "close") => Promise<{ ok: boolean }>;
      showAppMenu: (input: {
        menu: "file" | "edit" | "view" | "window" | "help";
        x: number;
        y: number;
      }) => Promise<{ ok: boolean }>;
      onAppCommand: (listener: (command: string) => void) => () => void;
      onMobileAction: (
        listener: (action: { action: string; workspaceId?: string; threadId?: string }) => void
      ) => () => void;
      onAssistantActivity: (
        listener: (activity: { type: "patch" | "run" | "complete"; title: string; detail: string }) => void
      ) => () => void;
      onOpenWorkspaceFilePreview?: (listener: (event: {
        workspaceId: string;
        filePath: string;
        kind?: "image" | "video" | "pdf" | "docx" | "pptx" | "html" | "text";
      }) => void) => () => void;
      onModelStreamDelta: (
        listener: (update: { requestId: string; delta: string }) => void
      ) => () => void;
      onSnapshotUpdate: (listener: (snapshot: PhaseOneSnapshot) => void) => () => void;
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
        permissionMode: "full" | "approval" | "agent";
        systemPrompt: string;
        toolContext?: string;
        messages: Array<{
          id?: string;
          role: "user" | "assistant";
          content: string;
          createdAt?: string;
          attachments?: Array<{ name: string; path: string; url: string }>;
        }>;
      }) => Promise<{ content: string }>;
      cancelModelRequest: (input?: { requestId?: string }) => Promise<{ ok: boolean; detail: string }>;
    };
  }
}

export const featureItems: FeatureItem[] = [
  { id: "new-chat", label: "新建对话", icon: "+", description: "创建新线程或从当前线程分叉上下文。" },
  { id: "experts", label: "专家市场", icon: "◎", description: "浏览并安装专家包；召唤仅由全局/项目 Skill 自行 expert.summon。" },
  { id: "extensions", label: "扩展", icon: "◇", description: "管理 GitHub、Jira、Slack 等外部服务集成。" },
  { id: "skills", label: "技能", icon: "⬡", description: "管理当前工作台可调用的技能能力。" },
  { id: "plugins", label: "插件", icon: "⌘", description: "管理外接能力和集成插件。" },
  { id: "automation", label: "自动化", icon: "◔", description: "配置项目空间和线程的定时动作。" },
  { id: "mcp", label: "软件联动", icon: "↔", description: "开箱控制本机窗口；MCP 仅作高级扩展。" }
];

export const settingsFeatureItem: FeatureItem = {
  id: "settings",
  label: "设置",
  icon: "⚙",
  description: "管理模型网关、API 密钥和本地桌面工作台配置。"
};

export const emptySnapshot: PhaseOneSnapshot = {
  session: {
    id: "phase1-local",
    title: "默认线程",
    status: "planning",
    workspacePath: "Loading workspace..."
  },
  messages: [],
  workspace: [],
  runs: [],
  memories: [],
  timeline: []
};

export const initialPatchForm: PatchFormState = {
  filePath: "apps/desktop/src/renderer/ui.tsx",
  searchText: "默认线程",
  replaceText: "默认线程"
};

export const initialModelConfig: ModelConfigState = {
  provider: "OpenAI",
  baseUrl: "",
  apiKey: "",
  wireApi: "responses",
  model: "gpt-5.5",
  reviewModel: "gpt-5.4-mini",
  reasoningEffort: "low",
  disableResponseStorage: true,
  systemPrompt: "You are a helpful coding assistant for the NewBrain desktop workspace."
};

export const initialDesktopPreferences: DesktopPreferencesState = {
  appearance: {
    theme: "light",
    density: "comfortable",
    reduceMotion: false,
    accentColor: "#339CFF",
    backgroundColor: "#FFFFFF",
    foregroundColor: "#1A1C1F",
    uiFontFamily: "Segoe UI, Microsoft YaHei UI, Microsoft YaHei, sans-serif",
    codeFontFamily: "Cascadia Code, Consolas, monospace",
    contrast: 60,
    uiFontSize: 14,
    codeFontSize: 12,
    sidebarTranslucent: true,
    pointerCursor: false,
    diffMarks: "color"
  },
  configuration: {
    requireApprovalForShell: true,
    saveResponses: false,
    telemetryEnabled: false
  },
  personalization: {
    workMode: "coding",
    proactiveUpdates: true,
    includeVerificationSummary: true,
    reviewFindingsFirst: true
  },
  permissions: {
    fullAccess: false
  },
  hooks: {
    beforeCommand: true,
    afterCommand: true,
    beforeCommit: true,
    afterTask: true,
    beforeCommandScript: "",
    afterCommandScript: "",
    beforeCommitScript: "",
    afterTaskScript: ""
  },
  git: {
    statusCommand: "git status --short --branch",
    branchPrefix: "codex/",
    showDiffBeforeCommit: true,
    confirmBeforePush: true,
    pullRequestMergeMethod: "merge",
    forcePushWithLease: false,
    createDraftPullRequests: true,
    autoDeleteOldWorktrees: true,
    autoDeleteWorktreeLimit: 15,
    commitInstructions: ""
  },
  environment: {
    defaultOpenTarget: "system",
    terminalShell: "/bin/zsh",
    extraEnv: {},
    autoBootstrapConda: true
  },
  editor: {
    language: "auto",
    sendShortcut: "enter",
    followBehavior: "queue"
  },
  popup: {
    shortcut: "",
    defaultProjectlessChat: false
  },
  dictation: {
    microphone: "system",
    holdShortcut: "",
    toggleShortcut: "",
    keepBarVisible: false,
    dictionaryOpen: true,
    dictionaryEntries: [{ timestamp: "6月30日 22:06", phrase: "Yeah." }]
  },
  notifications: {
    turnComplete: "when-unfocused",
    permission: true,
    question: true
  },
  shortcuts: {},
  worktree: {
    defaultIsolated: true,
    keepArchived: false,
    rootDir: ".newbrain/worktrees"
  },
  browser: {
    autoOpenPreview: false,
    preserveTabs: true,
    highResScreenshots: false,
    previewUrl: "http://127.0.0.1:3000"
  },
  market: {
    directClawhubAllowed: true
  },
  brain: {
    selectedWorkspaceKey: ""
  },
  launchAtLogin: true
};

export const initialFeatureConfig: FeatureConfigPayload = {
  skills: [],
  plugins: [],
  automations: []
};

export const initialMcpServer: McpServerState = {
  id: "",
  name: "",
  transport: "stdio",
  command: "",
  args: "",
  url: "",
  env: "",
  enabled: true
};

export const initialDesktopAuthStatus: DesktopAuthStatusState = {
  authenticated: false,
  loading: true,
  mode: "none",
  base_url: "http://127.0.0.1:8790"
};

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} 超时`)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export interface ThreadGoalState {
  threadId: string;
  goalId: string;
  objective: string;
  status: "active" | "complete" | "blocked";
  tokenBudget?: number;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export async function optionalLoad<T>(promise: Promise<T>, fallback: T, label: string, timeoutMs = 6000): Promise<T> {
  try {
    return await withTimeout(promise, timeoutMs, label);
  } catch {
    return fallback;
  }
}

export const initialDraft: ManagedFeatureDraft = {
  name: "",
  summary: "",
  status: "",
  version: "",
  source: "",
  manifestPath: "",
  path: "",
  icon: "",
  capabilities: [],
  trigger: "",
  title: "",
  workspaceId: "",
  threadId: "",
  action: "workspace_scan",
  intervalMinutes: "30",
  dailyTime: "",
  runtime: "worktree",
  targetType: "project",
  schedule: "daily",
  model: "gpt-5.5",
  reasoning: "low",
  template: "",
  prompt: "",
  sandboxRule: "default"
};

export function SettingsNavIcon({ name }: { name: SettingsNavIconName }) {
  const common = {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const
  };

  switch (name) {
    case "gear":
      return (
        <span className="settings-nav-icon" aria-hidden="true">
          <svg {...common}>
            <circle cx="12" cy="12" r="3.2" />
            <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a1.7 1.7 0 0 1 0 2.4l-.1.1a1.7 1.7 0 0 1-2.4 0l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9v.2a1.7 1.7 0 0 1-1.7 1.7h-.2a1.7 1.7 0 0 1-1.7-1.7v-.2a1 1 0 0 0-.7-.9 1 1 0 0 0-1.1.2l-.1.1a1.7 1.7 0 0 1-2.4 0l-.1-.1a1.7 1.7 0 0 1 0-2.4l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6h-.2A1.7 1.7 0 0 1 3 13.7v-.2a1.7 1.7 0 0 1 1.7-1.7h.2a1 1 0 0 0 .9-.7 1 1 0 0 0-.2-1.1l-.1-.1a1.7 1.7 0 0 1 0-2.4l.1-.1a1.7 1.7 0 0 1 2.4 0l.1.1a1 1 0 0 0 1.1.2h.1a1 1 0 0 0 .6-.9v-.2A1.7 1.7 0 0 1 11.5 3h.2a1.7 1.7 0 0 1 1.7 1.7v.2a1 1 0 0 0 .6.9h.1a1 1 0 0 0 1.1-.2l.1-.1a1.7 1.7 0 0 1 2.4 0l.1.1a1.7 1.7 0 0 1 0 2.4l-.1.1a1 1 0 0 0-.2 1.1v.1a1 1 0 0 0 .9.6h.2a1.7 1.7 0 0 1 1.7 1.7v.2a1.7 1.7 0 0 1-1.7 1.7h-.2a1 1 0 0 0-.9.6Z" />
          </svg>
        </span>
      );
    case "sun":
      return (
        <span className="settings-nav-icon" aria-hidden="true">
          <svg {...common}>
            <circle cx="12" cy="12" r="4.2" />
            <path d="M12 2.8v2.3M12 18.9v2.3M21.2 12h-2.3M5.1 12H2.8M18.5 5.5l-1.6 1.6M7.1 16.9l-1.6 1.6M18.5 18.5l-1.6-1.6M7.1 7.1 5.5 5.5" />
          </svg>
        </span>
      );
    case "dial":
      return (
        <span className="settings-nav-icon" aria-hidden="true">
          <svg {...common}>
            <path d="M12 3.5a8.5 8.5 0 1 1-7.2 4" />
            <path d="M12 8v4.4l2.9 1.3" />
            <path d="M5 5.8 8.4 9" />
          </svg>
        </span>
      );
    case "clock":
      return (
        <span className="settings-nav-icon" aria-hidden="true">
          <svg {...common}>
            <circle cx="12" cy="12" r="8.4" />
            <path d="M12 8v4.2l2.8 1.7" />
            <path d="M8 16a3.6 3.6 0 0 0 5.8-2.9" />
          </svg>
        </span>
      );
    case "anchor":
      return (
        <span className="settings-nav-icon" aria-hidden="true">
          <svg {...common}>
            <circle cx="12" cy="5.3" r="1.7" />
            <path d="M12 7v11.2" />
            <path d="M8.2 11.6H5.4a6.6 6.6 0 0 0 13.2 0h-2.8" />
            <path d="M8.6 17.7 12 20.6l3.4-2.9" />
          </svg>
        </span>
      );
    case "git":
      return (
        <span className="settings-nav-icon" aria-hidden="true">
          <svg {...common}>
            <circle cx="7" cy="5.8" r="1.8" />
            <circle cx="17" cy="5.8" r="1.8" />
            <circle cx="7" cy="18.2" r="1.8" />
            <path d="M8.8 5.8h6.4M17 7.6v3.4a3.2 3.2 0 0 1-3.2 3.2H8.7M7 7.6v8.8" />
          </svg>
        </span>
      );
    case "screen":
      return (
        <span className="settings-nav-icon" aria-hidden="true">
          <svg {...common}>
            <rect x="4" y="5" width="16" height="12.5" rx="2.6" />
            <path d="M9 19.3h6" />
          </svg>
        </span>
      );
    case "keyboard":
      return (
        <span className="settings-nav-icon" aria-hidden="true">
          <svg {...common}>
            <rect x="3" y="6" width="18" height="12" rx="2.5" />
            <path d="M6 10h1M10 10h1M14 10h1M18 10h0M6 14h2M10 14h8" />
          </svg>
        </span>
      );
    case "worktree":
      return (
        <span className="settings-nav-icon" aria-hidden="true">
          <svg {...common}>
            <path d="M4 17.8h8" />
            <path d="M12 6.2h8" />
            <path d="m15.8 3.6 4.2 2.6-4.2 2.6" />
            <path d="m8.2 20.4-4.2-2.6 4.2-2.6" />
          </svg>
        </span>
      );
    case "browser":
      return (
        <span className="settings-nav-icon" aria-hidden="true">
          <svg {...common}>
            <rect x="4" y="4.7" width="16" height="14.8" rx="3" />
            <path d="M4.5 8.6h15" />
            <path d="M8.2 6.6h.01M11.2 6.6h.01" />
          </svg>
        </span>
      );
    case "spark":
      return (
        <span className="settings-nav-icon" aria-hidden="true">
          <svg {...common}>
            <path d="m11.8 5.1 1.3 3.4 3.5 1.3-3.5 1.3-1.3 3.4-1.3-3.4-3.4-1.3 3.4-1.3 1.3-3.4Z" />
            <path d="M4.5 4.9v1.5M4.5 11.2v1.5M2 8h1.5M5.5 8H7" />
          </svg>
        </span>
      );
    case "archive":
      return (
        <span className="settings-nav-icon" aria-hidden="true">
          <svg {...common}>
            <rect x="5" y="4.7" width="14" height="4" rx="1.3" />
            <path d="M6.5 8.7h11v8.6A1.6 1.6 0 0 1 15.9 19H8.1a1.6 1.6 0 0 1-1.6-1.7V8.7Z" />
            <path d="M10 12.2h4" />
          </svg>
        </span>
      );
    case "link":
      return (
        <span className="settings-nav-icon" aria-hidden="true">
          <svg {...common}>
            <path d="m9.7 13.8-2 2a2.9 2.9 0 1 1-4.1-4.1l2-2" />
            <path d="m14.3 10.2 2-2a2.9 2.9 0 1 1 4.1 4.1l-2 2" />
            <path d="m8.8 15.2 6.4-6.4" />
          </svg>
        </span>
      );
    case "user":
      return (
        <span className="settings-nav-icon" aria-hidden="true">
          <svg {...common}>
            <path d="M12 5.2a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2Z" />
            <path d="M5 19.2a7.4 7.4 0 0 1 14 0" />
          </svg>
        </span>
      );
    case "card":
      return (
        <span className="settings-nav-icon" aria-hidden="true">
          <svg {...common}>
            <rect x="4" y="6" width="16" height="12" rx="2.4" />
            <path d="M4.5 10h15" />
          </svg>
        </span>
      );
  }
}

export function buildWorkspaceTree(entries: WorkspaceEntry[]) {
  const rootNodes: TreeNode[] = [];
  const directoryMap = new Map<string, TreeNode>();
  const sortedEntries = [...entries].sort((left, right) => left.path.localeCompare(right.path));

  for (const entry of sortedEntries) {
    const node: TreeNode = {
      key: entry.path,
      name: entry.name,
      path: entry.path,
      kind: entry.kind,
      children: []
    };

    if (entry.kind === "directory") {
      directoryMap.set(entry.path, node);
    }

    const lastSlash = entry.path.lastIndexOf("/");
    const parentPath = lastSlash >= 0 ? entry.path.slice(0, lastSlash) : "";
    const parentNode = parentPath ? directoryMap.get(parentPath) : undefined;

    if (parentNode) {
      parentNode.children.push(node);
    } else {
      rootNodes.push(node);
    }
  }

  return rootNodes;
}

export function collectDirectoryKeys(nodes: TreeNode[]) {
  const keys: string[] = [];

  for (const node of nodes) {
    if (node.kind === "directory") {
      keys.push(node.path);
      keys.push(...collectDirectoryKeys(node.children));
    }
  }

  return keys;
}

export function SettingsSwitch({ enabled }: { enabled: boolean }) {
  return (
    <span className={`settings-toggle${enabled ? " on" : ""}`} aria-hidden="true">
      <span />
    </span>
  );
}

export function formatEnvText(env: Record<string, string>) {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

export function parseEnvText(text: string) {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    env[trimmed.slice(0, separatorIndex).trim()] = trimmed.slice(separatorIndex + 1).trim();
  }
  return env;
}

export function formatRelativeTimeLabel(input?: string) {
  if (!input) {
    return "刚刚";
  }

  const timestamp = new Date(input).getTime();
  if (Number.isNaN(timestamp)) {
    return "刚刚";
  }

  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (diffMinutes < 1) {
    return "刚刚";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} 小时前`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} 天前`;
}

export function formatTimelineType(type: WorkspaceTimelineEvent["type"]) {
  switch (type) {
    case "message":
      return "对话";
    case "approval":
      return "审批";
    case "patch":
      return "变更";
    case "run":
      return "运行";
    case "thread":
      return "线程";
    default:
      return type;
  }
}

export function formatSearchKind(kind: SearchResultSpec["kind"]) {
  switch (kind) {
    case "workspace":
      return "项目空间";
    case "thread":
      return "对话";
    case "timeline":
      return "时间线";
    case "message":
      return "对话";
    case "memory":
      return "记忆";
    case "file":
      return "文件";
    default:
      return kind;
  }
}

export interface WorkspaceTreeProps {
  nodes: TreeNode[];
  expandedPaths: Set<string>;
  activePath: string;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  level?: number;
}

export function WorkspaceTree({
  nodes,
  expandedPaths,
  activePath,
  onToggle,
  onSelect,
  level = 0
}: WorkspaceTreeProps) {
  return (
    <ul className="workspace-tree-list">
      {nodes.map((node) => {
        const isDirectory = node.kind === "directory";
        const isExpanded = isDirectory ? expandedPaths.has(node.path) : false;
        const isActive = activePath === node.path;

        return (
          <li key={node.key}>
            <button
              className={`workspace-tree-item level-${Math.min(level, 5)}${isActive ? " active" : ""}`}
              type="button"
              onClick={() => {
                onSelect(node.path);
                if (isDirectory) {
                  onToggle(node.path);
                }
              }}
            >
              <span className={`tree-chevron${isDirectory && isExpanded ? " expanded" : ""}`}>
                {isDirectory ? "›" : ""}
              </span>
              <span className={`tree-icon ${node.kind}`}>{isDirectory ? "▱" : "▪"}</span>
              <span className="tree-label">{node.name}</span>
            </button>
            {isDirectory && isExpanded && node.children.length > 0 ? (
              <WorkspaceTree
                nodes={node.children}
                expandedPaths={expandedPaths}
                activePath={activePath}
                onToggle={onToggle}
                onSelect={onSelect}
                level={level + 1}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
