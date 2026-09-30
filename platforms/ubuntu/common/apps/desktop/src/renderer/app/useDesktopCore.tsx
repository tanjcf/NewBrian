// @ts-nocheck
import { useEffect, useRef } from "react";
import { sortThreadsByRecentActivity } from "./thread-order";
import { reconcileThreadDisplayMessages } from "./thread-activity-policy";
import { restoreStartupThreadSnapshot } from "./startup-thread-restore";
import { normalizeWorkspaceCatalog, resolveUserVisibleThreadSelection } from "./workspace-visibility";
import { isMissingWorkspaceSelectionError } from "../../shared/workspace-selection-errors";
import {
  resolveFontZoomDirection,
  scaleAppearanceFontSizes,
  shouldHandleFontZoomWheel
} from "./font-zoom-policy";

export function useDesktopCore(ctx: any) {
const setPreviewMode = ctx.setPreviewMode;
const setPreviewPlacement = ctx.setPreviewPlacement;
const { api, modelConfig, desktopPreferences, workspaceCatalog, archivedThreadIds, pinnedThreadIds, activeThreadRequestIds = {}, selectedWorkspace, selectedThread, selectedWorkspaceId, selectedThreadId, threadContextMenu, showAccountMenu, bootstrapState, desktopBootstrapStatus, isBootstrapBlocking, searchQuery, loginCodeCooldownSeconds, activeSettingsSection, mcpServers, expandedMcpLogId, newWorkspaceName, newWorkspacePath, newThreadTitle, newThreadSummary, isComposingNewThread, forkThreadTitle, editingThreadTitle, editingThreadSummary, skillDraft, pluginDraft, automationDraft, editingFeatureId, environmentEnvText, authStatus, loginForm, isSubmittingLogin, isSendingLoginCode, question, selectedComposerTools, chatMessages, isAskingModel, latestAssistantMessage, shouldAutoOpenPreview, setErrorMessage, setChatStatus, setWorkspaceCatalog, setSelectedWorkspaceId, setSelectedThreadId, setExpandedWorkspaceIds, setExpandedThreadListWorkspaceIds, setArchivedThreadIds, setUnreadThreadIds, setPinnedThreadIds, setThreadContextMenu, setSnapshot, setChatMessages, updateThreadMessages, setExpandedPaths, setEditingFeatureId, setSkillDraft, setPluginDraft, setAutomationDraft, setSearchResults, setBootstrapState, setModelConfig, setDesktopPreferences, setShellCommand, setEnvironmentEnvText, setFeatureConfig, setMcpServers, setMcpDiscoveredTools, setSystemTools, setAuthStatus, setDesktopBootstrapStatus, setLoginForm, setIsRetryingCondaBootstrap, setShowAccountMenu, setMcpHealth, setMcpLogs, setEditingThreadTitle, setEditingThreadSummary, setForkThreadTitle, setNewWorkspaceName, setNewWorkspacePath, setNewThreadTitle, setNewThreadSummary, setIsComposingNewThread, setActiveFeature, setQuestion, setIsAskingModel, setLoginCodeCooldownSeconds, setIsSubmittingLogin, setIsSendingLoginCode, setActiveSettingsSection, initialDraft, initialMcpServer, initialDesktopAuthStatus, initialModelConfig, initialDesktopPreferences, initialFeatureConfig, emptySnapshot, withTimeout, optionalLoad, formatEnvText, parseEnvText, buildWorkspaceTree, collectDirectoryKeys, coerceValueBySchema, settingsFeatureItem } = ctx;
const window = globalThis.window;
const document = window?.document ?? globalThis.document;
const navigator = window?.navigator ?? globalThis.navigator;

function writeClipboard(text: string) {
  if (!navigator.clipboard) {
    setErrorMessage("当前环境不支持剪贴板 API。");
    return;
  }

  navigator.clipboard.writeText(text).catch((error) => {
    setErrorMessage(error instanceof Error ? error.message : String(error));
  });
}

function relativeLuminance(color: unknown): number | null {
  const hex = String(color || "").trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hex) return null;
  let value = hex[1];
  if (value.length === 3) value = value.split("").map((part) => part + part).join("");
  const channel = (start: number) => {
    const raw = Number.parseInt(value.slice(start, start + 2), 16) / 255;
    return raw <= 0.03928 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function applyVisualPreferences(preferences: DesktopPreferencesState) {
  const resolvedTheme =
    preferences.appearance.theme === "system"
      ? window.matchMedia?.("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : preferences.appearance.theme;
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.themePreference = preferences.appearance.theme;
  document.documentElement.dataset.density = preferences.appearance.density;
  document.documentElement.dataset.reduceMotion = preferences.appearance.reduceMotion ? "true" : "false";
  document.documentElement.dataset.sidebarTranslucent = preferences.appearance.sidebarTranslucent ? "true" : "false";
  document.documentElement.dataset.pointerCursor = preferences.appearance.pointerCursor ? "true" : "false";
  document.documentElement.dataset.diffMarks = preferences.appearance.diffMarks;
  document.documentElement.style.setProperty("--accent", preferences.appearance.accentColor);
  // Appearance stores a single bg/fg pair (defaults are light). Do not force those onto dark theme,
  // or input areas become dark while text stays near-black and unreadable.
  const backgroundColor = preferences.appearance.backgroundColor;
  const foregroundColor = preferences.appearance.foregroundColor;
  const backgroundLuminance = relativeLuminance(backgroundColor);
  const foregroundLuminance = relativeLuminance(foregroundColor);
  if (resolvedTheme === "dark") {
    if (backgroundLuminance != null && backgroundLuminance < 0.45) {
      document.documentElement.style.setProperty("--bg", backgroundColor);
    } else {
      document.documentElement.style.removeProperty("--bg");
    }
    if (foregroundLuminance != null && foregroundLuminance > 0.55) {
      document.documentElement.style.setProperty("--text", foregroundColor);
    } else {
      document.documentElement.style.removeProperty("--text");
    }
  } else {
    document.documentElement.style.setProperty("--bg", backgroundColor);
    document.documentElement.style.setProperty("--text", foregroundColor);
  }
  document.documentElement.style.setProperty("--sans", preferences.appearance.uiFontFamily);
  document.documentElement.style.setProperty("--mono", preferences.appearance.codeFontFamily);
  document.documentElement.style.setProperty("--text-base", `${preferences.appearance.uiFontSize}px`);
  document.documentElement.style.setProperty("--vscode-chat-font-size", `${preferences.appearance.uiFontSize}px`);
  document.documentElement.style.setProperty("--code-font-size", `${preferences.appearance.codeFontSize}px`);
  document.documentElement.style.setProperty("--appearance-contrast", String(preferences.appearance.contrast));
}

function buildPersonalizedSystemPrompt() {
  const rules = [
    modelConfig.systemPrompt,
    desktopPreferences.personalization.workMode === "everyday"
      ? "Use a practical everyday-work style: keep technical detail lighter unless it is necessary, and explain actions in plain language."
      : "Use a coding-work style: include implementation details, file references, and verification notes when they help.",
    desktopPreferences.personalization.proactiveUpdates
      ? "Give brief progress updates while working on multi-step tasks."
      : "Avoid unsolicited progress updates unless the user asks.",
    desktopPreferences.personalization.includeVerificationSummary
      ? "When changes are made, include a concise verification summary."
      : "Keep completion summaries brief and omit verification detail unless important.",
    desktopPreferences.personalization.reviewFindingsFirst
      ? "For code review requests, list findings before summaries."
      : "For code review requests, use the most natural order for the situation."
  ];
  return rules.filter(Boolean).join("\n");
}

function shouldArchiveDeleteThread() {
  return !desktopPreferences.worktree.keepArchived;
}

const safeCoreWorkspaceCatalog = normalizeWorkspaceCatalog(workspaceCatalog);
const archivedThreads = safeCoreWorkspaceCatalog.flatMap((workspace) =>
  (workspace.threads ?? [])
    .filter((thread) => thread.archived || archivedThreadIds.has(thread.id))
    .map((thread) => ({ workspace, thread }))
);

function toMcpServerState(input: {
  id: string;
  name: string;
  transport: "stdio" | "sse";
  command: string;
  args: string[];
  url: string;
  env: Record<string, string>;
  enabled: boolean;
}): McpServerState {
  return {
    id: input.id,
    name: input.name,
    transport: input.transport,
    command: input.command,
    args: input.args.join(" "),
    url: input.url,
    env: Object.entries(input.env)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
    enabled: input.enabled
  };
}

function parseMcpDraft(draft: McpServerState) {
  return {
    id: draft.id,
    name: draft.name.trim(),
    transport: draft.transport,
    command: draft.command.trim(),
    args: draft.args
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean),
    url: draft.url.trim(),
    env: Object.fromEntries(
      draft.env
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const separatorIndex = line.indexOf("=");
          if (separatorIndex === -1) {
            return [line, ""];
          }
          return [line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim()];
        })
        .filter(([key]) => key)
    ),
    enabled: draft.enabled
  };
}

function sortThreadsForMenu(threads: WorkspaceThreadRecord[]) {
  return sortThreadsByRecentActivity(threads)
    .filter((thread) => !thread.archived && !archivedThreadIds.has(thread.id))
    .sort((left, right) => {
      const leftPinned = pinnedThreadIds.has(left.id) ? 1 : 0;
      const rightPinned = pinnedThreadIds.has(right.id) ? 1 : 0;
      if (leftPinned !== rightPinned) {
        return rightPinned - leftPinned;
      }
      return 0;
    });
}

async function renameThreadFromMenu(workspace: WorkspaceCatalogItem, thread: WorkspaceThreadRecord) {
  setSelectedWorkspaceId(workspace.id);
  setSelectedThreadId(thread.id);
  setEditingThreadTitle(thread.title);
  setEditingThreadSummary(thread.summary ?? "");
  ctx.setShowRenameThreadDialog?.(true);
  setErrorMessage("");
}
async function forkThreadFromMenu(workspace: WorkspaceCatalogItem, thread: WorkspaceThreadRecord, openInNewWorkspace: boolean) {
  if (!api) {
    return;
  }

  try {
    const nextCatalog = await api.forkWorkspaceThread({
      workspaceId: workspace.id,
      sourceThreadId: thread.id,
      title: openInNewWorkspace ? `${thread.title} 新工作树` : `${thread.title} 本地派生`
    });
    setWorkspaceCatalog(normalizeWorkspaceCatalog(nextCatalog));
    const currentWorkspace = nextCatalog.find((item) => item.id === workspace.id);
    const newestThread = resolveUserVisibleThreadSelection(currentWorkspace?.threads ?? [], null);
    setSelectedWorkspaceId(workspace.id);
    if (newestThread) {
      setSelectedThreadId(newestThread.id);
    }
    if (openInNewWorkspace || desktopPreferences.worktree.defaultIsolated) {
      const result = await api.createWorkspaceWorktree({
        workspaceId: workspace.id,
        branchName: `${desktopPreferences.git.branchPrefix}${thread.title.replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase()}`
      });
      setChatStatus(result.detail);
    }
    setExpandedWorkspaceIds((current) => new Set([...current, workspace.id]));
    setErrorMessage("");
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : String(error));
  }
}

async function forkCurrentAnswer() {
  if (!api || !selectedWorkspace?.id || !selectedThread?.id) {
    return;
  }

  try {
    const nextCatalog = await api.forkWorkspaceThread({
      workspaceId: selectedWorkspace.id,
      sourceThreadId: selectedThread.id,
      title: `${selectedThread.title} 答案分叉`
    });
    setWorkspaceCatalog(normalizeWorkspaceCatalog(nextCatalog));
    const currentWorkspace = nextCatalog.find((workspace) => workspace.id === selectedWorkspace.id);
    const newestThread = resolveUserVisibleThreadSelection(currentWorkspace?.threads ?? [], null);
    if (newestThread) {
      setSelectedThreadId(newestThread.id);
    }
    if (desktopPreferences.worktree.defaultIsolated) {
      const result = await api.createWorkspaceWorktree({
        workspaceId: selectedWorkspace.id,
        branchName: `${desktopPreferences.git.branchPrefix}${selectedThread.title.replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase()}`
      });
      setChatStatus(result.detail);
    } else {
      setChatStatus("已分叉答案");
    }
    setExpandedWorkspaceIds((current) => new Set([...current, selectedWorkspace.id]));
    setErrorMessage("");
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : String(error));
  }
}

async function handleThreadMenuAction(action: string, workspace: WorkspaceCatalogItem, thread: WorkspaceThreadRecord) {
  setThreadContextMenu(null);

  switch (action) {
    case "pin":
      setPinnedThreadIds((current) => {
        const next = new Set(current);
        if (next.has(thread.id)) {
          next.delete(thread.id);
        } else {
          next.add(thread.id);
        }
        return next;
      });
      return;
    case "rename":
      await renameThreadFromMenu(workspace, thread);
      return;
    case "archive":
      setArchivedThreadIds((current) => new Set([...current, thread.id]));
      if (api) {
        const nextCatalog = await api.archiveWorkspaceThread({ workspaceId: workspace.id, threadId: thread.id, archived: true });
        setWorkspaceCatalog(normalizeWorkspaceCatalog(nextCatalog));
      }
      if (selectedThreadId === thread.id) {
        const nextThread = workspace.threads.find((item) => item.id !== thread.id && !item.archived && !archivedThreadIds.has(item.id));
        setSelectedThreadId(nextThread?.id ?? "");
      }
      return;
    case "unread":
      setUnreadThreadIds((current) => {
        const next = new Set(current);
        if (next.has(thread.id)) {
          next.delete(thread.id);
        } else {
          next.add(thread.id);
        }
        return next;
      });
      return;
    case "explorer":
      if (api) setChatStatus((await api.openWorkspaceLocation({ workspaceId: workspace.id, target: "explorer" })).detail);
      return;
    case "side-chat":
      setPreviewMode?.("chat");
      setPreviewPlacement?.("side");
      return;
    case "copy-dir":
      writeClipboard(workspace.path);
      return;
    case "copy-id":
      writeClipboard(thread.id);
      return;
    case "copy-link":
      writeClipboard(`newbrain://workspace/${workspace.id}/thread/${thread.id}`);
      return;
    case "fork-local":
      await forkThreadFromMenu(workspace, thread, false);
      return;
    case "fork-worktree":
      await forkThreadFromMenu(workspace, thread, true);
      return;
    case "new-window":
      window.open(window.location.href, "_blank", "noopener,noreferrer");
      return;
    case "schedule-task": {
      setSelectedWorkspaceId(workspace.id);
      setSelectedThreadId(thread.id);
      setIsComposingNewThread(false);
      setActiveFeature("new-chat");
      setQuestion(`请帮我为对话「${thread.title || "当前对话"}」创建一个自动化计划任务：说明触发时间和要执行的内容。`);
      if (typeof ctx.setComposerSkillContext === "function") {
        ctx.setComposerSkillContext("Automation Creator");
      }
      if (typeof ctx.setNewThreadScope === "function") {
        ctx.setNewThreadScope("project");
      }
      if (typeof ctx.setChatUsesProject === "function") {
        ctx.setChatUsesProject(true);
      }
      if (typeof ctx.setSelectedSidebarRow === "function") {
        ctx.setSelectedSidebarRow(`chat:${workspace.id}:${thread.id}`);
      }
      setChatStatus("已进入 Automation Creator：发送后将创建计划任务，并继续在对话中确认细节。");
      return;
    }
    case "export-html": {
      if (!api?.exportWorkspaceThreadHtml) {
        setErrorMessage("当前版本不支持导出对话 HTML。");
        return;
      }
      try {
        setChatStatus("正在导出对话为 HTML…");
        const liveMessages = selectedThreadId === thread.id
          ? (chatMessages ?? [])
              .filter((message) =>
                message.role === "user"
                || message.role === "assistant"
                || message.role === "tool"
                || message.role === "system"
              )
              .map((message) => ({
                id: message.id,
                role: message.role,
                content: message.content ?? "",
                createdAt: message.createdAt ?? "",
                reasoningSummary: message.reasoningSummary,
                attachments: message.attachments
              }))
          : undefined;
        const result = await api.exportWorkspaceThreadHtml({
          workspaceId: workspace.id,
          threadId: thread.id,
          liveMessages: liveMessages?.length ? liveMessages : undefined
        });
        if (result.canceled) {
          setChatStatus("已取消导出");
          return;
        }
        if (!result.ok) {
          setErrorMessage(result.detail || "导出对话失败。");
          setChatStatus("导出对话失败");
          return;
        }
        setChatStatus(`已导出对话到 ${result.path || "所选位置"}`);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
        setChatStatus("导出对话失败");
      }
      return;
    }
    default:
      return;
  }
}

// threadId 缺省取当前选中线程；调用方若知道快照所属线程必须显式传入，避免消息写入错误线程。
function syncSnapshot(nextSnapshot: PhaseOneSnapshot, threadId = selectedThreadId) {
  setSnapshot(nextSnapshot);

  const nextChatMessages = nextSnapshot.messages
    .filter(
      (message): message is typeof message & { role: "user" | "assistant" } =>
        message.role === "user" || message.role === "assistant"
    )
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      reasoningSummary: message.reasoningSummary,
      excludeFromModelContext: message.excludeFromModelContext,
      createdAt: message.createdAt,
      attachments: message.attachments
    }));

  if (threadId) {
    updateThreadMessages(
      threadId,
      (current) => reconcileThreadDisplayMessages(current, nextChatMessages),
      { display: true }
    );
  } else {
    setChatMessages(nextChatMessages);
  }

  const nextTree = buildWorkspaceTree(nextSnapshot.workspace);
  const directoryPaths = collectDirectoryKeys(nextTree);
  setExpandedPaths((current) => {
    const merged = new Set(current);
    for (const path of directoryPaths) {
      merged.add(path);
    }
    return merged;
  });
}

function resetFeatureDraft(kind: ManagedFeatureKind) {
  setEditingFeatureId("");
  if (kind === "skills") {
    setSkillDraft({ ...initialDraft, status: "enabled" });
    return;
  }
  if (kind === "plugins") {
    setPluginDraft({ ...initialDraft, status: "connected" });
    return;
  }
  setAutomationDraft({
    ...initialDraft,
    status: "idle",
    workspaceId: selectedWorkspace?.id ?? "",
    threadId: selectedThread?.id ?? "",
    runtime: "worktree",
    targetType: "project",
    schedule: "daily",
    model: modelConfig.model,
    reasoning: modelConfig.reasoningEffort,
    prompt: ""
  });
}

function loadFeatureDraft(kind: ManagedFeatureKind, item: SkillSpec | PluginSpec | AutomationSpec) {
  setEditingFeatureId(item.id);
  if (kind === "skills") {
    const skill = item as SkillSpec;
    setSkillDraft({
      ...initialDraft,
      name: skill.name,
      summary: skill.summary,
      status: skill.status === "disabled" ? "disabled" : "enabled",
      source: skill.source ?? "",
      icon: skill.icon ?? "",
      path: skill.path ?? ""
    });
    return;
  }
  if (kind === "plugins") {
    const plugin = item as PluginSpec;
    setPluginDraft({
      ...initialDraft,
      id: plugin.id,
      name: plugin.name,
      summary: plugin.summary,
      status: plugin.status,
      version: plugin.version ?? "",
      source: plugin.source ?? "",
      manifestPath: plugin.manifestPath ?? "",
      capabilities: plugin.capabilities ?? []
    });
    return;
  }
  const automation = item as AutomationSpec;
  setAutomationDraft({
    ...initialDraft,
    title: automation.title,
    trigger: automation.trigger,
    status: automation.status,
    workspaceId: automation.workspaceId ?? selectedWorkspace?.id ?? "",
    threadId: automation.threadId ?? selectedThread?.id ?? "",
    action: automation.action ?? "workspace_scan",
    intervalMinutes: String(automation.intervalMinutes ?? 30),
    dailyTime: automation.dailyTime ?? "",
    runtime: automation.runtime ?? "worktree",
    targetType: automation.targetType ?? (automation.threadId ? "thread" : "project"),
    schedule: automation.schedule ?? "daily",
    model: automation.model ?? modelConfig.model,
    reasoning: automation.reasoning ?? modelConfig.reasoningEffort,
    template: automation.template ?? "",
    prompt: automation.prompt ?? automation.trigger ?? "",
    sandboxRule: automation.sandboxRule ?? "default"
  });
}

async function runAction(action: () => Promise<PhaseOneSnapshot>) {
  try {
    const nextSnapshot = await action();
    syncSnapshot(nextSnapshot);
    await refreshCatalog();
    setErrorMessage("");
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function refreshCatalog() {
  if (!api) {
    return;
  }

  try {
    const catalog = await api.listWorkspaces();
    setWorkspaceCatalog(normalizeWorkspaceCatalog(catalog));

    if (!selectedWorkspaceId && catalog[0]) {
      setSelectedWorkspaceId(catalog[0].id);
      setExpandedWorkspaceIds(new Set([catalog[0].id]));
      const recentThread = resolveUserVisibleThreadSelection(catalog[0].threads, null);
      if (recentThread) {
        setSelectedThreadId(recentThread.id);
      }
    }
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : String(error));
  }
}

useEffect(() => {
  document.documentElement.dataset.theme = "light";
}, []);

useEffect(() => {
  if (!api || authStatus.authenticated || authStatus.loading || !authStatus.last_error) {
    return;
  }

  let canceled = false;
  const retry = () => {
    api.getAuthStatus().then((nextStatus) => {
      if (!canceled) setAuthStatus(nextStatus);
    }).catch(() => {
      // Keep the persisted/fallback status visible and retry while the local auth IPC is transiently unavailable.
    });
  };
  const timer = window.setInterval(retry, 1_500);
  retry();
  return () => {
    canceled = true;
    window.clearInterval(timer);
  };
}, [api, authStatus.authenticated, authStatus.last_error, authStatus.loading]);

useEffect(() => {
  if (!threadContextMenu) {
    return;
  }

  function closeContextMenu() {
    setThreadContextMenu(null);
  }

  window.addEventListener("click", closeContextMenu);
  window.addEventListener("keydown", closeContextMenu);

  return () => {
    window.removeEventListener("click", closeContextMenu);
    window.removeEventListener("keydown", closeContextMenu);
  };
}, [threadContextMenu]);

useEffect(() => {
  if (!showAccountMenu) {
    return;
  }

  function closeAccountMenu() {
    setShowAccountMenu(false);
  }

  window.addEventListener("click", closeAccountMenu);
  window.addEventListener("keydown", closeAccountMenu);

  return () => {
    window.removeEventListener("click", closeAccountMenu);
    window.removeEventListener("keydown", closeAccountMenu);
  };
}, [showAccountMenu]);

useEffect(() => {
  if (!window.newbrain) {
    setBootstrapState("未检测到 Electron preload API，当前只显示静态界面。");
    return;
  }

  const codecnApi = window.newbrain;
  let mounted = true;

  async function load() {
    try {
      const bootstrap = await withTimeout(codecnApi.bootstrap(), 6000, "本地 runtime 初始化");
      let nextAuthStatus = { ...initialDesktopAuthStatus, loading: false, last_error: "认证状态读取失败" };
      for (let attempt = 1; attempt <= 8; attempt += 1) {
        try {
          nextAuthStatus = await withTimeout(codecnApi.getAuthStatus(), 6_000, "认证状态读取");
          break;
        } catch {
          if (attempt < 8) await new Promise((resolveDelay) => window.setTimeout(resolveDelay, 1_000));
        }
      }
      const [nextSnapshot, catalog, model, preferences, features, servers, discoveredTools, nextDesktopBootstrapStatus] = await Promise.all([
        optionalLoad(codecnApi.getSnapshot(), emptySnapshot, "会话快照读取"),
        optionalLoad(codecnApi.listWorkspaces(), [], "工作区列表读取"),
        optionalLoad(codecnApi.getModelConfig(), initialModelConfig, "模型配置读取"),
        optionalLoad(codecnApi.getDesktopPreferences(), initialDesktopPreferences, "桌面偏好读取"),
        optionalLoad(codecnApi.getFeatureConfig(), initialFeatureConfig, "功能配置读取"),
        optionalLoad(codecnApi.getMcpServers(), [], "MCP 配置读取"),
        optionalLoad(codecnApi.getMcpDiscoveredTools(), [], "MCP 工具读取"),
        optionalLoad(codecnApi.getDesktopBootstrapStatus(), desktopBootstrapStatus, "环境初始化状态读取")
      ]);

      if (!mounted) {
        return;
      }

      setBootstrapState(`${bootstrap.appName} · ${bootstrap.platform} · ${bootstrap.shell}`);
      setWorkspaceCatalog(normalizeWorkspaceCatalog(catalog));
      setModelConfig(model);
      if (codecnApi.listCustomModelEndpoints) {
        void codecnApi.listCustomModelEndpoints().then((snapshot) => {
          const selected = snapshot?.endpoints?.find((item) => item.id === snapshot.selectedId);
          if (!mounted || !selected) return;
          setModelConfig((current) => ({
            ...current,
            model: selected.id,
            provider: selected.label,
            baseUrl: selected.baseUrl,
            wireApi: selected.wireApi || "chat.completions",
            apiKey: ""
          }));
        }).catch(() => undefined);
      }
      setDesktopPreferences(preferences);
      applyVisualPreferences(preferences);
      setShellCommand(preferences.git.statusCommand);
      setEnvironmentEnvText(formatEnvText(preferences.environment.extraEnv));
      setFeatureConfig(features);
      setMcpServers(servers.map(toMcpServerState));
      setMcpDiscoveredTools(discoveredTools);
      void codecnApi.getSystemTools().then(setSystemTools).catch(() => setSystemTools([]));
      setAuthStatus(nextAuthStatus);
      setDesktopBootstrapStatus(nextDesktopBootstrapStatus);
      // A restored desktop login must resume an interrupted environment bootstrap.
      // Reading and polling persisted state alone leaves stale "running" tasks stuck forever.
      if (nextAuthStatus.authenticated && nextDesktopBootstrapStatus.overall.status !== "ready") {
        void codecnApi
          .startDesktopBootstrap()
          .then((nextStatus) => {
            if (mounted) {
              setDesktopBootstrapStatus(nextStatus);
            }
          })
          .catch((error) => {
            if (mounted) {
              setErrorMessage(error instanceof Error ? error.message : String(error));
            }
          });
      }
      setLoginForm((current) => ({
        ...current,
        agreementAccepted: nextAuthStatus.agreement?.enabled ? current.agreementAccepted : true
      }));

      if (catalog[0]) {
        // 优先恢复上次关闭前选中的项目/线程，找不到时再回退到第一个。
        let lastWorkspaceId = "";
        let lastThreadId = "";
        try {
          lastWorkspaceId = localStorage.getItem("newbrain.lastSelectedWorkspaceId.v1") || "";
          lastThreadId = localStorage.getItem("newbrain.lastSelectedThreadId.v1") || "";
        } catch {
          // 忽略读取失败
        }
        const restoredWorkspace = catalog.find((workspace) => workspace.id === lastWorkspaceId) ?? catalog[0];
        const restoredThread =
          resolveUserVisibleThreadSelection(restoredWorkspace.threads, lastThreadId);
        setExpandedWorkspaceIds(new Set([restoredWorkspace.id]));
        if (restoredThread) {
          try {
            await restoreStartupThreadSnapshot({
              api: codecnApi,
              workspaceId: restoredWorkspace.id,
              threadId: restoredThread.id,
              syncSnapshot
            });
            setSelectedWorkspaceId(restoredWorkspace.id);
            setSelectedThreadId(restoredThread.id);
            setIsComposingNewThread(false);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setSelectedWorkspaceId(restoredWorkspace.id);
            if (isMissingWorkspaceSelectionError(message)) {
              setSelectedThreadId("");
              setIsComposingNewThread(true);
              syncSnapshot(nextSnapshot);
              setErrorMessage("原项目或任务已不存在，已恢复到可用工作区。");
            } else {
              throw error;
            }
          }
        } else {
          setSelectedWorkspaceId(restoredWorkspace.id);
          setSelectedThreadId("");
          setIsComposingNewThread(true);
          syncSnapshot(nextSnapshot);
        }
      } else {
        setSelectedWorkspaceId("");
        setSelectedThreadId("");
        setExpandedWorkspaceIds(new Set());
        setIsComposingNewThread(true);
        syncSnapshot(nextSnapshot);
      }
    } catch (error) {
      if (mounted) {
        setBootstrapState("本地 runtime 初始化失败");
        setAuthStatus((current) => ({ ...current, loading: false }));
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }
  }

  void load();

  return () => {
    mounted = false;
  };
}, []);

useEffect(() => {
  if (!api) {
    return;
  }

  if (!isBootstrapBlocking) {
    return;
  }

  let canceled = false;
  const poll = () => {
    api
      .getDesktopBootstrapStatus()
      .then((nextStatus) => {
        if (!canceled) {
          setDesktopBootstrapStatus(nextStatus);
        }
      })
      .catch((error) => {
        if (!canceled) {
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      });
  };

  poll();
  const timer = window.setInterval(poll, 1200);
  return () => {
    canceled = true;
    window.clearInterval(timer);
  };
}, [api, isBootstrapBlocking]);

useEffect(() => {
  if (!api || !searchQuery.trim()) {
    setSearchResults([]);
    return;
  }

  let canceled = false;
  const handle = window.setTimeout(() => {
    api
      .searchWorkspaces(searchQuery.trim())
      .then((results) => {
        if (!canceled) {
          setSearchResults(results);
        }
      })
      .catch((error) => {
        if (!canceled) {
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      });
  }, 180);

  return () => {
    canceled = true;
    window.clearTimeout(handle);
  };
}, [api, searchQuery]);

useEffect(() => {
  if (loginCodeCooldownSeconds <= 0) {
    return;
  }

  const timer = window.setTimeout(() => {
    setLoginCodeCooldownSeconds((current) => (current > 0 ? current - 1 : 0));
  }, 1000);

  return () => window.clearTimeout(timer);
}, [loginCodeCooldownSeconds]);

useEffect(() => {
  applyVisualPreferences(desktopPreferences);
}, [desktopPreferences.appearance.theme, desktopPreferences.appearance.density, desktopPreferences.appearance.reduceMotion, desktopPreferences.appearance.accentColor, desktopPreferences.appearance.backgroundColor, desktopPreferences.appearance.foregroundColor, desktopPreferences.appearance.uiFontFamily, desktopPreferences.appearance.codeFontFamily, desktopPreferences.appearance.contrast, desktopPreferences.appearance.uiFontSize, desktopPreferences.appearance.codeFontSize, desktopPreferences.appearance.sidebarTranslucent, desktopPreferences.appearance.pointerCursor, desktopPreferences.appearance.diffMarks]);

useEffect(() => {
  if (!window?.addEventListener) return;
  let saveTimer = 0;
  let pendingPreferences = null;
  const flushFontZoomSave = () => {
    if (!pendingPreferences) return;
    const next = pendingPreferences;
    pendingPreferences = null;
    void saveDesktopPreferences(next, {
      statusMessage: `字体 ${next.appearance.uiFontSize}px（Ctrl+滚轮缩放）`
    });
  };
  const onWheel = (event) => {
    if (!shouldHandleFontZoomWheel(event)) return;
    event.preventDefault();
    const direction = resolveFontZoomDirection(event.deltaY);
    if (!direction) return;
    setDesktopPreferences((current) => {
      const nextSizes = scaleAppearanceFontSizes(current.appearance, direction);
      if (
        nextSizes.uiFontSize === current.appearance.uiFontSize
        && nextSizes.codeFontSize === current.appearance.codeFontSize
      ) {
        setChatStatus(
          direction > 0
            ? `已到最大字号 ${current.appearance.uiFontSize}px`
            : `已到最小字号 ${current.appearance.uiFontSize}px`
        );
        return current;
      }
      const next = {
        ...current,
        appearance: {
          ...current.appearance,
          ...nextSizes
        }
      };
      applyVisualPreferences(next);
      setChatStatus(`字体 ${nextSizes.uiFontSize}px`);
      pendingPreferences = next;
      if (saveTimer) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(flushFontZoomSave, 280);
      return next;
    });
  };
  window.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    window.removeEventListener("wheel", onWheel);
    if (saveTimer) window.clearTimeout(saveTimer);
    flushFontZoomSave();
  };
}, [api, setDesktopPreferences, setChatStatus]);

useEffect(() => {
  if (desktopPreferences.appearance.theme !== "system" || !window.matchMedia) {
    return;
  }
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const listener = () => applyVisualPreferences(desktopPreferences);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}, [desktopPreferences]);

useEffect(() => {
  if (!api || !shouldAutoOpenPreview) {
    return;
  }
  void api.openBrowserPreview(desktopPreferences.browser.previewUrl).catch((error) => {
    setErrorMessage(error instanceof Error ? error.message : String(error));
  });
}, [api, desktopPreferences.browser.previewUrl, shouldAutoOpenPreview]);

useEffect(() => {
  if (!api || activeSettingsSection !== "mcp") {
    return;
  }

  const enabledServers = mcpServers.filter((server) => server.enabled);
  if (enabledServers.length === 0) {
    return;
  }

  const poll = () => {
    for (const server of enabledServers) {
      void api
        .testMcpServer(parseMcpDraft(server))
        .then((result) => {
          setMcpHealth((current) => ({ ...current, [server.id]: result }));
        })
        .catch((error) => {
          const detail = error instanceof Error ? error.message : String(error);
          setMcpHealth((current) => ({
            ...current,
            [server.id]: {
              ok: false,
              code: "poll_failed",
              detail,
              checkedAt: new Date().toISOString(),
              running: false
            }
          }));
        });
    }
  };

  poll();
  const timer = window.setInterval(poll, 30_000);
  return () => window.clearInterval(timer);
}, [activeSettingsSection, api, mcpServers]);

useEffect(() => {
  if (!api || !expandedMcpLogId) {
    return;
  }

  let canceled = false;
  const loadLogs = () => {
    void api.getMcpServerLogs(expandedMcpLogId).then((logs) => {
      if (!canceled) {
        setMcpLogs((current) => ({ ...current, [expandedMcpLogId]: logs }));
      }
    }).catch((error) => {
      if (!canceled) {
        const detail = error instanceof Error ? error.message : String(error);
        setMcpLogs((current) => ({
          ...current,
          [expandedMcpLogId]: [
            ...current[expandedMcpLogId] ?? [],
            `[${new Date().toISOString()}] Failed to load MCP logs: ${detail}`
          ].slice(-200)
        }));
      }
    });
  };

  loadLogs();
  const timer = window.setInterval(loadLogs, 2000);
  return () => {
    canceled = true;
    window.clearInterval(timer);
  };
}, [api, expandedMcpLogId]);

const activateThreadSeqRef = useRef(0);

useEffect(() => {
  if (!api || isComposingNewThread || !selectedWorkspace?.id || !selectedThread?.id || activeThreadRequestIds[selectedThread.id]) {
    return;
  }

  const activationSeq = ++activateThreadSeqRef.current;
  const activatingThreadId = selectedThread.id;

  void api.activateWorkspaceThread({
      workspaceId: selectedWorkspace.id,
      threadId: activatingThreadId
    })
    .then((nextSnapshot) => {
      if (activationSeq !== activateThreadSeqRef.current) return;
      syncSnapshot(nextSnapshot, activatingThreadId);
      return refreshCatalog();
    })
    .then(() => setErrorMessage(""))
    .catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!isMissingWorkspaceSelectionError(message)) {
        setErrorMessage(message);
        return;
      }
      try {
        const catalog = await api.listWorkspaces();
        setWorkspaceCatalog(normalizeWorkspaceCatalog(catalog));
        const workspace = catalog.find((item: any) => item.id === selectedWorkspace.id) ?? catalog[0];
        const recentThread = resolveUserVisibleThreadSelection(workspace?.threads ?? [], null);
        if (workspace && recentThread) {
          setSelectedWorkspaceId(workspace.id);
          setSelectedThreadId(recentThread.id);
        } else {
          setSelectedWorkspaceId(workspace?.id ?? "");
          setSelectedThreadId("");
          setIsComposingNewThread(true);
        }
        setErrorMessage("原任务已不存在，已恢复到可用工作区。请新建任务或选择其他任务。");
      } catch (recoveryError) {
        setSelectedThreadId("");
        setIsComposingNewThread(true);
        setErrorMessage(
          recoveryError instanceof Error
            ? `任务恢复失败：${recoveryError.message}`
            : `任务恢复失败：${String(recoveryError)}`
        );
      }
    });
}, [api, isComposingNewThread, selectedWorkspace?.id, selectedThread?.id, activeThreadRequestIds]);

useEffect(() => {
  setEditingThreadTitle(selectedThread?.title ?? "");
  setEditingThreadSummary(selectedThread?.summary ?? "");
  setForkThreadTitle(selectedThread ? `${selectedThread.title} 分叉` : "");
}, [selectedThread?.id]);

async function createWorkspace() {
  if (!api || !newWorkspaceName.trim() || !newWorkspacePath.trim()) {
    return;
  }

  try {
    const nextCatalog = await api.addWorkspace({
      name: newWorkspaceName.trim(),
      path: newWorkspacePath.trim()
    });
    setWorkspaceCatalog(normalizeWorkspaceCatalog(nextCatalog));
    const newest = nextCatalog[0];
    if (newest) {
      setSelectedWorkspaceId(newest.id);
      setExpandedWorkspaceIds((current) => new Set([...current, newest.id]));
    }
    setNewWorkspaceName("");
    setNewWorkspacePath("");
    setErrorMessage("");
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : String(error));
  }
}

async function createThread() {
  if (!api || !selectedWorkspaceId) {
    return;
  }

  const titleText = newThreadTitle.trim() || "新线程";
  const summaryText = newThreadSummary.trim() || "从当前项目空间创建的新上下文线程。";

  try {
    const nextCatalog = await api.addWorkspaceThread({
      workspaceId: selectedWorkspaceId,
      title: titleText,
      summary: summaryText,
      scope: newThreadScope === "chat" ? "chat" : "project"
    });
    setWorkspaceCatalog(normalizeWorkspaceCatalog(nextCatalog));
    const currentWorkspace = nextCatalog.find((workspace) => workspace.id === selectedWorkspaceId);
    const newestThread = resolveUserVisibleThreadSelection(currentWorkspace?.threads ?? [], null);
    if (newestThread) {
      setSelectedThreadId(newestThread.id);
    }
    if (desktopPreferences.worktree.defaultIsolated) {
      const result = await api.createWorkspaceWorktree({
        workspaceId: selectedWorkspaceId,
        branchName: `${desktopPreferences.git.branchPrefix}${titleText.replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase()}`
      });
      setChatStatus(result.detail);
    }
    setNewThreadTitle("");
    setNewThreadSummary("");
    setActiveFeature("new-chat");
    setErrorMessage("");
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : String(error));
  }
}

async function forkThread() {
  if (!api || !selectedWorkspaceId || !selectedThreadId) {
    return;
  }

  try {
    const nextCatalog = await api.forkWorkspaceThread({
      workspaceId: selectedWorkspaceId,
      sourceThreadId: selectedThreadId,
      title: forkThreadTitle.trim() || `${selectedThread?.title ?? "当前线程"} 分叉`
    });
    setWorkspaceCatalog(normalizeWorkspaceCatalog(nextCatalog));
    const currentWorkspace = nextCatalog.find((workspace) => workspace.id === selectedWorkspaceId);
    const newestThread = resolveUserVisibleThreadSelection(currentWorkspace?.threads ?? [], null);
    if (newestThread) {
      setSelectedThreadId(newestThread.id);
    }
    if (desktopPreferences.worktree.defaultIsolated) {
      const result = await api.createWorkspaceWorktree({
        workspaceId: selectedWorkspaceId,
        branchName: `${desktopPreferences.git.branchPrefix}${(forkThreadTitle.trim() || selectedThread?.title || "thread").replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase()}`
      });
      setChatStatus(result.detail);
    }
    setErrorMessage("");
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : String(error));
  }
}

async function renameThread() {
  if (!api || !selectedWorkspaceId || !selectedThreadId || !editingThreadTitle.trim()) {
    return;
  }

  try {
    const nextCatalog = await api.renameWorkspaceThread({
      workspaceId: selectedWorkspaceId,
      threadId: selectedThreadId,
      title: editingThreadTitle.trim(),
      summary: editingThreadSummary.trim()
    });
    setWorkspaceCatalog(normalizeWorkspaceCatalog(nextCatalog));
    ctx.setShowRenameThreadDialog?.(false);
    setErrorMessage("");
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : String(error));
  }
}

async function deleteThread() {
  if (!api || !selectedWorkspaceId || !selectedThreadId) {
    return;
  }

  try {
    const nextCatalog = await api.deleteWorkspaceThread({
      workspaceId: selectedWorkspaceId,
      threadId: selectedThreadId
    });
    setWorkspaceCatalog(normalizeWorkspaceCatalog(nextCatalog));
    const currentWorkspace = nextCatalog.find((workspace) => workspace.id === selectedWorkspaceId);
    setSelectedThreadId(resolveUserVisibleThreadSelection(currentWorkspace?.threads ?? [], null)?.id ?? "");
    setErrorMessage("");
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : String(error));
  }
}

async function saveFeature(kind: ManagedFeatureKind) {
  if (!api) {
    return false;
  }

  const draft = kind === "skills" ? skillDraft : kind === "plugins" ? pluginDraft : automationDraft;
  const schedule = String(draft.schedule || "").trim();
  let intervalMinutes = String(draft.intervalMinutes || "").trim();
  const dailyTime = String((draft as { dailyTime?: string }).dailyTime || "").trim();
  if (kind === "automations") {
    if (!intervalMinutes || intervalMinutes === "30") {
      if (schedule === "hourly") intervalMinutes = "60";
      else if (schedule === "daily") intervalMinutes = "1440";
      else if (schedule === "weekly") intervalMinutes = String(7 * 1440);
    }
  }
  const item: Record<string, string> = {
    name: draft.name,
    summary: draft.summary,
    status: kind === "automations" ? (draft.status || "scheduled") : draft.status,
    version: draft.version ?? "",
    source: draft.source ?? "",
    manifestPath: draft.manifestPath ?? "",
    path: draft.path ?? "",
    icon: draft.icon ?? "",
    capabilities: Array.isArray(draft.capabilities) ? draft.capabilities.join(",") : "",
    trigger: draft.trigger || draft.prompt,
    title: draft.title,
    workspaceId: draft.workspaceId,
    threadId: draft.threadId,
    action: draft.action === "thread_follow_up" ? "workspace_scan" : draft.action,
    intervalMinutes,
    dailyTime,
    runtime: draft.runtime,
    targetType: draft.targetType,
    schedule,
    model: draft.model,
    reasoning: draft.reasoning,
    template: draft.template,
    prompt: draft.prompt || draft.trigger,
    sandboxRule: draft.sandboxRule,
    rrule: draft.rrule ?? ""
  };

  try {
    const nextConfig = editingFeatureId
      ? await api.updateFeatureItem({ kind, id: editingFeatureId, item })
      : await api.addFeatureItem({ kind, item });

    setFeatureConfig(nextConfig);
    resetFeatureDraft(kind);
    setErrorMessage("");
    return true;
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function removeFeature(kind: ManagedFeatureKind, id: string) {
  if (!api) {
    return;
  }

  try {
    const nextConfig = await api.deleteFeatureItem({ kind, id });
    setFeatureConfig(nextConfig);
    if (editingFeatureId === id) {
      resetFeatureDraft(kind);
    }
    setErrorMessage("");
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : String(error));
  }
}

async function saveModelConfig() {
  if (!api) {
    return;
  }

  try {
    const nextConfig = await api.saveModelConfig(modelConfig);
    setModelConfig(nextConfig);
    setChatStatus("模型配置已保存。");
    setErrorMessage("");
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : String(error));
  }
}

function selectAddedWorkspace(nextCatalog: WorkspaceCatalogItem[], preferredWorkspace?: WorkspaceCatalogItem) {
  setWorkspaceCatalog(normalizeWorkspaceCatalog(nextCatalog));
  const newest = preferredWorkspace ?? nextCatalog.at(-1);
  if (newest) {
    setSelectedWorkspaceId(newest.id);
    const threadId = resolveUserVisibleThreadSelection(newest.threads, null)?.id ?? "";
    setSelectedThreadId(threadId);
    setIsComposingNewThread(!threadId);
    setExpandedWorkspaceIds((current) => new Set([...current, newest.id]));
    setExpandedThreadListWorkspaceIds((current) => new Set([...current, newest.id]));
  }
}

async function createBlankProject(name: string, options?: { brainWorkspaceKey?: string }) {
  if (!api || !name.trim()) {
    return "";
  }

  try {
    const beforeIds = new Set(normalizeWorkspaceCatalog(workspaceCatalog).map((workspace) => workspace.id));
    const nextCatalog = await api.createBlankWorkspace({
      name: name.trim(),
      ...(options?.brainWorkspaceKey ? { brainWorkspaceKey: options.brainWorkspaceKey as any } : {})
    });
    const normalized = normalizeWorkspaceCatalog(nextCatalog);
    const createdWorkspace = normalized.find((workspace) => !beforeIds.has(workspace.id)) ?? normalized.at(-1);
    try {
      selectAddedWorkspace(normalized, createdWorkspace);
    } catch (selectionError) {
      console.error("[project-create] project created but selection sync failed", selectionError);
      setWorkspaceCatalog(normalized);
    }
    setErrorMessage("");
    return createdWorkspace?.id ?? "";
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : String(error));
    return "";
  }
}

async function addExistingProject(options?: { brainWorkspaceKey?: string }) {
  if (!api) {
    return "";
  }

  try {
    const path = await api.selectWorkspaceFolder();
    if (!path) {
      return "";
    }
    const name = path.split(/[\\/]/).filter(Boolean).at(-1) || "新项目";
    const nextCatalog = await api.addWorkspace({
      name,
      path,
      ...(options?.brainWorkspaceKey ? { brainWorkspaceKey: options.brainWorkspaceKey as any } : {})
    });
    const normalizedPath = path.replace(/[\\/]+$/, "").toLowerCase();
    const addedWorkspace = nextCatalog.find(
      (workspace) => workspace.path.replace(/[\\/]+$/, "").toLowerCase() === normalizedPath
    );
    selectAddedWorkspace(nextCatalog, addedWorkspace);
    setErrorMessage("");
    return addedWorkspace?.id ?? "";
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : String(error));
    return "";
  }
}

async function saveDesktopPreferences(nextPreferences = desktopPreferences, options = {}) {
  if (!api) {
    return;
  }

  try {
    const payload = {
      ...initialDesktopPreferences,
      ...nextPreferences,
      personalization: { ...initialDesktopPreferences.personalization, ...nextPreferences.personalization },
      permissions: { ...initialDesktopPreferences.permissions, ...nextPreferences.permissions },
      editor: { ...initialDesktopPreferences.editor, ...nextPreferences.editor },
      popup: { ...initialDesktopPreferences.popup, ...nextPreferences.popup },
      dictation: { ...initialDesktopPreferences.dictation, ...nextPreferences.dictation },
      notifications: { ...initialDesktopPreferences.notifications, ...nextPreferences.notifications },
      shortcuts: { ...(initialDesktopPreferences.shortcuts || {}), ...(nextPreferences.shortcuts || {}) },
      market: { ...initialDesktopPreferences.market, ...nextPreferences.market },
      brain: { ...initialDesktopPreferences.brain, ...nextPreferences.brain },
      environment: {
        ...initialDesktopPreferences.environment,
        ...nextPreferences.environment,
        extraEnv: parseEnvText(environmentEnvText)
      }
    };
    const saved = await api.saveDesktopPreferences(payload);
    setDesktopPreferences(saved);
    applyVisualPreferences(saved);
    setEnvironmentEnvText(formatEnvText(saved.environment.extraEnv));
    setShellCommand(saved.git.statusCommand);
    if (options.statusMessage !== null) {
      setChatStatus(options.statusMessage ?? "设置已保存并立即生效。");
    }
    setErrorMessage("");
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : String(error));
  }
}

async function handleRetryCondaBootstrap() {
  if (!api) {
    return;
  }

  setIsRetryingCondaBootstrap(true);
  try {
    const nextStatus = await api.retryDesktopCondaBootstrap();
    const nextCatalog = await api.listWorkspaces();
    const nextSnapshot = await api.getSnapshot();
    setDesktopBootstrapStatus(nextStatus);
    setWorkspaceCatalog(normalizeWorkspaceCatalog(nextCatalog));
    syncSnapshot(nextSnapshot);
    setErrorMessage("");
    setChatStatus(
      nextStatus.conda.status === "ready"
        ? "conda 初始化已完成。"
        : "conda 仍需手动安装，请按提示先完成宿主机安装。"
    );
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : String(error));
  } finally {
    setIsRetryingCondaBootstrap(false);
  }
}

return {
  writeClipboard,
  applyVisualPreferences,
  buildPersonalizedSystemPrompt,
  shouldArchiveDeleteThread,
  archivedThreads,
  toMcpServerState,
  parseMcpDraft,
  sortThreadsForMenu,
  renameThreadFromMenu,
  forkThreadFromMenu,
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
};
}
