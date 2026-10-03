import { useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { LoginScreen } from "./app/LoginScreen";
import { WorkspaceModules } from "./app/WorkspaceModules";
import { FeaturePanel } from "./app/FeaturePanel";
import { coerceValueBySchema, createSchemaFieldRenderer, setValueAtPath } from "./app/schema-fields";
import { SettingsWorkspace } from "./app/SettingsWorkspace";
import { AppShell } from "./app/AppShell";
import { ThreadContextMenu } from "./app/ThreadContextMenu";
import { AuthLoadingScreen, BootstrapBlockingScreen } from "./app/BootstrapScreens";
import { createMcpServerActions } from "./app/mcp-server-actions";
import { useDesktopCore } from "./app/useDesktopCore";
import { reconcileThreadDisplayMessages } from "./app/thread-activity-policy";
import { snapshotToDisplayMessages } from "./app/thread-hydration";
import { SidebarIcon } from "./app/SidebarIcon";
import type {
  AutomationSpec,
  PhaseOneSnapshot,
  PluginSpec,
  SearchResultSpec,
  SkillSpec,
  WorkspaceCatalogItem,
  WorkspaceThreadRecord,
  WorkspaceTimelineEvent
} from "@codex-forge/protocol";
import { INTERNAL_CHAT_WORKSPACE_ID } from "@codex-forge/protocol";
import { mapSubscriptionInactiveUserMessage } from "../shared/model-user-facing-error.ts";
import {
  SettingsNavIcon,
  SettingsSwitch,
  WorkspaceTree,
  buildWorkspaceTree,
  collectDirectoryKeys,
  emptySnapshot,
  featureItems,
  formatEnvText,
  formatRelativeTimeLabel,
  formatSearchKind,
  formatTimelineType,
  initialDesktopAuthStatus,
  initialDesktopPreferences,
  initialDraft,
  initialFeatureConfig,
  initialLoginForm,
  initialMcpServer,
  initialModelConfig,
  initialPatchForm,
  isCnMobile,
  optionalLoad,
  parseEnvText,
  resolveLoginIdentifier,
  settingsFeatureItem,
  shouldUseLoginCode,
  withTimeout
} from "./app/desktop-model";
import {
  APP_UPDATE_STATUS_POLL_MS,
  shouldRefreshAppUpdateOnWindowSignal
} from "./app/app-update-status-poll";
import type {
  BootstrapPayload,
  ComposerToolFieldValueMap,
  ComposerToolChip,
  DesktopAuthStatusState,
  DesktopBootstrapStatusState,
  DesktopPreferencesState,
  FeatureConfigPayload,
  FeatureTab,
  LoginFormState,
  ManagedFeatureDraft,
  ManagedFeatureKind,
  McpDiscoveredToolState,
  McpServerHealthState,
  McpServerInspectionState,
  McpServerState,
  ModelChatMessage,
  ModelConfigState,
  PatchFormState,
  PreviewMode,
  PreviewPlacement,
  SettingsSection,
  SystemToolState,
  TerminalSessionState,
  ThreadContextMenuState,
  TreeNode,
  ConversationTurn
} from "./app/desktop-model";

function normalizeModelErrorMessage(error: unknown) {
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/^Error invoking remote method 'phase1:chat-with-model': Error:\s*/i, "")
    .replace(/^Error invoking remote method \"phase1:chat-with-model\": Error:\s*/i, "")
    .trim();
  const subscriptionMessage = mapSubscriptionInactiveUserMessage(message);
  if (subscriptionMessage) return subscriptionMessage;
  if (/this operation was aborted|aborterror|model request aborted|agent loop was cancelled/i.test(message)) {
    return "上一轮请求已被新消息取代或手动停止。请查看最新回复，或重试上一轮。";
  }
  return message;
}

function normalizeLoginErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/^Error invoking remote method 'phase1:login-auth': Error:\s*/i, "")
    .replace(/^Error invoking remote method "phase1:login-auth": Error:\s*/i, "")
    .replace(/^Error invoking remote method 'phase1:send-login-code': Error:\s*/i, "")
    .replace(/^Error invoking remote method "phase1:send-login-code": Error:\s*/i, "")
    .trim();
}

type ReviewChangeFile = {
  filePath: string;
  status: string;
  additions: number;
  deletions: number;
  diff: string;
  source: string;
};

type QueuedComposerDraft = {
  question: string;
  images: Array<{ name: string; path: string; url: string }>;
  createdAt: string;
};

export function App() {
  const [bootstrapState, setBootstrapState] = useState("正在连接本地 runtime...");
  const [snapshot, setSnapshot] = useState<PhaseOneSnapshot>(emptySnapshot);
  const [workspaceCatalog, setWorkspaceCatalog] = useState<WorkspaceCatalogItem[]>([]);
  const [shellCommand, setShellCommand] = useState("git status --short --branch");
  const [patchForm, setPatchForm] = useState<PatchFormState>(initialPatchForm);
  const [modelConfig, setModelConfig] = useState<ModelConfigState>(initialModelConfig);
  const [desktopPreferences, setDesktopPreferences] = useState<DesktopPreferencesState>(initialDesktopPreferences);
  const [environmentEnvText, setEnvironmentEnvText] = useState("");
  const [chatMessages, setChatMessagesState] = useState<ModelChatMessage[]>([]);
  const chatMessagesRef = useRef<ModelChatMessage[]>([]);
  const threadMessagesRef = useRef<Map<string, ModelChatMessage[]>>(new Map());
  const threadActivitiesRef = useRef<Map<string, any[]>>(new Map());
  const selectedWorkspaceIdRef = useRef("");
  const selectedThreadIdRef = useRef("");
  const requestThreadIdsRef = useRef<Map<string, string>>(new Map());
  const [question, setQuestion] = useState("");
  const [composerImages, setComposerImages] = useState<
    Array<{ name: string; path: string; url: string }>
  >([]);
  const [queuedComposerDraft, setQueuedComposerDraft] = useState<QueuedComposerDraft | null>(null);
  const queuedComposerDraftRef = useRef<QueuedComposerDraft | null>(null);
  const [chatStatus, setChatStatus] = useState("登录后可直接提问；API Key 仅作为开发者兼容入口。");
  const [errorMessage, setErrorMessage] = useState("");
  const [isAskingModel, setIsAskingModel] = useState(false);
  const [askingThreadId, setAskingThreadId] = useState("");
  const activeModelRequestIdRef = useRef("");
  const activeThreadRequestsRef = useRef<Map<string, string>>(new Map());
  const streamLengthsByRequestRef = useRef<Map<string, number>>(new Map());
  const [activeThreadRequestVersion, setActiveThreadRequestVersion] = useState(0);
  const [composerPermission, setComposerPermission] = useState<"full" | "approval" | "agent">("full");
  const [composerWorkspaceContext, setComposerWorkspaceContext] = useState(true);
  const [selectedWorkspaceId, setSelectedWorkspaceIdState] = useState("");
  const [selectedThreadId, setSelectedThreadIdState] = useState("");
  const setSelectedWorkspaceId = (value: SetStateAction<string>) => {
    const next = typeof value === "function" ? value(selectedWorkspaceIdRef.current) : value;
    selectedWorkspaceIdRef.current = next;
    setSelectedWorkspaceIdState(next);
  };
  const setSelectedThreadId = (value: SetStateAction<string>) => {
    const previous = selectedThreadIdRef.current;
    const next = typeof value === "function" ? value(previous) : value;
    if (previous === next) {
      return;
    }
    selectedThreadIdRef.current = next;
    setSelectedThreadIdState(next);
    if (next) {
      const cached = threadMessagesRef.current.get(next);
      if (cached?.length) {
        chatMessagesRef.current = cached;
        setChatMessagesState(cached);
      } else if (previous !== next) {
        chatMessagesRef.current = [];
        setChatMessagesState([]);
      }
    }
  };

  const hydrateWorkspaceThread = (
    workspaceId: string,
    threadId: string,
    options?: { display?: boolean }
  ) => {
    if (!api || !workspaceId || !threadId) return;
    void api.activateWorkspaceThread({ workspaceId, threadId }).then((nextSnapshot) => {
      if (selectedThreadIdRef.current !== threadId) return;
      const restoredMessages = snapshotToDisplayMessages(nextSnapshot);
      const current = threadMessagesRef.current.get(threadId) ?? chatMessagesRef.current;
      const reconciled = reconcileThreadDisplayMessages(current, restoredMessages);
      updateThreadMessages(threadId, () => reconciled, { display: options?.display ?? true });
      setSnapshot(nextSnapshot);
    }).catch(() => undefined);
  };

  const selectWorkspaceThread = (
    workspaceId: string,
    threadId: string,
    options?: { force?: boolean }
  ) => {
    const normalizedWorkspaceId = String(workspaceId || "").trim();
    const normalizedThreadId = String(threadId || "").trim();
    if (!normalizedThreadId) return;
    if (normalizedWorkspaceId) {
      selectedWorkspaceIdRef.current = normalizedWorkspaceId;
      setSelectedWorkspaceIdState(normalizedWorkspaceId);
    }
    const switching = selectedThreadIdRef.current !== normalizedThreadId;
    if (switching) {
      setSelectedThreadId(normalizedThreadId);
    } else if (!options?.force) {
      return;
    }
    hydrateWorkspaceThread(normalizedWorkspaceId || selectedWorkspaceIdRef.current, normalizedThreadId, {
      display: true
    });
  };
  useEffect(() => {
    if (desktopPreferences.permissions?.fullAccess) {
      setComposerPermission("full");
    } else if (desktopPreferences.configuration?.requireApprovalForShell) {
      setComposerPermission("approval");
    } else {
      setComposerPermission("agent");
    }
  }, [desktopPreferences.permissions?.fullAccess, desktopPreferences.configuration?.requireApprovalForShell]);
  selectedWorkspaceIdRef.current = selectedWorkspaceId;
  selectedThreadIdRef.current = selectedThreadId;
  chatMessagesRef.current = chatMessages;

  const setChatMessages = (updater: ModelChatMessage[] | ((current: ModelChatMessage[]) => ModelChatMessage[])) => {
    setChatMessagesState((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      const threadId = selectedThreadIdRef.current;
      if (threadId) threadMessagesRef.current.set(threadId, next);
      chatMessagesRef.current = next;
      return next;
    });
  };

  const updateThreadMessages = (
    threadId: string,
    updater: ModelChatMessage[] | ((current: ModelChatMessage[]) => ModelChatMessage[]),
    options?: { display?: boolean }
  ) => {
    const current = threadMessagesRef.current.get(threadId) ??
      (selectedThreadIdRef.current === threadId ? chatMessagesRef.current : []);
    const next = typeof updater === "function" ? updater(current) : updater;
    threadMessagesRef.current.set(threadId, next);
    if (options?.display || selectedThreadIdRef.current === threadId) {
      chatMessagesRef.current = next;
      setChatMessagesState(next);
    }
    return next;
  };
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Set<string>>(() => new Set());
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [activeTreePath, setActiveTreePath] = useState("apps/desktop/src/renderer/ui.tsx");
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newWorkspacePath, setNewWorkspacePath] = useState("");
  const [newThreadTitle, setNewThreadTitle] = useState("");
  const [newThreadSummary, setNewThreadSummary] = useState("");
  const [isComposingNewThread, setIsComposingNewThread] = useState(false);
  const [newThreadScope, setNewThreadScope] = useState<"project" | "chat">("chat");
  const [chatUsesProject, setChatUsesProject] = useState(false);
  const [forkThreadTitle, setForkThreadTitle] = useState("");
  const [editingThreadTitle, setEditingThreadTitle] = useState("");
  const [editingThreadSummary, setEditingThreadSummary] = useState("");
  const [showRenameThreadDialog, setShowRenameThreadDialog] = useState(false);
  const [activeFeature, setActiveFeature] = useState<FeatureTab>("new-chat");
  const [featureConfig, setFeatureConfig] = useState<FeatureConfigPayload>(initialFeatureConfig);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResultSpec[]>([]);
  const [showSearchDialog, setShowSearchDialog] = useState(false);
  const [editingFeatureId, setEditingFeatureId] = useState("");
  const [skillDraft, setSkillDraft] = useState<ManagedFeatureDraft>({ ...initialDraft, status: "enabled" });
  const [pluginDraft, setPluginDraft] = useState<ManagedFeatureDraft>({ ...initialDraft, status: "connected" });
  const [automationDraft, setAutomationDraft] = useState<ManagedFeatureDraft>({
    ...initialDraft,
    status: "idle"
  });
  const [reviewDrawerOpen, setReviewDrawerOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("empty");
  const [terminalSession, setTerminalSession] = useState<any>(null);
  const [sideBrowserUrl, setSideBrowserUrl] = useState(desktopPreferences.browser.previewUrl || "");
  const sideBrowserFrameRef = useRef<HTMLIFrameElement | null>(null);
  const [sideFileFilter, setSideFileFilter] = useState("");
  const [previewPlacement, setPreviewPlacement] = useState<PreviewPlacement>("hidden");
  const [reviewOptionsOpen, setReviewOptionsOpen] = useState(false);
  const [reviewDiffCollapsed, setReviewDiffCollapsed] = useState(false);
  const [reviewSideBySide, setReviewSideBySide] = useState(false);
  const [reviewHiddenFiles, setReviewHiddenFiles] = useState<Set<string>>(() => new Set());
  const [reviewChanges, setReviewChanges] = useState<ReviewChangeFile[]>([]);
  const [reviewTotals, setReviewTotals] = useState({ additions: 0, deletions: 0 });
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [selectedReviewFile, setSelectedReviewFile] = useState("");
  const [reviewReloadToken, setReviewReloadToken] = useState(0);
  const [reviewFileFilter, setReviewFileFilter] = useState("");
  const [reviewCollapsedTreePaths, setReviewCollapsedTreePaths] = useState<Set<string>>(() => new Set());
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);
  const [showAddWorkspacePanel, setShowAddWorkspacePanel] = useState(false);
  const [sortProjectsAscending, setSortProjectsAscending] = useState(false);
  const [expandedThreadListWorkspaceIds, setExpandedThreadListWorkspaceIds] = useState<Set<string>>(() => new Set());
  const [threadContextMenu, setThreadContextMenu] = useState<ThreadContextMenuState | null>(null);
  const readPersistedIdSet = (key: string) => {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "[]");
      return new Set<string>(Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : []);
    } catch {
      return new Set<string>();
    }
  };
  const [pinnedThreadIds, setPinnedThreadIds] = useState<Set<string>>(() => readPersistedIdSet("newbrain.pinnedThreadIds.v1"));
  const [unreadThreadIds, setUnreadThreadIds] = useState<Set<string>>(() => readPersistedIdSet("newbrain.unreadThreadIds.v1"));
  const [archivedThreadIds, setArchivedThreadIds] = useState<Set<string>>(() => readPersistedIdSet("newbrain.archivedThreadIds.v1"));
  useEffect(() => {
    try {
      localStorage.setItem("newbrain.pinnedThreadIds.v1", JSON.stringify([...pinnedThreadIds]));
      localStorage.setItem("newbrain.unreadThreadIds.v1", JSON.stringify([...unreadThreadIds]));
      localStorage.setItem("newbrain.archivedThreadIds.v1", JSON.stringify([...archivedThreadIds]));
    } catch {
      // localStorage 不可用时忽略，仅影响状态持久化
    }
  }, [pinnedThreadIds, unreadThreadIds, archivedThreadIds]);
  useEffect(() => {
    try {
      if (selectedWorkspaceId) localStorage.setItem("newbrain.lastSelectedWorkspaceId.v1", selectedWorkspaceId);
      if (selectedThreadId) localStorage.setItem("newbrain.lastSelectedThreadId.v1", selectedThreadId);
    } catch {
      // 忽略持久化失败
    }
  }, [selectedWorkspaceId, selectedThreadId]);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showOpenLocationMenu, setShowOpenLocationMenu] = useState(false);
  const [showWorkspaceStatusMenu, setShowWorkspaceStatusMenu] = useState(false);
  const [workspaceHeaderStatus, setWorkspaceHeaderStatus] = useState({
    branch: "main",
    changes: 0,
    additions: 0,
    deletions: 0,
    githubCliAvailable: false
  });
  const [workspaceStatusSubmenu, setWorkspaceStatusSubmenu] = useState<"local" | "branch" | null>(null);
  const [workspaceBranches, setWorkspaceBranches] = useState<{ current: string; branches: string[]; changedFiles: number }>({ current: "", branches: [], changedFiles: 0 });
  const [branchSearch, setBranchSearch] = useState("");
  const [branchCreateName, setBranchCreateName] = useState("codex/new-branch");
  const [workspaceUsageRemaining, setWorkspaceUsageRemaining] = useState<number | null>(null);
  const [assistantActivities, setAssistantActivities] = useState<
    Array<{ type: "patch" | "run" | "complete"; title: string; detail: string; contentOffset?: number }>
  >([]);
  const streamingAssistantRef = useRef<{ id: string; contentLength: number }>({ id: "", contentLength: 0 });
  const [assistantStartedAt, setAssistantStartedAt] = useState<number | null>(null);
  const [lastAssistantElapsedSeconds, setLastAssistantElapsedSeconds] = useState<number | null>(null);
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSection>("account");
  const [mcpServers, setMcpServers] = useState<McpServerState[]>([]);
  const [mcpDraft, setMcpDraft] = useState<McpServerState>(initialMcpServer);
  const [editingMcpId, setEditingMcpId] = useState("");
  const [mcpHealth, setMcpHealth] = useState<Record<string, McpServerHealthState>>({});
  const [testingMcpId, setTestingMcpId] = useState("");
  const [mcpLogs, setMcpLogs] = useState<Record<string, string[]>>({});
  const [expandedMcpLogId, setExpandedMcpLogId] = useState("");
  const [mcpInspection, setMcpInspection] = useState<Record<string, McpServerInspectionState>>({});
  const [mcpDiscoveredTools, setMcpDiscoveredTools] = useState<McpDiscoveredToolState[]>([]);
  const [systemTools, setSystemTools] = useState<SystemToolState[]>([]);
  const [showMcpToolPicker, setShowMcpToolPicker] = useState(false);
  const [selectedComposerTools, setSelectedComposerTools] = useState<ComposerToolChip[]>([]);
  const [authStatus, setAuthStatus] = useState<DesktopAuthStatusState>(initialDesktopAuthStatus);
  const [appUpdateStatus, setAppUpdateStatus] = useState<null | {
    currentVersion: string;
    available: boolean;
    latestVersion?: string;
    releaseId?: string;
    channel?: string;
    notes?: string;
    mandatory?: boolean;
    downloadUrl?: string;
    staged?: boolean;
    stagedPath?: string;
    skippedVersion?: string;
    detail: string;
  }>(null);
  const [appUpdateBusy, setAppUpdateBusy] = useState(false);
  const [appUpdateDiscoverOpen, setAppUpdateDiscoverOpen] = useState(false);
  const [appUpdateApplied, setAppUpdateApplied] = useState<null | {
    fromVersion: string;
    toVersion: string;
    notes: string;
  }>(null);
  const [appUpdateProgress, setAppUpdateProgress] = useState<null | {
    phase: string;
    percent: number;
    detail: string;
    latestVersion?: string;
    currentVersion?: string;
    notes?: string;
    installMode?: "silent" | "wizard" | "patch" | "nsis";
    preservesUserData: true;
  }>(null);
  const [accountProfile, setAccountProfile] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem("newbrain.accountProfile.v1") || "{}");
    } catch {
      return {};
    }
  });
  const [loginForm, setLoginForm] = useState<LoginFormState>(initialLoginForm);
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false);
  const [isSendingLoginCode, setIsSendingLoginCode] = useState(false);
  const [loginCodeCooldownSeconds, setLoginCodeCooldownSeconds] = useState(0);
  const [agreementDialog, setAgreementDialog] = useState<null | "tos" | "policy">(null);
  const [desktopBootstrapStatus, setDesktopBootstrapStatus] = useState<DesktopBootstrapStatusState>({
    overall: {
      status: "pending",
      totalTasks: 1,
      completedTasks: 0,
      progressPercent: 0
    },
    tasks: [],
    conda: { status: "pending" }
  });
  const [isRetryingCondaBootstrap, setIsRetryingCondaBootstrap] = useState(false);

  const api = window.newbrain;

  useEffect(() => {
    const openSettings = (event: Event) => {
      const section = (event as CustomEvent<{ section?: SettingsSection }>).detail?.section;
      setActiveSettingsSection(section || "account");
      setActiveFeature("settings");
    };
    window.addEventListener("newbrain:open-settings", openSettings);
    return () => window.removeEventListener("newbrain:open-settings", openSettings);
  }, []);

  useEffect(() => {
    if (!api) return;
    return api.onMobileAction((action) => {
      if (action.action === "new-chat") {
        setActiveFeature("new-chat");
        setNewThreadScope("chat");
        setChatUsesProject(false);
        setIsComposingNewThread(true);
        setQuestion("");
        setPreviewPlacement("hidden");
        return;
      }
      if (action.workspaceId) setSelectedWorkspaceId(action.workspaceId);
      if (action.action === "select-thread" && action.threadId) {
        setSelectedThreadId(action.threadId);
        setIsComposingNewThread(false);
        setActiveFeature("new-chat");
      } else if (action.action === "select-project") {
        setIsComposingNewThread(false);
        setActiveFeature("new-chat");
      }
    });
  }, [api]);

  useEffect(() => {
    if (!api) return;
    return api.onSnapshotUpdate((nextSnapshot) => {
      setSnapshot(nextSnapshot);
      void api.listWorkspaces().then(setWorkspaceCatalog).catch(() => undefined);
    });
  }, [api]);

  useEffect(() => {
    if (!showOpenLocationMenu && !showWorkspaceStatusMenu) return;
    const closePreviewMenus = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof PointerEvent &&
        event.target instanceof Element &&
        event.target.closest(".preview-action-popover-wrap")
      ) {
        return;
      }
      setShowOpenLocationMenu(false);
      setShowWorkspaceStatusMenu(false);
      setWorkspaceStatusSubmenu(null);
    };
    document.addEventListener("pointerdown", closePreviewMenus, true);
    document.addEventListener("keydown", closePreviewMenus);
    return () => {
      document.removeEventListener("pointerdown", closePreviewMenus, true);
      document.removeEventListener("keydown", closePreviewMenus);
    };
  }, [showOpenLocationMenu, showWorkspaceStatusMenu]);

  const selectedWorkspace =
    workspaceCatalog.find((workspace) => workspace.id === selectedWorkspaceId) ?? workspaceCatalog[0];
  const isComposingStandaloneChat = isComposingNewThread && newThreadScope === "chat";
  const selectedThread =
    selectedWorkspace?.threads.find((thread) => thread.id === selectedThreadId) ??
    (isComposingStandaloneChat ? undefined : selectedWorkspace?.threads[0]);

  useEffect(() => {
    if (!workspaceCatalog.length) return;
    const workspace =
      workspaceCatalog.find((item) => item.id === selectedWorkspaceId) ??
      workspaceCatalog[0];
    if (!workspace) return;

    if (workspace.id !== selectedWorkspaceId) {
      setSelectedWorkspaceId(workspace.id);
    }
    if (!isComposingStandaloneChat && workspace.threads.length > 0 && !workspace.threads.some((thread) => thread.id === selectedThreadId)) {
      setSelectedThreadId(workspace.threads[0].id);
    }
  }, [isComposingStandaloneChat, selectedThreadId, selectedWorkspaceId, workspaceCatalog]);

  const refreshWorkspaceHeaderStatus = async () => {
    if (!api || !selectedWorkspace?.id) return;
    try {
      setWorkspaceHeaderStatus(await api.getWorkspaceHeaderStatus(selectedWorkspace.id));
    } catch {
      // Keep the last successful status while the workspace is unavailable.
    }
  };
  const openWorkspaceStatusSubmenu = async (menu: "local" | "branch") => {
    setWorkspaceStatusSubmenu(menu);
    if (!api || !selectedWorkspace?.id) return;
    if (menu === "branch") {
      try { setWorkspaceBranches(await api.getWorkspaceBranches(selectedWorkspace.id)); } catch (error) { setErrorMessage(error instanceof Error ? error.message : String(error)); }
    } else {
      try {
        const billing: any = await api.getBillingSubscription();
        const subscriptions = Array.isArray(billing?.subscriptions) ? billing.subscriptions : [];
        const ratios = subscriptions
          .flatMap((item: any) => [[Number(item.daily_used || 0), Number(item.daily_quota || 0)], [Number(item.monthly_used || 0), Number(item.monthly_quota || 0)]])
          .filter((pair: number[]) => {
            if (!Number.isFinite(pair[0]) || !Number.isFinite(pair[1]) || pair[1] <= 0) return false;
            const ratio = pair[0] / pair[1];
            return ratio >= 0 && ratio <= 2;
          })
          .map((pair: number[]) => Math.max(0, 100 - pair[0] / pair[1] * 100));
        setWorkspaceUsageRemaining(ratios.length ? Math.round(Math.min(...ratios)) : null);
      } catch { setWorkspaceUsageRemaining(null); }
    }
  };
  useEffect(() => {
    if (!api || !selectedWorkspace?.id) return;
    let canceled = false;
    api.getWorkspaceHeaderStatus(selectedWorkspace.id)
      .then((status) => {
        if (!canceled) setWorkspaceHeaderStatus(status);
      })
      .catch(() => undefined);
    return () => {
      canceled = true;
    };
  }, [api, selectedWorkspace?.id, snapshot.runs]);
  useEffect(() => {
    if (!showWorkspaceStatusMenu || !api || !selectedWorkspace?.id) return;
    const timer = window.setInterval(() => {
      void api.getWorkspaceHeaderStatus(selectedWorkspace.id).then(setWorkspaceHeaderStatus).catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [api, selectedWorkspace?.id, showWorkspaceStatusMenu]);
  useEffect(() => {
    if (!api || previewMode !== "terminal") return;
    let disposed = false;
    void api.getTerminalSession().then((session: any) => { if (!disposed) setTerminalSession(session); });
    const unsubscribe = api.onTerminalUpdate((session: any) => { if (!disposed) setTerminalSession(session); });
    return () => { disposed = true; unsubscribe?.(); };
  }, [api, previewMode, selectedWorkspace?.id]);

  useEffect(() => {
    if (!api || previewMode !== "review" || !selectedWorkspace?.id) return;
    let disposed = false;
    setReviewLoading(true);
    setReviewError("");
    api.getReviewChanges({ workspaceId: selectedWorkspace.id, threadId: selectedThread?.id })
      .then((result) => {
        if (disposed) return;
        setReviewChanges(result.files);
        setReviewTotals({ additions: result.additions, deletions: result.deletions });
        setSelectedReviewFile((current) =>
          result.files.some((file) => file.filePath === current)
            ? current
            : result.files[0]?.filePath ?? ""
        );
      })
      .catch((error) => {
        if (disposed) return;
        setReviewChanges([]);
        setReviewTotals({ additions: 0, deletions: 0 });
        setReviewError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!disposed) setReviewLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [api, previewMode, selectedWorkspace?.id, selectedThread?.id, snapshot.timeline, snapshot.runs, reviewReloadToken]);
  const treeNodes = useMemo(() => buildWorkspaceTree(snapshot.workspace), [snapshot.workspace]);
  const filteredTreeNodes = useMemo(() => {
    const query = sideFileFilter.trim().toLowerCase();
    if (!query) return treeNodes;
    const filterNodes = (nodes: TreeNode[]): TreeNode[] =>
      nodes
        .map((node) => {
          const children = filterNodes(node.children);
          const matches = node.name.toLowerCase().includes(query) || node.path.toLowerCase().includes(query);
          return matches || children.length ? { ...node, children } : null;
        })
        .filter((node): node is TreeNode => Boolean(node));
    return filterNodes(treeNodes);
  }, [sideFileFilter, treeNodes]);
  const timelineItems = snapshot.timeline ?? [];

  useEffect(() => {
    return api?.onAssistantActivity((activity) => {
      const activityEvent = activity as typeof activity & { requestId?: string };
      const requestId = activityEvent.requestId || "";
      const threadId = requestId
        ? requestThreadIdsRef.current.get(requestId)
        : (streamingAssistantRef.current.id ? requestThreadIdsRef.current.get(streamingAssistantRef.current.id) : selectedThreadIdRef.current);
      if (!threadId) return;
      const contentLength = requestId
        ? streamLengthsByRequestRef.current.get(requestId) ?? 0
        : streamingAssistantRef.current.contentLength;
      const activityWithOffset = { ...activity, contentOffset: contentLength };
      const currentItems = threadActivitiesRef.current.get(threadId) ?? [];
      const previous = currentItems.at(-1);
      const nextItems =
        previous?.type === "run" &&
        previous.title === "\u6b63\u5728\u6267\u884c\u547d\u4ee4" &&
        activity.type === "run" &&
        activity.detail === previous.detail
          ? [...currentItems.slice(0, -1), activityWithOffset].slice(-12)
          : [...currentItems, activityWithOffset].slice(-12);
      threadActivitiesRef.current.set(threadId, nextItems);
      if (selectedThreadIdRef.current === threadId) setAssistantActivities(nextItems);
      if (activity.type === "complete") setIsAskingModel(activeThreadRequestsRef.current.size > 0);
    });
  }, [api]);

  useEffect(() => api?.onModelStreamDelta?.(({ requestId, delta }) => {
    const threadId = requestThreadIdsRef.current.get(requestId);
    if (streamingAssistantRef.current.id === requestId) {
      streamingAssistantRef.current.contentLength += delta.length;
    }
    streamLengthsByRequestRef.current.set(requestId, (streamLengthsByRequestRef.current.get(requestId) ?? 0) + delta.length);
    if (threadId) {
      updateThreadMessages(threadId, (current) => current.map((message) =>
        message.id === requestId ? { ...message, content: `${message.content}${delta}` } : message
      ));
    }
  }), [api]);

  useEffect(() => {
    if (selectedThread?.id) {
      setAssistantActivities(threadActivitiesRef.current.get(selectedThread.id) ?? []);
    }
    if (isAskingModel) return;
    setAssistantActivities([]);
    setAssistantStartedAt(null);
    setLastAssistantElapsedSeconds(null);
  }, [isAskingModel, selectedThread?.id]);

  useEffect(() => {
    if (!api) return;
    let disposed = false;
    const refreshAutomationStatus = async () => {
      try {
        const nextConfig = await api.getFeatureConfig();
        if (!disposed) {
          setFeatureConfig((current) =>
            JSON.stringify(current.automations) === JSON.stringify(nextConfig.automations)
              ? current
              : nextConfig
          );
        }
      } catch {
        // The previous state remains authoritative while the local service is unavailable.
      }
    };
    void refreshAutomationStatus();
    const timer = window.setInterval(() => void refreshAutomationStatus(), 1000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [api]);
  const activeFeatureItem =
    activeFeature === "settings"
      ? settingsFeatureItem
      : featureItems.find((item) => item.id === activeFeature) ?? featureItems[0];
  const visibleWorkspaceCatalog = useMemo(() => {
    const projectCatalog = workspaceCatalog.map((workspace) => ({
      ...workspace,
      threads: workspace.threads.filter((thread) => thread.scope !== "chat")
    }));
    if (!sortProjectsAscending) {
      return projectCatalog;
    }

    return [...projectCatalog].sort((left, right) => left.name.localeCompare(right.name));
  }, [sortProjectsAscending, workspaceCatalog]);
  const latestAssistantMessage =
    [...chatMessages].reverse().find((message) => message.role === "assistant")?.content ??
    selectedThread?.summary ??
    "这里会显示 NewBrain 对当前任务的处理结果、建议、变更摘要和模型回复。";
  const condaBootstrapSummary =
    desktopBootstrapStatus.conda.status === "ready"
      ? `已就绪${desktopBootstrapStatus.conda.source ? ` · ${desktopBootstrapStatus.conda.source === "system" ? "复用系统 conda" : "托管 conda"}` : ""}`
      : desktopBootstrapStatus.conda.status === "manual_required"
        ? "需要手动安装 conda"
        : "等待初始化";
  const isAuthenticated = authStatus.authenticated;
  useEffect(() => {
    if (!api?.onAppUpdateProgress) return;
    return api.onAppUpdateProgress((progress) => {
      setAppUpdateProgress(progress);
      setAppUpdateDiscoverOpen(false);
      if (progress.phase === "ready" || progress.phase === "done" || progress.phase === "error") {
        setAppUpdateBusy(false);
      }
      if (progress.phase === "ready" || progress.phase === "done" || progress.phase === "error") {
        void api.getAppUpdateStatus?.().then((status) => setAppUpdateStatus(status)).catch(() => undefined);
      }
    });
  }, [api]);
  useEffect(() => {
    if (!api?.getAppliedAppUpdate) return;
    void api.getAppliedAppUpdate().then((applied) => {
      if (applied) setAppUpdateApplied(applied);
    }).catch(() => undefined);
  }, [api]);
  useEffect(() => {
    if (!appUpdateStatus?.available) return;
    if (appUpdateStatus.skippedVersion && appUpdateStatus.skippedVersion === appUpdateStatus.latestVersion) return;
    if (appUpdateApplied) return;
    if (
      appUpdateProgress?.phase === "ready"
      && !appUpdateStatus.staged
      && appUpdateProgress.latestVersion
      && appUpdateProgress.latestVersion === appUpdateStatus.latestVersion
    ) {
      setAppUpdateProgress(null);
      setAppUpdateDiscoverOpen(true);
      return;
    }
    if (appUpdateProgress || appUpdateDiscoverOpen) return;
    if (appUpdateStatus.staged) {
      setAppUpdateProgress({
        phase: "ready",
        percent: 100,
        detail: appUpdateStatus.detail,
        latestVersion: appUpdateStatus.latestVersion,
        currentVersion: appUpdateStatus.currentVersion,
        notes: appUpdateStatus.notes,
        preservesUserData: true
      });
      return;
    }
    setAppUpdateDiscoverOpen(true);
  }, [
    appUpdateStatus?.available,
    appUpdateStatus?.latestVersion,
    appUpdateStatus?.staged,
    appUpdateStatus?.skippedVersion,
    appUpdateStatus?.detail,
    appUpdateProgress?.phase,
    appUpdateProgress?.latestVersion,
    appUpdateDiscoverOpen,
    appUpdateApplied
  ]);
  useEffect(() => {
    if (!api?.getAppUpdateStatus) return;
    let cancelled = false;
    const refresh = () => {
      if (!shouldRefreshAppUpdateOnWindowSignal({
        isAuthenticated,
        documentHidden: typeof document !== "undefined" && document.hidden
      })) {
        return;
      }
      void api.getAppUpdateStatus().then((status) => {
        if (!cancelled && status) setAppUpdateStatus(status);
      }).catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, APP_UPDATE_STATUS_POLL_MS);
    const onFocus = () => refresh();
    const onVisibility = () => refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [api, isAuthenticated]);
  async function startDesktopAppUpdate() {
    if (!api?.startAppUpdate || appUpdateBusy) return;
    setAppUpdateBusy(true);
    setAppUpdateDiscoverOpen(false);
    setAppUpdateProgress({
      phase: "preparing",
      percent: 1,
      detail: "正在准备更新。聊天记录、项目与本地历史会保留。",
      latestVersion: appUpdateStatus?.latestVersion,
      currentVersion: appUpdateStatus?.currentVersion,
      notes: appUpdateStatus?.notes,
      preservesUserData: true
    });
    try {
      const result = await api.startAppUpdate();
      setChatStatus(result.detail || "");
      if (!result.ok) {
        setAppUpdateProgress((current) => current ? {
          ...current,
          phase: "error",
          percent: 0,
          detail: result.detail || "更新失败"
        } : {
          phase: "error",
          percent: 0,
          detail: result.detail || "更新失败",
          preservesUserData: true
        });
        setErrorMessage(result.detail || "更新失败");
      } else if (result.staged) {
        setAppUpdateProgress((current) => ({
          phase: "ready",
          percent: 100,
          detail: result.detail || `v${appUpdateStatus?.latestVersion || ""} 已就绪，重启后生效。`,
          latestVersion: current?.latestVersion || appUpdateStatus?.latestVersion,
          currentVersion: current?.currentVersion || appUpdateStatus?.currentVersion,
          notes: current?.notes || appUpdateStatus?.notes,
          preservesUserData: true
        }));
      }
      const status = await api.getAppUpdateStatus().catch(() => null);
      if (status) setAppUpdateStatus(status);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setAppUpdateProgress({
        phase: "error",
        percent: 0,
        detail,
        preservesUserData: true
      });
      setErrorMessage(detail);
    } finally {
      setAppUpdateBusy(false);
    }
  }
  async function applyDesktopAppUpdate() {
    if (!api?.applyAppUpdate || appUpdateBusy) return;
    setAppUpdateBusy(true);
    try {
      const result = await api.applyAppUpdate();
      setChatStatus(result.detail || "");
      if (!result.ok) {
        setAppUpdateProgress({
          phase: "error",
          percent: 0,
          detail: result.detail || "安装失败",
          latestVersion: appUpdateStatus?.latestVersion,
          currentVersion: appUpdateStatus?.currentVersion,
          notes: appUpdateStatus?.notes,
          preservesUserData: true
        });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setAppUpdateProgress({
        phase: "error",
        percent: 0,
        detail,
        latestVersion: appUpdateStatus?.latestVersion,
        currentVersion: appUpdateStatus?.currentVersion,
        notes: appUpdateStatus?.notes,
        preservesUserData: true
      });
    } finally {
      setAppUpdateBusy(false);
    }
  }
  async function skipDesktopAppUpdate() {
    const version = appUpdateStatus?.latestVersion;
    if (api?.skipAppUpdateVersion) {
      await api.skipAppUpdateVersion(version).catch(() => undefined);
    }
    const status = await api?.getAppUpdateStatus?.().catch(() => null);
    if (status) setAppUpdateStatus(status);
  }
  function dismissAppUpdateProgress() {
    setAppUpdateProgress(null);
  }
  function dismissAppUpdateDiscover() {
    setAppUpdateDiscoverOpen(false);
  }
  async function dismissAppliedAppUpdate() {
    setAppUpdateApplied(null);
    await api?.dismissAppliedAppUpdate?.().catch(() => undefined);
  }
  const isBootstrapBlocking =
    isAuthenticated &&
    desktopBootstrapStatus.overall.status === "pending";
  const isCurrentThreadAskingModel = Boolean(
    selectedThread?.id && activeThreadRequestsRef.current.has(selectedThread.id)
  );
  const conversationTurns = useMemo<ConversationTurn[]>(() => {
    if (chatMessages.length === 0) {
      if (selectedThread?.id && !isComposingNewThread) {
        return [];
      }
      return [
        {
          id: "thread-summary",
          assistant: {
            id: "thread-summary-message",
            role: "assistant",
            content: latestAssistantMessage
          }
        }
      ];
    }

    const turns: ConversationTurn[] = [];

    for (const message of chatMessages) {
      if (message.role === "user") {
        turns.push({ id: message.id, user: message });
        continue;
      }

      if (message.role === "tool") {
        const lastTurn = turns[turns.length - 1];
        if (lastTurn) {
          lastTurn.tools = [...(lastTurn.tools ?? []), message];
        } else {
          turns.push({ id: message.id, tools: [message] });
        }
        continue;
      }

      const lastTurn = turns[turns.length - 1];
      if (lastTurn && !lastTurn.assistant) {
        lastTurn.assistant = message;
      } else {
        turns.push({ id: message.id, assistant: message });
      }
    }

    if (isCurrentThreadAskingModel) {
      const pendingMessage: ModelChatMessage = {
        id: "assistant-pending",
        role: "assistant",
        content: "正在思考中..."
      };
      const lastTurn = turns[turns.length - 1];
      if (lastTurn && !lastTurn.assistant) {
        lastTurn.assistant = pendingMessage;
      }
    }

    return turns;
  }, [chatMessages, isComposingNewThread, isCurrentThreadAskingModel, latestAssistantMessage, selectedThread?.id]);
  const latestUserMessage =
    [...chatMessages].reverse().find((message) => message.role === "user")?.content ??
    "继续推进当前项目窗口的对话任务流。";
  const title = selectedThread?.title ?? snapshot.session?.title ?? "默认线程";
  const isSettingsFeature = activeFeature === "settings";
  const isFullPageFeature = ["extensions", "skills", "plugins", "experts", "automation", "mcp"].includes(activeFeature);
  const showsFeaturePanel =
    activeFeature !== "new-chat" &&
    activeFeature !== "settings" &&
    activeFeature !== "extensions" &&
    activeFeature !== "skills" &&
    activeFeature !== "plugins" &&
    activeFeature !== "automation" &&
    activeFeature !== "mobile" &&
    activeFeature !== "mcp";
  const isLocalPreviewUrl = (() => {
    try {
      const hostname = new URL(desktopPreferences.browser.previewUrl).hostname;
      return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
    } catch {
      return false;
    }
  })();
  const shouldAutoOpenPreview =
    desktopPreferences.browser.autoOpenPreview &&
    isLocalPreviewUrl &&
    !isFullPageFeature &&
    activeFeature !== "settings" &&
    activeFeature !== "new-chat";

  const projectResponseMessage = isAskingModel ? "正在思考中..." : latestAssistantMessage;
  const apiKeyConfigured = modelConfig.apiKeyConfigured === true || modelConfig.apiKey.trim().length > 0;
  const isUsingLoginSession = isAuthenticated && !apiKeyConfigured;
  const displayUserName = authStatus.user?.display_name || "未登录";
  const displayUserEmail = authStatus.user?.email || "尚未登录 OmniRoute 账号";
  const displayUserPlan = authStatus.user?.plan || "未激活";
  const displayUserAvatar = accountProfile.avatar || authStatus.user?.avatar_text || "未";

  const {
    writeClipboard,
    applyVisualPreferences,
    buildPersonalizedSystemPrompt,
    archivedThreads,
    toMcpServerState,
    parseMcpDraft,
    sortThreadsForMenu,
    forkCurrentAnswer,
    handleThreadMenuAction,
    syncSnapshot,
    resetFeatureDraft,
    loadFeatureDraft,
    runAction,
    refreshCatalog,
	    createWorkspace,
	    createBlankProject,
	    addExistingProject,
	    createThread,
    forkThread,
    renameThread,
    deleteThread,
    saveFeature,
    removeFeature,
    saveModelConfig,
    saveDesktopPreferences,
    handleRetryCondaBootstrap
  } = useDesktopCore({
    api, modelConfig, desktopPreferences, workspaceCatalog, archivedThreadIds, pinnedThreadIds,
    selectedWorkspace, selectedThread, selectedWorkspaceId, selectedThreadId, threadContextMenu, showAccountMenu,
    bootstrapState, desktopBootstrapStatus, isBootstrapBlocking, searchQuery, loginCodeCooldownSeconds,
    activeSettingsSection, mcpServers, expandedMcpLogId, newWorkspaceName, newWorkspacePath,
    newThreadTitle, newThreadSummary, forkThreadTitle, editingThreadTitle, editingThreadSummary,
    skillDraft, pluginDraft, automationDraft, editingFeatureId, environmentEnvText, authStatus, loginForm,
    isSubmittingLogin, isSendingLoginCode, question, selectedComposerTools, chatMessages, isAskingModel,
    latestAssistantMessage, shouldAutoOpenPreview, setErrorMessage, setChatStatus, setWorkspaceCatalog, setSelectedWorkspaceId,
    setSelectedThreadId, setExpandedWorkspaceIds, setExpandedThreadListWorkspaceIds, setArchivedThreadIds, setUnreadThreadIds, setPinnedThreadIds,
    setThreadContextMenu, setSnapshot, setChatMessages, updateThreadMessages, setExpandedPaths, setEditingFeatureId, setSkillDraft,
    setPluginDraft, setAutomationDraft, setSearchResults, setBootstrapState, setModelConfig, setDesktopPreferences,
    setShellCommand, setEnvironmentEnvText, setFeatureConfig, setMcpServers, setMcpDiscoveredTools,
    setSystemTools, setAuthStatus, setDesktopBootstrapStatus, setLoginForm, setIsRetryingCondaBootstrap,
    setShowAccountMenu, setMcpHealth, setMcpLogs, setEditingThreadTitle, setEditingThreadSummary,
    setShowRenameThreadDialog,
    setForkThreadTitle, setNewWorkspaceName, setNewWorkspacePath, setNewThreadTitle, setNewThreadSummary,
    setActiveFeature, setQuestion, setIsAskingModel, setLoginCodeCooldownSeconds, setIsSubmittingLogin,
    setIsSendingLoginCode, setActiveSettingsSection, setPreviewMode, setPreviewPlacement, initialDraft, initialMcpServer, initialDesktopAuthStatus,
    initialModelConfig, initialDesktopPreferences, initialFeatureConfig, emptySnapshot, withTimeout, optionalLoad,
    formatEnvText, parseEnvText, buildWorkspaceTree, collectDirectoryKeys, coerceValueBySchema, settingsFeatureItem
  });

  useEffect(() => {
    const handleAppCommand = (event: Event) => {
      const command = (event as CustomEvent<{ command?: string }>).detail?.command;
      if (!command) return;

      if (command === "new-chat" || command === "quick-chat") {
        setActiveFeature("new-chat");
        setIsComposingNewThread(true);
        setQuestion("");
        setPreviewPlacement("hidden");
        return;
      }
      if (command === "open-folder") {
        void addExistingProject();
        return;
      }
      if (command === "logout") {
        void api?.logoutAuth().then((status) => {
          setAuthStatus(status);
          setShowAccountMenu(false);
          setActiveFeature("new-chat");
        });
        return;
      }
      if (command === "toggle-bottom-panel" || command === "toggle-side-panel") {
        setPreviewPlacement((current) => current === "hidden" ? "side" : "hidden");
        return;
      }
      if (command === "toggle-file-tree") {
        setPreviewMode("files");
        setPreviewPlacement((current) => current === "hidden" ? "side" : "hidden");
        return;
      }
      if (command === "open-browser") {
        setPreviewMode("browser");
        setPreviewPlacement("side");
        return;
      }
      if (command === "find") {
        setShowSearchDialog(true);
        return;
      }
      if (command === "automations") {
        setActiveFeature("automation");
        return;
      }
      if (command === "skills") {
        setActiveFeature("skills");
        return;
      }
      if (command === "mcp") {
        setActiveFeature("mcp");
      }
    };
    window.addEventListener("newbrain:app-command", handleAppCommand);
    return () => window.removeEventListener("newbrain:app-command", handleAppCommand);
  }, [addExistingProject, api]);

  const {
    resetMcpDraft,
    loadMcpDraft,
    saveMcpServers,
    handleSaveMcpServer,
    handleDeleteMcpServer,
    handleToggleMcpServer,
    handleTestMcpServer,
    handleStartMcpServer,
    handleStopMcpServer,
    handleLoadMcpLogs,
    handleClearMcpLogs,
    handleInspectMcpServer
  } = createMcpServerActions({
    api,
    initialMcpServer,
    setEditingMcpId,
    setMcpDraft,
    parseMcpDraft,
    setMcpServers,
    toMcpServerState,
    mcpDraft,
    editingMcpId,
    mcpServers,
    setErrorMessage,
    setTestingMcpId,
    setMcpHealth,
    setMcpLogs,
    setExpandedMcpLogId,
    setMcpInspection,
    setMcpDiscoveredTools
  });

  function handleInsertMcpTool(tool: McpDiscoveredToolState) {
    const properties =
      tool.inputSchema && typeof tool.inputSchema.properties === "object"
        ? (tool.inputSchema.properties as Record<string, { type?: string }>)
        : {};
    const initialFieldValues = Object.fromEntries(
      Object.keys(properties).map((key) => [key, ""])
    );

    setSelectedComposerTools((current) => {
      if (current.some((item) => item.id === tool.id)) {
        return current;
      }
      return [
        ...current,
        {
          id: tool.id,
          label: tool.name,
          detail: `${tool.serverName}${tool.description ? ` · ${tool.description}` : ""}`,
          serverName: tool.serverName,
          inputSchema: tool.inputSchema,
          fieldValues: initialFieldValues
        }
      ];
    });

    setQuestion((current) => {
      const prefix = `使用 MCP 工具 ${tool.name}（来自 ${tool.serverName}）辅助当前任务。`;
      return current.includes(prefix) ? current : `${current ? `${current}\n` : ""}${prefix}`;
    });
    setShowMcpToolPicker(false);
  }

  function handleRemoveComposerTool(id: string) {
    setSelectedComposerTools((current) => current.filter((item) => item.id !== id));
  }

  function handleComposerToolFieldChange(id: string, fieldKey: string, value: string) {
    setSelectedComposerTools((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              fieldValues: {
                ...(item.fieldValues ?? {}),
                [fieldKey]: value
              }
            }
          : item
      )
    );
  }

  type SchemaPath = Array<string | number>;

  type SchemaLike = {
    type?: string;
    properties?: Record<string, SchemaLike>;
  };

  function handleComposerToolFieldChangePath(toolId: string, path: SchemaPath, value: unknown) {
    setSelectedComposerTools((current) =>
      current.map((item) =>
        item.id === toolId
          ? {
              ...item,
              fieldValues: setValueAtPath(item.fieldValues ?? {}, path, value) as ComposerToolFieldValueMap
            }
          : item
      )
    );
  }

  const { renderComposerToolFields } = createSchemaFieldRenderer({
    handleComposerToolFieldChange,
    handleComposerToolFieldChangePath
  });

  async function handleLogout() {
    if (!api) {
      setModelConfig((current) => ({ ...current, apiKey: "" }));
      setChatStatus("已退出 API 密钥登录。");
      return;
    }

    try {
      const nextAuthStatus = await api.logoutAuth();
      setAuthStatus(nextAuthStatus);
      setChatStatus("已退出登录。");
      setErrorMessage("");
      setActiveFeature("new-chat");
      setActiveSettingsSection("account");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleLoginSubmit(
    agreementChecked = loginForm.agreementAccepted,
    emailAuthMode: "password" | "code" = "password"
  ) {
    if (!api || isSubmittingLogin) {
      return;
    }

    const channel = loginForm.channel === "phone" ? "phone" : "email";
    const identifier = resolveLoginIdentifier(loginForm);
    const password = loginForm.password.trim();
    const captcha = loginForm.captcha.trim();
    const passwordLoginEnabled = authStatus.password_login_enabled !== false;
    const useCode = shouldUseLoginCode(loginForm, emailAuthMode, { passwordLoginEnabled });

    if (channel === "phone") {
      if (!isCnMobile(identifier)) {
        setErrorMessage("请填写 11 位手机号。");
        return;
      }
      if (!captcha) {
        setErrorMessage("请填写短信验证码。");
        return;
      }
    } else {
      if (!identifier) {
        setErrorMessage("请输入邮箱。");
        return;
      }
      if (useCode && !captcha) {
        setErrorMessage("请先获取并填写邮箱验证码后再登录。");
        return;
      }
      if (!useCode && !password) {
        setErrorMessage("请输入密码。");
        return;
      }
    }

    if (authStatus.agreement?.enabled && !agreementChecked) {
      setLoginForm((current) => ({ ...current, agreementAccepted: false }));
      setErrorMessage("请先阅读并勾选用户协议后再登录。");
      return;
    }

    setErrorMessage("");
    setIsSubmittingLogin(true);
    try {
      const nextAuthStatus = await api.loginAuth({
        email: identifier,
        password: useCode ? "" : password,
        captcha: useCode ? captcha : "",
        agreement_accepted: authStatus.agreement?.enabled ? agreementChecked : true
      });
      setAuthStatus(nextAuthStatus);
      if (nextAuthStatus.authenticated) {
        const nextBootstrapStatus = await api.startDesktopBootstrap();
        setDesktopBootstrapStatus(nextBootstrapStatus);
      }
      setLoginForm((current) => ({
        ...current,
        password: "",
        captcha: ""
      }));
      setChatStatus("账号登录成功，已接入真实会话。");
      setErrorMessage("");
      return nextAuthStatus.authenticated === true;
    } catch (error) {
      setErrorMessage(normalizeLoginErrorMessage(error));
      return false;
    } finally {
      setIsSubmittingLogin(false);
    }
  }

  async function handleSendLoginCode() {
    if (!api || isSendingLoginCode || loginCodeCooldownSeconds > 0) {
      return;
    }

    const channel = loginForm.channel === "phone" ? "phone" : "email";
    if (channel === "phone") {
      if (!isCnMobile(loginForm.phone)) {
        setErrorMessage("请先填写 11 位手机号。");
        return;
      }
    } else if (!loginForm.email.trim()) {
      setErrorMessage("请先输入邮箱。");
      return;
    }

    setErrorMessage("");
    setIsSendingLoginCode(true);
    try {
      const result = await api.sendLoginCode(
        channel === "phone"
          ? { phone: loginForm.phone.trim() }
          : { email: loginForm.email.trim() }
      );
      const resendAfter =
        typeof (result.data as Record<string, unknown> | undefined)?.resend_after_seconds === "number"
          ? Number((result.data as Record<string, unknown>).resend_after_seconds)
          : 60;
      setLoginCodeCooldownSeconds(Math.max(1, resendAfter));
      setChatStatus(channel === "phone" ? "验证码已发送，请查收短信。" : "验证码已发送，请查收邮箱。");
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(normalizeLoginErrorMessage(error));
    } finally {
      setIsSendingLoginCode(false);
    }
  }

  function handleLoginFormChange(updater: React.SetStateAction<LoginFormState>) {
    setErrorMessage("");
    setLoginForm(updater);
  }

  async function askModel(draftOverride?: QueuedComposerDraft & {
    forceStandaloneChat?: boolean;
    forceProjectThread?: boolean;
    brainWorkspaceKey?: import("@codex-forge/protocol").BrainWorkspaceKey;
  }) {
    const draftQuestion = draftOverride?.question ?? question;
    const draftImages = draftOverride?.images ?? composerImages;
    const forceStandaloneChat = Boolean(draftOverride?.forceStandaloneChat);
    const forceProjectThread = Boolean(draftOverride?.forceProjectThread);
    if (!api || (!draftQuestion.trim() && draftImages.length === 0)) {
      return;
    }
    if (!draftOverride) {
      setQuestion("");
      setComposerImages([]);
    }
    const currentWorkspaceId = selectedWorkspaceIdRef.current || selectedWorkspaceId;
    const currentWorkspace =
      workspaceCatalog.find((workspace) => workspace.id === currentWorkspaceId) ??
      selectedWorkspace;
    const currentThreadId = selectedThreadIdRef.current || selectedThreadId;
    const currentThread =
      currentWorkspace?.threads.find((thread) => thread.id === currentThreadId) ??
      selectedThread;
    const currentThreadIsAsking = Boolean(currentThread?.id && activeThreadRequestsRef.current.has(currentThread.id));

    if (currentThreadIsAsking && !draftOverride) {
      if (desktopPreferences.editor?.followBehavior === "guide") {
        setChatStatus("当前对话正在运行。已启用引导模式，请先停止或批准当前运行后再发送下一条。");
        return;
      }
      const nextDraft = {
        question: draftQuestion.trim(),
        images: draftImages,
        createdAt: new Date().toISOString()
      };
      queuedComposerDraftRef.current = nextDraft;
      setQueuedComposerDraft(nextDraft);
      setChatStatus("当前对话正在处理中，已将下一条消息加入排队。");
      return;
    }

    const composingNewThread = forceStandaloneChat || isComposingNewThread;
    const composingThreadScope = forceStandaloneChat ? "chat" : (forceProjectThread ? "project" : newThreadScope);
    const effectiveChatUsesProject = forceStandaloneChat ? false : (forceProjectThread ? true : chatUsesProject);
    if (forceStandaloneChat) {
      setChatUsesProject(false);
      setNewThreadScope("chat");
      setIsComposingNewThread(true);
    } else if (forceProjectThread) {
      setChatUsesProject(true);
      setNewThreadScope("project");
    }
    const effectiveThreadScope: "project" | "chat" =
      composingThreadScope === "project" || (composingThreadScope === "chat" && effectiveChatUsesProject)
        ? "project"
        : "chat";
    let targetWorkspaceId = forceStandaloneChat ? INTERNAL_CHAT_WORKSPACE_ID : currentWorkspaceId;
    let targetWorkspace = forceStandaloneChat
      ? workspaceCatalog.find((workspace) => workspace.id === INTERNAL_CHAT_WORKSPACE_ID) ?? currentWorkspace
      : currentWorkspace;
    let targetThread = forceStandaloneChat ? undefined : currentThread;
    let targetThreadTitle = selectedThread?.title || "新对话";
    if (composingNewThread) {
      if (!targetWorkspaceId) {
        setErrorMessage("请先选择一个项目，再新建线程。");
        return;
      }

      const titleText = draftQuestion.trim().slice(0, 36) || "新线程";
      try {
        setChatStatus("正在创建新线程...");
        const nextCatalog = await api.addWorkspaceThread({
          workspaceId: targetWorkspaceId,
          title: titleText,
          summary: effectiveThreadScope === "chat" ? "从聊天输入框创建的新对话。" : "从项目输入框创建的新线程。",
          scope: effectiveThreadScope,
          ...(targetWorkspaceId === INTERNAL_CHAT_WORKSPACE_ID && draftOverride?.brainWorkspaceKey
            ? { brainWorkspaceKey: draftOverride.brainWorkspaceKey }
            : {})
        });
        const nextWorkspace = nextCatalog.find((workspace) => workspace.id === targetWorkspaceId);
        const newestThread = nextWorkspace?.threads[0];
        if (!newestThread || newestThread.scope !== effectiveThreadScope) {
          throw new Error("新线程创建后未返回线程记录。");
        }
        targetWorkspaceId = nextWorkspace?.id ?? targetWorkspaceId;
        targetWorkspace = nextWorkspace ?? currentWorkspace;
        targetThread = newestThread;
        targetThreadTitle = newestThread.title;
        const nextSnapshot = await api.activateWorkspaceThread({
          workspaceId: targetWorkspaceId,
          threadId: newestThread.id
        });
        setSelectedWorkspaceId(targetWorkspaceId);
        setSelectedThreadId(newestThread.id);
        syncSnapshot(nextSnapshot, newestThread.id);
        setWorkspaceCatalog(nextCatalog);
        if (effectiveThreadScope === "project") {
          setExpandedWorkspaceIds((current) => new Set([...current, targetWorkspaceId]));
          setExpandedThreadListWorkspaceIds((current) => new Set([...current, targetWorkspaceId]));
        }
        setIsComposingNewThread(false);
        if (forceProjectThread) {
          setNewThreadScope("project");
          setChatUsesProject(true);
        } else {
          setNewThreadScope("chat");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setErrorMessage(message);
        setChatStatus("新线程创建失败。");
        return;
      }
    }

    let composedQuestion = draftQuestion.trim();
    let toolContext = "";
    if (selectedComposerTools.length > 0) {
      setChatStatus("正在调用 MCP 工具...");
      const toolResults = await Promise.all(
        selectedComposerTools.map(async (tool) => {
          const schema = (tool.inputSchema ?? {}) as SchemaLike;
          const coercedArgs = coerceValueBySchema(schema, tool.fieldValues ?? {});
          const parsedArgs =
            coercedArgs && typeof coercedArgs === "object" && !Array.isArray(coercedArgs)
              ? (coercedArgs as Record<string, unknown>)
              : undefined;
          return api.callMcpTool({
            toolId: tool.id,
            query: composedQuestion,
            args: parsedArgs
          });
        })
      );
      updateThreadMessages(targetThread?.id || "", (current) => [
        ...current,
        ...toolResults.map((result) => ({
          id: `tool-${result.toolName}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
          role: "tool" as const,
          toolName: result.toolName,
          content: result.ok
            ? result.content || result.detail
            : `调用失败：${result.detail}`
        }))
      ]);
      toolContext = toolResults
        .map((result) =>
          result.ok
            ? `MCP工具 ${result.toolName}（${result.serverName}）结果：\n${result.content}`
            : `MCP工具 ${result.toolName}（${result.serverName}）调用失败：${result.detail}`
        )
        .join("\n\n");
    }
    const contextThreadTitle = targetThreadTitle;
    if (composerWorkspaceContext && targetWorkspace && !(composingNewThread && composingThreadScope === "chat" && !chatUsesProject)) {
      toolContext = [
        toolContext,
        `当前工作区上下文：\n- 名称：${targetWorkspace.name}\n- 根目录：${targetWorkspace.path}\n- 当前线程：${targetThread?.title || "新对话"}`
      ].filter(Boolean).join("\n\n");
    }
    if (composerWorkspaceContext && composingNewThread) {
      toolContext = [toolContext, `当前新线程：${contextThreadTitle}`].filter(Boolean).join("\n\n");
    }

    const userMessage: ModelChatMessage = {
      id: `local-user-${Date.now()}`,
      role: "user",
      content: composedQuestion || "请查看附件图片",
      createdAt: new Date().toISOString(),
      attachments: draftImages
    };
    const targetThreadId = targetThread?.id || "";
    const targetMessages = threadMessagesRef.current.get(targetThreadId) ??
      (selectedThreadIdRef.current === targetThreadId ? chatMessagesRef.current : []);
    const nextMessages = [...(composingNewThread ? [] : targetMessages), userMessage];
    updateThreadMessages(targetThreadId, nextMessages);
    setAssistantActivities([]);
    streamingAssistantRef.current = { id: "", contentLength: 0 };
    const requestStartedAt = Date.now();
    setAskingThreadId(targetThread?.id || "");
    setAssistantStartedAt(requestStartedAt);
    setLastAssistantElapsedSeconds(null);
    setIsAskingModel(true);
    setChatStatus("正在请求大模型...");

    const streamRequestId = `local-assistant-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    activeModelRequestIdRef.current = streamRequestId;
    if (targetThreadId) {
      activeThreadRequestsRef.current.set(targetThreadId, streamRequestId);
      requestThreadIdsRef.current.set(streamRequestId, targetThreadId);
      setActiveThreadRequestVersion((current) => current + 1);
    }
    streamingAssistantRef.current = { id: streamRequestId, contentLength: 0 };
    updateThreadMessages(targetThreadId, (current) => [...current, {
      id: streamRequestId,
      role: "assistant" as const,
      content: "",
      createdAt: new Date().toISOString()
    }]);

    try {
      const result = await api.chatWithModel({
        requestId: streamRequestId,
        workspaceId: targetWorkspaceId,
        threadId: targetThread?.id,
        ...modelConfig,
        disableResponseStorage: !desktopPreferences.configuration.saveResponses,
        permissionMode: composerPermission,
        systemPrompt: buildPersonalizedSystemPrompt(),
        toolContext,
        messages: nextMessages
          .filter(
            (message): message is ModelChatMessage & { role: "user" | "assistant" } =>
              message.role === "user" || message.role === "assistant"
          )
          .map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            createdAt: message.createdAt,
            attachments: message.attachments
          }))
      });

      // Replace with the canonical final content in case the provider omitted a delta.
      updateThreadMessages(targetThreadId, (current) => current.map((message) =>
        message.id === streamRequestId ? { ...message, content: result.content } : message
      ));
      setChatStatus("模型回复成功。");
      setErrorMessage("");
      const nextSnapshot = await api.getSnapshot();
      if (selectedThreadIdRef.current === targetThreadId && desktopPreferences.configuration.saveResponses) {
        syncSnapshot(nextSnapshot, targetThreadId);
      } else if (selectedThreadIdRef.current === targetThreadId) {
        // Keep the non-persisted response visible for this session while still updating approval/run state.
        setSnapshot(nextSnapshot);
      }
      await refreshCatalog();
    } catch (error) {
      const message = normalizeModelErrorMessage(error);
      setChatStatus("模型请求失败。");
      setErrorMessage(message);
      // The error panel owns request failures. Keeping a synthetic assistant
      // message here would feed it back into the next request as conversation.
      updateThreadMessages(targetThreadId, (current) => current.filter((item) => item.id !== streamRequestId));
    } finally {
      setLastAssistantElapsedSeconds(Math.max(1, Math.round((Date.now() - requestStartedAt) / 1000)));
      setAssistantStartedAt(null);
      if (streamingAssistantRef.current.id === streamRequestId) {
        streamingAssistantRef.current = { id: "", contentLength: 0 };
      }
      if (activeModelRequestIdRef.current === streamRequestId) activeModelRequestIdRef.current = "";
      requestThreadIdsRef.current.delete(streamRequestId);
      streamLengthsByRequestRef.current.delete(streamRequestId);
      if (targetThreadId && activeThreadRequestsRef.current.get(targetThreadId) === streamRequestId) {
        activeThreadRequestsRef.current.delete(targetThreadId);
        setActiveThreadRequestVersion((current) => current + 1);
      }
      setIsAskingModel(activeThreadRequestsRef.current.size > 0);
      setAskingThreadId(
        selectedThreadIdRef.current && activeThreadRequestsRef.current.has(selectedThreadIdRef.current)
          ? selectedThreadIdRef.current
          : ""
      );
      const queuedDraft = queuedComposerDraftRef.current;
      if (queuedDraft) {
        queuedComposerDraftRef.current = null;
        setQueuedComposerDraft(null);
        window.setTimeout(() => void askModel(queuedDraft), 0);
      }
    }
  }

  async function cancelCurrentModelRequest() {
    const requestId = selectedThread?.id
      ? activeThreadRequestsRef.current.get(selectedThread.id) || ""
      : activeModelRequestIdRef.current;
    if (!api?.cancelModelRequest || !requestId) {
      setChatStatus("当前没有可停止的任务。");
      return;
    }
    const result = await api.cancelModelRequest({ requestId });
    setChatStatus(result.detail);
    if (result.ok) {
      streamingAssistantRef.current = { id: "", contentLength: 0 };
      setIsAskingModel(false);
      setAskingThreadId("");
      if (selectedThread?.id) {
        activeThreadRequestsRef.current.delete(selectedThread.id);
        setActiveThreadRequestVersion((current) => current + 1);
      }
      activeModelRequestIdRef.current = "";
    }
  }

  function renderFeaturePanel() {
    return (
      <FeaturePanel
        activeFeature={activeFeature}
        newThreadTitle={newThreadTitle}
        setNewThreadTitle={setNewThreadTitle}
        newThreadSummary={newThreadSummary}
        setNewThreadSummary={setNewThreadSummary}
        api={api}
        workspaceCatalog={workspaceCatalog}
        addExistingProject={addExistingProject}
        selectedWorkspace={selectedWorkspace}
        createThread={createThread}
        selectedThread={selectedThread}
        forkThread={forkThread}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchResults={searchResults}
        setSelectedWorkspaceId={setSelectedWorkspaceId}
        setSelectedThreadId={setSelectedThreadId}
        formatSearchKind={formatSearchKind}
        skillDraft={skillDraft}
        setSkillDraft={setSkillDraft}
        resetFeatureDraft={resetFeatureDraft}
        editingFeatureId={editingFeatureId}
        saveFeature={saveFeature}
        featureConfig={featureConfig}
        setFeatureConfig={setFeatureConfig}
        loadFeatureDraft={loadFeatureDraft}
        removeFeature={removeFeature}
        pluginDraft={pluginDraft}
        setPluginDraft={setPluginDraft}
        automationDraft={automationDraft}
        setAutomationDraft={setAutomationDraft}
        setActiveFeature={setActiveFeature}
        activeSettingsSection={activeSettingsSection}
        setActiveSettingsSection={setActiveSettingsSection}
        mcpDiscoveredTools={mcpDiscoveredTools}
        isAuthenticated={isAuthenticated}
        modelConfig={modelConfig}
        setModelConfig={setModelConfig}
        handleLogout={handleLogout}
        saveModelConfig={saveModelConfig}
        isUsingLoginSession={isUsingLoginSession}
        apiKeyConfigured={apiKeyConfigured}
        snapshot={snapshot}
        bootstrapState={bootstrapState}
        projectResponseMessage={projectResponseMessage}
        desktopBootstrapStatus={desktopBootstrapStatus}
        condaBootstrapSummary={condaBootstrapSummary}
        handleRetryCondaBootstrap={handleRetryCondaBootstrap}
        isRetryingCondaBootstrap={isRetryingCondaBootstrap}
      />
    );
  }

  function renderPreviewPanel() {
    const renderReviewDiff = (file: ReviewChangeFile) => {
      const rows: Array<{ type: "meta" | "hunk" | "add" | "del" | "ctx"; text: string; oldLine?: number; newLine?: number }> = [];
      let oldLine = 0;
      let newLine = 0;
      for (const line of String(file.diff || "").split("\n")) {
        const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (hunk) {
          oldLine = Number(hunk[1]);
          newLine = Number(hunk[2]);
          rows.push({ type: "hunk", text: line });
          continue;
        }
        if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) {
          rows.push({ type: "meta", text: line });
          continue;
        }
        if (line.startsWith("+")) {
          rows.push({ type: "add", text: line.slice(1), newLine: newLine > 0 ? newLine : undefined });
          newLine += 1;
          continue;
        }
        if (line.startsWith("-")) {
          rows.push({ type: "del", text: line.slice(1), oldLine: oldLine > 0 ? oldLine : undefined });
          oldLine += 1;
          continue;
        }
        rows.push({
          type: "ctx",
          text: line.startsWith(" ") ? line.slice(1) : line,
          oldLine: oldLine > 0 ? oldLine : undefined,
          newLine: newLine > 0 ? newLine : undefined
        });
        oldLine += 1;
        newLine += 1;
      }
      if (!rows.length) return <div className="review-diff-empty">这个文件由当前线程记录为已修改，但当前工作区没有可生成的文本 diff。</div>;
      const rowsWithoutMeta = rows.filter((row) => row.type !== "meta");
      const changedIndexes = new Set<number>();
      rowsWithoutMeta.forEach((row, index) => {
        if (row.type === "add" || row.type === "del" || row.type === "hunk") {
          for (let offset = -3; offset <= 3; offset += 1) changedIndexes.add(index + offset);
        }
      });
      const visibleRows: Array<typeof rowsWithoutMeta[number] | { type: "fold"; count: number; key: string }> = [];
      let foldedCount = 0;
      rowsWithoutMeta.forEach((row, index) => {
        const shouldShow = row.type !== "ctx" || changedIndexes.has(index);
        if (!shouldShow) {
          foldedCount += 1;
          return;
        }
        if (foldedCount > 0) {
          visibleRows.push({ type: "fold", count: foldedCount, key: `fold-${index}-${foldedCount}` });
          foldedCount = 0;
        }
        visibleRows.push(row);
      });
      if (foldedCount > 0) visibleRows.push({ type: "fold", count: foldedCount, key: `fold-tail-${foldedCount}` });
      return (
        <div className="review-diff-table">
          {visibleRows.map((row, index) => (
            row.type === "fold" ? (
              <div key={row.key} className="review-diff-fold">{row.count} unmodified lines</div>
            ) : (
              <div key={row.type + "-" + index + "-" + (row.oldLine ?? "") + "-" + (row.newLine ?? "")} className={"review-diff-row " + row.type}>
                <span className="review-line old">{row.oldLine ?? ""}</span>
                <span className="review-line new">{row.newLine ?? ""}</span>
                <code>{row.type === "add" ? "+" : row.type === "del" ? "-" : row.type === "hunk" ? "" : " "}{row.text}</code>
              </div>
            )
          ))}
        </div>
      );
    };

    if (previewMode === "workspace") {
      return (
        <div className="preview-content">
          <h3>{selectedWorkspace?.name ?? "项目空间"}</h3>
          <p>{selectedWorkspace?.path ?? snapshot.session.workspacePath}</p>
          <dl>
            <div>
              <dt>文件树</dt>
              <dd>{snapshot.workspace.length} 项</dd>
            </div>
            <div>
              <dt>时间线</dt>
              <dd>{timelineItems.length} 条</dd>
            </div>
            <div>
              <dt>运行记录</dt>
              <dd>{snapshot.runs.length} 条</dd>
            </div>
          </dl>
        </div>
      );
    }

    if (previewMode === "review") {
      const normalizedReviewFilter = reviewFileFilter.trim().toLowerCase();
      const hasReviewFilter = Boolean(normalizedReviewFilter);
      const hasHiddenReviewFiles = reviewHiddenFiles.size > 0;
      const visibleReviewFiles = reviewChanges.filter((file) =>
        !reviewHiddenFiles.has(file.filePath) &&
        (!normalizedReviewFilter || file.filePath.toLowerCase().includes(normalizedReviewFilter))
      );
      const selectedFile =
        visibleReviewFiles.find((file) => file.filePath === selectedReviewFile) ?? visibleReviewFiles[0];
      const reviewPathParts = visibleReviewFiles.map((file) => file.filePath.split(/[\\/]+/).filter(Boolean));
      let reviewCommonPrefixParts = reviewPathParts[0]?.slice(0, -1) ?? [];
      for (const parts of reviewPathParts.slice(1)) {
        let index = 0;
        while (index < reviewCommonPrefixParts.length && reviewCommonPrefixParts[index] === parts[index]) index += 1;
        reviewCommonPrefixParts = reviewCommonPrefixParts.slice(0, index);
      }
      const reviewTreeRootLabel = reviewCommonPrefixParts.length ? reviewCommonPrefixParts.join("/") : "当前变更";
      type ReviewTreeNode = { name: string; path: string; children: Map<string, ReviewTreeNode>; file?: ReviewChangeFile };
      const reviewTreeRoot: ReviewTreeNode = { name: "", path: "", children: new Map() };
      for (const file of visibleReviewFiles) {
        const fullParts = file.filePath.split(/[\\/]+/).filter(Boolean);
        const parts = fullParts.slice(reviewCommonPrefixParts.length);
        let node = reviewTreeRoot;
        parts.forEach((part, index) => {
          const path = [...(node.path ? node.path.split("/") : []), part].join("/");
          if (!node.children.has(part)) node.children.set(part, { name: part, path, children: new Map() });
          node = node.children.get(part)!;
          if (index === parts.length - 1) node.file = file;
        });
      }
      const renderReviewTreeNode = (node: ReviewTreeNode, depth = 0): any => {
        const children = [...node.children.values()].sort((left, right) => {
          if (Boolean(left.file) !== Boolean(right.file)) return left.file ? 1 : -1;
          return left.name.localeCompare(right.name);
        });
        if (node.file) {
          return (
            <button
              key={node.path}
              type="button"
              className={"review-tree-row file" + (node.file.filePath === selectedFile?.filePath ? " active" : "")}
              style={{ "--review-tree-depth": depth } as any}
              onClick={() => setSelectedReviewFile(node.file!.filePath)}
            >
              <SidebarIcon name="file" />
              <span>{node.name}</span>
              <em>+{node.file.additions} -{node.file.deletions}</em>
            </button>
          );
        }
        const isCollapsed = Boolean(node.path && reviewCollapsedTreePaths.has(node.path) && !normalizedReviewFilter);
        return (
          <div key={node.path || "root"} className="review-tree-group">
            {node.path ? (
              <button
                type="button"
                className="review-tree-row folder"
                style={{ "--review-tree-depth": depth } as any}
                onClick={() => setReviewCollapsedTreePaths((current) => {
                  const next = new Set(current);
                  next.has(node.path) ? next.delete(node.path) : next.add(node.path);
                  return next;
                })}
              >
                <span className="review-tree-chevron">{isCollapsed ? "›" : "⌄"}</span>
                <span>{node.name}</span>
              </button>
            ) : null}
            {isCollapsed ? null : children.map((child) => renderReviewTreeNode(child, node.path ? depth + 1 : depth))}
          </div>
        );
      };

      return (
        <div className={`side-review-view${reviewSideBySide ? " side-by-side" : ""}`}>
          <div className="side-review-toolbar">
            <button type="button" className="side-review-title" title="选择要审查的对话">
              上轮对话 <span><SidebarIcon name="chevron-down" /></span>
            </button>
            <span className="change-counts">+{reviewTotals.additions} -{reviewTotals.deletions}</span>
            <div className="side-review-actions">
              <button type="button" className="side-review-icon-button" title="重新读取真实变更" aria-label="重新读取真实变更" disabled={reviewLoading} onClick={() => setReviewReloadToken((current) => current + 1)}>↻</button>
              <div className="preview-action-popover-wrap">
                <button
                  type="button"
                  className="side-review-icon-button"
                  title="查看选项"
                  aria-label="查看选项"
                  aria-expanded={reviewOptionsOpen}
                  onClick={() => setReviewOptionsOpen((current) => !current)}
                >
                  <SidebarIcon name="more" />
                </button>
                {reviewOptionsOpen ? (
                  <div className="preview-action-menu side-review-options-menu">
                    <button type="button" onClick={() => setReviewDiffCollapsed((current) => !current)}>
                      <span>{reviewDiffCollapsed ? "✓" : ""}</span><span>折叠全部差异</span>
                    </button>
                    <button type="button" onClick={() => setReviewSideBySide((current) => !current)}>
                      <span>{reviewSideBySide ? "✓" : ""}</span><span>并排差异视图</span>
                    </button>
                    <button type="button" onClick={() => setReviewHiddenFiles(new Set())}>
                      <span></span><span>显示全部文件</span>
                    </button>
                  </div>
                ) : null}
              </div>
              <button type="button" className="side-review-icon-button" title={reviewDiffCollapsed ? "展开全部差异" : "折叠全部差异"} aria-label={reviewDiffCollapsed ? "展开全部差异" : "折叠全部差异"} onClick={() => setReviewDiffCollapsed((current) => !current)}>⇅</button>
              <button
                type="button"
                className="side-review-icon-button"
                title="跳转到文件"
                aria-label="跳转到文件"
                disabled={!selectedFile}
                onClick={() => {
                  if (!selectedFile) return;
                  setActiveTreePath(selectedFile.filePath);
                  setPatchForm((current) => ({ ...current, filePath: selectedFile.filePath }));
                  setPreviewMode("files");
                  setPreviewPlacement("side");
                }}
              >↗</button>
              <button type="button" className={`side-review-icon-button${reviewSideBySide ? " active" : ""}`} title="切换到并排差异视图" aria-label="切换到并排差异视图" onClick={() => setReviewSideBySide((current) => !current)}>◫</button>
              <button
                type="button"
                className="side-review-icon-button"
                title="隐藏文件"
                aria-label="隐藏文件"
                disabled={!selectedFile}
                onClick={() => {
                  if (!selectedFile) return;
                  setReviewHiddenFiles((current) => new Set([...current, selectedFile.filePath]));
                }}
              >
                <SidebarIcon name="folder" />
              </button>
              <button
                type="button"
                className={"side-review-icon-button" + (previewPlacement === "center" ? " review-primary-action" : "")}
                title="提交或推送"
                aria-label="提交或推送"
                onClick={() => {
                  setPreviewMode("terminal");
                  setPreviewPlacement("side");
                  if (api) void api.writeTerminalInput("git status --short --branch\n");
                }}
              >
                <SidebarIcon name="sliders" />
                {previewPlacement === "center" ? <span>提交或推送</span> : null}
              </button>
              <button
                type="button"
                className={"side-review-icon-button" + (previewPlacement === "center" ? " review-secondary-action" : "")}
                title={workspaceHeaderStatus.githubCliAvailable ? "使用 GitHub CLI 创建 PR" : "安装 GitHub CLI (gh) 以创建 PR"}
                aria-label={workspaceHeaderStatus.githubCliAvailable ? "使用 GitHub CLI 创建 PR" : "安装 GitHub CLI (gh) 以创建 PR"}
                onClick={() => {
                  setPreviewMode("terminal");
                  setPreviewPlacement("side");
                  if (api) void api.writeTerminalInput(`${workspaceHeaderStatus.githubCliAvailable ? "gh pr create --web" : "gh --version"}\n`);
                }}
              >
                <SidebarIcon name="branch" />
                {previewPlacement === "center" ? <span>{workspaceHeaderStatus.githubCliAvailable ? "创建拉取请求" : "检查 gh"}</span> : null}
              </button>
            </div>
          </div>
          {reviewLoading ? (
            <div className="side-panel-empty">正在读取当前线程的真实变更…</div>
          ) : reviewError ? (
            <div className="side-panel-empty"><strong>审查数据读取失败</strong><span>{reviewError}</span></div>
          ) : visibleReviewFiles.length > 0 ? (
            <div className="side-review-files review-modern-layout">
              <div className="review-diff-pane">
                {selectedFile ? (
                  <header>
                    <SidebarIcon name="file" />
                    <strong>{selectedFile.filePath}</strong>
                    <span>{selectedFile.status} · {selectedFile.source === "thread" ? "当前线程" : "Git 工作区"}</span>
                  </header>
                ) : null}
                {reviewDiffCollapsed ? (
                  <button type="button" className="side-review-collapsed" onClick={() => setReviewDiffCollapsed(false)}>
                    {visibleReviewFiles.length} 个文件差异已折叠，点击展开
                  </button>
                ) : selectedFile ? (
                  renderReviewDiff(selectedFile)
                ) : null}
              </div>
              <aside className="review-file-pane">
                <label className="review-file-filter">⌕ <input placeholder="筛选文件..." value={reviewFileFilter} onChange={(event) => setReviewFileFilter(event.target.value)} /></label>
                <div className="review-file-tree-root" title={reviewTreeRootLabel}>⌄ {reviewTreeRootLabel}</div>
                <div className="review-tree-list">
                  {renderReviewTreeNode(reviewTreeRoot)}
                </div>
              </aside>
            </div>
          ) : reviewChanges.length > 0 && hasReviewFilter ? (
            <div className="side-panel-empty">
              <strong>没有匹配的文件</strong>
              <span>当前筛选条件未命中任何变更文件。</span>
              <button type="button" onClick={() => setReviewFileFilter("")}>清空筛选</button>
            </div>
          ) : reviewChanges.length > 0 && hasHiddenReviewFiles ? (
            <div className="side-panel-empty">
              <strong>文件已隐藏</strong>
              <button type="button" onClick={() => setReviewHiddenFiles(new Set())}>显示全部文件</button>
            </div>
          ) : reviewChanges.length > 0 ? (
            <div className="side-panel-empty">当前筛选条件下暂无可显示的变更文件。</div>
          ) : (
            <div className="side-panel-empty">当前线程暂无可审查的真实文件变更。</div>
          )}
        </div>
      );

      /* Legacy single-patch review UI removed. Real review data now comes from phase1:get-review-changes.
      const legacyPatch: any = undefined;
      const patchHidden = Boolean(patch && reviewHiddenFiles.has(patch.filePath));

      return (
        <div className={`side-review-view${reviewSideBySide ? " side-by-side" : ""}`}>
          <div className="side-review-toolbar">
            <button
              type="button"
              className="side-review-title"
              title="选择要审查的对话"
            >
              上轮对话 <span><SidebarIcon name="chevron-down" /></span>
            </button>
            <span className="change-counts">+{workspaceHeaderStatus.additions} −{workspaceHeaderStatus.deletions}</span>
            <div className="side-review-actions">
              <div className="preview-action-popover-wrap">
                <button
                  type="button"
                  className="side-review-icon-button"
                  title="查看选项"
                  aria-label="查看选项"
                  aria-expanded={reviewOptionsOpen}
                  onClick={() => setReviewOptionsOpen((current) => !current)}
                >
                  <SidebarIcon name="more" />
                </button>
                {reviewOptionsOpen ? (
                  <div className="preview-action-menu side-review-options-menu">
                    <button type="button" onClick={() => setReviewDiffCollapsed((current) => !current)}>
                      <span>{reviewDiffCollapsed ? "✓" : ""}</span><span>折叠全部差异</span>
                    </button>
                    <button type="button" onClick={() => setReviewSideBySide((current) => !current)}>
                      <span>{reviewSideBySide ? "✓" : ""}</span><span>并排差异视图</span>
                    </button>
                    <button type="button" onClick={() => setReviewHiddenFiles(new Set())}>
                      <span></span><span>显示全部文件</span>
                    </button>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="side-review-icon-button"
                title={reviewDiffCollapsed ? "展开全部差异" : "折叠全部差异"}
                aria-label={reviewDiffCollapsed ? "展开全部差异" : "折叠全部差异"}
                onClick={() => setReviewDiffCollapsed((current) => !current)}
              >
                ⇅
              </button>
              <button
                type="button"
                className="side-review-icon-button"
                title="跳转到文件"
                aria-label="跳转到文件"
                disabled={!patch}
                onClick={() => {
                  if (!patch) return;
                  setActiveTreePath(patch.filePath);
                  setPatchForm((current) => ({ ...current, filePath: patch.filePath }));
                  setPreviewMode("files");
                  setPreviewPlacement("side");
                }}
              >
                ⌕
              </button>
              <button
                type="button"
                className={`side-review-icon-button${reviewSideBySide ? " active" : ""}`}
                title="切换到拆分差异视图"
                aria-label="切换到拆分差异视图"
                onClick={() => setReviewSideBySide((current) => !current)}
              >
                ◫
              </button>
              <button
                type="button"
                className="side-review-icon-button"
                title="隐藏文件"
                aria-label="隐藏文件"
                disabled={!patch}
                onClick={() => {
                  if (!patch) return;
                  setReviewHiddenFiles((current) => new Set([...current, patch.filePath]));
                }}
              >
                <SidebarIcon name="folder" />
              </button>
              <button
                type="button"
                className="side-review-icon-button"
                title="提交或推送"
                aria-label="提交或推送"
                onClick={() => {
                  setPreviewMode("terminal");
                  setPreviewPlacement("side");
                  if (api) void api.writeTerminalInput("git status --short --branch\n");
                }}
              >
                <SidebarIcon name="sliders" />
              </button>
              <button
                type="button"
                className="side-review-icon-button"
                title={workspaceHeaderStatus.githubCliAvailable ? "使用 GitHub CLI 创建 PR" : "安装 GitHub CLI (gh) 以创建 PR"}
                aria-label={workspaceHeaderStatus.githubCliAvailable ? "使用 GitHub CLI 创建 PR" : "安装 GitHub CLI (gh) 以创建 PR"}
                onClick={() => {
                  setPreviewMode("terminal");
                  setPreviewPlacement("side");
                  if (api) void api.writeTerminalInput(`${workspaceHeaderStatus.githubCliAvailable ? "gh pr create --web" : "gh --version"}\n`);
                }}
              >
                <SidebarIcon name="branch" />
              </button>
            </div>
          </div>
          {patch && !patchHidden ? (
            <div className="side-review-files">
              <header>
                <SidebarIcon name="file" />
                <strong>{patch.filePath}</strong>
                <span>{patch.summary}</span>
              </header>
              {reviewDiffCollapsed ? (
                <button type="button" className="side-review-collapsed" onClick={() => setReviewDiffCollapsed(false)}>
                  {patch.hunks.length} 个差异块已折叠，点击展开
                </button>
              ) : (
                patch.hunks.map((hunk: any, index: number) => (
                  <pre key={`${hunk.header}-${index}`}><code>{[hunk.header, ...hunk.preview].join("\n")}</code></pre>
                ))
              )}
            </div>
          ) : patch && patchHidden ? (
            <div className="side-panel-empty">
              <strong>文件已隐藏</strong>
              <button type="button" onClick={() => setReviewHiddenFiles(new Set())}>显示文件</button>
            </div>
          ) : (
            <div className="side-panel-empty">当前线程暂无可审查的补丁。</div>
          )}
        </div>
      );
      */
    }

    if (previewMode === "terminal") {
      return <div className="side-terminal-view"><pre>{(terminalSession?.lines || []).join("\n")}</pre><form onSubmit={(event) => { event.preventDefault(); const command = String(new FormData(event.currentTarget).get("command") || ""); if (command.trim()) void api?.writeTerminalInput(`${command}\n`); event.currentTarget.reset(); }}><span>{terminalSession?.prompt || ">"}</span><input name="command" autoComplete="off" autoFocus /></form></div>;
    }

    if (previewMode === "browser") {
      const navigateBrowserHistory = (direction: "back" | "forward") => {
        try {
          const history = sideBrowserFrameRef.current?.contentWindow?.history;
          if (direction === "back") history?.back();
          else history?.forward();
        } catch {
          // Cross-origin frames may reject history access; keep the button safe.
        }
      };
      return <div className="side-browser-view"><form onSubmit={(event) => { event.preventDefault(); const value = String(new FormData(event.currentTarget).get("url") || "").trim(); if (value) setSideBrowserUrl(/^https?:\/\//i.test(value) ? value : `http://${value}`); }}><button type="button" aria-label="后退" onClick={() => navigateBrowserHistory("back")}>←</button><button type="button" aria-label="前进" onClick={() => navigateBrowserHistory("forward")}>→</button><input name="url" defaultValue={sideBrowserUrl} placeholder="输入 URL" /><button type="submit">↗</button></form>{sideBrowserUrl ? <iframe ref={sideBrowserFrameRef} key={sideBrowserUrl} src={sideBrowserUrl} title="NewBrain 浏览器" /> : <div className="side-browser-empty"><span>◎</span><strong>开始浏览</strong><small>输入 URL 以打开页面</small></div>}</div>;

    }

    if (previewMode === "files") {
      return <div className="side-files-view"><div className="side-files-search">⌕ <input value={sideFileFilter} onChange={(event) => setSideFileFilter(event.target.value)} placeholder="筛选文件..." /></div><WorkspaceTree nodes={filteredTreeNodes} expandedPaths={expandedPaths} activePath={activeTreePath} onToggle={(path) => setExpandedPaths((current) => { const next = new Set(current); next.has(path) ? next.delete(path) : next.add(path); return next; })} onSelect={(path) => { setActiveTreePath(path); setPatchForm((current) => ({ ...current, filePath: path })); }} /></div>;

    }

    if (previewMode === "chat") {
      return <div className="side-chat-view"><div className="side-chat-messages">{latestAssistantMessage ? <p>{latestAssistantMessage}</p> : null}</div><div className="side-chat-composer"><textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="要求后续变更" /><button type="button" disabled={!question.trim() || isAskingModel} onClick={() => void askModel()}>↑</button></div></div>;
    }

    return (
      <div className="preview-launcher">
        <button type="button" onClick={() => setPreviewMode("review")}>
          <SidebarIcon name="archive" /><span>审查</span><kbd>Ctrl+Shift+G</kbd>
        </button>
        <button type="button" onClick={() => setPreviewMode("terminal")}>
          <SidebarIcon name="terminal" /><span>终端</span><kbd>Ctrl+`</kbd>
        </button>
        <button type="button" onClick={() => setPreviewMode("browser")}>
          <span className="browser-glyph">◎</span><span>浏览器</span><kbd>Ctrl+T</kbd>
        </button>
        <button type="button" onClick={() => setPreviewMode("files")}>
          <SidebarIcon name="folder" /><span>文件</span><kbd>Ctrl+P</kbd>
        </button>
        <button type="button" onClick={() => setPreviewMode("chat")}>
          <SidebarIcon name="chat" /><span>侧边聊天</span><kbd>Ctrl+Alt+S</kbd>
        </button>
      </div>
    );
  }

  function handleTogglePreviewPanel() {
    setPreviewPlacement((current) => (current === "hidden" ? "side" : "hidden"));
  }

  function handleTogglePreviewExpanded() {
    if (previewPlacement === "center") {
      setPreviewPlacement("side");
      return;
    }

    setPreviewPlacement("center");
  }

  function PreviewExpandGlyph({ expanded }: { expanded: boolean }) {
    return <SidebarIcon name={expanded ? "minimize" : "maximize"} />;
  }

  function PreviewPanelGlyph({ visible }: { visible: boolean }) {
    return <span className={visible ? "preview-panel-glyph visible" : "preview-panel-glyph hidden"}><SidebarIcon name="panel-right" /></span>;
  }

  function SystemToolIcon({ toolId }: { toolId: string }) {
    if (toolId === "finder") {
      return <span className="system-tool-logo file-explorer" aria-hidden="true"><i /></span>;
    }
    if (toolId === "terminal") {
      return <span className="system-tool-logo terminal" aria-hidden="true">›_</span>;
    }
    if (toolId === "git-bash") {
      return <span className="system-tool-logo git-bash" aria-hidden="true">◆</span>;
    }
    if (toolId === "idea") {
      return <span className="system-tool-logo jetbrains idea" aria-hidden="true">IJ</span>;
    }
    if (toolId === "pycharm") {
      return <span className="system-tool-logo jetbrains pycharm" aria-hidden="true">PC</span>;
    }
    return <span className="system-tool-logo visual-studio" aria-hidden="true">∞</span>;
  }

  function renderPreviewHeaderActions(context: "sidebar" | "expanded" | "topbar") {
    const previewVisible = previewPlacement !== "hidden";
    const previewCentered = previewPlacement === "center";

    return (
      <div className={`preview-header-actions ${context}`} aria-label="工作区操作">
        {context === "topbar" ? (
          <>
            <div className="preview-action-popover-wrap">
              <button
                className="preview-open-location-button"
                type="button"
                title="选择打开位置"
                aria-label="选择打开位置"
                aria-expanded={showOpenLocationMenu}
                onClick={() => {
                  setShowOpenLocationMenu((current) => !current);
                  setShowWorkspaceStatusMenu(false);
                }}
              >
                <SidebarIcon name="external-link" />
                <span className="preview-open-location-label">打开位置</span>
                <span className="dropdown-chevron" aria-hidden="true"><SidebarIcon name="chevron-down" /></span>
              </button>
              {showOpenLocationMenu ? (
                <div className="preview-action-menu open-location-menu">
                  {systemTools.map((tool) => (
                    <button
                      key={tool.id}
                      type="button"
                      onClick={async () => {
                        setShowOpenLocationMenu(false);
                        if (!api || !selectedWorkspace) return;
                        const result = await api.openSystemTool({
                          toolId: tool.id,
                          workspaceId: selectedWorkspace.id
                        });
                        setChatStatus(result.detail);
                      }}
                    >
                      <SystemToolIcon toolId={tool.id} />
                      {tool.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="preview-action-popover-wrap">
              <button
                className="preview-icon-button workspace-status-button"
                type="button"
                title="工作区状态"
                aria-label="工作区状态"
                aria-expanded={showWorkspaceStatusMenu}
                onClick={() => {
                  setShowWorkspaceStatusMenu((current) => {
                    if (!current) void refreshWorkspaceHeaderStatus();
                    return !current;
                  });
                  setShowOpenLocationMenu(false);
                }}
              >
                <SidebarIcon name="sliders" />
              </button>
              {showWorkspaceStatusMenu ? (
                <div className="preview-action-menu workspace-status-menu">
                  <div className="workspace-status-heading">
                    <strong>环境信息</strong>
                    <button type="button" aria-label="打开环境设置" onClick={() => { setShowWorkspaceStatusMenu(false); setActiveFeature("settings"); setActiveSettingsSection("environment"); }}>＋</button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowWorkspaceStatusMenu(false);
                      setPreviewMode("review");
                      setPreviewPlacement("center");
                    }}
                  >
                    <SidebarIcon name="archive" /><span>变更</span><em className="change-counts">+{workspaceHeaderStatus.additions} −{workspaceHeaderStatus.deletions}</em>
                  </button>
                  <button type="button" className={workspaceStatusSubmenu === "local" ? "active" : ""} onClick={() => void openWorkspaceStatusSubmenu("local")}>
                    <SidebarIcon name="computer" /><span>本地</span><strong><SidebarIcon name="chevron-down" /></strong>
                  </button>
                  <button type="button" className={workspaceStatusSubmenu === "branch" ? "active" : ""} onClick={() => void openWorkspaceStatusSubmenu("branch")}>
                    <SidebarIcon name="branch" /><span>{workspaceHeaderStatus.branch}</span><strong><SidebarIcon name="chevron-down" /></strong>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setShowWorkspaceStatusMenu(false); setPreviewMode("terminal"); setPreviewPlacement("side");
                      if (api) void api.writeTerminalInput("git status --short --branch\n");
                    }}
                  >
                    <span className="commit-glyph" /><span>提交或推送</span>
                  </button>
                  <div className={workspaceHeaderStatus.githubCliAvailable ? "" : "disabled"}>
                    <span className="github-glyph">●</span>
                    <span>{workspaceHeaderStatus.githubCliAvailable ? "GitHub CLI 可用" : "GitHub CLI 不可用"}</span>
                  </div>
                  <div className="workspace-status-section-label">侧边聊天</div>
                  <button type="button" onClick={() => { setShowWorkspaceStatusMenu(false); setPreviewMode("chat"); setPreviewPlacement("side"); }}><SidebarIcon name="chat" /><span>侧边聊天</span></button>
                  <div className="workspace-status-source"><small>来源</small><span>◎</span></div>

                  {workspaceStatusSubmenu === "local" ? (
                    <div className="workspace-status-submenu local-status-submenu">
                      <span className="workspace-status-subtitle">继续使用</span>
                      <button type="button"><SidebarIcon name="computer" /><span>在本地处理</span><strong>✓</strong></button>
                      <button type="button" onClick={() => void api?.openBrowserPreview()}><span>◉</span><span>关联 NewBrain web</span><strong>↗</strong></button>
                      <button type="button" disabled><span>☁</span><span>发送至云端</span></button>
                      <div className="thread-context-divider" />
                      <button type="button" onClick={() => { setActiveFeature("settings"); setActiveSettingsSection("billing"); setShowWorkspaceStatusMenu(false); }}><span>◔</span><span>剩余用量 {workspaceUsageRemaining == null ? "--" : `${workspaceUsageRemaining}%`}</span><strong>›</strong></button>
                      <div className="thread-context-divider" />
                      <button type="button" onClick={async () => { if (!api || !selectedWorkspace) return; const result = await api.createWorkspaceWorktree({ workspaceId: selectedWorkspace.id }); setChatStatus(result.detail); }}><SidebarIcon name="git-worktree" /><span>工作树</span></button>
                    </div>
                  ) : null}

                  {workspaceStatusSubmenu === "branch" ? (
                    <div className="workspace-status-submenu branch-status-submenu">
                      <label>⌕<input value={branchSearch} onChange={(event) => setBranchSearch(event.target.value)} placeholder="搜索分支" /></label>
                      <span className="workspace-status-subtitle">分支</span>
                      <div className="branch-status-list">
                        {workspaceBranches.branches.filter((branch) => branch.toLowerCase().includes(branchSearch.toLowerCase())).map((branch) => (
                          <button key={branch} type="button" onClick={async () => { if (!api || !selectedWorkspace || branch === workspaceBranches.current) return; try { const next = await api.switchWorkspaceBranch({ workspaceId: selectedWorkspace.id, branch }); setWorkspaceBranches(next); await refreshWorkspaceHeaderStatus(); setWorkspaceStatusSubmenu(null); } catch (error) { setErrorMessage(error instanceof Error ? error.message : String(error)); } }}><SidebarIcon name="branch" /><span><strong>{branch}</strong>{branch === workspaceBranches.current ? <small>未提交：{workspaceBranches.changedFiles} 个文件</small> : null}</span><em>{branch === workspaceBranches.current ? "✓" : ""}</em></button>
                        ))}
                      </div>
                      <form
                        className="branch-create-form"
                        onSubmit={async (event) => {
                          event.preventDefault();
                          if (!api || !selectedWorkspace) return;
                          const branch = branchCreateName.trim();
                          if (!branch) return;
                          try {
                            const next = await api.switchWorkspaceBranch({ workspaceId: selectedWorkspace.id, branch, create: true });
                            setWorkspaceBranches(next);
                            setBranchCreateName("codex/new-branch");
                            await refreshWorkspaceHeaderStatus();
                            setWorkspaceStatusSubmenu(null);
                          } catch (error) {
                            setErrorMessage(error instanceof Error ? error.message : String(error));
                          }
                        }}
                      >
                        <input
                          value={branchCreateName}
                          onChange={(event) => setBranchCreateName(event.target.value)}
                          placeholder="codex/new-branch"
                          aria-label="新分支名称"
                        />
                        <button type="submit" disabled={!api || !selectedWorkspace || !branchCreateName.trim()}>
                          创建
                        </button>
                      </form>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </>
        ) : previewVisible ? (
          <button
            className="preview-icon-button"
            type="button"
            title={previewCentered ? "缩回侧栏" : "展开预览"}
            aria-label={previewCentered ? "缩回侧栏" : "展开预览"}
            onClick={handleTogglePreviewExpanded}
          >
            <PreviewExpandGlyph expanded={previewCentered} />
          </button>
        ) : null}
        {context !== "topbar" || !previewVisible ? (
          <button
            className="preview-icon-button preview-panel-toggle"
            type="button"
            title={previewVisible ? "隐藏侧栏" : "显示侧栏"}
            aria-label={previewVisible ? "隐藏侧栏" : "显示侧栏"}
            onClick={handleTogglePreviewPanel}
          >
            <PreviewPanelGlyph visible={previewVisible} />
          </button>
        ) : null}
      </div>
    );
  }

  function renderSettingsWorkspace() {
    return (
      <SettingsWorkspace
        authStatus={authStatus}
        setAuthStatus={setAuthStatus}
        setActiveSettingsSection={setActiveSettingsSection}
        activeSettingsSection={activeSettingsSection}
        setActiveFeature={setActiveFeature}
        setPreviewMode={setPreviewMode}
        previewMode={previewMode}
        modelConfig={modelConfig}
        setModelConfig={setModelConfig}
        apiKeyConfigured={apiKeyConfigured}
        isUsingLoginSession={isUsingLoginSession}
        handleLogout={handleLogout}
        isAuthenticated={isAuthenticated}
        displayUserAvatar={displayUserAvatar}
        displayUserName={displayUserName}
        displayUserEmail={displayUserEmail}
        displayUserPlan={displayUserPlan}
        onAccountProfileChange={setAccountProfile}
        desktopPreferences={desktopPreferences}
        saveDesktopPreferences={saveDesktopPreferences}
        setDesktopPreferences={setDesktopPreferences}
        setChatUsesProject={setChatUsesProject}
        setComposerPermission={setComposerPermission}
        isComposingNewThread={isComposingNewThread}
        newThreadScope={newThreadScope}
        environmentEnvText={environmentEnvText}
        setEnvironmentEnvText={setEnvironmentEnvText}
        formatEnvText={formatEnvText}
        mcpServers={mcpServers}
        mcpDraft={mcpDraft}
        setMcpDraft={setMcpDraft}
        editingMcpId={editingMcpId}
        saveModelConfig={saveModelConfig}
        saveMcpServers={saveMcpServers}
        resetMcpDraft={resetMcpDraft}
        handleSaveMcpServer={handleSaveMcpServer}
        loadMcpDraft={loadMcpDraft}
        handleDeleteMcpServer={handleDeleteMcpServer}
        handleToggleMcpServer={handleToggleMcpServer}
        handleTestMcpServer={handleTestMcpServer}
        handleStartMcpServer={handleStartMcpServer}
        handleStopMcpServer={handleStopMcpServer}
        handleLoadMcpLogs={handleLoadMcpLogs}
        handleClearMcpLogs={handleClearMcpLogs}
        handleInspectMcpServer={handleInspectMcpServer}
        testingMcpId={testingMcpId}
        mcpHealth={mcpHealth}
        mcpLogs={mcpLogs}
        expandedMcpLogId={expandedMcpLogId}
        setExpandedMcpLogId={setExpandedMcpLogId}
        mcpInspection={mcpInspection}
        systemTools={systemTools}
        setSystemTools={setSystemTools}
        api={api}
        runAction={runAction}
        archivedThreads={archivedThreads}
        workspaceCatalog={workspaceCatalog}
        addExistingProject={addExistingProject}
        selectedWorkspace={selectedWorkspace}
        setSelectedWorkspaceId={setSelectedWorkspaceId}
        setSelectedThreadId={setSelectedThreadId}
        setArchivedThreadIds={setArchivedThreadIds}
        deleteThread={deleteThread}
        setWorkspaceCatalog={setWorkspaceCatalog}
        renderFeaturePanel={renderFeaturePanel}
        SettingsNavIcon={SettingsNavIcon}
        SettingsSwitch={SettingsSwitch}
        writeClipboard={writeClipboard}
        shellCommand={shellCommand}
        setShellCommand={setShellCommand}
        bootstrapState={bootstrapState}
        snapshot={snapshot}
        desktopBootstrapStatus={desktopBootstrapStatus}
        setChatStatus={setChatStatus}
        setErrorMessage={setErrorMessage}
        appUpdateStatus={appUpdateStatus}
        appUpdateBusy={appUpdateBusy}
        startDesktopAppUpdate={startDesktopAppUpdate}
        applyDesktopAppUpdate={applyDesktopAppUpdate}
        skipDesktopAppUpdate={skipDesktopAppUpdate}
      />
    );
  }

  if (authStatus.loading) {
    return <AuthLoadingScreen bootstrapState={bootstrapState} errorMessage={errorMessage} />;
  }

  if (isBootstrapBlocking) {
    return (
      <BootstrapBlockingScreen
        bootstrapState={bootstrapState}
        desktopBootstrapStatus={desktopBootstrapStatus}
        errorMessage={errorMessage}
        isRetryingCondaBootstrap={isRetryingCondaBootstrap}
        onRetryCondaBootstrap={() => void handleRetryCondaBootstrap()}
      />
    );
  }

  function renderWorkspaceModules() {
    return (
      <WorkspaceModules
        WorkspaceTree={WorkspaceTree}
        isSettingsFeature={isSettingsFeature}
        activeFeature={activeFeature}
        setActiveFeature={setActiveFeature}
        featureItems={featureItems}
        showsFeaturePanel={showsFeaturePanel}
        activeFeatureItem={activeFeatureItem}
        renderFeaturePanel={renderFeaturePanel}
        projectsCollapsed={projectsCollapsed}
        setProjectsCollapsed={setProjectsCollapsed}
        workspaceCatalog={workspaceCatalog}
        setWorkspaceCatalog={setWorkspaceCatalog}
        expandedWorkspaceIds={expandedWorkspaceIds}
        setExpandedWorkspaceIds={setExpandedWorkspaceIds}
        sortProjectsAscending={sortProjectsAscending}
        setSortProjectsAscending={setSortProjectsAscending}
        showAddWorkspacePanel={showAddWorkspacePanel}
        setShowAddWorkspacePanel={setShowAddWorkspacePanel}
        newWorkspaceName={newWorkspaceName}
        setNewWorkspaceName={setNewWorkspaceName}
        newWorkspacePath={newWorkspacePath}
        setNewWorkspacePath={setNewWorkspacePath}
        api={api}
        createWorkspace={createWorkspace}
        createBlankProject={createBlankProject}
        addExistingProject={addExistingProject}
        visibleWorkspaceCatalog={visibleWorkspaceCatalog}
        selectedWorkspace={selectedWorkspace}
        workspaceHeaderStatus={workspaceHeaderStatus}
        snapshot={snapshot}
        setSnapshot={setSnapshot}
        expandedThreadListWorkspaceIds={expandedThreadListWorkspaceIds}
        setExpandedThreadListWorkspaceIds={setExpandedThreadListWorkspaceIds}
        sortThreadsForMenu={sortThreadsForMenu}
        setSelectedWorkspaceId={setSelectedWorkspaceId}
        setSelectedThreadId={setSelectedThreadId}
        selectWorkspaceThread={selectWorkspaceThread}
        setUnreadThreadIds={setUnreadThreadIds}
        pinnedThreadIds={pinnedThreadIds}
        unreadThreadIds={unreadThreadIds}
        setThreadContextMenu={setThreadContextMenu}
        handleThreadMenuAction={handleThreadMenuAction}
        showRenameThreadDialog={showRenameThreadDialog}
        setShowRenameThreadDialog={setShowRenameThreadDialog}
        editingThreadTitle={editingThreadTitle}
        setEditingThreadTitle={setEditingThreadTitle}
        renameThread={renameThread}
        formatRelativeTimeLabel={formatRelativeTimeLabel}
        formatSearchKind={formatSearchKind}
        reviewDrawerOpen={reviewDrawerOpen}
        setReviewDrawerOpen={setReviewDrawerOpen}
        treeNodes={treeNodes}
        expandedPaths={expandedPaths}
        activeTreePath={activeTreePath}
        setExpandedPaths={setExpandedPaths}
        setActiveTreePath={setActiveTreePath}
        setPatchForm={setPatchForm}
        setPreviewMode={setPreviewMode}
        previewMode={previewMode}
        runAction={runAction}
        displayUserAvatar={displayUserAvatar}
        displayUserName={displayUserName}
        displayUserPlan={displayUserPlan}
        showAccountMenu={showAccountMenu}
        setShowAccountMenu={setShowAccountMenu}
        setActiveSettingsSection={setActiveSettingsSection}
        handleLogout={handleLogout}
        appUpdateStatus={appUpdateStatus}
        appUpdateBusy={appUpdateBusy}
        appUpdateProgress={appUpdateProgress}
        appUpdateDiscoverOpen={appUpdateDiscoverOpen}
        appUpdateApplied={appUpdateApplied}
        startDesktopAppUpdate={startDesktopAppUpdate}
        applyDesktopAppUpdate={applyDesktopAppUpdate}
        skipDesktopAppUpdate={skipDesktopAppUpdate}
        dismissAppUpdateProgress={dismissAppUpdateProgress}
        dismissAppUpdateDiscover={dismissAppUpdateDiscover}
        dismissAppliedAppUpdate={dismissAppliedAppUpdate}
        title={title}
        previewPlacement={previewPlacement}
        setPreviewPlacement={setPreviewPlacement}
        renderPreviewHeaderActions={renderPreviewHeaderActions}
        errorMessage={errorMessage}
        setErrorMessage={setErrorMessage}
        conversationTurns={conversationTurns}
        writeClipboard={writeClipboard}
        setQuestion={setQuestion}
        setChatMessages={setChatMessages}
        composerImages={composerImages}
        setComposerImages={setComposerImages}
        queuedComposerDraft={queuedComposerDraft}
        setQueuedComposerDraft={setQueuedComposerDraft}
        queuedComposerDraftRef={queuedComposerDraftRef}
        timelineItems={timelineItems}
        assistantActivities={assistantActivities}
        assistantStartedAt={assistantStartedAt}
        lastAssistantElapsedSeconds={lastAssistantElapsedSeconds}
        selectedThread={selectedThread}
        activeThreadIds={Array.from(activeThreadRequestsRef.current.keys())}
        activeThreadRequestIds={Object.fromEntries(activeThreadRequestsRef.current.entries())}
        forkCurrentAnswer={forkCurrentAnswer}
        selectedComposerTools={selectedComposerTools}
        handleRemoveComposerTool={handleRemoveComposerTool}
        renderComposerToolFields={renderComposerToolFields}
        question={question}
        isAskingModel={isCurrentThreadAskingModel}
        isGlobalModelBusy={isCurrentThreadAskingModel}
        composerPermission={composerPermission}
        setComposerPermission={setComposerPermission}
        composerWorkspaceContext={composerWorkspaceContext}
        setComposerWorkspaceContext={setComposerWorkspaceContext}
        setShowMcpToolPicker={setShowMcpToolPicker}
        showMcpToolPicker={showMcpToolPicker}
        mcpDiscoveredTools={mcpDiscoveredTools}
        mcpServers={mcpServers}
        mcpDraft={mcpDraft}
        setMcpDraft={setMcpDraft}
        editingMcpId={editingMcpId}
        mcpHealth={mcpHealth}
        mcpInspection={mcpInspection}
        testingMcpId={testingMcpId}
        resetMcpDraft={resetMcpDraft}
        loadMcpDraft={loadMcpDraft}
        handleSaveMcpServer={handleSaveMcpServer}
        handleDeleteMcpServer={handleDeleteMcpServer}
        handleToggleMcpServer={handleToggleMcpServer}
        handleTestMcpServer={handleTestMcpServer}
        handleInspectMcpServer={handleInspectMcpServer}
        handleInsertMcpTool={handleInsertMcpTool}
        modelConfig={modelConfig}
        setModelConfig={setModelConfig}
        askModel={askModel}
        cancelCurrentModelRequest={cancelCurrentModelRequest}
        shellCommand={shellCommand}
        setShellCommand={setShellCommand}
        chatStatus={chatStatus}
        setChatStatus={setChatStatus}
        renderPreviewPanel={renderPreviewPanel}
        renderSettingsWorkspace={renderSettingsWorkspace}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchResults={searchResults}
        showSearchDialog={showSearchDialog}
        setShowSearchDialog={setShowSearchDialog}
        isComposingNewThread={isComposingNewThread}
        setIsComposingNewThread={setIsComposingNewThread}
        newThreadScope={newThreadScope}
        setNewThreadScope={setNewThreadScope}
        chatUsesProject={chatUsesProject}
        setChatUsesProject={setChatUsesProject}
        desktopPreferences={desktopPreferences}
        saveDesktopPreferences={saveDesktopPreferences}
        featureConfig={featureConfig}
        setFeatureConfig={setFeatureConfig}
        skillDraft={skillDraft}
        setSkillDraft={setSkillDraft}
        pluginDraft={pluginDraft}
        setPluginDraft={setPluginDraft}
        automationDraft={automationDraft}
        setAutomationDraft={setAutomationDraft}
        resetFeatureDraft={resetFeatureDraft}
        loadFeatureDraft={loadFeatureDraft}
        saveFeature={saveFeature}
        editingFeatureId={editingFeatureId}
      />
    );
  }

  if (!isAuthenticated) {
    return (
      <LoginScreen
        agreementDialog={agreementDialog}
        authStatus={authStatus}
        errorMessage={errorMessage}
        isSendingLoginCode={isSendingLoginCode}
        isSubmittingLogin={isSubmittingLogin}
        loginCodeCooldownSeconds={loginCodeCooldownSeconds}
        loginForm={loginForm}
        onLoginSubmit={(agreementChecked, emailAuthMode) =>
          handleLoginSubmit(agreementChecked, emailAuthMode)
        }
        onSendLoginCode={() => void handleSendLoginCode()}
        setAgreementDialog={setAgreementDialog}
        setLoginForm={handleLoginFormChange}
      />
    );
  }

  return (
      <AppShell
        activeThread={
        selectedWorkspace && selectedThread && !isComposingStandaloneChat
          ? { workspaceId: selectedWorkspace.id, threadId: selectedThread.id }
          : undefined
      }
      onNavigateThread={(workspaceId, threadId) => {
        setIsComposingNewThread(false);
        setActiveFeature("new-chat");
        setPreviewPlacement("hidden");
        setSelectedWorkspaceId(workspaceId);
        setSelectedThreadId(threadId);
      }}
      menu={
        <ThreadContextMenu
          menu={threadContextMenu}
          pinnedThreadIds={pinnedThreadIds}
          unreadThreadIds={unreadThreadIds}
          onAction={(action, workspace, thread) => void handleThreadMenuAction(action, workspace, thread)}
        />
      }
    >
      <div className={`workspace-frame${isSettingsFeature ? " settings-mode" : ""}${!isSettingsFeature && (previewPlacement === "hidden" || isFullPageFeature) ? " preview-hidden" : ""}${!isSettingsFeature && !isFullPageFeature && previewPlacement === "center" ? " preview-centered" : ""}`}>
        {renderWorkspaceModules()}
      </div>
    </AppShell>
  );

}
