export type SessionStatus = "idle" | "planning" | "running" | "awaiting-approval" | "failed";
export type MessageRole = "user" | "assistant" | "system" | "tool";
export type WorkspaceEntryKind = "file" | "directory";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export const INTERNAL_CHAT_WORKSPACE_ID = "workspace:internal-chat";

export * from "./agent-v1.js";

export interface SessionSummary {
  id: string;
  title: string;
  status: SessionStatus;
  workspacePath: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  /** Safe, user-visible reasoning summary. Never contains private chain-of-thought. */
  reasoningSummary?: string;
  /** Runtime history shown to the user but intentionally omitted from later model context. */
  excludeFromModelContext?: boolean;
  attachments?: Array<{
    name: string;
    path: string;
    url: string;
  }>;
}

export interface WorkspaceEntry {
  path: string;
  name: string;
  kind: WorkspaceEntryKind;
  depth: number;
}

export interface ToolRequest {
  id: string;
  kind: "shell" | "read" | "write" | "patch" | "git";
  reason: string;
  risk: "low" | "medium" | "high";
  command?: string;
  targetPath?: string;
}

export interface ApprovalRequest {
  id: string;
  toolRequestId: string;
  message: string;
  requiresConfirmation: boolean;
}

export interface AgentEvent<TPayload = unknown> {
  id: string;
  type: string;
  timestamp: string;
  payload: TPayload;
}

export interface PatchHunk {
  header: string;
  additions: number;
  deletions: number;
  preview: string[];
}

export interface PatchProposal {
  id: string;
  filePath: string;
  hunks: PatchHunk[];
  summary: string;
}

export interface CommandRun {
  id: string;
  callId?: string;
  toolName?: string;
  agentId?: string;
  threadId?: string;
  label: string;
  command: string;
  cwd?: string;
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  exitCode?: number;
  output?: string;
  stdout?: string;
  stderr?: string;
  failureMessage?: string;
  outputTruncated?: boolean;
  originalOutputBytes?: number;
}

export type AgentEventSource = "model" | "runtime" | "tool" | "orchestrator" | "user";
export type AgentEventKind = "reasoning_summary" | "decision" | "progress" | "tool_activity"
  | "evidence" | "quality_gate" | "cost" | "lifecycle" | "message";

export interface AgentActivityEvent<TPayload = unknown> extends AgentEvent<TPayload> {
  schemaVersion: 1;
  source: AgentEventSource;
  kind: AgentEventKind;
  runtimeId?: string;
  missionId?: string;
  taskId?: string;
  agentId?: string;
  threadId?: string;
  parentThreadId?: string;
  /** Safe user-visible summary. Never contains private model chain-of-thought. */
  summary?: string;
  evidenceRefs: string[];
}

export interface DelegatedTask {
  id: string;
  title: string;
  status: "queued" | "running" | "completed" | "failed";
  owner: "planner" | "researcher" | "verifier" | "editor";
  summary: string;
  parentThreadId?: string;
  childThreadId?: string;
  instruction?: string;
  dependsOn?: string[];
  result?: unknown;
}

export interface StructuredAgentResult {
  schemaVersion: 1;
  status: "completed" | "partial" | "blocked";
  role: string;
  summary: string;
  content: string;
  findings: Array<{ summary: string; confidence: number }>;
  evidenceRefs: string[];
  artifacts: unknown[];
  changedFiles: unknown[];
  tests: unknown[];
  unresolvedQuestions: string[];
  qualityGates: Array<{
    id: string;
    status: "passed" | "failed" | "not_required";
    detail: string;
  }>;
}

export interface ModelRoute {
  id: string;
  taskType: "planning" | "editing" | "verification" | "research";
  provider: string;
  model: string;
  reason: string;
}

export interface MemoryRecord {
  id: string;
  scope: "workspace" | "session" | "user";
  summary: string;
  createdAt: string;
}

export interface WorkspaceThreadRecord {
  id: string;
  title: string;
  summary: string;
  scope?: "project" | "chat";
  /** Scene affinity for INTERNAL_CHAT threads (「聊天」绑定场景). */
  brainWorkspaceKey?: import("./workspace-types.js").BrainWorkspaceKey;
  /** User-visible chat vs internal sub-agent session (OpenClaw-style isolated child). */
  kind?: "user" | "subagent";
  /** Parent thread when kind is subagent. */
  parentThreadId?: string;
  updatedAt: string;
  lastEventSummary?: string;
  status?: "idle" | "running" | "awaiting-approval" | "failed";
  statusLabel?: string;
  branch?: string;
  archived?: boolean;
}

export interface WorkspaceTimelineEvent {
  id: string;
  type: "message" | "approval" | "patch" | "run" | "thread";
  title: string;
  detail: string;
  createdAt: string;
}

export interface WorkspaceCondaConfig {
  source: "system" | "managed";
  condaPath: string;
  envPath: string;
  envName: string;
  pythonVersion: string;
  lastCheckedAt?: string;
  lastProvisionedAt?: string;
}

export interface WorkspaceCatalogItem {
  id: string;
  name: string;
  path: string;
  threads: WorkspaceThreadRecord[];
  /** BRAIN scene binding; missing/invalid values normalize to `document`. */
  brainWorkspaceKey?: import("./workspace-types.js").BrainWorkspaceKey;
  conda?: WorkspaceCondaConfig;
}

export interface SkillSpec {
  id: string;
  name: string;
  summary: string;
  status: "enabled" | "planned" | "disabled";
  icon?: string;
  source?: string;
  scope?: string;
  path?: string;
}

export interface PluginSpec {
  id: string;
  name: string;
  summary: string;
  status: "connected" | "planned" | "enabled" | "disabled";
  version?: string;
  source?: string;
  manifestPath?: string;
  publisher?: string;
  capabilities?: string[];
  skillRoots?: string[];
  mcpServerIds?: string[];
  lastError?: string;
}

export interface AutomationSpec {
  id: string;
  title: string;
  status: "idle" | "scheduled" | "running" | "paused";
  trigger: string;
  prompt?: string;
  schedule?: string;
  runtime?: string;
  model?: string;
  reasoning?: string;
  rrule?: string;
  workspaceId?: string;
  threadId?: string;
  action?: "workspace_scan" | "git_status" | "error_remediation";
  intervalMinutes?: number;
  dailyTime?: string;
  lastRunAt?: string;
  nextRunAt?: string;
  failureCount?: number;
  lastError?: string;
}

export interface SearchResultSpec {
  id: string;
  kind: "workspace" | "thread" | "timeline" | "message" | "memory" | "file";
  title: string;
  detail: string;
  workspaceId?: string;
  threadId?: string;
  filePath?: string;
  createdAt?: string;
}

export interface MobilePairingState {
  status: "stopped" | "waiting" | "connected";
  url: string;
  code: string;
  deviceName: string;
  expiresAt: string;
}

export interface ResearchWritingAttachmentInput {
  name: string;
  path: string;
  url: string;
}

export interface ResearchWritingIntakeInput {
  userRequest?: string;
  conversationContext?: string;
  answers: Array<{ question: string; answer: string }>;
  attachments?: ResearchWritingAttachmentInput[];
}

export interface ResearchWritingSourceInput {
  title: string;
  sourceType: string;
  url?: string;
  content: string;
}

export interface ResearchWritingPayload {
  title?: string;
  body: string;
  sources: ResearchWritingSourceInput[];
}

export type ResearchWritingExportFormat = "docx" | "txt" | "review-docx" | "review-txt";

export interface ResearchWritingExportInput {
  payload: ResearchWritingPayload;
  format: ResearchWritingExportFormat;
}

export interface ComposerAttachment {
  name: string;
  path: string;
  url: string;
  /** Original user-selected path when known (copied or local-linked). */
  sourcePath?: string;
  /** copied = managed app storage; local = referenced in place without whole-file copy. */
  linkMode?: "copied" | "local";
  sizeBytes?: number;
}

export interface OpenComposerAttachmentInput {
  path: string;
}

export interface SaveComposerClipboardFileInput {
  name: string;
  mimeType: string;
  data: ArrayBuffer;
}

export interface GeneratePatchInput {
  filePath: string;
  searchText: string;
  replaceText: string;
}

export type AppMenuName = "file" | "edit" | "view" | "window" | "help";

export interface ShowAppMenuInput {
  menu: AppMenuName;
  x: number;
  y: number;
}

export interface CancelModelRequestInput {
  requestId?: string;
}

export interface GuideModelRequestInput {
  requestId: string;
  message: string;
  attachments?: Array<{
    name: string;
    path: string;
    url?: string;
  }>;
  /** steer = inject into the active loop; followup = next turn; interrupt = cancel then send. */
  delivery?: "steer" | "followup" | "interrupt";
}

export type RespondApprovalInput = boolean | {
  approved: boolean;
  requestId?: string;
  approvalId?: string;
  permissionMode?: "full";
};

export interface ModelChatMessageInput {
  id?: string;
  role: "system" | "user" | "assistant";
  content: string;
  createdAt?: string;
  attachments?: ComposerAttachment[];
}

export type ModelOptimizeFor = "cost" | "balanced" | "intelligence";

export type ModelRoutingStatus = "probing" | "active" | "failed" | "disabled";

export type ModelRoutingRole = "chat" | "code" | "gov" | "research" | "vision" | "review";

export type ModelRoutingTaskClass = "chat" | "code" | "gov_write" | "research" | "general";

/** Gateway probe profile consumed by Auto constraint solving. */
export interface ModelRoutingProfile {
  schema_version: 1;
  status: ModelRoutingStatus;
  tier: 1 | 2 | 3;
  cost_weight: number;
  quality_weight: number;
  quality_by_task?: Partial<Record<ModelRoutingTaskClass, number>>;
  roles: ModelRoutingRole[];
  capabilities: string[];
  max_context?: number;
  probed_at?: string;
  probe_version?: string;
}

export interface ModelChatInput {
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
  permissionMode?: "full" | "approval" | "agent";
  /** Optional per-turn override; otherwise ModelConfig.optimizeFor. */
  optimizeFor?: ModelOptimizeFor;
  systemPrompt: string;
  toolContext?: string;
  selectedSkillNames?: string[];
  composerModes?: Array<"goal" | "plan">;
  messages: ModelChatMessageInput[];
}

export type HolonWorkItemStatus =
  | "QUEUED"
  | "DISPATCHED"
  | "RUNNING"
  | "WAITING_APPROVAL"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT";

export interface HolonWorkItem {
  schemaVersion: 1;
  id: string;
  source: string;
  objective: string;
  status: HolonWorkItemStatus;
  targetDeviceId: string;
  knowledgeSnapshotId?: string;
  executionPolicyVersion: string;
  learningPolicyVersion: string;
  versionNo: number;
  dispatchAttemptCount: number;
  leaseUntil: string;
  cancelRequested: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HolonKnowledgeSnapshotItem {
  skillKey: string;
  versionId: string;
  ordinal: number;
  contentJson: string;
  contentHash: string;
}

export interface HolonKnowledgeSnapshot {
  schemaVersion: 1;
  id: string;
  generation: number;
  status: "READY";
  itemCount: number;
  contentHash: string;
  createdAt: string;
  items: HolonKnowledgeSnapshotItem[];
}

export type HolonRuntimeEventType =
  | "work_item.started"
  | "tool.completed"
  | "tool.failed"
  | "approval.requested"
  | "approval.resolved"
  | "work_item.completed"
  | "work_item.failed"
  | "work_item.cancelled";

export interface HolonRuntimeEvent {
  schemaVersion: 1;
  eventId: string;
  workItemId: string;
  threadId?: string;
  turnId?: string;
  sequenceNo: number;
  eventType: HolonRuntimeEventType;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface HolonEventBatchResult {
  ok: true;
  accepted: number;
  duplicate: number;
  total: number;
}

export interface HolonWorkItemIdInput { workItemId: string; }
export interface HolonKnowledgeSnapshotInput { snapshotId: string; }
export interface StartHolonWorkItemInput extends HolonWorkItemIdInput { threadId: string; turnId: string; }
export interface LearningListInput { limit?: number; }
export interface LearningSearchInput { query: string; limit?: number; }
export interface LearningCandidateInput { versionId: string; }
export interface LearningRollbackInput { skillKey: string; targetVersionId: string; }
export interface HolonFeedbackInput {
  idempotencyKey: string;
  workItemId: string;
  knowledgeSnapshotId: string;
  skillKey: string;
  versionId: string;
  success: boolean;
  safetyViolation: boolean;
  userRating?: -1 | 0 | 1;
  metrics: Record<string, number | boolean>;
}
export interface HolonSyncStatus {
  online: boolean;
  flushing: boolean;
  pendingEventCount: number;
  quarantinedEventCount: number;
  lastSyncAt?: string;
  lastError?: string;
}
export type HolonLocalWorkItemStatus = "claimed" | "running" | "waiting_approval" | "interrupted" | "completed" | "failed" | "cancelled";
export interface HolonWorkItemView {
  workItem: HolonWorkItem;
  snapshot: HolonKnowledgeSnapshot | null;
  effectiveToolNames: string[];
  status: HolonLocalWorkItemStatus;
  threadId?: string;
  lastError: string;
}
export interface HolonLearningCandidate {
  versionId: string;
  skillKey: string;
  parentVersionId?: string;
  status: "REVIEW_REQUIRED";
  contentJson: string;
  contentHash: string;
  sourceWorkItemId?: string;
  evaluationRunId?: string;
  indexStatus: string;
  createdAt: string;
  activatedAt?: string;
}
export interface HolonKnowledgeSearchResult {
  skillKey: string;
  versionId: string;
  content: string;
  contentHash: string;
  createdAt: string;
  score: number;
  source?: string;
}

/** Persisted desktop settings shared by renderer, preload, and main. */
export interface DesktopPreferences {
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
    /**
     * When true, keyword/heuristic routing may auto-awaken specialty skills.
     * Default false — explicit composer selection unless the user opts in.
     */
    autoSkillEnabled: boolean;
  };
  permissions: { fullAccess: boolean };
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
  popup: { shortcut: string; defaultProjectlessChat: boolean };
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
  worktree: { defaultIsolated: boolean; keepArchived: boolean; rootDir: string };
  browser: {
    enabled: boolean;
    autoOpenPreview: boolean;
    preserveTabs: boolean;
    highResScreenshots: boolean;
    previewUrl: string;
    openWebLinksIn: "in-app-browser" | "system";
    openLocalLinksIn: "in-app-browser" | "system";
    showFullUrl: boolean;
    annotatedScreenshots: "always" | "ask" | "never";
    downloadDir: string;
    askDownloadPath: boolean;
    historyAccess: "always_ask" | "allow" | "deny";
    siteToolsEnabled: boolean;
    agentPermissions: {
      defaults: {
        browse: "require_approval" | "always_allow" | "deny";
        download: "require_approval" | "always_allow" | "deny";
        upload: "require_approval" | "always_allow" | "deny";
      };
      exceptions: Array<{
        origin: string;
        browse: "require_approval" | "always_allow" | "deny";
        download: "require_approval" | "always_allow" | "deny";
        upload: "require_approval" | "always_allow" | "deny";
      }>;
    };
    fullCdpAccess: boolean;
  };
  /**
   * Skill market install policy.
   * Desktop connects to ClawHub directly when `directClawhubAllowed` is true (default).
   * Fleet may still publish `market.direct_clawhub_allowed=false` as metadata; local preference wins.
   */
  market: {
    directClawhubAllowed: boolean;
  };
  /**
   * Last opened BRAIN scene workspace.
   * Empty string means unset — fall back to localStorage / default `explore`.
   */
  brain: {
    selectedWorkspaceKey: string;
  };
  /**
   * Start the desktop app when the OS user session starts.
   * Missing saved values normalize to true.
   */
  launchAtLogin: boolean;
}

export interface McpServerConfig {
  id: string;
  name: string;
  transport: "stdio" | "sse";
  command: string;
  args: string[];
  url: string;
  env: Record<string, string>;
  enabled: boolean;
}

export interface McpServerHealth {
  ok: boolean;
  code?: string;
  detail: string;
  checkedAt: string;
  running?: boolean;
}

export interface McpServerInspection {
  ok: boolean;
  detail: string;
  checkedAt: string;
  serverInfo?: string;
  protocolVersion?: string;
  tools: Array<{ name: string; description: string; inputSchema?: Record<string, unknown> }>;
}

export interface McpDiscoveredTool {
  id: string;
  serverId: string;
  serverName: string;
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  protocolVersion?: string;
  discoveredAt: string;
}

export interface McpToolCallResult {
  ok: boolean;
  toolName: string;
  serverName: string;
  detail: string;
  content: string;
}

export interface McpToolCallInput {
  toolId: string;
  query: string;
  args?: Record<string, unknown>;
}

export interface SystemToolEntry {
  id: string;
  label: string;
  kind: "developer" | "system";
  icon: string;
  available: boolean;
  appName: string;
  commands: string[];
}

export interface DesktopBootstrapStatus {
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
    status: "ready" | "manual_required" | "pending" | "running";
    initializedAt?: string;
    updatedAt?: string;
    source?: "system" | "managed";
    condaPath?: string;
    reason?: string;
  };
}

export type PluginScope = "public" | "private";
export type PluginInstallState =
  | "not_installed"
  | "installed"
  | "disabled"
  | "failed"
  | "removed"
  | "update_available"
  | "installed_pending_report";
export type PluginAction = "install" | "update" | "enable" | "disable" | "remove";

export interface PluginCatalogItem {
  plugin_key: string;
  display_name: string;
  description: string;
  category: string;
  publisher: string;
  scope: PluginScope;
  icon_url: string;
  install_state: PluginInstallState;
  installed_version: string;
  latest_version: string;
  actions: PluginAction[];
  skills: string[];
}

export interface PluginCatalogSnapshot {
  items: PluginCatalogItem[];
  categories: string[];
  page: number;
  page_size: number;
  total: number;
}

export interface PluginCatalogQuery {
  scope?: PluginScope;
  category?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface PluginKeyInput { pluginKey: string }
export interface PluginInstallInput extends PluginKeyInput { version?: string }
export interface PluginSetEnabledInput extends PluginKeyInput { enabled: boolean }

export interface PluginOperationResult {
  ok: boolean;
  pluginKey: string;
  state: PluginInstallState;
  version: string;
  errorCode?: string;
  detail?: string;
}

export const desktopIpcChannels = {
  preferences: {
    get: "phase1:get-desktop-preferences",
    save: "phase1:save-desktop-preferences"
  },
  bootstrap: {
    getStatus: "phase1:get-desktop-bootstrap-status",
    start: "phase1:start-desktop-bootstrap",
    retryConda: "phase1:retry-desktop-conda-bootstrap"
  },
  auth: {
    getStatus: "phase1:get-auth-status",
    getBillingSubscription: "phase1:get-billing-subscription",
    openWalletPayment: "phase1:open-wallet-payment",
    claimNationalDayGift: "phase1:claim-national-day-gift",
    sendLoginCode: "phase1:send-login-code",
    login: "phase1:login-auth",
    loadRememberedLogin: "phase1:load-remembered-login",
    saveRememberedLogin: "phase1:save-remembered-login",
    clearRememberedLogin: "phase1:clear-remembered-login",
    changePassword: "phase1:change-auth-password",
    changeEmail: "phase1:change-auth-email",
    logout: "phase1:logout-auth"
  },
  holon: {
    getNextWorkItem: "phase1:holon-get-next-work-item",
    startWorkItem: "phase1:holon-start-work-item",
    cancelWorkItem: "phase1:holon-cancel-work-item",
    getWorkItemState: "phase1:holon-get-work-item-state",
    getKnowledgeSnapshot: "phase1:holon-get-knowledge-snapshot",
    getSyncStatus: "phase1:holon-get-sync-status",
    submitFeedback: "phase1:holon-submit-feedback"
  },
  learning: {
    listCandidates: "phase1:learning-list-candidates",
    searchPrivateKnowledge: "phase1:learning-search-private-knowledge",
    approveCandidate: "phase1:learning-approve-candidate",
    rejectCandidate: "phase1:learning-reject-candidate",
    rollbackPrivateSkill: "phase1:learning-rollback-private-skill"
  },
  plugins: {
    list: "plugins:list",
    get: "plugins:get",
    install: "plugins:install",
    setEnabled: "plugins:set-enabled",
    remove: "plugins:remove",
    reconcile: "plugins:reconcile"
  },
  experts: {
    list: "experts:list",
    install: "experts:install",
    setEnabled: "experts:set-enabled",
    summon: "experts:summon",
    clearSummon: "experts:clear-summon",
    getSummon: "experts:get-summon",
    resolveFromSkill: "experts:resolve-from-skill",
    summonFromSkill: "experts:summon-from-skill"
  },
  openclawSkills: {
    search: "phase1:search-openclaw-skills",
    installClawHub: "phase1:install-openclaw-skill-clawhub",
    installPath: "phase1:install-openclaw-skill-path",
    selectAndInstall: "phase1:select-install-openclaw-skill",
    inspectPath: "phase1:inspect-openclaw-skill-path",
    exportZip: "phase1:export-openclaw-skill-zip",
    uninstallWritingSkills: "phase1:uninstall-writing-skills"
  },
  goal: {
    get: "phase1:get-goal",
    getExecution: "phase1:get-goal-execution",
    create: "phase1:create-goal",
    update: "phase1:update-goal",
    setPaused: "phase1:set-goal-paused",
    updateObjective: "phase1:update-goal-objective",
    delete: "phase1:delete-goal",
    replacePlan: "phase1:replace-goal-plan",
    createQuestion: "phase1:create-goal-question",
    answerQuestion: "phase1:answer-goal-question"
  },
  governmentWritingSpecification: {
    get: "phase1:get-government-writing-specification",
    save: "phase1:save-government-writing-specification",
    saveSuggestions: "phase1:save-government-writing-specification-suggestions",
    applySuggestions: "phase1:apply-government-writing-specification-suggestions",
    confirm: "phase1:confirm-government-writing-specification"
  },
  workspace: {
    list: "phase1:list-workspaces",
    add: "phase1:add-workspace",
    createBlank: "phase1:create-blank-workspace",
    selectFolder: "phase1:select-workspace-folder",
    rename: "phase1:rename-workspace",
    remove: "phase1:remove-workspace",
    openLocation: "phase1:open-workspace-location",
    addThread: "phase1:add-workspace-thread",
    forkThread: "phase1:fork-workspace-thread",
    renameThread: "phase1:rename-workspace-thread",
    archiveThread: "phase1:archive-workspace-thread",
    deleteThread: "phase1:delete-workspace-thread",
    activateThread: "phase1:activate-workspace-thread",
    exportThreadHtml: "phase1:export-workspace-thread-html"
  },
  workspaceFiles: {
    read: "phase1:read-workspace-file",
    preview: "phase1:preview-workspace-file",
    open: "phase1:open-workspace-file",
    performAction: "phase1:perform-workspace-file-action"
  },
  workspaceGit: {
    getHeaderStatus: "phase1:get-workspace-header-status",
    getReviewChanges: "phase1:get-review-changes",
    getBranches: "phase1:get-workspace-branches",
    switchBranch: "phase1:switch-workspace-branch",
    recordFeedback: "phase1:record-message-feedback",
    createWorktree: "phase1:create-workspace-worktree"
  },
  collaboration: {
    run: "phase1:run-delegated-agent",
    list: "phase1:list-delegated-agents",
    respondApproval: "phase1:respond-delegated-agent-approval",
    mergeResults: "phase1:merge-delegated-agent-results"
  },
  window: {
    control: "phase1:window-control",
    showAppMenu: "phase1:show-app-menu",
    appCommand: "phase1:app-command",
    dictationCommand: "phase1:dictation-command",
    showInputContextMenu: "phase1:show-input-context-menu"
  },
  terminal: {
    getSession: "phase1:get-terminal-session",
    writeInput: "phase1:write-terminal-input",
    restartSession: "phase1:restart-terminal-session",
    openSystem: "phase1:open-system-terminal",
    update: "phase1:terminal-update"
  },
  browser: {
    openPreview: "phase1:open-browser-preview",
    closePreview: "phase1:close-browser-preview",
    capturePreview: "phase1:capture-browser-preview",
    clearBrowsingData: "phase1:clear-browser-browsing-data",
    listHistory: "phase1:list-browser-history",
    removeHistoryEntry: "phase1:remove-browser-history-entry",
    clearHistory: "phase1:clear-browser-history",
    selectDownloadDir: "phase1:select-browser-download-dir",
    listCredentials: "phase1:list-browser-credentials",
    upsertCredential: "phase1:upsert-browser-credential",
    removeCredential: "phase1:remove-browser-credential",
    listContacts: "phase1:list-browser-contacts",
    upsertContact: "phase1:upsert-browser-contact",
    removeContact: "phase1:remove-browser-contact",
    getCdpAccess: "phase1:get-browser-cdp-access",
    probeSiteTools: "phase1:probe-browser-site-tools"
  },
  mobile: {
    startPairing: "phase1:start-mobile-pairing",
    getPairingStatus: "phase1:get-mobile-pairing-status",
    stopPairing: "phase1:stop-mobile-pairing",
    action: "phase1:mobile-action"
  },
  events: {
    assistantActivity: "phase1:assistant-activity",
    modelReasoningDelta: "phase1:model-reasoning-delta",
    snapshotUpdate: "phase1:snapshot-update",
    openWorkspaceFilePreview: "phase1:open-workspace-file-preview"
  },
  system: {
    getTools: "phase1:get-system-tools",
    openTool: "phase1:open-system-tool",
    openSkillLocation: "phase1:open-skill-location",
    openLogLocation: "phase1:open-log-location",
    reportRendererFailure: "phase1:report-renderer-failure"
  },
  usageExceptionFeedback: {
    createPreview: "phase1:create-usage-exception-feedback-preview",
    confirm: "phase1:confirm-usage-exception-feedback"
  },
  appUpdate: {
    getStatus: "phase1:get-app-update-status",
    start: "phase1:start-app-update",
    verify: "phase1:verify-app-update",
    progress: "phase1:app-update-progress"
  },
  growth: {
    listInstances: "growth:list-instances",
    listHumanTasks: "growth:list-human-tasks",
    completeHumanTask: "growth:complete-human-task",
    publishSkill: "growth:publish-skill",
    listSkills: "growth:list-skills",
    upsertMemory: "growth:upsert-memory",
    listConnectors: "growth:list-connectors",
    solidifyConnector: "growth:solidify-connector",
    listTemplates: "growth:list-templates",
    importTemplate: "growth:import-template",
    completeAsyncWebhook: "growth:complete-async-webhook",
    runtimeStatus: "growth:runtime-status",
    setKillSwitch: "growth:set-kill-switch",
    listRuntimeAudits: "growth:list-runtime-audits",
    caseAsyncHumanDemo: "growth:case-async-human-demo"
  },
  core: {
    bootstrap: "phase1:bootstrap",
    getSnapshot: "phase1:get-snapshot",
    queueWorkspaceScan: "phase1:queue-workspace-scan",
    queueGitStatus: "phase1:queue-git-status",
    queueShellCommand: "phase1:queue-shell-command",
    respondApproval: "phase1:respond-approval",
    generatePatch: "phase1:generate-patch",
    applyPatch: "phase1:apply-patch"
  },
  model: {
    getConfig: "phase1:get-model-config",
    saveConfig: "phase1:save-model-config",
    chat: "phase1:chat-with-model",
    cancelRequest: "phase1:cancel-model-request",
    guideRequest: "phase1:guide-model-request",
    streamDelta: "phase1:model-stream-delta"
  },
  customModels: {
    list: "phase1:list-custom-model-endpoints",
    save: "phase1:save-custom-model-endpoint",
    delete: "phase1:delete-custom-model-endpoint",
    select: "phase1:select-custom-model-endpoint"
  },
  features: {
    getConfig: "phase1:get-feature-config",
    addItem: "phase1:add-feature-item",
    updateItem: "phase1:update-feature-item",
    deleteItem: "phase1:delete-feature-item"
  },
  researchWriting: {
    generateIntake: "phase1:generate-research-writing-intake",
    review: "phase1:review-research-writing",
    export: "phase1:export-research-writing"
  },
  composer: {
    selectImages: "phase1:select-composer-images",
    openAttachment: "phase1:open-composer-attachment",
    saveClipboardFile: "phase1:save-composer-clipboard-file"
  },
  deliveryPreferences: {
    get: "phase1:get-delivery-preferences",
    clear: "phase1:clear-delivery-preferences",
    pin: "phase1:pin-delivery-preferences"
  },
  policy: {
    getRules: "phase1:get-policy-rules",
    saveRules: "phase1:save-policy-rules"
  },
  search: {
    workspaces: "phase1:search-workspaces"
  },
  mcp: {
    getServers: "phase1:get-mcp-servers",
    saveServers: "phase1:save-mcp-servers",
    testServer: "phase1:test-mcp-server",
    startServer: "phase1:start-mcp-server",
    stopServer: "phase1:stop-mcp-server",
    getLogs: "phase1:get-mcp-server-logs",
    clearLogs: "phase1:clear-mcp-server-logs",
    inspectServer: "phase1:inspect-mcp-server",
    getDiscoveredTools: "phase1:get-mcp-discovered-tools",
    callTool: "phase1:call-mcp-tool"
  }
} as const;

export interface DesktopAgreementConfig {
  enabled: boolean;
  tos_title?: string;
  tos_content_html?: string;
  policy_title?: string;
  policy_content_html?: string;
  topic_name?: string;
  topic_id?: number;
}

export interface DesktopAuthAccount {
  id?: string;
  plan_type?: string;
  structure?: string;
  conversation_classifier_enabled?: boolean;
  finserv_enabled?: boolean;
  fedramp_compliant?: boolean;
  delinquent?: boolean;
  residency_region?: string;
  compute_residency?: string;
}

export interface DesktopAuthStatus {
  authenticated: boolean;
  loading: boolean;
  mode: "session_cookie" | "desktop_token" | "none";
  base_url: string;
  user?: {
    id: string;
    email: string;
    display_name: string;
    idp: string;
    iat?: number;
    amr: string[];
    acr: string;
    mfa: boolean;
    role: string;
    plan: string;
    avatar_text: string;
  };
  account?: DesktopAuthAccount;
  agreement?: DesktopAgreementConfig;
  last_error?: string;
  last_checked_at?: string;
  email_code_login_enabled?: boolean;
  password_login_enabled?: boolean;
  server_time?: string | null;
  server_date?: string | null;
  login_ceremony_enabled?: boolean;
}

export interface DesktopAuthLoginInput {
  email: string;
  password?: string;
  agreement_accepted: boolean;
  captcha?: string;
}

export interface DesktopAuthSendCodeInput { email?: string; phone?: string }
export interface DesktopAuthChangePasswordInput { currentPassword: string; newPassword: string }
export interface DesktopAuthChangeEmailInput { email: string; code: string }

export interface GoalThreadInput { threadId?: string }
export interface CreateGoalInput { objective: string; tokenBudget?: number; threadId: string }
export interface UpdateGoalInput {
  status: "complete" | "blocked";
  tokensUsed?: number;
  timeUsedSeconds?: number;
  threadId: string;
}
export interface SetGoalPausedInput extends GoalThreadInput { paused: boolean }
export interface UpdateGoalObjectiveInput extends GoalThreadInput { objective: string }
export interface ReplaceGoalPlanInput {
  steps: Array<{
    stepId: string;
    title: string;
    description: string;
    status: "pending" | "in_progress" | "completed";
    result?: string;
  }>;
}
export interface CreateGoalQuestionInput {
  questionId: string;
  prompt: string;
  options: Array<{ label: string; description: string; recommended?: boolean }>;
}
export interface AnswerGoalQuestionInput extends GoalThreadInput { questionId: string; answer: string }

export interface GovernmentWritingSpecificationContentInput {
  task: string;
  requirements: Array<{ key: string; label: string; value: string; status: "confirmed" | "pending" }>;
  cases: Array<{
    caseId: string;
    name: string;
    plannedUse: string;
    status: "verified" | "partial" | "missing" | "replace";
    evidence: Array<{
      evidenceId: string;
      title: string;
      authority: string;
      publishedAt: string;
      url: string;
      supportedClaims: string[];
      unsupportedClaims: string[];
      readFromOfficialPage: boolean;
      status: "verified" | "partial" | "missing" | "replace";
    }>;
  }>;
  structure: Array<{
    sectionId: string;
    level: 1 | 2;
    title: string;
    points: string;
    evidenceIds: string[];
    targetCharacters: number | null;
    verification: string;
  }>;
}

export interface GovernmentWritingSpecificationGoalInput extends GoalThreadInput { goalId: string }
export interface SaveGovernmentWritingSpecificationInput extends GovernmentWritingSpecificationGoalInput {
  currentVersionId?: string;
  source: "user-structured" | "user-markdown" | "model-revision" | "suggestion-application" | "model";
  changeSummary: string;
  content: GovernmentWritingSpecificationContentInput;
}
export interface ConfirmGovernmentWritingSpecificationInput extends GovernmentWritingSpecificationGoalInput { versionId: string }
export interface GovernmentWritingSuggestionInput {
  suggestionId: string;
  target:
    | { kind: "task" }
    | { kind: "requirement"; key: string }
    | { kind: "section-points"; sectionId: string };
  reason: string;
  proposedValue: string;
}
export interface SaveGovernmentWritingSuggestionsInput extends GovernmentWritingSpecificationGoalInput {
  baseVersionId: string;
  suggestions: GovernmentWritingSuggestionInput[];
}
export interface ApplyGovernmentWritingSuggestionsInput extends GovernmentWritingSpecificationGoalInput {
  baseVersionId: string;
  suggestionIds: string[];
}

export interface AddWorkspaceInput {
  name: string;
  path: string;
  brainWorkspaceKey?: import("./workspace-types.js").BrainWorkspaceKey;
}
export interface CreateBlankWorkspaceInput {
  name: string;
  brainWorkspaceKey?: import("./workspace-types.js").BrainWorkspaceKey;
}
export interface WorkspaceIdInput { workspaceId: string }
export interface RenameWorkspaceInput extends WorkspaceIdInput { name: string }
export interface OpenWorkspaceLocationInput extends WorkspaceIdInput { target: "explorer" | "vscode" }
export interface WorkspaceThreadInput extends WorkspaceIdInput { threadId: string }
export type ActivateWorkspaceThreadInput = WorkspaceThreadInput;
export interface AddWorkspaceThreadInput extends WorkspaceIdInput {
  title: string;
  summary: string;
  scope?: "project" | "chat";
  /** Scene affinity when creating INTERNAL_CHAT / standalone chat threads. */
  brainWorkspaceKey?: import("./workspace-types.js").BrainWorkspaceKey;
}
export interface ForkWorkspaceThreadInput extends WorkspaceIdInput {
  sourceThreadId: string;
  title: string;
  owner?: "planner" | "researcher" | "verifier" | "editor";
  instruction?: string;
}
export interface RenameWorkspaceThreadInput extends WorkspaceThreadInput { title: string; summary: string }
export interface ArchiveWorkspaceThreadInput extends WorkspaceThreadInput {
  archived: boolean;
  scope?: "project" | "chat";
}
export interface ExportWorkspaceThreadHtmlInput extends WorkspaceThreadInput {
  /** Optional live renderer messages; when present they override persisted thread state. */
  liveMessages?: ChatMessage[];
}
export interface ExportWorkspaceThreadHtmlResult {
  ok: boolean;
  canceled: boolean;
  path?: string;
  detail?: string;
}
export interface WorkspaceFileInput extends WorkspaceIdInput { filePath: string }
export type WorkspaceArtifactPreview = {
  kind: "pdf";
  path: string;
  name: string;
  mimeType: "application/pdf";
  size: number;
  dataUrl: string;
} | {
  kind: "docx";
  path: string;
  name: string;
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  size: number;
  html: string;
} | {
  kind: "pptx";
  path: string;
  name: string;
  mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  size: number;
  dataUrl: string;
} | {
  kind: "html";
  path: string;
  name: string;
  mimeType: "text/html";
  size: number;
  content: string;
  previewUrl: string;
} | {
  kind: "image";
  path: string;
  name: string;
  mimeType: string;
  size: number;
  previewUrl: string;
} | {
  kind: "video";
  path: string;
  name: string;
  mimeType: string;
  size: number;
  previewUrl: string;
} | {
  kind: "audio";
  path: string;
  name: string;
  mimeType: string;
  size: number;
  previewUrl: string;
};
export interface WorkspaceFileActionInput extends WorkspaceFileInput {
  action: "open-vscode" | "open-with" | "open-tool" | "copy-contents" | "reveal" | "save-as";
  toolId?: string;
}
export interface WorkspaceReviewInput { workspaceId?: string; threadId?: string }
export interface SwitchWorkspaceBranchInput extends WorkspaceIdInput { branch: string; create?: boolean }
export interface RecordMessageFeedbackInput extends WorkspaceReviewInput {
  messageId: string;
  rating: "helpful" | "unhelpful";
}
export interface CreateWorkspaceWorktreeInput extends WorkspaceIdInput { branchName?: string }
export interface RunDelegatedAgentInput extends WorkspaceIdInput { childThreadId: string }
export interface ListDelegatedAgentsInput extends WorkspaceIdInput { parentThreadId: string }
export interface RespondDelegatedAgentApprovalInput extends RunDelegatedAgentInput { approved: boolean }
export interface MergeDelegatedAgentResultsInput extends WorkspaceIdInput {
  parentThreadId: string;
  childThreadIds: string[];
}

export interface TerminalSessionSnapshot {
  cwd: string;
  shell: string;
  prompt: string;
  isRunning: boolean;
  lines: string[];
  launchedAt?: string;
  lastExitCode?: number | null;
}

export interface ModelConfig {
  provider: string;
  baseUrl: string;
  /** Write-only renderer input. Main process always returns this field empty. */
  apiKey: string;
  /** Safe status flag; never contains credential material. */
  apiKeyConfigured?: boolean;
  wireApi: "responses" | "chat.completions";
  model: string;
  reviewModel: string;
  reasoningEffort: "low" | "medium" | "high" | "xhigh";
  disableResponseStorage: boolean;
  systemPrompt: string;
  toolContext?: string;
  /** Auto Optimize For mode; default balanced when omitted. */
  optimizeFor?: ModelOptimizeFor;
  /** Parent Auto user-visible label from route settings; not an upstream model id. */
  autoParentDisplayName?: string;
  availableModels?: Array<{
    id: string;
    model: string;
    label: string;
    provider: string;
    /** Gateway capability tags such as vision / multimodal / image. */
    capabilities?: string[];
    /** Input price per 1M tokens from gateway billing config. */
    input_token_price_per_million?: number;
    /** Output price per 1M tokens from gateway billing config. */
    output_token_price_per_million?: number;
    /** Chinese capability introduction for the main agent. */
    capability_intro?: string;
    /** Best-fit task scenarios. */
    best_for?: string;
    /** Strength summary. */
    strengths?: string;
    /** Probe-generated routing profile; required for Auto eligibility when status=active. */
    routing?: ModelRoutingProfile;
  }>;
}

export interface DesktopPolicyRule {
  id?: string;
  toolName?: string;
  commandPrefix?: string;
  decision: "allow" | "ask" | "deny";
  enabled?: boolean;
  reason?: string;
  /** exact remembers a full approved command; prefix is legacy startsWith matching */
  match?: "exact" | "prefix";
}

export interface OpenSystemToolInput {
  toolId: string;
  workspaceId?: string;
}

export interface OpenSkillLocationInput {
  id?: string;
  name?: string;
}

export interface RendererFailureInput {
  kind: "renderer_error" | "renderer_unhandled_rejection" | "renderer_bootstrap_error";
  message: string;
  stackTrace?: string;
  context?: Record<string, unknown>;
}

export interface CreateUsageExceptionFeedbackPreviewInput {
  workspaceId: string;
  threadId: string;
  description: string;
}

export interface ConfirmUsageExceptionFeedbackInput {
  previewId: string;
}

export interface UsageExceptionFeedbackPreview {
  previewId: string;
  title: string;
  symptomSummary: string;
  possibleCause: string;
  category: string;
  contextSummary: string;
  environmentSummary: string;
  logSummary: string;
  expiresAt: string;
}

export interface UsageExceptionFeedbackSubmissionResult {
  ok: boolean;
  localReportId: string;
  delivery: "uploaded" | "queued";
}

export interface DesktopAppUpdateStatus {
  currentVersion: string;
  available: boolean;
  latestVersion?: string;
  releaseId?: string;
  channel?: string;
  notes?: string;
  mandatory?: boolean;
  downloadUrl?: string;
  detail: string;
}

export interface DesktopAppUpdateStartResult {
  ok: boolean;
  path?: string;
  detail: string;
}

export interface DesktopAppUpdateProgress {
  phase: "preparing" | "downloading" | "verifying" | "installing" | "opening" | "done" | "error";
  percent: number;
  detail: string;
  latestVersion?: string;
  /** Silent in-app path, MSI wizard fallback, or ulit.zip patch apply. */
  installMode?: "silent" | "wizard" | "patch";
  preservesUserData: true;
}

export interface DesktopAppUpdateVerifyInput {
  releaseId: string;
  ok?: boolean;
}

export interface DesktopAppUpdateVerifyResult {
  ok: boolean;
  releaseId?: string;
  verificationCount?: number;
  threshold?: number;
  promotedToStable?: boolean;
  detail: string;
}

export interface SystemOpenResult {
  ok: boolean;
  detail: string;
}

export interface OpenLogLocationResult extends SystemOpenResult {
  path: string;
  files: {
    debug: string;
    diagnostics: string;
    auth: string;
    sqlite: string;
  };
}

export interface WorkspaceHeaderStatus {
  branch: string;
  changes: number;
  additions: number;
  deletions: number;
  githubCliAvailable: boolean;
}

export interface WorkspaceBranchStatus {
  current: string;
  branches: string[];
  changedFiles: number;
}

export interface WorkspaceReviewChanges {
  workspaceId: string;
  threadId: string;
  files: Array<{
    filePath: string;
    status: string;
    additions: number;
    deletions: number;
    diff: string;
    source: string;
  }>;
  additions: number;
  deletions: number;
}

export type WindowControlAction = "minimize" | "maximize" | "close";

export type ManagedFeatureKind = "skills" | "plugins" | "automations";

export interface FeatureItemInput {
  id?: string;
  name?: string;
  summary?: string;
  version?: string;
  source?: string;
  manifestPath?: string;
  path?: string;
  icon?: string;
  scope?: string;
  publisher?: string;
  capabilities?: string[] | string;
  title?: string;
  trigger?: string;
  status?: string;
  workspaceId?: string;
  threadId?: string;
  action?: string;
  intervalMinutes?: string;
  dailyTime?: string;
  prompt?: string;
  schedule?: string;
  runtime?: string;
  model?: string;
  reasoning?: string;
  rrule?: string;
}

export interface FeatureConfigPayload {
  skills: SkillSpec[];
  plugins: PluginSpec[];
  automations: AutomationSpec[];
}

export interface AddFeatureItemInput {
  kind: ManagedFeatureKind;
  item: FeatureItemInput;
}

export interface UpdateFeatureItemInput extends AddFeatureItemInput { id: string }
export interface DeleteFeatureItemInput { kind: ManagedFeatureKind; id: string }

export interface OpenClawSkillSearchInput {
  query?: string;
  limit?: number;
}

export interface OpenClawSkillSearchHit {
  score: number;
  slug: string;
  ownerHandle?: string | null;
  displayName: string;
  summary?: string;
  version?: string;
  updatedAt?: number;
  pageUrl?: string;
}

export interface OpenClawSkillInstallClawHubInput {
  ref: string;
  force?: boolean;
  acknowledgeRisk?: boolean;
  forceInstall?: boolean;
}

export interface OpenClawSkillInstallPathInput {
  path: string;
  force?: boolean;
  acknowledgeRisk?: boolean;
}

export interface OpenClawSkillSelectInstallInput {
  force?: boolean;
  acknowledgeRisk?: boolean;
}

export interface OpenClawSkillInspectPathInput {
  path: string;
}

export interface OpenClawSkillInstallResultPayload {
  skill: SkillSpec;
  targetDir: string;
  warnings: string[];
  source: string;
  acknowledgedRisk: boolean;
}

export interface OpenClawSkillExportZipInput {
  /** Feature catalog skill id, or skill folder name. */
  skillId?: string;
  skillName?: string;
  /** Optional absolute destination zip path. When omitted, a save dialog is used. */
  destinationPath?: string;
}

export interface OpenClawSkillExportZipResult {
  ok: boolean;
  skillName: string;
  zipPath: string;
  fileCount: number;
}

export interface UninstallWritingSkillsInput {
  /** Extra skill names to treat as writing skills for this request. */
  extraNames?: string[];
}

export interface UninstallWritingSkillsResult {
  ok: boolean;
  removed: Array<{ id: string; name: string }>;
  skipped: string[];
  detail: string;
}

export interface OpenWorkspaceFilePreviewEvent {
  workspaceId: string;
  filePath: string;
  kind?: "image" | "video" | "pdf" | "docx" | "pptx" | "html" | "text";
}

export interface PhaseOneSnapshot {
  session: SessionSummary;
  messages: ChatMessage[];
  workspace: WorkspaceEntry[];
  pendingTool?: ToolRequest;
  approval?: ApprovalRequest;
  patch?: PatchProposal;
  runs: CommandRun[];
  delegatedTasks?: DelegatedTask[];
  modelRoutes?: ModelRoute[];
  memories?: MemoryRecord[];
  timeline?: WorkspaceTimelineEvent[];
  /** Thread-scoped Delivery Preference OS profile (document.style, etc.). */
  deliveryPreferences?: {
    version: number;
    domains: Record<string, unknown>;
  };
  /** Durable, user-visible execution history. Private model reasoning is never stored here. */
  events?: Array<{
    id: string;
    type: string;
    createdAt: string;
    turnId?: string;
    payload: Record<string, unknown>;
  }>;
  automations?: AutomationSpec[];
}
export * from "./brain-workspace.js";
export * from "./software-types.js";
export * from "./workspace-types.js";
