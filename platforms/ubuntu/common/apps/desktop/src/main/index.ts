import { app, BrowserWindow, globalShortcut, ipcMain, net, protocol, screen } from "electron";
import { Menu, nativeTheme, type MenuItemConstructorOptions } from "electron";
import { safeStorage } from "electron";
import { dialog } from "electron";
import { shell as electronShell } from "electron";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams, type ChildProcessWithoutNullStreams as ShellChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, promises as fs, watch, type FSWatcher } from "node:fs";
import { createServer, type Server as HttpServer } from "node:http";
import * as os from "node:os";
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  AutomationSpec,
  ChatMessage,
  CommandRun,
  MemoryRecord,
  MobilePairingState,
  PluginSpec,
  RendererFailureInput,
  SearchResultSpec,
  SkillSpec,
  WorkspaceCatalogItem,
  WorkspaceThreadRecord,
  WorkspaceTimelineEvent
} from "@codex-forge/protocol";
import { isBrainWorkspaceKey } from "@codex-forge/protocol";
import { createLocalRuntime } from "../../../agentd/src/runtime.js";
import { applyLoginItemSettings } from "./login-item-settings.js";
import { deliverStartupDailyBriefing, setDailyBriefingChatHost } from "./daily-briefing-delivery.js";
import { CodexStorage } from "./codex-storage.js";
import { resolveElectronAppVersion } from "./resolve-app-version.js";
import { BrainWorkspaceStorage } from "./brain-workspace-storage.js";
import { registerBrainWorkspaceIpcHandlers } from "./brain-workspace-ipc.js";
import { confirmBrainSceneUiAction } from "./brain-scene-auto-confirm.js";
import { QuantSimulationService } from "./quant-simulation-service.js";
import { resolveBrainMarketDataUrl } from "./brain-market-data-url.js";
import { DesktopMarketBarsClient } from "./desktop-market-bars-client.js";
import { DesktopMarketOverviewClient } from "./desktop-market-overview-client.js";
import { DesktopWebSearchClient } from "./desktop-web-search-client.js";
import { QuantStrategyScheduler } from "./quant-strategy-scheduler.js";
import { FlowScheduler } from "./flow-scheduler.js";
import { QuantStrategyTaskRunner } from "./quant-strategy-task-runner.js";
import { ChinaMarketCalendarService, parseConfiguredMarketHolidays } from "./market-calendar-service.js";
import { DocumentWorkerProcess } from "./document-worker-process.js";
import { readTextWithTransientRetry, recoverDurableText, restoreTextFile, writeTextAtomically } from "./atomic-file.js";
import { executeDelegatedModelStep } from "./delegated-model-step.js";
import { ModelChatStepService } from "./model-chat-step-service.js";
import {
  containsPrivatePlanningNarration,
  extractPrivatePlanningNarration,
  sanitizeVisibleModelContent
} from "./model-stream-visibility.js";
import { syncDesktopControlPlane as syncDesktopControlPlaneProtocol } from "./desktop-control-plane.js";
import { decodeMcpMessages, encodeMcpMessage } from "./mcp-framing.js";
import {
  appendUrlCitations,
  extractChatEnvelope,
  extractChatEnvelopeFromSse,
  extractResponsesEnvelope,
  extractResponsesEnvelopeFromSse,
  formatModelGatewayError,
  formatModelNetworkError,
  formatToolDefinitions
} from "./openai-wire.js";
import { reconcileThreadMessages } from "./thread-message-reconciliation.js";
import { builtinPluginCatalog, builtinPluginUri } from "../shared/builtin-plugins.js";
import {
  resolveLoginCeremonyAuthFields,
  shouldInvalidateLocalAuthForLoginCeremony
} from "../shared/login-ceremony-policy";
import {
  appendRolloutRecords,
  appendStateSnapshotCompacting,
  createRolloutEvent,
  createStateSnapshot,
  readRolloutRecords,
  readLatestStateSnapshot
} from "./rollout-store.js";
import { AgentHostClient } from "./agent-host-client.js";
import { AgentHostLoopBridge } from "./agent-host-loop-bridge.js";
import { createAgentHostQuitCoordinator } from "./agent-host-quit-coordinator.js";
import { AgentTurnControlPlaneService } from "./agent-turn-control-plane.js";
import { composeAndRegisterModelChat } from "./compose-model-chat.js";
import { DesktopErrorCollector } from "./desktop-error-collector.js";
import { DesktopErrorOutbox } from "./desktop-error-outbox.js";
import { DesktopSecretVault } from "./desktop-secret-vault.js";
import { createRememberedLoginStore } from "./remembered-login-store.js";
import { createLinuxSecretProtector } from "./linux-secret-protector.js";
import { CustomModelEndpointStore } from "./custom-model-endpoint-store.js";
import { registerCustomModelEndpointIpc } from "./custom-model-endpoint-ipc.js";
import { isCustomModelSelection } from "../shared/custom-model-endpoint.js";
import { GovernmentWritingSpecificationService } from "./government-writing-specification-service.js";
import { ManagedChildProcessManager } from "./managed-child-process.js";
import { RustCoreClient } from "./rust-core-client.js";
import { RustCoreService } from "./rust-core-service.js";
import { RustCoreToolRouter } from "./rust-core-tool-router.js";
import { resolveUnixRustCoreBinary } from "./rust-core-binary-unix.js";
import {
  publishWorkspaceFilePreviewFromMain
} from "./model-chat-runtime-setup.js";
import { OfficialGovernmentWebService } from "./official-government-web-service.js";
import { createReadAuthorizedDesktopModelConfig } from "./read-authorized-desktop-model-config.js";
import {
  resolveTrustedPrivateModelCredential,
  separatePrivateModelCredential,
  toRendererSafeModelConfig
} from "./private-model-credential-policy.js";
import type { AuthorizedModel } from "./authorized-model-catalog.js";
import { scheduleUserKnowledgeSync } from "./user-knowledge-sync.js";
import { selectModelRequestAuth } from "./model-request-auth-policy.js";
import { NovelTtsService } from "./novel-tts-service.js";
import { registerSystemIpcHandlers } from "./system-ipc.js";
import {
  askBrowserAnnotationDialog,
  askBrowserDownloadApprovalDialog,
  askBrowserHistoryAccessDialog,
  clearNewbrainBrowserSessionData,
  pickBrowserDownloadDirectory,
  pickBrowserDownloadSavePath,
  registerBrowserIpcHandlers
} from "./browser-ipc.js";
import {
  assertBrowserAgentPermission,
  browserOriginFromUrl,
  DEFAULT_BROWSER_USE_PREFERENCES,
  evaluateBrowserToolPolicyDecision,
  normalizeBrowserUsePreferencesPartial,
  resolveBrowserLinkOpenTarget,
  type BrowserUsePreferences
} from "./browser-agent-policy.js";
import {
  clearBrowserHistory,
  listBrowserHistory,
  recordBrowserHistoryVisit,
  removeBrowserHistoryEntry
} from "./browser-history-store.js";
import {
  listBrowserCredentials,
  removeBrowserCredential,
  upsertBrowserCredential
} from "./browser-credentials-store.js";
import {
  listBrowserContacts,
  removeBrowserContact,
  upsertBrowserContact
} from "./browser-contacts-store.js";
import {
  mergeBrowserPermissionsExceptions,
  writeBrowserPermissionsFile
} from "./browser-permissions-store.js";
import { assertBrowserHistoryAccess } from "./browser-history-access.js";
import { writeBrowserScreenshotAnnotation } from "./browser-screenshot-annotation.js";
import { applyBrowserDownloadItemPolicy } from "./browser-download-session.js";
import { attachBrowserCdpIfAllowed, resolveBrowserCdpAccess } from "./browser-cdp-access.js";
import { probeBrowserSiteTools } from "./browser-site-tools.js";
import { BrowserPreviewService, normalizeBrowserPreviewUrl } from "./browser-preview-service.js";

const appDirectory = dirname(fileURLToPath(import.meta.url));
const documentWorkerProcess = new DocumentWorkerProcess({
  appDirectory,
  resourcesPath: process.resourcesPath,
  acquireRustCore: (binding) => getRustCoreService().acquire(binding)
});
protocol.registerSchemesAsPrivileged([
  { scheme: "newbrain-attachment", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

function getPackagedUserDataPath() {
  return join(os.homedir(), ".newbrain");
}

if (app.isPackaged) {
  app.setPath("userData", getPackagedUserDataPath());
}

function resolveWorkspacePath() {
  const configured = process.env.NEWBRAIN_WORKSPACE_PATH?.trim();
  if (configured) {
    return resolve(configured);
  }

  const userNewbrainPath = getPackagedUserDataPath();
  if (existsSync(join(userNewbrainPath, "newbrain.config.json"))) {
    return userNewbrainPath;
  }

  if (app.isPackaged) {
    return app.getPath("userData");
  }

  const seen = new Set<string>();
  for (const start of [process.cwd(), appDirectory]) {
    let current = resolve(start);
    while (!seen.has(current)) {
      seen.add(current);
      if (existsSync(join(current, "newbrain.config.json"))) {
        return current;
      }
      const parent = dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }

  for (const candidate of [join(appDirectory, "..", "..", "..", "..")]) {
    const resolved = resolve(candidate);
    if (existsSync(join(resolved, "newbrain.config.json"))) {
      return resolved;
    }
  }
  return app.getPath("userData");
}

const workspacePath = resolveWorkspacePath();
const desktopDebugLogPath = join(workspacePath, "tmp-desktop-debug.log");
const modelConfigPath = join(workspacePath, "newbrain.config.json");
const workspaceCatalogPath = join(workspacePath, "newbrain.workspaces.json");
const featureConfigPath = join(workspacePath, "newbrain.features.json");
const builtinPluginsRoot = app.isPackaged
  ? join(process.resourcesPath, "plugins")
  : join(app.getAppPath(), "build", "plugins");
const bootstrapConfigPath = join(workspacePath, "newbrain.bootstrap.json");
const workspaceStateRoot = join(workspacePath, ".newbrain");
const privateModelCredentialPath = join(workspaceStateRoot, "credentials", "private-model.credential");
const linuxSecretProtector = createLinuxSecretProtector(safeStorage);
const privateModelCredentialVault = new DesktopSecretVault(
  privateModelCredentialPath,
  linuxSecretProtector
);
const rememberedLoginStore = createRememberedLoginStore(
  join(workspaceStateRoot, "credentials", "remembered-login.credential"),
  linuxSecretProtector
);
const customModelEndpointStore = new CustomModelEndpointStore(
  join(workspaceStateRoot, "credentials", "custom-model-endpoints"),
  linuxSecretProtector
);
const policyRulesPath = join(workspaceStateRoot, "rules", "default.rules.json");
const desktopProfileRoot = join(workspacePath, ".desktop-profile");
const desktopAuthStatePath = join(workspaceStateRoot, "desktop-auth.json");
const desktopDeviceFingerprintPath = join(workspaceStateRoot, "desktop-device.json");
let cachedDesktopDeviceFingerprint: DesktopDeviceFingerprint | null = null;
const desktopControlPlaneStatePath = join(workspaceStateRoot, "desktop-control-plane.json");
const desktopBootstrapStatePath = join(workspaceStateRoot, "desktop-bootstrap.json");
const desktopWorktreeBindingsPath = join(workspaceStateRoot, "worktree-bindings.json");
const desktopPreviewScreenshotPath = join(workspaceStateRoot, "preview-screenshot.png");
const desktopDiagnosticsLogPath = join(workspaceStateRoot, "diagnostics.log");
const authorizedModelsCachePath = join(workspaceStateRoot, "authorized-models.json");
/** Last successfully loaded authorized model catalog for main-agent economics briefing. */
let cachedAuthorizedModels: AuthorizedModel[] = [];
const userSkillRoot = join(workspaceStateRoot, "skills");
const userKnowledgeRoot = join(workspaceStateRoot, "user-knowledge");
const authAuditLogPath = join(workspacePath, "tmp-auth-session.log");
const bundledModelConfigPath = join(process.resourcesPath, "newbrain.config.json");
const bundledFeatureConfigPath = join(process.resourcesPath, "newbrain.features.json");
const bundledBootstrapConfigPath = join(process.resourcesPath, "newbrain.bootstrap.json");
const shellLabel = process.platform === "win32" ? "PowerShell" : process.platform === "linux" ? "bash" : "zsh";
const platformLabel = process.platform === "win32" ? "Windows" : process.platform === "linux" ? "Ubuntu Linux" : "macOS";
const automationTickMs = 60_000;
const configuredGatewayBaseUrlEnv = process.env.NEWBRAIN_MODEL_BASE_URL?.trim() || "";
const productionGatewayBaseUrl = "https://api.sinnauze.cn/v1";
const defaultGatewayBaseUrl = app.isPackaged
  ? productionGatewayBaseUrl
  : "http://127.0.0.1:8790/v1";
const dashboardPath = "/api/dashboard";
const processUuid = randomUUID();
const codexStorage = new CodexStorage(workspaceStateRoot);
const brainWorkspaceStorage = new BrainWorkspaceStorage(workspaceStateRoot);
const desktopMarketBarsClient = new DesktopMarketBarsClient({
  readGatewayOrigin,
  readAccessToken: async () => (await readDesktopAuthState())?.access_token?.trim() || "",
  createHeaders: ({ accessToken }) => createDesktopAuthHeaders({
    accessToken,
    device: collectDesktopDeviceFingerprint()
  })
});
const desktopMarketOverviewClient = new DesktopMarketOverviewClient({
  readGatewayOrigin,
  readAccessToken: async () => (await readDesktopAuthState())?.access_token?.trim() || "",
  createHeaders: ({ accessToken }) => createDesktopAuthHeaders({ accessToken, device: collectDesktopDeviceFingerprint() })
});
const desktopWebSearchClient = new DesktopWebSearchClient({
  readGatewayOrigin,
  readAccessToken: async () => (await readDesktopAuthState())?.access_token?.trim() || "",
  createHeaders: ({ accessToken }) => createDesktopAuthHeaders({
    accessToken,
    device: collectDesktopDeviceFingerprint()
  })
});
const opsMarketDataUrl = resolveBrainMarketDataUrl();
const quantSimulationService = new QuantSimulationService(
  opsMarketDataUrl
    ? { remoteUrl: opsMarketDataUrl }
    : { queryRemote: (query) => desktopMarketBarsClient.queryBars(query) },
  {
    load: (projectId) => brainWorkspaceStorage.loadQuantState(projectId),
    save: (projectId, stateJson) => brainWorkspaceStorage.saveQuantState(projectId, stateJson)
  }
);
const marketCalendarService = new ChinaMarketCalendarService({
  remoteUrl: process.env.BRAIN_MARKET_CALENDAR_URL,
  holidays: parseConfiguredMarketHolidays(process.env.BRAIN_MARKET_HOLIDAYS)
});
const quantStrategyScheduler = new QuantStrategyScheduler({
  store: brainWorkspaceStorage.quantStrategyScheduleStore(),
  resolveOwnerId: resolveBrainLocalOwnerId,
  isTradingDay: (exchange, date) => marketCalendarService.isTradingDay(exchange, date),
  execute: async (input) => { brainWorkspaceStorage.enqueueQuantStrategyExecution(input); }
});
const quantStrategyTaskRunner = new QuantStrategyTaskRunner({ store: brainWorkspaceStorage, simulation: quantSimulationService, resolveOwnerId: resolveBrainLocalOwnerId });
let quantStrategyTimer: NodeJS.Timeout | null = null;
let quantStrategyTaskTimer: NodeJS.Timeout | null = null;
let brainFlowExecution: import("./flow-execution-service.js").FlowExecutionService | undefined;
let flowSchedulerTimer: NodeJS.Timeout | null = null;

if (process.platform === "win32") {
  // Ensure taskbar grouping + icon resolution uses the packaged AppUserModelID.
  // Must be set before creating any windows.
  app.setAppUserModelId("cn.newbrain.desktop");
}

let runtime: Awaited<ReturnType<typeof createLocalRuntime>>;
type AgentModelCallback = Parameters<Awaited<ReturnType<typeof createLocalRuntime>>["advanceAgentLoop"]>[0];
let activeAgentModelCallback: AgentModelCallback | null = null;
let activeWorkspaceId = "";
let activeThreadId = "";
let modelRequestInFlight = false;
let activeModelRequestId = "";
let activeModelAbortController: AbortController | null = null;
const concurrentModelTasks = new Map<string, {
  abortController: AbortController;
  workspaceId: string;
  threadId: string;
  scope?: {
    workspaceId: string;
    threadId: string;
    requestId: string;
    turnId: string;
    runtimeId?: string;
    springSessionId?: string;
    springTurnId?: string;
    mediaJobId?: string;
  };
  runtime?: Awaited<ReturnType<typeof createLocalRuntime>>;
  pendingGuidance?: Array<{
    message: string;
    attachments: Array<{ name: string; path: string; url?: string }>;
    delivery: "steer" | "followup" | "interrupt";
  }>;
  pendingFollowups?: Array<{
    message: string;
    attachments: Array<{ name: string; path: string; url?: string }>;
    delivery: "steer" | "followup" | "interrupt";
  }>;
  modelCallback?: AgentModelCallback;
  writtenArtifacts?: unknown[];
  skillDisclosure?: string;
  springTurnId?: string;
  springSessionId?: string;
  springApprovalId?: string;
  springToolCallId?: string;
  mediaJobId?: string;
}>();
const canceledModelRequestIds = new Set<string>();
const remoteAgentEventObservers = new Map<string, (event: { type: string; payload?: unknown }) => void>();
let activeShellEnv: Record<string, string> = { ...(process.env as Record<string, string>) };
let automationTimer: NodeJS.Timeout | null = null;
let automationTickRunning = false;
let mobileBridgeServer: HttpServer | null = null;
let mobilePairingState: MobilePairingState = {
  status: "stopped",
  url: "",
  code: "",
  deviceName: "",
  expiresAt: ""
};
let mobilePairingToken = "";
let mainWindowRef: BrowserWindow | null = null;
const agentHostProcessManager = new ManagedChildProcessManager({ gracefulTimeoutMs: 3_000 });
const rustCoreProcessManager = new ManagedChildProcessManager({ gracefulTimeoutMs: 3_000 });
let rustCoreService: RustCoreService | null = null;
function getRustCoreService() {
  if (rustCoreService) return rustCoreService;
  rustCoreService = new RustCoreService({
    binaryPath: resolveUnixRustCoreBinary({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appDirectory }),
    documentWorkerRuntimePath: process.execPath,
    documentWorkerPath: app.isPackaged ? join(process.resourcesPath, "document-worker.js") : join(appDirectory, "../../document-worker.js"),
    processManager: rustCoreProcessManager,
    createClient: (child) => {
      if (!child.stdin || !child.stdout || !child.stderr) throw new Error("BRAIN_CORE_PIPE_REQUIRED");
      return new RustCoreClient({ child: {
        stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, exitCode: child.exitCode,
        kill: (signal) => child.kill(signal), once: (event, listener) => child.once(event, listener)
      } });
    }
  });
  return rustCoreService;
}
let agentHostLoopBridge: AgentHostLoopBridge;
const rustCoreToolRouter = new RustCoreToolRouter({
  mode: async () => (await readFeatureConfig()).runtime.rustCoreTools,
  acquire: (binding) => getRustCoreService().acquire(binding),
  shellCommand: (command) => ({ executable: "/bin/bash", args: ["-lc", command] })
});
const agentHostClient = new AgentHostClient({
  entryPath: join(appDirectory, "agent-host-entry.js"),
  cwd: workspacePath,
  env: { ELECTRON_RUN_AS_NODE: "1" },
  processManager: agentHostProcessManager,
  onModelRequest: (input) => agentHostLoopBridge.handleModelRequest(input) as never,
  onPolicyRequest: (input) => agentHostLoopBridge.handlePolicyRequest(input) as never,
  onToolRequest: (input) => agentHostLoopBridge.handleToolRequest(input) as never,
  onEvent: (event) => {
    if (event.event === "agent.event") return agentHostLoopBridge.handleHostEvent(event.payload as never);
  }
});
agentHostLoopBridge = new AgentHostLoopBridge({
  client: agentHostClient,
  invokeTool: (input) => rustCoreToolRouter.invoke(input)
});
const officialGovernmentWebService = new OfficialGovernmentWebService();
const governmentWritingSpecificationService = new GovernmentWritingSpecificationService(codexStorage);
const desktopErrorOutbox = new DesktopErrorOutbox(join(workspaceStateRoot, "error-reports"));
const desktopErrorCollector = new DesktopErrorCollector({
  capture: async (failure) => {
    const device = collectDesktopDeviceFingerprint();
    return desktopErrorOutbox.capture({
      ...failure,
      deviceId: device.device_id,
      appVersion: resolveElectronAppVersion(app),
      context: failure.context ?? {}
    });
  },
  flush: async () => ({ uploaded: 0, failed: 0 }),
  onDiagnostic: (message) => { void appendDesktopDebugLog(message); }
});
let rendererFailureRestartScheduled = false;
let explicitQuitRequested = false;
const novelTtsService = new NovelTtsService({
  readGatewayBaseUrl,
  readBearerToken: async () => {
    const authState = await readDesktopAuthState();
    const authSelection = selectModelRequestAuth(authState, "");
    return authSelection.bearerToken || "";
  },
  appendDebugLog: appendDesktopDebugLog
});
let registeredPopupShortcut = "";
const registeredDictationShortcuts = new Set<string>();
let desktopBootstrapPromise: Promise<DesktopBootstrapStateFile> | null = null;
let previewWindowRef: BrowserWindow | null = null;
let workspaceWatcher: FSWatcher | null = null;
let workspaceWatchDebounce: NodeJS.Timeout | null = null;
const mcpRuntimeProcesses = new Map<string, ChildProcessWithoutNullStreams>();
const mcpRuntimeLogs = new Map<string, string[]>();

interface TerminalSnapshot {
  cwd: string;
  shell: string;
  prompt: string;
  isRunning: boolean;
  lines: string[];
  launchedAt?: string;
  lastExitCode?: number | null;
}

interface TerminalSessionState {
  process: ShellChildProcess | null;
  cwd: string;
  shell: string;
  prompt: string;
  isRunning: boolean;
  lines: string[];
  launchedAt?: string;
  lastExitCode?: number | null;
}

const terminalMaxLines = 1200;
const terminalSession: TerminalSessionState = {
  process: null,
  cwd: workspacePath,
  shell: process.env.SHELL?.trim() || (process.platform === "win32" ? "powershell.exe" : "/bin/bash"),
  prompt: process.platform === "win32" ? "PS>" : "$",
  isRunning: false,
  lines: []
};

function trimTerminalLines(lines: string[]) {
  return lines.slice(-terminalMaxLines);
}

function pushTerminalLines(chunk: string) {
  const normalized = chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split("\n");
  const nextLines = [...terminalSession.lines];

  for (const part of parts) {
    if (!part && parts.length === 1) {
      continue;
    }
    nextLines.push(part);
  }

  terminalSession.lines = trimTerminalLines(nextLines);
}

function getTerminalSnapshot(): TerminalSnapshot {
  return {
    cwd: terminalSession.cwd,
    shell: terminalSession.shell,
    prompt: terminalSession.prompt,
    isRunning: terminalSession.isRunning,
    lines: [...terminalSession.lines],
    launchedAt: terminalSession.launchedAt,
    lastExitCode: terminalSession.lastExitCode
  };
}

function emitTerminalSnapshot() {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) {
    return;
  }
  mainWindowRef.webContents.send("phase1:terminal-update", getTerminalSnapshot());
}

function attachShellProcess(child: ShellChildProcess) {
  terminalSession.process = child;
  terminalSession.isRunning = true;
  terminalSession.launchedAt = nowIso();
  terminalSession.lastExitCode = null;
  terminalSession.lines = trimTerminalLines([
    ...terminalSession.lines,
    `已连接本地终端: ${terminalSession.shell}`,
    `工作目录: ${terminalSession.cwd}`
  ]);

  child.stdout.on("data", (chunk) => {
    pushTerminalLines(String(chunk));
    emitTerminalSnapshot();
  });

  child.stderr.on("data", (chunk) => {
    pushTerminalLines(String(chunk));
    emitTerminalSnapshot();
  });

  child.on("error", (error) => {
    terminalSession.lines = trimTerminalLines([
      ...terminalSession.lines,
      `终端启动失败: ${error.message}`
    ]);
    terminalSession.isRunning = false;
    terminalSession.process = null;
    emitTerminalSnapshot();
  });

  child.on("exit", (code) => {
    terminalSession.lines = trimTerminalLines([
      ...terminalSession.lines,
      `终端已退出${typeof code === "number" ? `，退出码 ${code}` : ""}`
    ]);
    terminalSession.isRunning = false;
    terminalSession.lastExitCode = code;
    terminalSession.process = null;
    emitTerminalSnapshot();
  });

  emitTerminalSnapshot();
}

function createShellProcess() {
  if (terminalSession.process && terminalSession.isRunning) {
    return terminalSession.process;
  }

  const shellCommand = terminalSession.shell;
  const shellArgs =
    process.platform === "win32"
      ? ["-NoLogo"]
      : ["-l"];

  const child = spawn(shellCommand, shellArgs, {
    cwd: terminalSession.cwd,
    env: {
      ...process.env,
      ...activeShellEnv,
      TERM: process.env.TERM || "xterm-256color"
    },
    stdio: "pipe"
  });

  attachShellProcess(child);
  return child;
}

function ensureTerminalSession() {
  return createShellProcess();
}

function clearTerminalSession() {
  terminalSession.lines = [];
  emitTerminalSnapshot();
}

function pushMcpRuntimeLog(serverId: string, line: string) {
  const current = mcpRuntimeLogs.get(serverId) ?? [];
  current.push(`[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${line}`);
  mcpRuntimeLogs.set(serverId, current.slice(-200));
}

function isBrokenPipeError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EPIPE";
}

function safeConsoleLog(...args: unknown[]) {
  try {
    console.log(...args);
  } catch (error) {
    if (!isBrokenPipeError(error)) {
      void appendDesktopDebugLog(`console log failed ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    }
  }
}

function safeConsoleError(...args: unknown[]) {
  try {
    console.error(...args);
  } catch (error) {
    if (!isBrokenPipeError(error)) {
      void appendDesktopDebugLog(`console error failed ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    }
  }
}

process.stdout?.on?.("error", (error: NodeJS.ErrnoException) => {
  if (error.code !== "EPIPE") {
    void appendDesktopDebugLog(`stdout error ${error.stack ?? error.message}`);
  }
});

process.stderr?.on?.("error", (error: NodeJS.ErrnoException) => {
  if (error.code !== "EPIPE") {
    void appendDesktopDebugLog(`stderr error ${error.stack ?? error.message}`);
  }
});

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-software-rasterizer");
app.commandLine.appendSwitch("no-sandbox");

try {
  app.setPath("userData", desktopProfileRoot);
  app.setPath("sessionData", join(desktopProfileRoot, "session"));
} catch (error) {
  safeConsoleError("failed to set desktop profile paths", error);
}

async function appendDesktopDebugLog(entry: string) {
  const line = `[${new Date().toISOString()}] ${entry}\n`;
  try {
    await ensureDirectory(dirname(desktopDebugLogPath));
    await fs.appendFile(desktopDebugLogPath, line, "utf8");
    codexStorage.appendLog({ level: "debug", target: "desktop", body: entry, threadId: undefined, processUuid });
  } catch (error) {
    if (!isBrokenPipeError(error)) {
      safeConsoleError("failed to write desktop debug log", error);
    }
  }
}

function collectDesktopErrorEnvironment() {
  return {
    platform: process.platform,
    osRelease: os.release(),
    architecture: process.arch,
    locale: app.getLocale(),
    codecnVersion: resolveElectronAppVersion(app),
    packaged: app.isPackaged,
    electronVersion: process.versions.electron ?? "",
    chromiumVersion: process.versions.chrome ?? "",
    nodeVersion: process.versions.node
  };
}

async function reportRendererFailure(input: RendererFailureInput) {
  const device = collectDesktopDeviceFingerprint();
  const record = await desktopErrorOutbox.capture({
    ...input,
    deviceId: device.device_id,
    appVersion: resolveElectronAppVersion(app),
    context: { ...(input.context ?? {}), environment: collectDesktopErrorEnvironment() }
  });
  await appendDesktopDebugLog(`renderer failure persisted id=${record.id} fingerprint=${record.fingerprint}`);
  if (!rendererFailureRestartScheduled && process.env.NEWBRAIN_DISABLE_CRASH_RESTART !== "1") {
    rendererFailureRestartScheduled = true;
    setTimeout(() => {
      explicitQuitRequested = true;
      app.relaunch();
      app.exit(70);
    }, 500);
  }
  return { ok: true, id: record.id };
}

/** Persist non-fatal UI diagnostics without restarting the desktop process. */
async function reportRendererDiagnostic(input: import("@codex-forge/protocol").RendererDiagnosticInput) {
  const device = collectDesktopDeviceFingerprint();
  await appendDesktopDebugLog(
    `renderer diagnostic kind=${input.kind} message=${String(input.message || "").slice(0, 500)}`
  );
  try {
    const result = await desktopErrorCollector.reportWithResult({
      kind: input.kind,
      message: input.message,
      stackTrace: input.stackTrace,
      deviceId: device.device_id,
      appVersion: resolveElectronAppVersion(app),
      context: {
        ...(input.context ?? {}),
        environment: collectDesktopErrorEnvironment(),
        severity: "diagnostic"
      }
    });
    const capture = result.capture as { id?: string } | undefined;
    const id = typeof capture?.id === "string" ? capture.id : "";
    await appendDesktopDebugLog(`renderer diagnostic persisted id=${id || "unknown"} kind=${input.kind}`);
    return { ok: true, id };
  } catch (error) {
    await appendDesktopDebugLog(
      `renderer diagnostic failed kind=${input.kind} error=${error instanceof Error ? error.message : String(error)}`
    );
    return { ok: false, id: "" };
  }
}

async function appendDiagnosticsLog(entry: string) {
  const preferences = await getActiveDesktopPreferences().catch(() => defaultDesktopPreferences);
  if (!preferences.configuration.telemetryEnabled) {
    return;
  }
  const line = `[${new Date().toISOString()}] ${entry}\n`;
  try {
    await ensureDirectory(dirname(desktopDiagnosticsLogPath));
    await fs.appendFile(desktopDiagnosticsLogPath, line, "utf8");
    codexStorage.appendLog({ level: "info", target: "diagnostics", body: entry, threadId: undefined, processUuid });
  } catch (error) {
    await appendDesktopDebugLog(`failed to write diagnostics log: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function appendAuthAuditLog(event: string, detail: string) {
  const line = `[${new Date().toISOString()}] ${event} ${detail}\n`;
  try {
    await ensureDirectory(dirname(authAuditLogPath));
    await fs.appendFile(authAuditLogPath, line, "utf8");
    codexStorage.appendLog({ level: "info", target: `auth.${event}`, body: detail, threadId: undefined, processUuid });
  } catch (error) {
    if (!isBrokenPipeError(error)) {
      safeConsoleError("failed to write auth audit log", error);
    }
  }
}

function toBase64(buffer: Buffer) {
  return buffer.toString("base64");
}

function fromBase64(value: string) {
  return Buffer.from(value, "base64");
}

function stripJsonBom(raw: string) {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

function parseJsonText<T>(raw: string): T {
  return JSON.parse(stripJsonBom(raw)) as T;
}

async function backupCorruptJsonFile(filePath: string, reason: string) {
  const backupPath = `${filePath}.corrupt-${Date.now()}`;
  try {
    await fs.rename(filePath, backupPath);
    await appendDesktopDebugLog(`backed up corrupt json file path=${filePath} backup=${backupPath} reason=${reason}`);
  } catch (error) {
    await appendDesktopDebugLog(
      `failed to back up corrupt json file path=${filePath} reason=${reason} error=${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function encryptDesktopSecret(value: string) {
  if (!value) {
    return "";
  }
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return `v1:${toBase64(safeStorage.encryptString(value))}`;
    }
  } catch (error) {
    void appendDesktopDebugLog(`safeStorage encrypt failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return `plain:${toBase64(Buffer.from(value, "utf8"))}`;
}

function decryptDesktopSecret(value?: string) {
  if (!value) {
    return "";
  }
  if (value.startsWith("v1:")) {
    const payload = value.slice(3);
    try {
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(fromBase64(payload));
      }
    } catch (error) {
      void appendDesktopDebugLog(`safeStorage decrypt failed: ${error instanceof Error ? error.message : String(error)}`);
      return "";
    }
    return "";
  }
  if (value.startsWith("plain:")) {
    return fromBase64(value.slice(6)).toString("utf8");
  }
  return "";
}

function createCookieHeaderFromSetCookie(setCookies: string[]) {
  const pairs = new Map<string, string>();
  for (const cookie of setCookies) {
    const [firstPart] = cookie.split(";");
    const separatorIndex = firstPart.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const name = firstPart.slice(0, separatorIndex).trim();
    const value = firstPart.slice(separatorIndex + 1).trim();
    if (name) {
      pairs.set(name, value);
    }
  }
  return [...pairs.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function readSetCookieHeaders(response: Response) {
  const rawHeaders = response.headers as Headers & { getSetCookie?: () => string[]; raw?: () => Record<string, string[]> };
  if (typeof rawHeaders.getSetCookie === "function") {
    return rawHeaders.getSetCookie();
  }
  if (typeof rawHeaders.raw === "function") {
    return rawHeaders.raw()["set-cookie"] ?? [];
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

interface DesktopDeviceFingerprint {
  device_id: string;
  device_name: string;
  device_type: string;
  os_name: string;
  os_version: string;
  app_version: string;
  mac_id: string;
  motherboard_id: string;
  disk_id: string;
}

interface DesktopAuthApiUser {
  id?: string;
  name?: string;
  email?: string;
  idp?: string;
  iat?: number;
  amr?: string[];
  acr?: string;
  mfa?: boolean;
  role?: string;
}

interface DesktopAuthApiAccount {
  id?: string;
  planType?: string;
  structure?: string;
  isConversationClassifierEnabledForWorkspace?: boolean;
  isFinservEnabledWorkspace?: boolean;
  isFedrampCompliantWorkspace?: boolean;
  isDelinquent?: boolean;
  residencyRegion?: string;
  computeResidency?: string;
}

interface DesktopAuthApiResponse {
  ok?: boolean;
  code?: string;
  message?: string;
  request_id?: string;
  user?: DesktopAuthApiUser;
  account?: DesktopAuthApiAccount;
  accessToken?: string;
  sessionToken?: string;
  expires?: string;
  authProvider?: string;
  rumViewTags?: Record<string, unknown>;
  data?: {
    user?: DesktopAuthApiUser;
    account?: DesktopAuthApiAccount;
    tokens?: {
      access_token?: string;
      refresh_token?: string;
    };
  };
}

function safeMachineToken(...values: Array<string | undefined>) {
  const source = values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean)
    .join("|");
  return source ? createHash("sha256").update(source).digest("hex").slice(0, 48) : "";
}

function scoreNetworkInterfaceName(name: string) {
  const lower = String(name || "").toLowerCase();
  let score = 0;
  if (/ethernet|eth\d|en\d|局域网|本地连接|本地網路/.test(lower)) score += 40;
  if (/wi-?fi|wlan|wireless|无线|wlan\d|wl|en0/.test(lower)) score += 25;
  if (/bluetooth|virtual|vethernet|hyper-v|vmware|virtualbox|docker|wsl|loopback|vpn|tap|tun|npcap|pseudo|bridge/.test(lower)) {
    score -= 60;
  }
  return score;
}

function resolvePrimaryMacAddress() {
  const interfaces = os.networkInterfaces();
  const candidates: Array<{ mac: string; score: number }> = [];
  for (const [name, records] of Object.entries(interfaces)) {
    for (const record of records ?? []) {
      if (!record || record.internal || !record.mac || record.mac === "00:00:00:00:00:00") continue;
      const mac = record.mac.replace(/:/g, "-").toLowerCase();
      if (!mac || mac === "00-00-00-00-00-00") continue;
      candidates.push({ mac, score: scoreNetworkInterfaceName(name) });
    }
  }
  if (!candidates.length) return "";
  candidates.sort((left, right) => right.score - left.score || left.mac.localeCompare(right.mac));
  return candidates[0]!.mac;
}

function readWindowsMachineIdentifier() {
  if (process.platform !== "win32") {
    return "";
  }
  const result = spawnSync("reg.exe", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], {
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0 || !result.stdout) {
    return "";
  }
  const match = String(result.stdout).match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
  return match?.[1]?.trim() || "";
}

function readWmicValue(alias: string, property: string) {
  if (process.platform !== "win32") {
    return "";
  }
  const result = spawnSync("wmic", [alias, "get", property, "/value"], {
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0 || !result.stdout) {
    return "";
  }
  const match = String(result.stdout).match(new RegExp(`${property}=([^\\r\\n]+)`, "i"));
  return match?.[1]?.trim() || "";
}

function isUsableDesktopDeviceFingerprint(value: unknown): value is DesktopDeviceFingerprint {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return ["device_id", "mac_id", "motherboard_id", "disk_id"]
    .every((key) => typeof record[key] === "string" && String(record[key]).trim().length > 0);
}

function reusePersistedDesktopDeviceFingerprint(
  persisted: DesktopDeviceFingerprint,
  live: DesktopDeviceFingerprint
): DesktopDeviceFingerprint {
  return {
    ...persisted,
    device_name: live.device_name || persisted.device_name,
    device_type: live.device_type || persisted.device_type,
    os_name: live.os_name || persisted.os_name,
    os_version: live.os_version || persisted.os_version,
    app_version: live.app_version || persisted.app_version
  };
}

function readPersistedDesktopDeviceFingerprintSync(): DesktopDeviceFingerprint | null {
  try {
    const parsed = JSON.parse(readFileSync(desktopDeviceFingerprintPath, "utf8")) as unknown;
    return isUsableDesktopDeviceFingerprint(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writePersistedDesktopDeviceFingerprint(device: DesktopDeviceFingerprint) {
  cachedDesktopDeviceFingerprint = device;
  await ensureDirectory(dirname(desktopDeviceFingerprintPath));
  await fs.writeFile(desktopDeviceFingerprintPath, `${JSON.stringify(device, null, 2)}\n`, "utf8");
}

function collectLiveDesktopDeviceFingerprint(): DesktopDeviceFingerprint {
  const machineGuid = readWindowsMachineIdentifier();
  const primaryMac = resolvePrimaryMacAddress();
  const boardSerial = readWmicValue("baseboard", "serialnumber");
  const diskSerial = readWmicValue("diskdrive", "serialnumber");
  const deviceId = safeMachineToken(
    process.platform,
    app.getPath("userData"),
    machineGuid || primaryMac || os.hostname()
  ).slice(0, 24);
  return {
    device_id: deviceId,
    device_name: os.hostname() || `${platformLabel}-desktop`,
    device_type: "desktop",
    os_name: process.platform,
    os_version: os.release(),
    app_version: resolveElectronAppVersion(app),
    mac_id: safeMachineToken(primaryMac, machineGuid || os.hostname()),
    motherboard_id: safeMachineToken(boardSerial, machineGuid, os.hostname()),
    disk_id: safeMachineToken(diskSerial, machineGuid, workspacePath)
  };
}

/** Reuse persisted device identity so WiFi/MAC churn does not force re-login. */
function collectDesktopDeviceFingerprint(): DesktopDeviceFingerprint {
  const live = collectLiveDesktopDeviceFingerprint();
  if (cachedDesktopDeviceFingerprint) {
    return reusePersistedDesktopDeviceFingerprint(cachedDesktopDeviceFingerprint, live);
  }
  const persisted = readPersistedDesktopDeviceFingerprintSync();
  if (persisted) {
    cachedDesktopDeviceFingerprint = reusePersistedDesktopDeviceFingerprint(persisted, live);
    return cachedDesktopDeviceFingerprint;
  }
  cachedDesktopDeviceFingerprint = live;
  void writePersistedDesktopDeviceFingerprint(live).catch(() => undefined);
  return live;
}

function createDesktopAuthHeaders(input: {
  accessToken?: string;
  device: DesktopDeviceFingerprint;
}) {
  const osName = String(input.device.os_name || "").trim().toLowerCase();
  const platform =
    osName === "darwin" || osName === "macos" || osName === "osx" || osName === "mac"
      ? "macos"
      : osName === "linux"
        ? "linux"
        : "windows";
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Desktop-Client": "newbrain",
    "X-Request-Id": randomUUID(),
    "X-Desktop-Device-Id": input.device.device_id,
    "X-Desktop-Device-Name": input.device.device_name,
    "X-Desktop-Device-Type": input.device.device_type,
    "X-Desktop-OS-Name": input.device.os_name,
    "X-Desktop-OS-Version": input.device.os_version,
    "X-Desktop-App-Version": input.device.app_version,
    "X-Desktop-Mac-Id": input.device.mac_id,
    "X-Desktop-Motherboard-Id": input.device.motherboard_id,
    "X-Desktop-Disk-Id": input.device.disk_id,
    "X-Desktop-Platform": platform
  };
  if (input.accessToken?.trim()) {
    headers.Authorization = `Bearer ${input.accessToken.trim()}`;
  }
  return headers;
}

function computeAvatarText(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return "未";
  }
  const firstCodePoint = Array.from(normalized)[0] ?? "U";
  return firstCodePoint.toUpperCase();
}

function maskEmail(value: string) {
  const trimmed = value.trim().toLowerCase();
  const separatorIndex = trimmed.indexOf("@");
  if (separatorIndex <= 1) {
    return trimmed ? "***" : "";
  }
  return `${trimmed.slice(0, Math.min(2, separatorIndex))}***${trimmed.slice(separatorIndex)}`;
}

function inferPlanLabel(role: string) {
  const normalized = role.trim().toLowerCase();
  if (normalized === "admin") {
    return "管理员";
  }
  return "已登录";
}

function buildDesktopAuthUser(input?: PersistedDesktopAuthState["user"]) {
  const email = input?.email?.trim() || "";
  const displayName = input?.display_name?.trim() || email || "用户";
  const role = input?.role?.trim() || "user";
  return {
    id: input?.id?.trim() || "",
    email,
    display_name: displayName,
    idp: input?.idp?.trim() || "",
    iat: typeof input?.iat === "number" ? input.iat : undefined,
    amr: Array.isArray(input?.amr) ? input.amr.filter((item): item is string => typeof item === "string") : [],
    acr: input?.acr?.trim() || "",
    mfa: Boolean(input?.mfa),
    role,
    plan: input?.plan?.trim() || inferPlanLabel(role),
    avatar_text: input?.avatar_text?.trim() || computeAvatarText(displayName || email || role)
  };
}

async function readDesktopAuthState(): Promise<PersistedDesktopAuthState | null> {
  try {
    const raw = await fs.readFile(desktopAuthStatePath, "utf8");
    let parsed: Record<string, unknown>;
    try {
      parsed = parseJsonText<Record<string, unknown>>(raw);
    } catch {
      // Older builds could persist a mojibake plan label without its closing quote.
      const repaired = raw.replace(/("plan"\s*:\s*)"[^"\r\n]*,/u, '$1"已登录",');
      parsed = parseJsonText<Record<string, unknown>>(repaired);
    }
    const mode = parsed.mode === "desktop_token" ? "desktop_token" : parsed.mode === "session_cookie" ? "session_cookie" : null;
    if (!mode) {
      return null;
    }
    const normalizedState: PersistedDesktopAuthState = {
      mode,
      session_cookie: typeof parsed.session_cookie === "string" ? decryptDesktopSecret(parsed.session_cookie) : "",
      access_token: typeof parsed.access_token === "string" ? decryptDesktopSecret(parsed.access_token) : "",
      refresh_token: typeof parsed.refresh_token === "string" ? decryptDesktopSecret(parsed.refresh_token) : "",
      expires: typeof parsed.expires === "string" ? parsed.expires : "",
      auth_provider: typeof parsed.auth_provider === "string" ? parsed.auth_provider : "",
      user: parsed.user && typeof parsed.user === "object" ? (parsed.user as PersistedDesktopAuthState["user"]) : undefined,
      account: parsed.account && typeof parsed.account === "object" ? (parsed.account as PersistedDesktopAuthState["account"]) : undefined,
      rum_view_tags: parsed.rum_view_tags && typeof parsed.rum_view_tags === "object" ? (parsed.rum_view_tags as Record<string, unknown>) : undefined,
      last_synced_at: typeof parsed.last_synced_at === "string" ? parsed.last_synced_at : ""
    };
    if (Object.prototype.hasOwnProperty.call(parsed, "gateway_api_key")) {
      await writeDesktopAuthState(normalizedState);
      await appendDesktopDebugLog("removed legacy desktop gateway credential from local auth state");
    }
    return normalizedState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeDesktopAuthState(state: PersistedDesktopAuthState | null) {
  await ensureDirectory(dirname(desktopAuthStatePath));
  if (!state) {
    await safeUnlink(desktopAuthStatePath);
    return;
  }

  const payload = {
    ...state,
    session_cookie: state.session_cookie ? encryptDesktopSecret(state.session_cookie) : "",
    access_token: state.access_token ? encryptDesktopSecret(state.access_token) : "",
    refresh_token: state.refresh_token ? encryptDesktopSecret(state.refresh_token) : "",
    last_synced_at: state.last_synced_at || nowIso()
  };
  await fs.writeFile(desktopAuthStatePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function syncAuthenticatedDesktopControlPlane() {
  const authState = await readDesktopAuthState();
  if (!authState?.access_token) {
    throw new Error("桌面控制面同步需要有效登录状态。");
  }
  const device = collectDesktopDeviceFingerprint();
  const state = await syncDesktopControlPlaneProtocol({
    gatewayOrigin: await readGatewayOrigin(),
    accessToken: authState.access_token,
    clientVersion: resolveElectronAppVersion(app),
    deviceId: device.device_id
  });
  await ensureDirectory(workspaceStateRoot);
  await fs.writeFile(desktopControlPlaneStatePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await appendDesktopDebugLog(
    `desktop control plane synced protocol=${state.protocol_version} origin=${state.gateway_origin}`
  );
  return state;
}

async function fetchDesktopAuthLoginFlags(): Promise<{
  emailCodeLoginEnabled: boolean;
  passwordLoginEnabled: boolean;
  serverTime: string | null;
  serverDate: string | null;
  loginCeremonyEnabled: boolean;
}> {
  const ceremonyFallback = resolveLoginCeremonyAuthFields({
    isPackaged: app.isPackaged,
    serverTime: null,
    serverDate: null
  });
  try {
    const gatewayOrigin = await readGatewayOrigin();
    const response = await fetch(`${gatewayOrigin}/api/desktop/auth/config`, {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });
    const payload = (await readJsonResponse(response)) as Record<string, unknown> | null;
    const data =
      payload && typeof payload.data === "object" && payload.data
        ? (payload.data as Record<string, unknown>)
        : payload || {};
    const emailCodeLoginEnabled = Boolean(data.email_code_login_enabled);
    const passwordLoginEnabled =
      data.password_login_enabled === undefined ? !emailCodeLoginEnabled : Boolean(data.password_login_enabled);
    const serverTime = typeof data.server_time === "string" ? data.server_time : null;
    const serverDate = typeof data.server_date === "string" ? data.server_date : null;
    const ceremony = resolveLoginCeremonyAuthFields({
      isPackaged: app.isPackaged,
      serverTime,
      serverDate
    });
    return {
      emailCodeLoginEnabled,
      passwordLoginEnabled,
      serverTime: ceremony.server_time,
      serverDate: ceremony.server_date,
      loginCeremonyEnabled: ceremony.login_ceremony_enabled
    };
  } catch (error) {
    await appendDesktopDebugLog(
      `desktop auth config fetch failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return {
      emailCodeLoginEnabled: false,
      passwordLoginEnabled: true,
      serverTime: null,
      serverDate: null,
      loginCeremonyEnabled: ceremonyFallback.login_ceremony_enabled
    };
  }
}

function desktopLoginCeremonyStatusFields(loginFlags: Awaited<ReturnType<typeof fetchDesktopAuthLoginFlags>>) {
  return {
    email_code_login_enabled: loginFlags.emailCodeLoginEnabled,
    password_login_enabled: loginFlags.passwordLoginEnabled,
    server_time: loginFlags.serverTime,
    server_date: loginFlags.serverDate,
    login_ceremony_enabled: loginFlags.loginCeremonyEnabled
  };
}

async function fetchAgreementConfig(): Promise<DesktopAgreementConfig> {
  try {
    const gatewayOrigin = await readGatewayOrigin();
    const response = await fetch(`${gatewayOrigin}/api/agreement`, {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });
    const data = await response.json().catch(() => ({}));
    return {
      enabled: Boolean((data as Record<string, unknown>).enabled),
      tos_title: typeof (data as Record<string, unknown>).tos_title === "string" ? String((data as Record<string, unknown>).tos_title) : "",
      tos_content_html:
        typeof (data as Record<string, unknown>).tos_content_html === "string"
          ? String((data as Record<string, unknown>).tos_content_html)
          : "",
      policy_title:
        typeof (data as Record<string, unknown>).policy_title === "string"
          ? String((data as Record<string, unknown>).policy_title)
          : "",
      policy_content_html:
        typeof (data as Record<string, unknown>).policy_content_html === "string"
          ? String((data as Record<string, unknown>).policy_content_html)
          : "",
      topic_name: typeof (data as Record<string, unknown>).topic_name === "string" ? String((data as Record<string, unknown>).topic_name) : "",
      topic_id: typeof (data as Record<string, unknown>).topic_id === "number" ? Number((data as Record<string, unknown>).topic_id) : undefined
    };
  } catch (error) {
    await appendDesktopDebugLog(`agreement fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      enabled: true,
      tos_title: "服务协议",
      tos_content_html: "<p>协议加载失败，请稍后重试。</p>",
      policy_title: "使用政策",
      policy_content_html: "<p>政策加载失败，请稍后重试。</p>"
    };
  }
}

async function readJsonResponse(response: Response) {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return raw;
  }
}

async function fetchJsonWithDesktopAuth(path: string, authState: PersistedDesktopAuthState, device: DesktopDeviceFingerprint) {
  const gatewayOrigin = await readGatewayOrigin();
  const tokenCandidates = [authState.access_token]
    .map((token) => token?.trim() || "")
    .filter((token, index, list) => token && list.indexOf(token) === index);
  const sessionCookie = authState.session_cookie?.trim() || "";
  let lastPayload: unknown = null;
  let lastStatus = 0;

  for (const token of tokenCandidates.length ? tokenCandidates : [""]) {
    const headers = createDesktopAuthHeaders({ accessToken: token, device });
    if (sessionCookie) headers.Cookie = sessionCookie;
    const response = await fetch(`${gatewayOrigin}${path}`, { method: "GET", headers });
    const payload = await readJsonResponse(response);
    if (response.ok) return payload;
    lastPayload = payload;
    lastStatus = response.status;
    if (response.status !== 401 && response.status !== 403) break;
  }

  if (sessionCookie && tokenCandidates.length > 0) {
    const response = await fetch(`${gatewayOrigin}${path}`, {
      method: "GET",
      headers: { Accept: "application/json", Cookie: sessionCookie }
    });
    const payload = await readJsonResponse(response);
    if (response.ok) return payload;
    lastPayload = payload;
    lastStatus = response.status;
  }

  const message =
    lastPayload && typeof lastPayload === "object"
      ? String((lastPayload as Record<string, unknown>).message || (lastPayload as Record<string, unknown>).detail || "")
      : "";
  throw new Error(message || `OmniRoute request failed: HTTP ${lastStatus || "unknown"} ${path}`);
}

async function fetchDesktopBillingSubscription() {
  const authState = await readDesktopAuthState();
  if (!authState) {
    throw new Error("请先登录后查看订阅信息");
  }

  const device = collectDesktopDeviceFingerprint();
  if (!authState.access_token?.trim() && !authState.session_cookie?.trim()) {
    throw new Error("当前会话没有可用的 OmniRoute 访问凭证");
  }

  const [bootstrapResult, subscriptionsResult, usageResult] = await Promise.allSettled([
    fetchJsonWithDesktopAuth("/api/desktop/v1/bootstrap", authState, device),
    fetchJsonWithDesktopAuth("/api/subscriptions", authState, device),
    fetchJsonWithDesktopAuth("/api/desktop/v1/usage?page=1&page_size=100", authState, device)
  ]);
  const bootstrap = bootstrapResult.status === "fulfilled" ? bootstrapResult.value : null;
  const subscriptions = subscriptionsResult.status === "fulfilled" ? subscriptionsResult.value : null;
  const usage = usageResult.status === "fulfilled" ? usageResult.value : null;
  if (!bootstrap && !subscriptions) {
    const errors = [bootstrapResult, subscriptionsResult]
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason))
      .filter(Boolean);
    throw new Error(`订阅信息加载失败${errors.length ? `：${errors.join("；")}` : "。"}`);
  }

  return normalizeDesktopBillingPayload({
    bootstrap,
    subscription: subscriptions,
    usage,
    source_error: usageResult.status === "rejected"
      ? usageResult.reason instanceof Error ? usageResult.reason.message : String(usageResult.reason)
      : undefined
  });
}

function normalizeDesktopBillingPayload(payloadRecord: Record<string, unknown>) {
  const bootstrap = payloadRecord.bootstrap && typeof payloadRecord.bootstrap === "object"
    ? payloadRecord.bootstrap as Record<string, unknown>
    : {};
  const subscription = payloadRecord.subscription && typeof payloadRecord.subscription === "object"
    ? payloadRecord.subscription as Record<string, unknown>
    : {};
  const bootstrapEntitlements = bootstrap.entitlements && typeof bootstrap.entitlements === "object"
    ? bootstrap.entitlements as Record<string, unknown>
    : {};
  const summary = subscription.summary && typeof subscription.summary === "object"
    ? subscription.summary as Record<string, unknown>
    : bootstrapEntitlements;
  const usage = payloadRecord.usage && typeof payloadRecord.usage === "object"
    ? payloadRecord.usage as Record<string, unknown>
    : {};
  const usageSummary = usage.summary && typeof usage.summary === "object"
    ? usage.summary as Record<string, unknown>
    : {};
  const usageItems = Array.isArray(usage.items)
    ? usage.items as Array<Record<string, unknown>>
    : Array.isArray(usage.records)
      ? usage.records as Array<Record<string, unknown>>
      : [];
  const tokenUsed = usageItems.reduce((total, item) => total
    + Number(item.input_tokens ?? item.prompt_tokens ?? 0)
    + Number(item.output_tokens ?? item.completion_tokens ?? 0), 0);
  const taskUsed = Number((usageSummary.total ?? usageSummary.total_requests ?? usageItems.length) || usageItems.length);
  const directSubscriptions = Array.isArray(subscription.subscriptions)
    ? subscription.subscriptions as Record<string, unknown>[]
    : Array.isArray(payloadRecord.subscriptions)
      ? payloadRecord.subscriptions as Record<string, unknown>[]
      : [];
  const activeSubscription = directSubscriptions.find((item) => ["active", "valid"].includes(String(item.status || "").toLowerCase()))
    ?? directSubscriptions[0]
    ?? summary;
  const hasSubscriptionSource =
    directSubscriptions.length > 0 ||
    Object.keys(summary).some((key) => !["daily_used", "monthly_used", "monthly_tokens_used", "monthly_tasks_used"].includes(key) && summary[key] != null && String(summary[key]).trim() !== "");
  const normalizedSubscription = {
    ...activeSubscription,
    id: activeSubscription.id ?? "omniroute-current",
    plan_name: String(activeSubscription.plan_name ?? summary.plan_name ?? "Unavailable"),
    plan_code: String(activeSubscription.plan_code ?? summary.plan_code ?? "unknown"),
    provider_name: String(activeSubscription.provider_name ?? activeSubscription.vendor_name ?? summary.provider_name ?? summary.vendor_name ?? "Unknown"),
    status: String(activeSubscription.status ?? summary.status ?? "unknown"),
    expires_at: activeSubscription.expires_at ?? summary.expires_at ?? summary.expire_at ?? "",
    balance: Number(activeSubscription.balance ?? summary.balance ?? 0),
    daily_used: Number(activeSubscription.daily_used ?? summary.daily_used ?? 0),
    daily_quota: Number(activeSubscription.daily_quota ?? summary.daily_quota ?? 0),
    monthly_used: Number(activeSubscription.monthly_used ?? summary.monthly_used ?? 0),
    monthly_quota: Number(activeSubscription.monthly_quota ?? summary.monthly_quota ?? 0),
    monthly_tokens_used: Number(activeSubscription.monthly_tokens_used ?? summary.monthly_tokens_used ?? tokenUsed),
    monthly_tokens_quota: Number(activeSubscription.monthly_tokens_quota ?? summary.monthly_tokens_quota ?? 0),
    monthly_tasks_used: Number(activeSubscription.monthly_tasks_used ?? summary.monthly_tasks_used ?? taskUsed),
    monthly_task_quota: Number(activeSubscription.monthly_task_quota ?? summary.monthly_task_quota ?? 0)
  };
  const billingHistory = [
    subscription.billing_history, subscription.activities, subscription.invoices, subscription.payments, subscription.orders, subscription.transactions,
    payloadRecord.billing_history, payloadRecord.invoices, payloadRecord.payments, payloadRecord.orders, payloadRecord.transactions
  ].find(Array.isArray) ?? [];
  return {
    ...subscription,
    summary: { ...summary, ...normalizedSubscription },
    subscriptions: directSubscriptions.length
      ? directSubscriptions.map((item) => item.id === activeSubscription.id ? { ...item, ...normalizedSubscription } : item)
      : hasSubscriptionSource
        ? [normalizedSubscription]
        : [],
    billing_history: billingHistory,
    usage,
    bootstrap,
    source_error: payloadRecord.source_error
  };
}

async function fetchDashboardWithSessionCookie(sessionCookie: string) {
  const gatewayOrigin = await readGatewayOrigin();
  const response = await fetch(`${gatewayOrigin}${dashboardPath}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Cookie: sessionCookie
    }
  });
  const payload = await readJsonResponse(response);
  return { response, payload };
}

function buildDesktopAuthUserFromApi(payloadUser?: DesktopAuthApiUser, fallbackEmail = "") {
  return buildDesktopAuthUser({
    id: typeof payloadUser?.id === "string" ? payloadUser.id : "",
    email: typeof payloadUser?.email === "string" ? payloadUser.email : fallbackEmail,
    display_name:
      typeof payloadUser?.name === "string"
        ? payloadUser.name
        : typeof payloadUser?.email === "string"
          ? payloadUser.email
          : fallbackEmail,
    idp: typeof payloadUser?.idp === "string" ? payloadUser.idp : "",
    iat: typeof payloadUser?.iat === "number" ? payloadUser.iat : undefined,
    amr: Array.isArray(payloadUser?.amr) ? payloadUser.amr.filter((item): item is string => typeof item === "string") : [],
    acr: typeof payloadUser?.acr === "string" ? payloadUser.acr : "",
    mfa: Boolean(payloadUser?.mfa),
    role: typeof payloadUser?.role === "string" ? payloadUser.role : "user"
  });
}

function buildDesktopAuthAccountFromApi(payloadAccount?: DesktopAuthApiAccount): PersistedDesktopAuthState["account"] | undefined {
  if (!payloadAccount) {
    return undefined;
  }
  return {
    id: typeof payloadAccount.id === "string" ? payloadAccount.id : "",
    plan_type: typeof payloadAccount.planType === "string" ? payloadAccount.planType : "",
    structure: typeof payloadAccount.structure === "string" ? payloadAccount.structure : "",
    conversation_classifier_enabled: Boolean(payloadAccount.isConversationClassifierEnabledForWorkspace),
    finserv_enabled: Boolean(payloadAccount.isFinservEnabledWorkspace),
    fedramp_compliant: Boolean(payloadAccount.isFedrampCompliantWorkspace),
    delinquent: Boolean(payloadAccount.isDelinquent),
    residency_region: typeof payloadAccount.residencyRegion === "string" ? payloadAccount.residencyRegion : "",
    compute_residency: typeof payloadAccount.computeResidency === "string" ? payloadAccount.computeResidency : ""
  };
}

function extractDesktopAuthErrorMessage(payload: unknown, status: number) {
  const record = payload as Record<string, unknown> | null;
  const code = typeof record?.code === "string" ? String(record.code) : "";
  const message = typeof record?.message === "string" ? String(record.message) : `认证失败 (${status})`;
  const detail = typeof record?.detail === "string"
    ? String(record.detail)
    : typeof record?.error === "string"
      ? String(record.error)
      : "";
  const requestId = typeof record?.request_id === "string" ? String(record.request_id) : "";
  const segments = [code ? `${code}: ${message}` : message];
  if (detail && detail !== message) {
    segments.push(detail);
  }
  if (requestId) {
    segments.push(`request_id=${requestId}`);
  }
  return segments.join(" | ");
}

function normalizeConnectionErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.toLowerCase().includes("fetch failed")) {
    return "无法连接认证服务，请检查网络或服务器地址。";
  }
  return message;
}

async function fetchDesktopAuthMe(accessToken: string, device: DesktopDeviceFingerprint) {
  const gatewayOrigin = await readGatewayOrigin();
  const response = await fetch(`${gatewayOrigin}/api/desktop/auth/me`, {
    method: "GET",
    headers: createDesktopAuthHeaders({ accessToken, device })
  });
  const payload = await readJsonResponse(response);
  return { response, payload };
}

async function refreshDesktopTokens(persisted: PersistedDesktopAuthState, device: DesktopDeviceFingerprint) {
  if (!persisted.refresh_token) {
    return null;
  }
  const gatewayOrigin = await readGatewayOrigin();
  const response = await fetch(`${gatewayOrigin}/api/desktop/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...createDesktopAuthHeaders({ device })
    },
    body: JSON.stringify({
      refresh_token: persisted.refresh_token,
      device_id: device.device_id,
      app_version: device.app_version,
      device
    })
  });
  const payload = await readJsonResponse(response);
  return { response, payload };
}

async function refreshDesktopAccessTokenForGateway(): Promise<string> {
  const persisted = await readDesktopAuthState();
  if (!persisted?.refresh_token) return "";
  const refreshed = await refreshDesktopTokens(persisted, collectDesktopDeviceFingerprint());
  const payload = refreshed?.payload as Record<string, unknown> | null;
  if (!refreshed?.response.ok || !payload || payload.ok !== true) return "";
  const tokens = payload.data && typeof payload.data === "object"
    ? (payload.data as { tokens?: { access_token?: string; refresh_token?: string } }).tokens
    : undefined;
  const accessToken =
    typeof payload.accessToken === "string" && payload.accessToken
      ? payload.accessToken
      : typeof tokens?.access_token === "string"
        ? tokens.access_token
        : "";
  if (!accessToken) return "";
  const refreshToken =
    typeof payload.sessionToken === "string" && payload.sessionToken
      ? payload.sessionToken
      : typeof tokens?.refresh_token === "string"
        ? tokens.refresh_token
        : persisted.refresh_token;
  await writeDesktopAuthState({
    ...persisted,
    access_token: accessToken,
    refresh_token: refreshToken,
    expires: typeof payload.expires === "string" ? payload.expires : persisted.expires,
    last_synced_at: nowIso()
  });
  await writePersistedDesktopDeviceFingerprint(collectDesktopDeviceFingerprint()).catch(() => undefined);
  return accessToken;
}

async function resolveDesktopAuthStatus(): Promise<DesktopAuthStatus> {
  const agreement = await fetchAgreementConfig();
  const persisted = await readDesktopAuthState();
  const checkedAt = nowIso();
  const device = collectDesktopDeviceFingerprint();
  const gatewayOrigin = await readGatewayOrigin();

  if (!persisted || !persisted.access_token) {
    const loginFlags = await fetchDesktopAuthLoginFlags();
    return {
      authenticated: false,
      loading: false,
      mode: "none",
      base_url: gatewayOrigin,
      agreement,
      last_checked_at: checkedAt,
      ...desktopLoginCeremonyStatusFields(loginFlags)
    };
  }

  {
    const loginFlags = await fetchDesktopAuthLoginFlags();
    if (
      shouldInvalidateLocalAuthForLoginCeremony({
        isPackaged: app.isPackaged,
        serverDate: loginFlags.serverDate,
        serverTime: loginFlags.serverTime,
        lastSyncedAt: persisted.last_synced_at
      })
    ) {
      await appendAuthAuditLog(
        "session_expired",
        persisted.user?.email ? `${maskEmail(persisted.user.email)} login_ceremony_window` : "login_ceremony_window"
      );
      await writeDesktopAuthState(null);
      return {
        authenticated: false,
        loading: false,
        mode: "none",
        base_url: gatewayOrigin,
        agreement,
        last_checked_at: checkedAt,
        ...desktopLoginCeremonyStatusFields(loginFlags)
      };
    }
  }

  try {
    let { response, payload } = await fetchDesktopAuthMe(persisted.access_token, device);
    let activeAccessToken = persisted.access_token;
    let activeRefreshToken = persisted.refresh_token || "";
    const firstErrorCode =
      typeof (payload as Record<string, unknown> | null)?.code === "string"
        ? String((payload as Record<string, unknown>).code)
        : "";

    if ((response.status === 401 || firstErrorCode === "AUTH_DEVICE_REVALIDATION_REQUIRED") && persisted.refresh_token) {
      const refreshed = await refreshDesktopTokens(persisted, device);
      if (refreshed?.response.ok && (refreshed.payload as DesktopAuthApiResponse | null)?.ok) {
        const refreshedPayload = refreshed.payload as DesktopAuthApiResponse;
        activeAccessToken =
          typeof refreshedPayload.accessToken === "string" && refreshedPayload.accessToken
            ? refreshedPayload.accessToken
            : typeof refreshedPayload.data?.tokens?.access_token === "string"
              ? refreshedPayload.data.tokens.access_token
              : activeAccessToken;
        activeRefreshToken =
          typeof refreshedPayload.sessionToken === "string" && refreshedPayload.sessionToken
            ? refreshedPayload.sessionToken
            : typeof refreshedPayload.data?.tokens?.refresh_token === "string"
              ? refreshedPayload.data.tokens.refresh_token
              : activeRefreshToken;
        ({ response, payload } = await fetchDesktopAuthMe(activeAccessToken, device));
      }
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        await appendAuthAuditLog("session_expired", persisted.user?.email ? maskEmail(persisted.user.email) : "unknown");
        await writeDesktopAuthState(null);
        const loginFlags = await fetchDesktopAuthLoginFlags();
        return {
          authenticated: false,
          loading: false,
          mode: "none",
          base_url: gatewayOrigin,
          agreement,
          last_checked_at: checkedAt,
          last_error: extractDesktopAuthErrorMessage(payload, response.status),
          ...desktopLoginCeremonyStatusFields(loginFlags)
        };
      }

      return {
        authenticated: false,
        loading: false,
        mode: "desktop_token",
        base_url: gatewayOrigin,
        agreement,
        last_checked_at: checkedAt,
        last_error: extractDesktopAuthErrorMessage(payload, response.status)
      };
    }

    const desktopPayload = payload as DesktopAuthApiResponse | null;
    const payloadUser = desktopPayload?.user ?? desktopPayload?.data?.user;
    const user = buildDesktopAuthUserFromApi(payloadUser, persisted.user?.email ?? "");
    const account = buildDesktopAuthAccountFromApi(desktopPayload?.account ?? desktopPayload?.data?.account) ?? persisted.account;
    await writeDesktopAuthState({
      mode: "desktop_token",
      access_token: activeAccessToken,
      refresh_token: activeRefreshToken,
      expires: typeof desktopPayload?.expires === "string" ? desktopPayload.expires : persisted.expires,
      auth_provider: typeof desktopPayload?.authProvider === "string" ? desktopPayload.authProvider : persisted.auth_provider,
      user,
      account,
      rum_view_tags: desktopPayload?.rumViewTags ?? persisted.rum_view_tags,
      last_synced_at: checkedAt
    });
    await writePersistedDesktopDeviceFingerprint(device).catch(() => undefined);

    return {
      authenticated: true,
      loading: false,
      mode: "desktop_token",
      base_url: gatewayOrigin,
      user,
      account,
      agreement,
      last_checked_at: checkedAt
    };
  } catch (error) {
    const lastError = normalizeConnectionErrorMessage(error);
    return {
      authenticated: false,
      loading: false,
      mode: persisted.mode,
      base_url: gatewayOrigin,
      agreement,
      last_checked_at: checkedAt,
      last_error: lastError
    };
  }
}

async function loginDesktopAuth(input: DesktopAuthLoginInput): Promise<DesktopAuthStatus> {
  const email = input.email.trim().toLowerCase();
  const password = input.password?.trim() || "";
  const captcha = input.captcha?.trim() || "";
  const agreement = await fetchAgreementConfig();
  const device = collectDesktopDeviceFingerprint();
  const gatewayOrigin = await readGatewayOrigin();

  if (!email || (!password && !captcha)) {
    await appendAuthAuditLog("login_rejected", "missing_credentials");
    throw new Error("请输入邮箱，并填写密码或验证码。");
  }
  if (agreement.enabled && !input.agreement_accepted) {
    await appendAuthAuditLog("login_rejected", `${maskEmail(email)} agreement_missing`);
    throw new Error("请先勾选并同意服务协议与使用政策。");
  }

  const loginWithCode = Boolean(captcha);
  const response = await fetch(`${gatewayOrigin}/api/desktop/auth/login/${loginWithCode ? "code" : "password"}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...createDesktopAuthHeaders({ device })
    },
    body: JSON.stringify({
      identifier: email,
      password: loginWithCode ? undefined : password,
      code: loginWithCode ? captcha : undefined,
      agreement_accepted: input.agreement_accepted,
      device
    })
  });

  const payload = await readJsonResponse(response);
  if (!response.ok || !(payload as Record<string, unknown> | null)?.ok) {
    const message = normalizeDesktopLoginError(payload, response.status, loginWithCode);
    await appendDesktopDebugLog(
      `desktop login failed payload: ${JSON.stringify({ status: response.status, payload })}`
    );
    await appendDesktopDebugLog(`desktop login failed: ${message}`);
    await appendAuthAuditLog("login_failed", `${maskEmail(email)} ${message}`);
    throw new Error(message);
  }

  const desktopPayload = payload as DesktopAuthApiResponse;
  const accessToken =
    typeof desktopPayload.accessToken === "string" && desktopPayload.accessToken
      ? desktopPayload.accessToken
      : typeof desktopPayload.data?.tokens?.access_token === "string"
        ? desktopPayload.data.tokens.access_token
        : "";
  const sessionToken =
    typeof desktopPayload.sessionToken === "string" && desktopPayload.sessionToken
      ? desktopPayload.sessionToken
      : typeof desktopPayload.data?.tokens?.refresh_token === "string"
        ? desktopPayload.data.tokens.refresh_token
        : "";
  if (!accessToken || !sessionToken) {
    throw new Error("登录成功，但未收到完整桌面认证令牌。");
  }
  const payloadUser = desktopPayload.user ?? desktopPayload.data?.user;
  const user = buildDesktopAuthUserFromApi(payloadUser, email);
  const account = buildDesktopAuthAccountFromApi(desktopPayload.account ?? desktopPayload.data?.account);

  await writeDesktopAuthState({
    mode: "desktop_token",
    access_token: accessToken,
    refresh_token: sessionToken,
    expires: desktopPayload.expires ?? "",
    auth_provider: desktopPayload.authProvider ?? "",
    user,
    account,
    rum_view_tags: desktopPayload.rumViewTags,
    last_synced_at: nowIso()
  });
  await writePersistedDesktopDeviceFingerprint(collectDesktopDeviceFingerprint()).catch(() => undefined);
  await appendAuthAuditLog("login_success", `${maskEmail(email)} mode=desktop_token`);

  const currentConfig = await readRootConfig();
  if (currentConfig.llm.baseUrl.trim() === defaultModelConfig.baseUrl && currentConfig.llm.apiKey.trim() === defaultModelConfig.apiKey) {
    const saved = await writeRootConfig({
      ...currentConfig.llm,
      apiKey: ""
    });
    await appendDesktopDebugLog(`cleared bundled gateway key after user login, config hash=${createHash("sha256").update(saved.llm.baseUrl).digest("hex").slice(0, 8)}`);
  }

  const nextStatus = await resolveDesktopAuthStatus();
  if (nextStatus.authenticated) {
    void startDesktopBootstrapAfterAuth().catch((error) => {
      void appendDesktopDebugLog(
        `desktop bootstrap after auth failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`
      );
    });
  }
  return nextStatus;
}

function normalizeDesktopLoginError(payload: unknown, status: number, loginWithCode: boolean) {
  const rawMessage = extractDesktopAuthErrorMessage(payload, status).toLowerCase();
  if (status === 401 || rawMessage.includes("unauthorized") || rawMessage.includes("invalid username/email or password")) {
    return loginWithCode ? "邮箱或验证码不正确，请检查后重试。" : "邮箱或密码不正确，请检查后重试。";
  }
  if (rawMessage.includes("login code expired")) {
    return "验证码已过期，请重新获取。";
  }
  if (rawMessage.includes("login code invalid")) {
    return "邮箱或验证码不正确，请检查后重试。";
  }
  return extractDesktopAuthErrorMessage(payload, status);
}

async function sendDesktopLoginCode(input: DesktopAuthSendCodeInput) {
  const phone = input.phone?.trim() || "";
  const email = input.email?.trim().toLowerCase() || "";
  const identifier = phone || email;
  const device = collectDesktopDeviceFingerprint();
  const gatewayOrigin = await readGatewayOrigin();
  if (!identifier) {
    throw new Error(phone ? "手机号不能为空。" : "邮箱或手机号不能为空。");
  }
  if (phone && !/^1\d{10}$/.test(phone)) {
    throw new Error("请填写 11 位手机号。");
  }

  let response: Response;
  try {
    response = await fetch(`${gatewayOrigin}/api/desktop/auth/login-code/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...createDesktopAuthHeaders({ device })
      },
      body: JSON.stringify({
        identifier,
        device_id: device.device_id,
        device_name: device.device_name
      })
    });
  } catch (error) {
    const message = `无法连接登录服务 ${gatewayOrigin}，请确认 newbrain.config.json 的 llm.baseUrl 可访问。`;
    await appendDesktopDebugLog(
      `desktop send login code fetch failed: ${error instanceof Error ? error.message : String(error)}`
    );
    throw new Error(message);
  }

  const payload = await readJsonResponse(response);
  if (!response.ok || !(payload as Record<string, unknown> | null)?.ok) {
    const message = extractDesktopAuthErrorMessage(payload, response.status);
    await appendDesktopDebugLog(
      `desktop send login code failed payload: ${JSON.stringify({ status: response.status, payload })}`
    );
    throw new Error(message);
  }

  return payload as Record<string, unknown>;
}

async function logoutDesktopAuth() {
  const persisted = await readDesktopAuthState();
  await appendAuthAuditLog("logout", persisted?.user?.email ? maskEmail(persisted.user.email) : "anonymous");
  if (persisted?.access_token) {
    try {
      const gatewayOrigin = await readGatewayOrigin();
      await fetch(`${gatewayOrigin}/api/desktop/auth/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...createDesktopAuthHeaders({
            accessToken: persisted.access_token,
            device: collectDesktopDeviceFingerprint()
          })
        },
        body: JSON.stringify({
          revoke_gateway_key: true
        })
      });
    } catch (error) {
      await appendDesktopDebugLog(`desktop logout request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await writeDesktopAuthState(null);
  return resolveDesktopAuthStatus();
}

interface ModelConfig {
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
}

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
  browser: BrowserUsePreferences;
  launchAtLogin: boolean;
  shortcuts: Record<string, string>;
}

interface SystemToolEntry {
  id: string;
  label: string;
  kind: "developer" | "system";
  icon: string;
  available: boolean;
  appName: string;
  commands: string[];
}

interface RootConfigFile {
  llm: ModelConfig;
  preferences?: DesktopPreferences;
  mcpServers?: McpServerConfig[];
  mcpDiscoveredTools?: McpDiscoveredTool[];
}

interface WorktreeBindingRecord {
  workspaceId: string;
  threadId?: string;
  branchName: string;
  path: string;
  createdAt: string;
}

interface WorktreeBindingsFile {
  bindings: WorktreeBindingRecord[];
}

interface DesktopAgreementConfig {
  enabled: boolean;
  tos_title?: string;
  tos_content_html?: string;
  policy_title?: string;
  policy_content_html?: string;
  topic_name?: string;
  topic_id?: number;
}

interface DesktopAuthStatus {
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
  account?: PersistedDesktopAuthState["account"];
  agreement?: DesktopAgreementConfig;
  last_error?: string;
  last_checked_at?: string;
}

interface DesktopAuthLoginInput {
  email: string;
  password?: string;
  agreement_accepted: boolean;
  captcha?: string;
}

interface DesktopAuthSendCodeInput {
  email?: string;
  phone?: string;
}

interface PersistedDesktopAuthState {
  mode: "session_cookie" | "desktop_token";
  session_cookie?: string;
  access_token?: string;
  refresh_token?: string;
  expires?: string;
  auth_provider?: string;
  user?: {
    id?: string;
    email?: string;
    display_name?: string;
    idp?: string;
    iat?: number;
    amr?: string[];
    acr?: string;
    mfa?: boolean;
    role?: string;
    plan?: string;
    avatar_text?: string;
  };
  account?: {
    id?: string;
    plan_type?: string;
    structure?: string;
    conversation_classifier_enabled?: boolean;
    finserv_enabled?: boolean;
    fedramp_compliant?: boolean;
    delinquent?: boolean;
    residency_region?: string;
    compute_residency?: string;
  };
  rum_view_tags?: Record<string, unknown>;
  last_synced_at?: string;
}

interface WorkspaceCatalogFile {
  workspaces: WorkspaceCatalogItem[];
}

interface FeatureConfigFile {
  skills: SkillSpec[];
  plugins: PluginSpec[];
  automations: AutomationSpec[];
  runtime: { rustCoreTools: "disabled" | "read" | "read-write" };
}

interface BootstrapEnvironmentConfigItem {
  id: string;
  label?: string;
  enabled?: boolean;
  command?: string;
  args?: string[];
  cwd?: string;
}

interface BootstrapConfigFile {
  environments: BootstrapEnvironmentConfigItem[];
}

type ManagedFeatureKind = "skills" | "plugins" | "automations";

interface FeatureItemInput {
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
}

interface ThreadStateFile {
  version?: 2;
  messages: ChatMessage[];
  memories: MemoryRecord[];
  runs: CommandRun[];
  timeline: WorkspaceTimelineEvent[];
  events?: ThreadEventRecord[];
  context?: ThreadContextState;
}

function normalizeCapabilityList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

async function readJsonFile(filePath: string) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as Record<string, any>;
}

async function resolvePluginManifest(input: FeatureItemInput) {
  const source = (input.manifestPath || input.source || "").trim();
  if (!source) {
    throw new Error("安装插件必须选择真实插件目录或 manifest 文件，不能空数据新增。");
  }
  if (/^https?:\/\//i.test(source)) {
    throw new Error("当前桌面版只支持安装本地插件目录或 manifest 文件，远程插件请先下载到本地。");
  }

  const absoluteSource = resolve(workspacePath, source);
  if (!existsSync(absoluteSource)) {
    throw new Error(`插件来源不存在：${absoluteSource}`);
  }

  const stat = await fs.stat(absoluteSource);
  const candidates = stat.isDirectory()
    ? [
        join(absoluteSource, ".codex-plugin", "plugin.json"),
        join(absoluteSource, ".newbrain-plugin", "plugin.json"),
        join(absoluteSource, "plugin.json"),
        join(absoluteSource, "package.json")
      ]
    : [absoluteSource];
  const manifestPath = candidates.find((candidate) => existsSync(candidate));
  if (!manifestPath) {
    throw new Error("插件目录缺少 .codex-plugin/plugin.json、plugin.json 或 package.json。");
  }

  const manifest = await readJsonFile(manifestPath);
  const pluginRoot = stat.isDirectory()
    ? absoluteSource
    : basename(dirname(manifestPath)) === ".codex-plugin"
      ? dirname(dirname(manifestPath))
      : dirname(manifestPath);
  const name = String(manifest.displayName || manifest.title || manifest.name || input.name || "").trim();
  if (!name) {
    throw new Error(`插件 manifest 缺少 name/displayName：${manifestPath}`);
  }
  const summary = String(manifest.description || manifest.summary || input.summary || "").trim();
  const capabilities = [
    ...normalizeCapabilityList(input.capabilities),
    ...normalizeCapabilityList(manifest.capabilities),
    ...(Array.isArray(manifest.skills) && manifest.skills.length ? ["skills"] : []),
    ...(manifest.mcpServers && Object.keys(manifest.mcpServers).length ? ["mcp"] : []),
    ...(Array.isArray(manifest.apps) && manifest.apps.length ? ["apps"] : [])
  ];

  return {
    id: String(manifest.id || manifest.name || input.id || makeId("plugin")).trim(),
    name,
    summary: summary || "暂无插件说明。",
    status: "connected" as const,
    version: String(manifest.version || input.version || "local").trim(),
    source: pluginRoot,
    manifestPath,
    publisher: String(manifest.publisher || manifest.author?.name || manifest.author || input.publisher || "").trim(),
    capabilities: [...new Set(capabilities.length ? capabilities : ["plugin"])]
  };
}

function resolvePluginContributionPath(pluginRoot: string, contributionPath: string) {
  const resolved = resolve(pluginRoot, contributionPath);
  const normalizedRoot = resolve(pluginRoot);
  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error(`插件贡献路径越界：${contributionPath}`);
  }
  return resolved;
}

async function readPluginContributions(plugin: PluginSpec) {
  if (!plugin.manifestPath || !plugin.source) return { skillRoots: [], mcpServers: [] as McpServerConfig[] };
  const manifest = await readJsonFile(resolvePluginStoragePath(plugin.manifestPath));
  const pluginRoot = resolvePluginStoragePath(plugin.source);
  const skillCandidates = Array.isArray(manifest.skills)
    ? manifest.skills.map((entry: any) => typeof entry === "string" ? entry : String(entry?.path ?? "")).filter(Boolean)
    : [];
  if (existsSync(join(pluginRoot, "skills"))) skillCandidates.push("skills");
  const skillRoots: string[] = [];
  for (const candidate of skillCandidates) {
    const contributionPath = resolvePluginContributionPath(pluginRoot, candidate);
    const root = existsSync(join(contributionPath, "SKILL.md")) ? dirname(contributionPath) : contributionPath;
    if (existsSync(root)) skillRoots.push(root);
  }

  const mcpEntries: Array<[string, any]> = Array.isArray(manifest.mcpServers)
    ? manifest.mcpServers.map((entry: any, index: number) => [String(entry?.id ?? entry?.name ?? index), entry] as [string, any])
    : manifest.mcpServers && typeof manifest.mcpServers === "object"
      ? Object.entries(manifest.mcpServers) as Array<[string, any]>
      : [];
  const mcpServers = mcpEntries.map(([name, raw]: [string, any]) => {
    const command = String(raw?.command ?? "").trim();
    const resolvedCommand = command.startsWith(".") ? resolvePluginContributionPath(pluginRoot, command) : command;
    return normalizeMcpServer({
      id: `${plugin.id}:${name}`,
      name: String(raw?.name ?? `${plugin.name} / ${name}`),
      transport: raw?.transport === "sse" ? "sse" : "stdio",
      command: resolvedCommand,
      args: Array.isArray(raw?.args) ? raw.args.map(String) : [],
      url: String(raw?.url ?? ""),
      env: raw?.env && typeof raw.env === "object" ? raw.env : {},
      enabled: raw?.enabled !== false
    });
  });
  return { skillRoots: [...new Set(skillRoots)], mcpServers };
}

async function activatePlugin(plugin: PluginSpec): Promise<PluginSpec> {
  const contributions = await readPluginContributions(plugin);
  if (contributions.skillRoots.length) await runtime.addSkillRoots(contributions.skillRoots);
  if (contributions.mcpServers.length) {
    const current = await readMcpServers();
    const replacing = new Set(contributions.mcpServers.map((server) => server.id));
    await writeMcpServers([...current.filter((server) => !replacing.has(server.id)), ...contributions.mcpServers]);
  }
  return {
    ...plugin,
    status: "enabled",
    skillRoots: contributions.skillRoots,
    mcpServerIds: contributions.mcpServers.map((server) => server.id),
    lastError: undefined
  };
}

async function deactivatePlugin(plugin: PluginSpec) {
  if (plugin.skillRoots?.length) await runtime.removeSkillRoots(plugin.skillRoots);
  if (plugin.mcpServerIds?.length) {
    const removing = new Set(plugin.mcpServerIds);
    await writeMcpServers((await readMcpServers()).filter((server) => !removing.has(server.id)));
    await writeMcpDiscoveredTools((await readMcpDiscoveredTools()).filter((tool) => !removing.has(tool.serverId)));
    await syncMcpToolsToRuntime();
  }
}

async function queueStartupDailyBriefing(): Promise<void> {
  try {
    const openedAtLogin = process.env.NEWBRAIN_DAILY_BRIEFING === "1"
      || app.getLoginItemSettings().wasOpenedAtLogin === true;
    if (!openedAtLogin) return;
    const authState = await readDesktopAuthState();
    const accessToken = authState?.access_token?.trim() || "";
    if (!accessToken) return;
    const catalog = await readWorkspaceCatalog();
    await deliverStartupDailyBriefing({
      openedAtLogin,
      accessToken,
      gatewayOrigin: await readGatewayOrigin(),
      headers: createDesktopAuthHeaders({
        accessToken,
        device: collectDesktopDeviceFingerprint()
      }),
      catalog,
      addThread: (workspaceId) => addWorkspaceThread({
        workspaceId,
        title: "今日简报",
        summary: "开机后的今日热点",
        scope: "chat"
      }),
      readMessages: async (workspaceId, threadId) => {
        const latest = await readWorkspaceCatalog();
        const workspace = latest.workspaces.find((item) => item.id === workspaceId);
        const thread = workspace?.threads.find((item) => item.id === threadId);
        if (!workspace || !thread) return [];
        const state = await readThreadState(workspace, thread);
        return state.messages ?? [];
      },
      appendAssistantMessage: async (workspaceId, threadId, content) => {
        const latest = await readWorkspaceCatalog();
        const workspace = latest.workspaces.find((item) => item.id === workspaceId);
        const thread = workspace?.threads.find((item) => item.id === threadId);
        if (!workspace || !thread) return;
        const state = await readThreadState(workspace, thread);
        state.messages = [...(state.messages ?? []), {
          id: makeId("message"),
          role: "assistant",
          content,
          createdAt: nowIso()
        }];
        await writeThreadState(workspace, thread, state);
      },
      activate: (workspaceId, threadId) => activateWorkspaceThread({ workspaceId, threadId })
    });
  } catch (error) {
    await appendDesktopDebugLog(`daily briefing skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

setDailyBriefingChatHost({
  readAccessToken: async () => (await readDesktopAuthState())?.access_token?.trim() || "",
  readGatewayOrigin: () => readGatewayOrigin(),
  createHeaders: (accessToken) => createDesktopAuthHeaders({
    accessToken,
    device: collectDesktopDeviceFingerprint()
  }),
  readThreadTitle: async (workspaceId, threadId) => {
    const catalog = await readWorkspaceCatalog();
    const workspace = catalog.workspaces.find((item) => item.id === workspaceId);
    return workspace?.threads.find((item) => item.id === threadId)?.title || "";
  },
  appendMessages: async (workspaceId, threadId, messages) => {
    const catalog = await readWorkspaceCatalog();
    const workspace = catalog.workspaces.find((item) => item.id === workspaceId);
    const thread = workspace?.threads.find((item) => item.id === threadId);
    if (!workspace || !thread) return;
    const state = await readThreadState(workspace, thread);
    const known = new Set((state.messages ?? []).map((item) => item.id));
    const next = messages.filter((item) => !known.has(item.id));
    if (!next.length) return;
    state.messages = [...(state.messages ?? []), ...next];
    await writeThreadState(workspace, thread, state);
    if (runtime && activeWorkspaceId === workspaceId && activeThreadId === threadId) {
      runtime.setThreadState(state);
    }
  },
  snapshot: async () => runtime?.getSnapshot?.() ?? { messages: [] },
  nowIso
});

async function activateConfiguredPlugins() {
  const config = await readFeatureConfig();
  const nextPlugins: PluginSpec[] = [];
  for (const plugin of config.plugins) {
    if ((plugin.status === "connected" || plugin.status === "enabled") && plugin.manifestPath) {
      try {
        nextPlugins.push(await activatePlugin(plugin));
      } catch (error) {
        const lastError = error instanceof Error ? error.message : String(error);
        nextPlugins.push({ ...plugin, status: "disabled", lastError });
        await appendDesktopDebugLog(`plugin activation failed (${plugin.id}): ${lastError}`);
        await appendDiagnosticsLog(`plugin activation failed (${plugin.name || plugin.id}): ${lastError}`);
      }
    } else {
      nextPlugins.push(plugin);
    }
  }
  if (JSON.stringify(nextPlugins) !== JSON.stringify(config.plugins)) {
    await writeFeatureConfig({ ...config, plugins: nextPlugins });
  }
}

type ThreadEventType =
  | "message"
  | "tool_call"
  | "tool_result"
  | "file_change"
  | "run_status"
  | "approval"
  | "feedback"
  | "context_changed"
  | "context_compacted"
  | "skill_loaded"
  | "memory_recalled"
  | "memory_created"
  | "error";

interface ThreadEventRecord {
  id: string;
  type: ThreadEventType;
  createdAt: string;
  turnId?: string;
  payload: Record<string, unknown>;
}

interface ThreadContextState {
  version: 1;
  summary: string;
  compactedMessageIds: string[];
  estimatedTokens: number;
  modelContextWindow: number;
  lastCompactedAt?: string;
  systemPromptHash?: string;
  provider?: string;
  model?: string;
}

interface DesktopPolicyRule {
  id?: string;
  toolName?: string;
  commandPrefix?: string;
  decision: "allow" | "ask" | "deny";
  enabled?: boolean;
  reason?: string;
}

interface WorkspaceCondaConfig {
  source: "system" | "managed";
  condaPath: string;
  envPath: string;
  envName: string;
  pythonVersion: string;
  lastCheckedAt?: string;
  lastProvisionedAt?: string;
}

interface CondaDiscoveryResult {
  config: WorkspaceCondaConfig;
  shellEnv: Record<string, string>;
}

interface ResolvedCondaExecutable {
  source: "system" | "managed";
  condaPath: string;
}

interface ManagedCondaInstallerSpec {
  fileName: string;
  downloadUrl: string;
  installMode: "windows-exe" | "posix-shell";
  platformLabel: string;
}

interface CondaBootstrapEnvironmentSummary {
  platform: NodeJS.Platform;
  arch: string;
  release: string;
  installerSpec: ManagedCondaInstallerSpec | null;
}

type DesktopBootstrapTaskStatus = "pending" | "running" | "ready" | "manual_required";

interface DesktopBootstrapTaskState {
  id: string;
  label: string;
  status: DesktopBootstrapTaskStatus;
  detail?: string;
  startedAt?: string;
  completedAt?: string;
}

interface DesktopBootstrapTaskDefinition {
  id: string;
  label: string;
  enabled: boolean;
  command?: string;
  args?: string[];
  cwd?: string;
}

interface DesktopBootstrapStateFile {
  overall?: {
    status: "ready" | "manual_required" | "pending" | "running";
    currentTaskId?: string;
    message?: string;
    updatedAt: string;
  };
  tasks?: DesktopBootstrapTaskState[];
  conda?: {
    status: "ready" | "manual_required" | "pending" | "running";
    initializedAt?: string;
    updatedAt: string;
    source?: "system" | "managed";
    condaPath?: string;
    reason?: string;
  };
  python?: {
    status: "ready" | "manual_required" | "pending" | "running";
    updatedAt: string;
    pythonPath?: string;
    version?: string;
    reason?: string;
  };
  node?: {
    status: "ready" | "manual_required" | "pending" | "running";
    updatedAt: string;
    nodePath?: string;
    version?: string;
    source?: "system" | "sandbox";
    reason?: string;
  };
  projectDeps?: {
    status: "ready" | "manual_required" | "pending" | "running";
    updatedAt: string;
    packageManager?: "pnpm" | "npm";
    installCwd?: string;
    reason?: string;
  };
}

interface DesktopBootstrapStatusPayload {
  overall: {
    status: "ready" | "manual_required" | "pending" | "running";
    currentTaskId?: string;
    message?: string;
    updatedAt?: string;
    totalTasks: number;
    completedTasks: number;
    progressPercent: number;
  };
  tasks: DesktopBootstrapTaskState[];
  conda: {
    status: "ready" | "manual_required" | "pending" | "running";
    initializedAt?: string;
    updatedAt?: string;
    source?: "system" | "managed";
    condaPath?: string;
    reason?: string;
  };
}

const defaultModelConfig: ModelConfig = {
  provider: "OpenAI",
  baseUrl: configuredGatewayBaseUrlEnv,
  apiKey: "",
  wireApi: "responses",
  model: "gpt-5.4",
  reviewModel: "gpt-5.4-mini",
  reasoningEffort: "medium",
  disableResponseStorage: true,
  systemPrompt: "You are a helpful coding assistant for the NewBrain desktop workspace."
};

const defaultDesktopPreferences: DesktopPreferences = {
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
    defaultOpenTarget: "visual-studio",
    terminalShell: process.platform === "win32" ? "powershell.exe" : "/bin/bash",
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
    dictionaryEntries: []
  },
  worktree: {
    defaultIsolated: true,
    keepArchived: false,
    rootDir: join(workspaceStateRoot, "worktrees")
  },
  browser: {
    ...DEFAULT_BROWSER_USE_PREFERENCES,
    autoOpenPreview: false,
    preserveTabs: true,
    highResScreenshots: false,
    previewUrl: "http://127.0.0.1:3000"
  },
  launchAtLogin: true,
  shortcuts: {}
};

/** Sync Browser Use prefs for policy-engine hooks (updated on read/save). */
let cachedBrowserUsePreferences: DesktopPreferences["browser"] = defaultDesktopPreferences.browser;

const defaultMcpServers: McpServerConfig[] = [];
const shownCondaPromptKeys = new Set<string>();
const defaultBootstrapConfig: BootstrapConfigFile = {
  environments: [
    {
      id: "conda",
      label: "Conda 环境",
      enabled: true
    },
    {
      id: "python",
      label: "Python 运行时",
      enabled: true
    },
    {
      id: "node",
      label: "Node.js 运行时",
      enabled: true
    },
    {
      id: "project-deps",
      label: "项目依赖",
      enabled: true
    }
  ]
};

function createBuiltinPluginSpecs(): PluginSpec[] {
  return builtinPluginCatalog.map((plugin) => ({
    id: plugin.id,
    name: plugin.name,
    summary: plugin.summary,
    version: "1.0.0",
    status: "enabled",
    source: builtinPluginUri(plugin.packageName),
    manifestPath: `${builtinPluginUri(plugin.packageName)}/.codex-plugin/plugin.json`,
    publisher: "NewBrain",
    capabilities: [...plugin.capabilities]
  }));
}

function mergeBuiltinPluginSpecs(plugins: PluginSpec[]) {
  const configured = new Map(plugins.map((plugin) => [plugin.id, plugin]));
  return createBuiltinPluginSpecs().map((plugin) => configured.get(plugin.id) ?? plugin)
    .concat(plugins.filter((plugin) => !builtinPluginCatalog.some((builtin) => builtin.id === plugin.id)));
}

function resolvePluginStoragePath(value: string) {
  if (!value.startsWith("builtin:")) return resolve(value);
  const relativePath = value.slice("builtin:".length).replace(/\//g, sep);
  const resolved = resolve(builtinPluginsRoot, relativePath);
  if (resolved !== builtinPluginsRoot && !resolved.startsWith(`${builtinPluginsRoot}${sep}`)) {
    throw new Error(`内置插件路径越界：${value}`);
  }
  return resolved;
}

const defaultFeatureConfig: FeatureConfigFile = {
  runtime: { rustCoreTools: "disabled" },
  skills: [
    {
      id: "skill-thread-fork",
      name: "线程分叉",
      summary: "从当前线程快速复制上下文，适合并行推进不同方案。",
      status: "enabled"
    },
    {
      id: "skill-workspace-scan",
      name: "工作区扫描",
      summary: "重新扫描当前项目文件树，适合切换目录后刷新上下文。",
      status: "enabled"
    }
  ],
  plugins: [
    {
      id: "plugin-git-console",
      name: "Git 工作台",
      summary: "围绕当前项目空间执行 Git 状态检查并记录到线程时间线。",
      status: "connected",
      version: "builtin",
      source: "builtin",
      capabilities: ["git", "workspace"]
    },
    {
      id: "plugin-shell-runner",
      name: "Shell 执行器",
      summary: "在审批链路控制下排队执行命令。",
      status: "connected",
      version: "builtin",
      source: "builtin",
      capabilities: ["shell", "approval"]
    },
    ...createBuiltinPluginSpecs()
  ],
  automations: [
    {
      id: "automation-git-check",
      title: "Git 巡检",
      status: "idle",
      trigger: "按固定间隔刷新 Git 状态并写入时间线",
      action: "git_status",
      intervalMinutes: 60
    },
    {
      id: "automation-workspace-scan",
      title: "工作区扫描",
      status: "idle",
      trigger: "按固定间隔刷新文件树",
      action: "workspace_scan",
      intervalMinutes: 30
    }
  ]
};

const systemToolCatalog: SystemToolEntry[] = [
  { id: "vscode", label: "VS Code", kind: "developer", icon: "VS", available: false, appName: "Visual Studio Code", commands: ["code"] },
  { id: "finder", label: "Finder", kind: "system", icon: "FD", available: false, appName: "Finder", commands: ["explorer.exe", "xdg-open"] },
  { id: "terminal", label: "Terminal", kind: "system", icon: "TM", available: false, appName: "Terminal", commands: ["wt.exe", "powershell.exe", "cmd.exe", "x-terminal-emulator"] },
  { id: "idea", label: "IntelliJ IDEA", kind: "developer", icon: "IJ", available: false, appName: "IntelliJ IDEA", commands: ["idea64.exe", "idea.exe", "idea"] },
  { id: "pycharm", label: "PyCharm", kind: "developer", icon: "PC", available: false, appName: "PyCharm", commands: ["pycharm64.exe", "pycharm.exe", "pycharm"] }
];

function resolveSystemToolCommand(tool: SystemToolEntry) {
  if (process.platform === "darwin") return "";
  if (process.platform === "win32" && tool.id === "vscode") {
    const knownInstallations = [
      join(process.env.LOCALAPPDATA ?? "", "Programs", "Microsoft VS Code", "Code.exe"),
      join(process.env.ProgramFiles ?? "", "Microsoft VS Code", "Code.exe"),
      join(process.env["ProgramFiles(x86)"] ?? "", "Microsoft VS Code", "Code.exe")
    ];
    const installedExecutable = knownInstallations.find((candidate) => isAbsolute(candidate) && existsSync(candidate));
    if (installedExecutable) return installedExecutable;
  }
  const lookupCommand = process.platform === "win32" ? "where.exe" : "which";
  for (const command of tool.commands) {
    const result = spawnSync(lookupCommand, [command], { encoding: "utf8", windowsHide: true });
    if (result.status === 0) return command;
  }
  return "";
}

function detectSystemToolAvailability(tool: SystemToolEntry, command: string) {
  if (process.platform !== "darwin") return Boolean(command);
  const result = spawnSync("osascript", ["-e", `id of app "${tool.appName}"`], {
    encoding: "utf8"
  });
  return result.status === 0;
}

function getSystemTools() {
  return systemToolCatalog.map((tool) => {
    const command = resolveSystemToolCommand(tool);
    let label = tool.label;
    if (tool.id === "finder" && process.platform !== "darwin") label = "文件资源管理器";
    if (tool.id === "terminal" && process.platform === "win32") {
      label = /^wt(?:\.exe)?$/i.test(command)
        ? "Windows Terminal"
        : /powershell/i.test(command)
          ? "PowerShell"
          : "命令提示符";
    }
    return { ...tool, label, available: detectSystemToolAvailability(tool, command) };
  });
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function makeWorkspaceEnvName(workspaceId: string) {
  const normalized = workspaceId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 32) || "workspace";
  return `newbrain-${normalized}`;
}

function getManagedCondaRoot() {
  return join(workspaceStateRoot, "conda");
}

function getManagedCondaExecutable() {
  if (process.platform === "win32") {
    return join(getManagedCondaRoot(), "Scripts", "conda.exe");
  }
  return join(getManagedCondaRoot(), "bin", "conda");
}

function getWorkspaceEnvRoot(workspaceId: string) {
  return join(getWorkspaceStateDir(workspaceId), "conda-env");
}

function getWorkspacePythonVersion(workspace: WorkspaceCatalogItem) {
  return workspace.conda?.pythonVersion?.trim() || "3.11";
}

function getSystemCondaCandidatePaths() {
  if (process.platform === "win32") {
    const userProfile = process.env.USERPROFILE?.trim() || "";
    const localAppData = process.env.LOCALAPPDATA?.trim() || "";
    const programData = process.env.ProgramData?.trim() || "C:\\ProgramData";
    return [
      "conda.exe",
      "conda.bat",
      userProfile ? join(userProfile, "miniconda3", "Scripts", "conda.exe") : "",
      userProfile ? join(userProfile, "anaconda3", "Scripts", "conda.exe") : "",
      localAppData ? join(localAppData, "miniconda3", "Scripts", "conda.exe") : "",
      localAppData ? join(localAppData, "anaconda3", "Scripts", "conda.exe") : "",
      programData ? join(programData, "miniconda3", "Scripts", "conda.exe") : "",
      programData ? join(programData, "anaconda3", "Scripts", "conda.exe") : ""
    ].filter(Boolean);
  }

  const homeDir = os.homedir();
  return [
    "conda",
    homeDir ? join(homeDir, "miniconda3", "bin", "conda") : "",
    homeDir ? join(homeDir, "anaconda3", "bin", "conda") : "",
    "/opt/miniconda3/bin/conda",
    "/opt/anaconda3/bin/conda"
  ].filter(Boolean);
}

function getSystemNodeCandidatePaths() {
  if (process.platform === "win32") {
    const programFiles = process.env.ProgramFiles?.trim() || "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"]?.trim() || "C:\\Program Files (x86)";
    return [
      "node",
      join(programFiles, "nodejs", "node.exe"),
      join(programFilesX86, "nodejs", "node.exe")
    ];
  }

  return ["node", "/usr/local/bin/node", "/opt/homebrew/bin/node", "/usr/bin/node"];
}

function resolvePreferredNodeExecutable() {
  for (const candidate of getSystemNodeCandidatePaths()) {
    const normalized = candidate.includes(sep) || candidate.includes("/") || candidate.includes("\\")
      ? resolve(candidate)
      : detectCommandPath(candidate);
    if (!normalized) {
      continue;
    }
    if (candidate === "node") {
      return normalized;
    }
    const candidatePath = normalized.trim();
    if (candidatePath) {
      return candidatePath;
    }
  }
  return "";
}

function quoteShellArgument(value: string) {
  if (process.platform === "win32") {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function detectCommandPath(command: string) {
  if (!command.trim()) {
    return "";
  }

  const lookupArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", `where ${command}`]
    : ["-lc", `command -v ${quoteShellArgument(command)}`];
  const lookup = spawnSync(process.platform === "win32" ? "cmd.exe" : "/bin/bash", lookupArgs, {
    encoding: "utf8",
    windowsHide: true
  });
  if (lookup.status !== 0) {
    return "";
  }
  const firstLine = String(lookup.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine || "";
}

function normalizeCondaExecutablePath(candidate: string) {
  if (!candidate.trim()) {
    return "";
  }
  if (candidate.includes(sep) || candidate.includes("/") || candidate.includes("\\")) {
    return resolve(candidate.trim());
  }
  return detectCommandPath(candidate.trim());
}

async function resolvePreferredCondaExecutable() {
  for (const candidate of getSystemCondaCandidatePaths()) {
    const normalized = normalizeCondaExecutablePath(candidate);
    if (!normalized) {
      continue;
    }
    if (candidate === "conda.exe" || candidate === "conda.bat" || candidate === "conda") {
      return { source: "system" as const, condaPath: normalized };
    }
    if (await pathExists(normalized)) {
      return { source: "system" as const, condaPath: normalized };
    }
  }

  const managedCondaPath = getManagedCondaExecutable();
  if (await pathExists(managedCondaPath)) {
    return { source: "managed" as const, condaPath: managedCondaPath };
  }

  return null;
}

function getManagedCondaInstallerSpec(): ManagedCondaInstallerSpec | null {
  if (process.platform === "win32") {
    if (process.arch === "x64") {
      return {
        fileName: "Miniconda3-latest-Windows-x86_64.exe",
        downloadUrl: "https://repo.anaconda.com/miniconda/Miniconda3-latest-Windows-x86_64.exe",
        installMode: "windows-exe",
        platformLabel: "Windows x64"
      };
    }
    return null;
  }

  if (process.platform === "darwin") {
    if (process.arch === "arm64") {
      return {
        fileName: "Miniconda3-latest-MacOSX-arm64.sh",
        downloadUrl: "https://repo.anaconda.com/miniconda/Miniconda3-latest-MacOSX-arm64.sh",
        installMode: "posix-shell",
        platformLabel: "macOS Apple Silicon"
      };
    }
    if (process.arch === "x64") {
      return {
        fileName: "Miniconda3-latest-MacOSX-x86_64.sh",
        downloadUrl: "https://repo.anaconda.com/miniconda/Miniconda3-latest-MacOSX-x86_64.sh",
        installMode: "posix-shell",
        platformLabel: "macOS Intel"
      };
    }
  }

  if (process.platform === "linux") {
    if (process.arch === "arm64") {
      return {
        fileName: "Miniconda3-latest-Linux-aarch64.sh",
        downloadUrl: "https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-aarch64.sh",
        installMode: "posix-shell",
        platformLabel: "Ubuntu Linux arm64"
      };
    }
    if (process.arch === "x64") {
      return {
        fileName: "Miniconda3-latest-Linux-x86_64.sh",
        downloadUrl: "https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh",
        installMode: "posix-shell",
        platformLabel: "Ubuntu Linux x64"
      };
    }
  }

  return null;
}

function summarizeCondaBootstrapEnvironment(): CondaBootstrapEnvironmentSummary {
  return {
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    installerSpec: getManagedCondaInstallerSpec()
  };
}

function getCondaManualInstallMessage(
  reason: string,
  environmentSummary: CondaBootstrapEnvironmentSummary
) {
  const systemLabel = `${environmentSummary.platform} ${environmentSummary.arch} (${environmentSummary.release})`;
  const installerLabel = environmentSummary.installerSpec
    ? `${environmentSummary.installerSpec.platformLabel}: ${environmentSummary.installerSpec.downloadUrl}`
    : "当前系统暂未配置自动下载的 Miniconda 安装包。";
  return [
    `NewBrain 没有检测到可复用的 conda，且暂时不能自动安装。`,
    "",
    `原因：${reason}`,
    `系统环境：${systemLabel}`,
    `建议安装包：${installerLabel}`,
    "",
    "请先在宿主机手动安装 conda/Miniconda，安装完成后重新打开应用。应用会优先复用你已安装的 conda。"
  ].join("\n");
}

async function showCondaManualInstallPrompt(
  reason: string,
  environmentSummary: CondaBootstrapEnvironmentSummary
) {
  const promptKey = `${reason}::${environmentSummary.platform}::${environmentSummary.arch}`;
  if (shownCondaPromptKeys.has(promptKey)) {
    return;
  }

  shownCondaPromptKeys.add(promptKey);
  await dialog.showMessageBox({
    type: "warning",
    title: "需要手动安装 conda",
    message: "未检测到可用 conda，且当前环境不适合自动下载安装。",
    detail: getCondaManualInstallMessage(reason, environmentSummary),
    buttons: ["我知道了"],
    defaultId: 0,
    noLink: true
  });
}

async function canReachPublicUrl(targetUrl: string) {
  try {
    const response = await fetch(targetUrl, {
      method: "HEAD",
      redirect: "follow"
    });
    return response.ok;
  } catch {
    return false;
  }
}

function buildCondaShellEnv(condaPath: string, envPath: string) {
  const nextEnv: Record<string, string> = { ...(process.env as Record<string, string>) };
  const condaDir = dirname(condaPath);
  const condaRoot =
    process.platform === "win32"
      ? dirname(condaDir)
      : dirname(condaDir);
  const envBinDir =
    process.platform === "win32"
      ? join(envPath, "Scripts")
      : join(envPath, "bin");
  const pathEntries = [
    envBinDir,
    process.platform === "win32" ? envPath : "",
    process.platform === "win32" ? join(envPath, "Library", "bin") : "",
    process.platform === "win32" ? join(envPath, "Library", "usr", "bin") : "",
    condaDir,
    process.platform === "win32" ? join(condaRoot, "Library", "bin") : "",
    process.platform === "win32" ? join(condaRoot, "condabin") : join(condaRoot, "condabin"),
    nextEnv.PATH || ""
  ].filter(Boolean);

  nextEnv.PATH = pathEntries.join(delimiter);
  nextEnv.CONDA_EXE = condaPath;
  nextEnv.CONDA_PREFIX = envPath;
  nextEnv.CONDA_DEFAULT_ENV = envPath;
  nextEnv.NEWBRAIN_CONDA_ENV = envPath;
  nextEnv.PYTHONNOUSERSITE = "1";
  return nextEnv;
}

function normalizeModelConfig(input?: Partial<ModelConfig>, fallback: ModelConfig = defaultModelConfig): ModelConfig {
  return {
    provider: input?.provider?.trim() || fallback.provider,
    baseUrl: input?.baseUrl?.trim() || fallback.baseUrl,
    apiKey: typeof input?.apiKey === "string" ? input.apiKey.trim() : fallback.apiKey,
    apiKeyConfigured: input?.apiKeyConfigured === true || fallback.apiKeyConfigured === true,
    wireApi: input?.wireApi === "chat.completions" ? "chat.completions" : "responses",
    model: input?.model?.trim() || fallback.model,
    reviewModel: input?.reviewModel?.trim() || fallback.reviewModel,
    reasoningEffort:
      input?.reasoningEffort === "low" || input?.reasoningEffort === "high" || input?.reasoningEffort === "xhigh"
        ? input.reasoningEffort
        : fallback.reasoningEffort,
    disableResponseStorage:
      typeof input?.disableResponseStorage === "boolean"
        ? input.disableResponseStorage
        : fallback.disableResponseStorage,
    systemPrompt: input?.systemPrompt?.trim() || fallback.systemPrompt
  };
}

function normalizeMcpServer(input?: Partial<McpServerConfig>): McpServerConfig {
  return {
    id: input?.id?.trim() || makeId("mcp"),
    name: input?.name?.trim() || "未命名 MCP 服务器",
    transport: input?.transport === "sse" ? "sse" : "stdio",
    command: input?.command?.trim() || "",
    args: Array.isArray(input?.args)
      ? input.args.map((item) => item.trim()).filter(Boolean)
      : [],
    url: input?.url?.trim() || "",
    env:
      input?.env && typeof input.env === "object"
        ? Object.fromEntries(
            Object.entries(input.env)
              .map(([key, value]) => [key.trim(), typeof value === "string" ? value.trim() : ""])
              .filter(([key]) => key)
          )
        : {},
    enabled: typeof input?.enabled === "boolean" ? input.enabled : true
  };
}

function isRunnableMcpServer(server: McpServerConfig) {
  return server.transport === "stdio"
    ? Boolean(server.command.trim())
    : Boolean(server.url.trim());
}

function normalizeMcpServers(input?: Partial<McpServerConfig>[]) {
  return Array.isArray(input)
    ? input.map(normalizeMcpServer).filter(isRunnableMcpServer)
    : defaultMcpServers;
}

function normalizeDesktopPreferences(input?: Partial<DesktopPreferences>): DesktopPreferences {
  const extraEnv =
    input?.environment?.extraEnv && typeof input.environment.extraEnv === "object"
      ? Object.fromEntries(
          Object.entries(input.environment.extraEnv)
            .map(([key, value]) => [key.trim(), typeof value === "string" ? value.trim() : ""])
            .filter(([key]) => key)
        )
      : defaultDesktopPreferences.environment.extraEnv;
  const normalizeWorktreeRootDir = (value?: string) => {
    const trimmed = value?.trim();
    if (!trimmed) {
      return defaultDesktopPreferences.worktree.rootDir;
    }
    const resolved = resolve(trimmed);
    const relativeToStateRoot = relative(workspaceStateRoot, resolved);
    if (
      app.isPackaged &&
      (relativeToStateRoot.startsWith("..") || isAbsolute(relativeToStateRoot))
    ) {
      return defaultDesktopPreferences.worktree.rootDir;
    }
    return resolved;
  };

  return {
    appearance: {
      theme:
        input?.appearance?.theme === "dark" || input?.appearance?.theme === "system"
          ? input.appearance.theme
          : defaultDesktopPreferences.appearance.theme,
      density: input?.appearance?.density === "compact" ? "compact" : defaultDesktopPreferences.appearance.density,
      reduceMotion:
        typeof input?.appearance?.reduceMotion === "boolean"
          ? input.appearance.reduceMotion
          : defaultDesktopPreferences.appearance.reduceMotion,
      accentColor: /^#[0-9a-f]{6}$/i.test(String(input?.appearance?.accentColor ?? "")) ? String(input?.appearance?.accentColor) : defaultDesktopPreferences.appearance.accentColor,
      backgroundColor: /^#[0-9a-f]{6}$/i.test(String(input?.appearance?.backgroundColor ?? "")) ? String(input?.appearance?.backgroundColor) : defaultDesktopPreferences.appearance.backgroundColor,
      foregroundColor: /^#[0-9a-f]{6}$/i.test(String(input?.appearance?.foregroundColor ?? "")) ? String(input?.appearance?.foregroundColor) : defaultDesktopPreferences.appearance.foregroundColor,
      uiFontFamily: String(input?.appearance?.uiFontFamily ?? "").trim() || defaultDesktopPreferences.appearance.uiFontFamily,
      codeFontFamily: String(input?.appearance?.codeFontFamily ?? "").trim() || defaultDesktopPreferences.appearance.codeFontFamily,
      contrast: Math.max(0, Math.min(100, Number(input?.appearance?.contrast ?? defaultDesktopPreferences.appearance.contrast) || defaultDesktopPreferences.appearance.contrast)),
      uiFontSize: Math.max(11, Math.min(20, Number(input?.appearance?.uiFontSize ?? defaultDesktopPreferences.appearance.uiFontSize) || defaultDesktopPreferences.appearance.uiFontSize)),
      codeFontSize: Math.max(10, Math.min(18, Number(input?.appearance?.codeFontSize ?? defaultDesktopPreferences.appearance.codeFontSize) || defaultDesktopPreferences.appearance.codeFontSize)),
      sidebarTranslucent: typeof input?.appearance?.sidebarTranslucent === "boolean" ? input.appearance.sidebarTranslucent : defaultDesktopPreferences.appearance.sidebarTranslucent,
      pointerCursor: typeof input?.appearance?.pointerCursor === "boolean" ? input.appearance.pointerCursor : defaultDesktopPreferences.appearance.pointerCursor,
      diffMarks: input?.appearance?.diffMarks === "marks" ? "marks" : defaultDesktopPreferences.appearance.diffMarks
    },
    configuration: {
      requireApprovalForShell:
        typeof input?.configuration?.requireApprovalForShell === "boolean"
          ? input.configuration.requireApprovalForShell
          : defaultDesktopPreferences.configuration.requireApprovalForShell,
      saveResponses:
        typeof input?.configuration?.saveResponses === "boolean"
          ? input.configuration.saveResponses
          : defaultDesktopPreferences.configuration.saveResponses,
      telemetryEnabled:
        typeof input?.configuration?.telemetryEnabled === "boolean"
          ? input.configuration.telemetryEnabled
          : defaultDesktopPreferences.configuration.telemetryEnabled
    },
    personalization: {
      workMode:
        input?.personalization?.workMode === "everyday"
          ? "everyday"
          : defaultDesktopPreferences.personalization.workMode,
      proactiveUpdates:
        typeof input?.personalization?.proactiveUpdates === "boolean"
          ? input.personalization.proactiveUpdates
          : defaultDesktopPreferences.personalization.proactiveUpdates,
      includeVerificationSummary:
        typeof input?.personalization?.includeVerificationSummary === "boolean"
          ? input.personalization.includeVerificationSummary
          : defaultDesktopPreferences.personalization.includeVerificationSummary,
      reviewFindingsFirst:
        typeof input?.personalization?.reviewFindingsFirst === "boolean"
          ? input.personalization.reviewFindingsFirst
          : defaultDesktopPreferences.personalization.reviewFindingsFirst
    },
    permissions: {
      fullAccess:
        typeof input?.permissions?.fullAccess === "boolean"
          ? input.permissions.fullAccess
          : defaultDesktopPreferences.permissions.fullAccess
    },
    hooks: {
      beforeCommand:
        typeof input?.hooks?.beforeCommand === "boolean"
          ? input.hooks.beforeCommand
          : defaultDesktopPreferences.hooks.beforeCommand,
      afterCommand:
        typeof input?.hooks?.afterCommand === "boolean"
          ? input.hooks.afterCommand
          : defaultDesktopPreferences.hooks.afterCommand,
      beforeCommit:
        typeof input?.hooks?.beforeCommit === "boolean"
          ? input.hooks.beforeCommit
          : defaultDesktopPreferences.hooks.beforeCommit,
      afterTask:
        typeof input?.hooks?.afterTask === "boolean" ? input.hooks.afterTask : defaultDesktopPreferences.hooks.afterTask,
      beforeCommandScript: input?.hooks?.beforeCommandScript?.trim() || "",
      afterCommandScript: input?.hooks?.afterCommandScript?.trim() || "",
      beforeCommitScript: input?.hooks?.beforeCommitScript?.trim() || "",
      afterTaskScript: input?.hooks?.afterTaskScript?.trim() || ""
    },
    git: {
      statusCommand: input?.git?.statusCommand?.trim() || defaultDesktopPreferences.git.statusCommand,
      branchPrefix: input?.git?.branchPrefix?.trim() || defaultDesktopPreferences.git.branchPrefix,
      showDiffBeforeCommit:
        typeof input?.git?.showDiffBeforeCommit === "boolean"
          ? input.git.showDiffBeforeCommit
          : defaultDesktopPreferences.git.showDiffBeforeCommit,
      confirmBeforePush:
        typeof input?.git?.confirmBeforePush === "boolean"
          ? input.git.confirmBeforePush
          : defaultDesktopPreferences.git.confirmBeforePush,
      pullRequestMergeMethod: input?.git?.pullRequestMergeMethod === "squash" ? "squash" : "merge",
      forcePushWithLease:
        typeof input?.git?.forcePushWithLease === "boolean"
          ? input.git.forcePushWithLease
          : defaultDesktopPreferences.git.forcePushWithLease,
      createDraftPullRequests:
        typeof input?.git?.createDraftPullRequests === "boolean"
          ? input.git.createDraftPullRequests
          : defaultDesktopPreferences.git.createDraftPullRequests,
      autoDeleteOldWorktrees:
        typeof input?.git?.autoDeleteOldWorktrees === "boolean"
          ? input.git.autoDeleteOldWorktrees
          : defaultDesktopPreferences.git.autoDeleteOldWorktrees,
      autoDeleteWorktreeLimit: Math.max(1, Math.min(100, Number(input?.git?.autoDeleteWorktreeLimit) || defaultDesktopPreferences.git.autoDeleteWorktreeLimit)),
      commitInstructions: String(input?.git?.commitInstructions ?? "")
    },
    environment: {
      defaultOpenTarget:
        input?.environment?.defaultOpenTarget === "system" || input?.environment?.defaultOpenTarget === "explorer"
          ? input.environment.defaultOpenTarget
          : defaultDesktopPreferences.environment.defaultOpenTarget,
      terminalShell: input?.environment?.terminalShell?.trim() || defaultDesktopPreferences.environment.terminalShell,
      extraEnv,
      autoBootstrapConda:
        typeof input?.environment?.autoBootstrapConda === "boolean"
          ? input.environment.autoBootstrapConda
          : defaultDesktopPreferences.environment.autoBootstrapConda
    },
    editor: {
      language:
        input?.editor?.language === "zh-CN" || input?.editor?.language === "en-US"
          ? input.editor.language
          : defaultDesktopPreferences.editor.language,
      sendShortcut: input?.editor?.sendShortcut === "mod-enter" ? "mod-enter" : defaultDesktopPreferences.editor.sendShortcut,
      followBehavior: input?.editor?.followBehavior === "guide" ? "guide" : defaultDesktopPreferences.editor.followBehavior
    },
    popup: {
      shortcut: String(input?.popup?.shortcut ?? "").trim(),
      defaultProjectlessChat:
        typeof input?.popup?.defaultProjectlessChat === "boolean"
          ? input.popup.defaultProjectlessChat
          : defaultDesktopPreferences.popup.defaultProjectlessChat
    },
    dictation: {
      microphone: input?.dictation?.microphone === "default" ? "default" : defaultDesktopPreferences.dictation.microphone,
      holdShortcut: String(input?.dictation?.holdShortcut ?? "").trim(),
      toggleShortcut: String(input?.dictation?.toggleShortcut ?? "").trim(),
      keepBarVisible:
        typeof input?.dictation?.keepBarVisible === "boolean"
          ? input.dictation.keepBarVisible
          : defaultDesktopPreferences.dictation.keepBarVisible,
      dictionaryOpen:
        typeof input?.dictation?.dictionaryOpen === "boolean"
          ? input.dictation.dictionaryOpen
          : defaultDesktopPreferences.dictation.dictionaryOpen,
      dictionaryEntries: Array.isArray(input?.dictation?.dictionaryEntries)
        ? input.dictation.dictionaryEntries
            .map((entry) => ({
              timestamp: String(entry?.timestamp ?? "").trim(),
              phrase: String(entry?.phrase ?? "").trim()
            }))
            .filter((entry) => entry.timestamp || entry.phrase)
        : defaultDesktopPreferences.dictation.dictionaryEntries
    },
    worktree: {
      defaultIsolated:
        typeof input?.worktree?.defaultIsolated === "boolean"
          ? input.worktree.defaultIsolated
          : defaultDesktopPreferences.worktree.defaultIsolated,
      keepArchived:
        typeof input?.worktree?.keepArchived === "boolean"
          ? input.worktree.keepArchived
          : defaultDesktopPreferences.worktree.keepArchived,
      rootDir: normalizeWorktreeRootDir(input?.worktree?.rootDir)
    },
    browser: normalizeBrowserUsePreferencesPartial(input?.browser, defaultDesktopPreferences.browser),
    launchAtLogin:
      typeof input?.launchAtLogin === "boolean"
        ? input.launchAtLogin
        : defaultDesktopPreferences.launchAtLogin,
    shortcuts:
      input?.shortcuts && typeof input.shortcuts === "object"
        ? Object.fromEntries(
            Object.entries(input.shortcuts)
              .map(([key, value]) => [key.trim(), typeof value === "string" ? value.trim() : ""])
              .filter(([key, value]) => key && value)
          )
        : defaultDesktopPreferences.shortcuts
  };
}

function normalizeThread(input: Partial<WorkspaceThreadRecord>): WorkspaceThreadRecord {
  const normalizedStatus =
    input.status === "running" ||
    input.status === "awaiting-approval" ||
    input.status === "failed" ||
    input.status === "idle"
      ? input.status
      : "idle";
  const repairKnownMojibakeText = (value?: string) => {
    if (!value) return "";
    return value
      .replaceAll("榛樿绾跨▼", "默认线程")
      .replaceAll("鏈懡鍚嶇嚎绋?", "未命名线程")
      .replaceAll("鏆傛棤绾跨▼鎽樿銆?", "暂无线程摘要。")
      .replaceAll("绾跨▼宸插垱寤?", "线程已创建")
      .replaceAll("姒涙顓荤痪璺ㄢ柤", "默认线程")
      .replaceAll("鏂扮嚎绋?", "新线程")
      .replaceAll("鏂板璇?", "新对话");
  };
  return {
    id: input.id?.trim() || makeId("thread"),
    title: repairKnownMojibakeText(input.title?.trim()) || "未命名线程",
    summary: repairKnownMojibakeText(input.summary?.trim()) || "暂无线程摘要。",
    scope: input.scope === "chat" ? "chat" : "project",
    ...(isBrainWorkspaceKey(input.brainWorkspaceKey) ? { brainWorkspaceKey: input.brainWorkspaceKey } : {}),
    updatedAt: input.updatedAt?.trim() || nowIso(),
    lastEventSummary: repairKnownMojibakeText(input.lastEventSummary?.trim()),
    status: normalizedStatus,
    statusLabel: input.statusLabel?.trim() || "",
    branch: input.branch?.trim() || ""
  };
}

function createDefaultWorkspaceThread(workspaceName: string): WorkspaceThreadRecord {
  return normalizeThread({
    id: makeId("thread"),
    title: "默认线程",
    summary: `${workspaceName || "workspace"} 已准备就绪`,
    scope: "project",
    updatedAt: nowIso(),
    lastEventSummary: "线程已创建"
  });
}

function sortThreads(threads: WorkspaceThreadRecord[]) {
  return [...threads].sort((left, right) => {
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}

function normalizeWorkspaceCondaConfig(
  workspaceId: string,
  input?: Partial<WorkspaceCondaConfig>
): WorkspaceCondaConfig | undefined {
  if (!input?.condaPath?.trim()) {
    return undefined;
  }

  return {
    source: input.source === "managed" ? "managed" : "system",
    condaPath: input.condaPath.trim(),
    envPath: input.envPath?.trim() || getWorkspaceEnvRoot(workspaceId),
    envName: input.envName?.trim() || makeWorkspaceEnvName(workspaceId),
    pythonVersion: input.pythonVersion?.trim() || "3.11",
    lastCheckedAt: input.lastCheckedAt?.trim() || undefined,
    lastProvisionedAt: input.lastProvisionedAt?.trim() || undefined
  };
}

function normalizeWorkspace(item: Partial<WorkspaceCatalogItem>): WorkspaceCatalogItem {
  const resolvedPath = item.path?.trim() ? resolve(item.path.trim()) : workspacePath;
  const workspaceId = item.id?.trim() || makeId("workspace");
  return {
    id: workspaceId,
    name: item.name?.trim() || basename(resolvedPath) || "workspace",
    path: resolvedPath,
    brainWorkspaceKey: isBrainWorkspaceKey(item.brainWorkspaceKey) ? item.brainWorkspaceKey : "document",
    threads: Array.isArray(item.threads) ? sortThreads(item.threads.map(normalizeThread)) : [],
    conda: normalizeWorkspaceCondaConfig(workspaceId, item.conda as Partial<WorkspaceCondaConfig> | undefined)
  };
}

function createTimelineEvent(
  type: WorkspaceTimelineEvent["type"],
  title: string,
  detail: string
): WorkspaceTimelineEvent {
  return {
    id: makeId("event"),
    type,
    title,
    detail,
    createdAt: nowIso()
  };
}

function createDefaultWorkspaceCatalog(): WorkspaceCatalogFile {
  const defaultWorkspacePath = app.isPackaged ? join(workspacePath, "workspace") : workspacePath;
  return {
    workspaces: [
      normalizeWorkspace({
        id: "workspace-newbrain",
        name: basename(defaultWorkspacePath),
        path: defaultWorkspacePath,
        threads: [
          {
            id: "thread-default",
            title: "默认线程",
            summary: "当前项目空间的默认上下文记忆线程。",
            updatedAt: nowIso(),
            lastEventSummary: "线程已创建"
          }
        ]
      })
    ]
  };
}

function createDefaultThreadState(workspaceName: string, threadTitle: string): ThreadStateFile {
  return {
    version: 2,
    messages: [
      {
        id: makeId("msg"),
        role: "system",
        content: `已进入项目空间 ${workspaceName} 的线程“${threadTitle}”。`,
        createdAt: nowIso()
      }
    ],
    memories: [
      {
        id: makeId("memory"),
        scope: "workspace",
        summary: `线程 ${threadTitle} 已创建，可在这里积累该项目空间下的上下文记忆。`,
        createdAt: nowIso()
      }
    ],
    runs: [],
    timeline: [
      createTimelineEvent("thread", "线程已创建", `已创建线程 ${threadTitle}`)
    ],
    events: [],
    context: { version: 1, summary: "", compactedMessageIds: [], estimatedTokens: 0, modelContextWindow: 128_000 }
  };
}

function getWorkspaceStateDir(workspaceId: string) {
  return join(workspaceStateRoot, "workspaces", workspaceId);
}

function getThreadStatePath(workspaceId: string, threadId: string) {
  return getThreadEventLogPath(workspaceId, threadId);
}

function getLegacyThreadStatePath(workspaceId: string, threadId: string) {
  return join(getWorkspaceStateDir(workspaceId), "threads", `${threadId}.json`);
}

function getThreadEventLogPath(workspaceId: string, threadId: string) {
  return join(getWorkspaceStateDir(workspaceId), "threads", `${threadId}.rollout.jsonl`);
}

async function ensureDirectory(targetPath: string) {
  await fs.mkdir(targetPath, { recursive: true });
}

async function ensureExistingDirectory(targetPath: string, label: string) {
  let stats;
  try {
    stats = await fs.stat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`${label} does not exist: ${targetPath}`);
    }
    throw error;
  }

  if (!stats.isDirectory()) {
    throw new Error(`${label} is not a directory: ${targetPath}`);
  }
}

function isPathInsideWorkspaceRoot(targetPath: string) {
  const normalizedRoot = resolve(workspacePath);
  const normalizedTarget = resolve(targetPath);
  const relativePath = relative(normalizedRoot, normalizedTarget);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

async function ensureActivatableWorkspaceDirectory(workspace: WorkspaceCatalogItem) {
  try {
    await ensureExistingDirectory(workspace.path, `Workspace "${workspace.name}" path`);
  } catch (error) {
    if (
      app.isPackaged &&
      (error as NodeJS.ErrnoException).message?.includes("does not exist") &&
      isPathInsideWorkspaceRoot(workspace.path)
    ) {
      await ensureDirectory(workspace.path);
      await appendDesktopDebugLog(`created missing packaged workspace directory id=${workspace.id} path=${workspace.path}`);
      return;
    }
    throw error;
  }
}

async function safeUnlink(targetPath: string) {
  try {
    await fs.unlink(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

async function readWorktreeBindings(): Promise<WorktreeBindingsFile> {
  try {
    const raw = await fs.readFile(desktopWorktreeBindingsPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<WorktreeBindingsFile>;
    return {
      bindings: Array.isArray(parsed.bindings)
        ? parsed.bindings.filter((item) => item.workspaceId && item.path && item.branchName)
        : []
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { bindings: [] };
    }
    throw error;
  }
}

async function writeWorktreeBindings(bindings: WorktreeBindingRecord[]) {
  await ensureDirectory(workspaceStateRoot);
  await fs.writeFile(desktopWorktreeBindingsPath, `${JSON.stringify({ bindings }, null, 2)}\n`, "utf8");
}

async function readRootConfig(): Promise<RootConfigFile> {
  try {
    const raw = await fs.readFile(modelConfigPath, "utf8");
    if (!stripJsonBom(raw).trim()) {
      throw new SyntaxError("empty root config");
    }
    const parsed = parseJsonText<Partial<RootConfigFile>>(raw);
    const legacyPlaintextCredential = parsed.llm?.apiKey?.trim() || "";
    if (legacyPlaintextCredential) {
      await privateModelCredentialVault.replace(legacyPlaintextCredential);
      parsed.llm = { ...parsed.llm, apiKey: "", apiKeyConfigured: true } as ModelConfig;
    }
    const bundledConfig = await readBundledRootConfig();
    const normalized = normalizeRootConfig(parsed, bundledConfig);
    normalized.llm = toRendererSafeModelConfig(
      normalized.llm,
      await privateModelCredentialVault.isConfigured()
    );
    if (legacyPlaintextCredential || shouldRepairRootConfig(parsed, normalized)) {
      await ensureDirectory(dirname(modelConfigPath));
      await fs.writeFile(modelConfigPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    }
    return {
      llm: normalized.llm,
      preferences: normalized.preferences,
      mcpServers: normalized.mcpServers,
      mcpDiscoveredTools: normalized.mcpDiscoveredTools
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const bundledConfig = await readBundledRootConfig();
      const initialConfig = bundledConfig ?? {
        llm: defaultModelConfig,
        preferences: defaultDesktopPreferences,
        mcpServers: defaultMcpServers
      };
      initialConfig.llm = toRendererSafeModelConfig(
        initialConfig.llm,
        await privateModelCredentialVault.isConfigured()
      );
      await fs.writeFile(modelConfigPath, `${JSON.stringify(initialConfig, null, 2)}\n`, "utf8");
      return initialConfig;
    }
    if (error instanceof SyntaxError) {
      await backupCorruptJsonFile(modelConfigPath, error.message);
      const bundledConfig = await readBundledRootConfig();
      const initialConfig = bundledConfig ?? {
        llm: defaultModelConfig,
        preferences: defaultDesktopPreferences,
        mcpServers: defaultMcpServers
      };
      initialConfig.llm = toRendererSafeModelConfig(
        initialConfig.llm,
        await privateModelCredentialVault.isConfigured()
      );
      await ensureDirectory(dirname(modelConfigPath));
      await fs.writeFile(modelConfigPath, `${JSON.stringify(initialConfig, null, 2)}\n`, "utf8");
      return initialConfig;
    }

    throw error;
  }
}

function normalizeRootConfig(
  parsed: Partial<RootConfigFile>,
  bundledConfig: RootConfigFile | null
): RootConfigFile {
  const fallbackModelConfig =
    bundledConfig?.llm && !parsed.llm?.baseUrl?.trim()
      ? { ...defaultModelConfig, baseUrl: bundledConfig.llm.baseUrl }
      : defaultModelConfig;
  const modelConfig = normalizeModelConfig(parsed.llm, fallbackModelConfig);
  return {
    llm: modelConfig,
    preferences: normalizeDesktopPreferences(parsed.preferences),
    mcpServers: normalizeMcpServers(parsed.mcpServers),
    mcpDiscoveredTools: Array.isArray(parsed.mcpDiscoveredTools) ? parsed.mcpDiscoveredTools : []
  };
}

function shouldRepairRootConfig(parsed: Partial<RootConfigFile>, normalized: RootConfigFile) {
  return Boolean(!parsed.llm?.baseUrl?.trim() && normalized.llm.baseUrl.trim());
}

async function readBundledRootConfig(): Promise<RootConfigFile | null> {
  try {
    const raw = await fs.readFile(bundledModelConfigPath, "utf8");
    const parsed = parseJsonText<Partial<RootConfigFile>>(raw);
    const normalized = normalizeRootConfig(parsed, null);
    return {
      ...normalized,
      llm: toRendererSafeModelConfig(normalized.llm, false)
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    await appendDesktopDebugLog(`bundled config read failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function writeRootConfig(nextConfig: ModelConfig) {
  const currentConfig = await readRootConfig();
  const separated = separatePrivateModelCredential(normalizeModelConfig(nextConfig));
  if (separated.credential) {
    await privateModelCredentialVault.replace(separated.credential);
  }
  const payload: RootConfigFile = {
    ...currentConfig,
    llm: toRendererSafeModelConfig(
      separated.config,
      await privateModelCredentialVault.isConfigured()
    ),
    preferences: normalizeDesktopPreferences(currentConfig.preferences)
  };
  await fs.writeFile(modelConfigPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

async function writeDesktopPreferences(nextPreferences: DesktopPreferences) {
  const currentConfig = await readRootConfig();
  const preferences = normalizeDesktopPreferences(nextPreferences);
  const payload: RootConfigFile = {
    ...currentConfig,
    llm: normalizeModelConfig(currentConfig.llm),
    preferences
  };
  await fs.writeFile(modelConfigPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await writeBrowserPermissionsFile(
    workspaceStateRoot,
    preferences.browser.agentPermissions?.exceptions || []
  );
  await applyDesktopPreferences(preferences);
  return preferences;
}

async function readMcpServers() {
  const config = await readRootConfig();
  return normalizeMcpServers(config.mcpServers);
}

async function readMcpDiscoveredTools() {
  const config = await readRootConfig();
  return Array.isArray(config.mcpDiscoveredTools) ? config.mcpDiscoveredTools : [];
}

async function writeMcpDiscoveredTools(nextTools: McpDiscoveredTool[]) {
  const currentConfig = await readRootConfig();
  const payload: RootConfigFile = {
    ...currentConfig,
    llm: normalizeModelConfig(currentConfig.llm),
    preferences: normalizeDesktopPreferences(currentConfig.preferences),
    mcpServers: normalizeMcpServers(currentConfig.mcpServers),
    mcpDiscoveredTools: nextTools
  };
  await fs.writeFile(modelConfigPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload.mcpDiscoveredTools ?? [];
}

async function writeMcpServers(nextServers: McpServerConfig[]) {
  const currentConfig = await readRootConfig();
  const payload: RootConfigFile = {
    ...currentConfig,
    llm: normalizeModelConfig(currentConfig.llm),
    preferences: normalizeDesktopPreferences(currentConfig.preferences),
    mcpServers: normalizeMcpServers(nextServers)
  };
  await fs.writeFile(modelConfigPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  if (runtime) await syncMcpToolsToRuntime();
  return payload.mcpServers ?? [];
}

async function testMcpServer(server: McpServerConfig): Promise<McpServerHealth> {
  const checkedAt = nowIso();

  if (server.transport === "stdio") {
    if (!server.command.trim()) {
      return { ok: false, code: "missing_command", detail: "缺少启动命令。", checkedAt };
    }

    if (mcpRuntimeProcesses.has(server.id)) {
      return {
        ok: true,
        code: "running",
        detail: `进程运行中：${server.command.trim()}`,
        checkedAt,
        running: true
      };
    }

    const inspection = await inspectStdioMcpServer(server);
    return {
      ok: inspection.ok,
      code: inspection.ok ? "mcp_protocol_ok" : "mcp_protocol_failed",
      detail: inspection.ok
        ? `MCP protocol is available${inspection.tools.length ? `; found ${inspection.tools.length} tools` : "; no tools returned"}.`
        : inspection.detail,
      checkedAt,
      running: false
    };
  }

  if (!server.url.trim()) {
    return { ok: false, code: "missing_url", detail: "缺少 SSE 服务地址。", checkedAt };
  }

  try {
    const response = await fetch(server.url.trim(), {
      method: "GET",
      headers: {
        Accept: "text/event-stream, application/json;q=0.9, */*;q=0.8"
      }
    });
    return {
      ok: response.ok,
      code: response.ok ? "http_ok" : `http_${response.status}`,
      detail: response.ok ? `连接成功，HTTP ${response.status}` : `连接失败，HTTP ${response.status}`,
      checkedAt,
      running: false
    };
  } catch (error) {
    return {
      ok: false,
      code: "network_error",
      detail: error instanceof Error ? error.message : String(error),
      checkedAt,
      running: false
    };
  }
}

async function startMcpServer(server: McpServerConfig): Promise<McpServerHealth> {
  const checkedAt = nowIso();

  if (server.transport !== "stdio") {
    return {
      ok: false,
      code: "unsupported_transport",
      detail: "仅 stdio 类型支持本地启动。",
      checkedAt,
      running: false
    };
  }

  if (!server.command.trim()) {
    return {
      ok: false,
      code: "missing_command",
      detail: "缺少启动命令。",
      checkedAt,
      running: false
    };
  }

  if (mcpRuntimeProcesses.has(server.id)) {
    return {
      ok: true,
      code: "already_running",
      detail: "进程已在运行。",
      checkedAt,
      running: true
    };
  }

  try {
    const child = spawn(server.command, server.args, {
      cwd: workspacePath,
      env: {
        ...process.env,
        ...server.env
      },
      stdio: "pipe"
    });

    mcpRuntimeProcesses.set(server.id, child);
    mcpRuntimeLogs.set(server.id, []);
    pushMcpRuntimeLog(server.id, `启动命令：${server.command}${server.args.length ? ` ${server.args.join(" ")}` : ""}`);
    child.stdout.on("data", (chunk) => {
      pushMcpRuntimeLog(server.id, `stdout: ${String(chunk).trimEnd()}`);
    });
    child.stderr.on("data", (chunk) => {
      pushMcpRuntimeLog(server.id, `stderr: ${String(chunk).trimEnd()}`);
    });
    child.once("exit", () => {
      pushMcpRuntimeLog(server.id, "进程已退出");
      mcpRuntimeProcesses.delete(server.id);
    });
    child.once("error", (error) => {
      pushMcpRuntimeLog(server.id, `进程错误：${error.message}`);
      mcpRuntimeProcesses.delete(server.id);
    });

    return {
      ok: true,
      code: "started",
      detail: `已启动进程：${server.command}${server.args.length ? ` ${server.args.join(" ")}` : ""}`,
      checkedAt,
      running: true
    };
  } catch (error) {
    return {
      ok: false,
      code: "spawn_failed",
      detail: error instanceof Error ? error.message : String(error),
      checkedAt,
      running: false
    };
  }
}

async function stopMcpServer(server: McpServerConfig): Promise<McpServerHealth> {
  const checkedAt = nowIso();
  const child = mcpRuntimeProcesses.get(server.id);

  if (!child) {
    return {
      ok: false,
      code: "not_running",
      detail: "当前没有运行中的本地进程。",
      checkedAt,
      running: false
    };
  }

  try {
    child.kill("SIGTERM");
    mcpRuntimeProcesses.delete(server.id);
    return {
      ok: true,
      code: "stopped",
      detail: "已停止本地 MCP 进程。",
      checkedAt,
      running: false
    };
  } catch (error) {
    return {
      ok: false,
      code: "stop_failed",
      detail: error instanceof Error ? error.message : String(error),
      checkedAt,
      running: true
    };
  }
}

function encodeMcpFrame(payload: unknown) {
  return encodeMcpMessage(payload);
}

function encodeLegacyMcpFrame(payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8"), body]);
}

async function inspectStdioMcpServer(server: McpServerConfig): Promise<McpServerInspection> {
  const checkedAt = nowIso();

  return await new Promise<McpServerInspection>((resolveResult) => {
    const child = spawn(server.command, server.args, {
      cwd: workspacePath,
      env: {
        ...process.env,
        ...server.env
      },
      stdio: "pipe"
    });

    let buffer = Buffer.alloc(0);
    let settled = false;
    let initialized = false;
    let serverInfo = "";
    let protocolVersion = "";
    const finish = (payload: McpServerInspection) => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      resolveResult(payload);
    };

    const parseFrames = () => {
      if (!/^Content-Length:/i.test(buffer.slice(0, Math.min(buffer.length, 32)).toString("utf8"))) {
        const decoded = decodeMcpMessages(buffer);
        if (decoded.error) {
          finish({ ok: false, detail: decoded.error.message, checkedAt, tools: [] });
          return;
        }
        if (decoded.messages.length) {
          buffer = Buffer.concat([...decoded.messages.map(encodeLegacyMcpFrame), decoded.rest]);
        }
      }
      while (true) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) {
          return;
        }
        const headerText = buffer.slice(0, headerEnd).toString("utf8");
        const lengthMatch = headerText.match(/Content-Length:\s*(\d+)/i);
        if (!lengthMatch) {
          finish({
            ok: false,
            detail: "MCP 响应缺少 Content-Length。",
            checkedAt,
            tools: []
          });
          return;
        }
        const contentLength = Number(lengthMatch[1]);
        const frameEnd = headerEnd + 4 + contentLength;
        if (buffer.length < frameEnd) {
          return;
        }
        const body = buffer.slice(headerEnd + 4, frameEnd).toString("utf8");
        buffer = buffer.slice(frameEnd);

        try {
          const message = JSON.parse(body) as any;
          if (message.id === 1 && message.result) {
            initialized = true;
            serverInfo = message.result.serverInfo?.name
              ? `${message.result.serverInfo.name}${message.result.serverInfo.version ? ` ${message.result.serverInfo.version}` : ""}`
              : "";
            protocolVersion = String(message.result.protocolVersion ?? "");
            child.stdin.write(
              encodeMcpFrame({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })
            );
            child.stdin.write(
              encodeMcpFrame({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
            );
          } else if (message.id === 2) {
            const tools = Array.isArray(message.result?.tools)
              ? message.result.tools.map((tool: any) => ({
                  name: String(tool?.name ?? "unknown"),
                  description: String(tool?.description ?? ""),
                  inputSchema:
                    tool?.inputSchema && typeof tool.inputSchema === "object"
                      ? tool.inputSchema
                      : undefined
                }))
              : [];
            finish({
              ok: true,
              detail: tools.length > 0 ? `已读取 ${tools.length} 个工具。` : "服务已连接，但未返回工具。",
              checkedAt,
              serverInfo,
              protocolVersion,
              tools
            });
            return;
          } else if (message.error) {
            finish({
              ok: false,
              detail: message.error?.message ? String(message.error.message) : "MCP 返回错误。",
              checkedAt,
              serverInfo,
              protocolVersion,
              tools: []
            });
            return;
          }
        } catch (error) {
          finish({
            ok: false,
            detail: error instanceof Error ? error.message : String(error),
            checkedAt,
            tools: []
          });
          return;
        }
      }
    };

    child.stdout.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      parseFrames();
    });

    child.stderr.on("data", (chunk) => {
      pushMcpRuntimeLog(server.id, `inspect stderr: ${String(chunk).trimEnd()}`);
    });

    child.once("error", (error) => {
      finish({
        ok: false,
        detail: error.message,
        checkedAt,
        tools: []
      });
    });

    child.stdin.write(
      encodeMcpFrame({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: {
            name: "NewBrain desktop",
            version: "0.1.0"
          }
        }
      })
    );

    child.once("exit", () => {
      if (!settled && !initialized) {
        finish({
          ok: false,
          detail: "MCP 进程在握手完成前退出。",
          checkedAt,
          tools: []
        });
      }
    });
  });
}

async function inspectMcpServer(server: McpServerConfig): Promise<McpServerInspection> {
  if (server.transport !== "stdio") {
    return {
      ok: false,
      detail: "当前仅支持 stdio 类型的协议探测。",
      checkedAt: nowIso(),
      tools: []
    };
  }

  if (!server.command.trim()) {
    return {
      ok: false,
      detail: "缺少启动命令。",
      checkedAt: nowIso(),
      tools: []
    };
  }

  return inspectStdioMcpServer(server);
}

async function persistMcpInspection(server: McpServerConfig, inspection: McpServerInspection) {
  const currentTools = await readMcpDiscoveredTools();
  const filtered = currentTools.filter((tool) => tool.serverId !== server.id);
  const nextTools = [
    ...inspection.tools.map((tool) => ({
      id: `${server.id}:${tool.name}`,
      serverId: server.id,
      serverName: server.name,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      protocolVersion: inspection.protocolVersion,
      discoveredAt: inspection.checkedAt
    })),
    ...filtered
  ];
  const persisted = await writeMcpDiscoveredTools(nextTools);
  if (runtime) await syncMcpToolsToRuntime();
  return persisted;
}

async function restoreEnabledMcpServers() {
  const servers = (await readMcpServers()).filter((server) => server.enabled && server.transport === "stdio");
  const results = await Promise.allSettled(servers.map((server) => startMcpServer(server)));
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (result.status === "rejected" || !result.value.ok) {
      const detail = result.status === "rejected"
        ? result.reason instanceof Error ? result.reason.message : String(result.reason)
        : result.value.detail;
      pushMcpRuntimeLog(servers[index].id, `自动恢复失败：${detail}`);
    }
  }
}

async function callStdioMcpTool(
  server: McpServerConfig,
  toolName: string,
  query: string,
  args?: Record<string, unknown>
): Promise<McpToolCallResult> {
  return await new Promise<McpToolCallResult>((resolveResult) => {
    const child = spawn(server.command, server.args, {
      cwd: workspacePath,
      env: {
        ...process.env,
        ...server.env
      },
      stdio: "pipe"
    });

    let buffer = Buffer.alloc(0);
    let settled = false;
    const finish = (payload: McpToolCallResult) => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      resolveResult(payload);
    };

    const parseFrames = () => {
      if (!/^Content-Length:/i.test(buffer.slice(0, Math.min(buffer.length, 32)).toString("utf8"))) {
        const decoded = decodeMcpMessages(buffer);
        if (decoded.error) {
          finish({
            ok: false,
            toolName,
            serverName: server.name,
            detail: decoded.error.message,
            content: ""
          });
          return;
        }
        if (decoded.messages.length) {
          buffer = Buffer.concat([...decoded.messages.map(encodeLegacyMcpFrame), decoded.rest]);
        }
      }
      while (true) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) {
          return;
        }
        const headerText = buffer.slice(0, headerEnd).toString("utf8");
        const lengthMatch = headerText.match(/Content-Length:\s*(\d+)/i);
        if (!lengthMatch) {
          finish({
            ok: false,
            toolName,
            serverName: server.name,
            detail: "响应缺少 Content-Length。",
            content: ""
          });
          return;
        }
        const contentLength = Number(lengthMatch[1]);
        const frameEnd = headerEnd + 4 + contentLength;
        if (buffer.length < frameEnd) {
          return;
        }
        const body = buffer.slice(headerEnd + 4, frameEnd).toString("utf8");
        buffer = buffer.slice(frameEnd);

        try {
          const message = JSON.parse(body) as any;
          if (message.id === 1 && message.result) {
            child.stdin.write(encodeMcpFrame({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }));
            child.stdin.write(
              encodeMcpFrame({
                jsonrpc: "2.0",
                id: 2,
                method: "tools/call",
                params: {
                    name: toolName,
                    arguments: {
                      query,
                      input: query,
                      prompt: query,
                      ...(args ?? {})
                    }
                }
              })
            );
          } else if (message.id === 2) {
            const contentItems = Array.isArray(message.result?.content) ? message.result.content : [];
            const text = contentItems
              .map((item: any) => {
                if (typeof item?.text === "string") {
                  return item.text;
                }
                return typeof item === "string" ? item : JSON.stringify(item);
              })
              .filter(Boolean)
              .join("\n\n")
              .trim();
            finish({
              ok: true,
              toolName,
              serverName: server.name,
              detail: "工具调用成功。",
              content: text || JSON.stringify(message.result ?? {}, null, 2)
            });
            return;
          } else if (message.error) {
            finish({
              ok: false,
              toolName,
              serverName: server.name,
              detail: String(message.error?.message ?? "工具调用失败。"),
              content: ""
            });
            return;
          }
        } catch (error) {
          finish({
            ok: false,
            toolName,
            serverName: server.name,
            detail: error instanceof Error ? error.message : String(error),
            content: ""
          });
          return;
        }
      }
    };

    child.stdout.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      parseFrames();
    });

    child.once("error", (error) => {
      finish({
        ok: false,
        toolName,
        serverName: server.name,
        detail: error.message,
        content: ""
      });
    });

    child.stdin.write(
      encodeMcpFrame({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: {
            name: "NewBrain desktop",
            version: "0.1.0"
          }
        }
      })
    );
  });
}

async function callMcpTool(toolId: string, query: string, args?: Record<string, unknown>) {
  const discoveredTools = await readMcpDiscoveredTools();
  const tool = discoveredTools.find((item) => item.id === toolId);
  if (!tool) {
    return {
      ok: false,
      toolName: toolId,
      serverName: "",
      detail: "未找到已发现的 MCP 工具。",
      content: ""
    };
  }

  const servers = await readMcpServers();
  const server = servers.find((item) => item.id === tool.serverId);
  if (!server) {
    return {
      ok: false,
      toolName: tool.name,
      serverName: tool.serverName,
      detail: "未找到对应的 MCP 服务器配置。",
      content: ""
    };
  }

  if (server.transport !== "stdio") {
    return {
      ok: false,
      toolName: tool.name,
      serverName: tool.serverName,
      detail: "当前仅支持 stdio MCP 工具调用。",
      content: ""
    };
  }

  return callStdioMcpTool(server, tool.name, query, args);
}

function toModelToolName(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
}

async function syncMcpToolsToRuntime() {
  runtime.unregisterExternalTools("mcp");
  const [tools, servers] = await Promise.all([readMcpDiscoveredTools(), readMcpServers()]);
  const enabledServers = new Set(servers.filter((server) => server.enabled).map((server) => server.id));
  for (const tool of tools) {
    if (!enabledServers.has(tool.serverId)) continue;
    const modelName = toModelToolName(`mcp__${tool.serverId}__${tool.name}`);
    runtime.registerExternalTool({
      name: modelName,
      title: `${tool.serverName}: ${tool.name}`,
      description: tool.description || `Call MCP tool ${tool.name} on ${tool.serverName}.`,
      kind: "read",
      risk: "medium",
      requiresApproval: true,
      inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
      namespace: "mcp"
    }, async (args) => {
      const query = String(args.query ?? args.input ?? args.prompt ?? "");
      const result = await callMcpTool(tool.id, query, args);
      return {
        ok: result.ok,
        exitCode: result.ok ? 0 : 1,
        output: result.content || result.detail,
        command: modelName,
        mcp: {
          toolId: tool.id,
          serverId: tool.serverId,
          serverName: tool.serverName
        }
      };
    });
  }
  return runtime.getToolDescriptors().filter((tool: any) => tool.namespace === "mcp");
}

function normalizeSkillName(rawName: string) {
  return rawName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

function titleCaseSkillName(skillName: string) {
  return skillName
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function yamlDoubleQuoted(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n")}"`;
}

function makeSkillDescription(input: FeatureItemInput, skillName: string) {
  const summary = input.summary?.trim();
  if (summary) return summary.slice(0, 1024);
  return `Use when Codex needs the ${skillName} skill. Describe concrete triggers, workflow guidance, and reusable resources in this skill.`;
}

function makeOpenAiYaml(skillName: string, displayName: string, description: string) {
  const shortDescription = description.replace(/\s+/g, " ").trim().slice(0, 84) || `Use ${displayName}.`;
  return [
    "interface:",
    `  display_name: ${yamlDoubleQuoted(displayName)}`,
    `  short_description: ${yamlDoubleQuoted(shortDescription)}`,
    `  default_prompt: ${yamlDoubleQuoted(`Use $${skillName} to help with this task.`)}`,
    "",
    "policy:",
    "  allow_implicit_invocation: true",
    ""
  ].join("\n");
}

function makeSkillMarkdown(skillName: string, displayName: string, description: string) {
  return [
    "---",
    `name: ${skillName}`,
    `description: ${description}`,
    "---",
    "",
    `# ${displayName}`,
    "",
    "## Overview",
    "",
    description,
    "",
    "## Workflow",
    "",
    "- Identify whether the current user request matches this skill's trigger description.",
    "- Apply the domain-specific guidance in this file before choosing tools or producing output.",
    "- Prefer project-local evidence and reusable resources in this skill when they are relevant.",
    "",
    "## Resources",
    "",
    "- Use `references/` for detailed guidance that should be loaded only when needed.",
    "- Use `scripts/` for deterministic helpers that can be executed repeatedly.",
    "- Use `assets/` for templates, examples, images, or other files used in outputs.",
    ""
  ].join("\n");
}

function validateSkillMarkdown(skillName: string, markdown: string) {
  if (!/^---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(markdown)) {
    throw new Error("Skill SKILL.md must start with YAML frontmatter.");
  }
  if (!/^[a-z0-9-]+$/.test(skillName) || skillName.startsWith("-") || skillName.endsWith("-") || skillName.includes("--")) {
    throw new Error(`Invalid skill name: ${skillName}`);
  }
  if (skillName.length > 64) {
    throw new Error(`Skill name is too long: ${skillName}`);
  }
  if (!new RegExp(`^name:\\s*${skillName}\\s*$`, "m").test(markdown)) {
    throw new Error("Skill SKILL.md frontmatter is missing the expected name.");
  }
  if (!/^description:\s*\S/m.test(markdown)) {
    throw new Error("Skill SKILL.md frontmatter is missing description.");
  }
}

function parseSkillFrontmatter(source: string, fallbackName: string) {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  const fields: Record<string, string> = {};
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const field = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
      if (field) {
        const rawValue = field[2].trim();
        fields[field[1]] =
          (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
          (rawValue.startsWith("'") && rawValue.endsWith("'"))
            ? rawValue.slice(1, -1)
            : rawValue;
      }
    }
  }
  return {
    name: fields.name?.trim() || fallbackName,
    description: fields.description?.trim() || ""
  };
}

async function discoverWorkspaceSkillSpecs() {
  const discovered: SkillSpec[] = [];
  const roots = [userSkillRoot, join(workspacePath, "skills")];
  for (const root of roots) {
    let entries;
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = join(root, entry.name, "SKILL.md");
      let source;
      try {
        source = await fs.readFile(skillPath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      const metadata = parseSkillFrontmatter(source, entry.name);
      const name = normalizeSkillName(metadata.name);
      if (!name) continue;
      discovered.push({
        id: `skill-${name}`,
        name,
        summary: metadata.description || "Codex skill",
        status: "enabled"
      });
    }
  }
  return discovered;
}

async function syncDiscoveredSkills(config: FeatureConfigFile) {
  const discoveredSkills = await discoverWorkspaceSkillSpecs();
  if (!discoveredSkills.length) return config;
  const existingKeys = new Set(config.skills.map((skill) => skill.name || skill.id));
  const merged = [
    ...discoveredSkills.filter((skill) => !existingKeys.has(skill.name) && !existingKeys.has(skill.id)),
    ...config.skills
  ];
  if (merged.length === config.skills.length) return config;
  const nextConfig = { ...config, skills: merged };
  await writeFeatureConfig(nextConfig);
  return nextConfig;
}

function getManagedSkillPath(skillName: string) {
  const normalized = normalizeSkillName(skillName);
  return normalized ? join(userSkillRoot, normalized) : "";
}

async function updateManagedSkillScaffold(current: SkillSpec, input: FeatureItemInput): Promise<SkillSpec> {
  const requestedName = input.name?.trim() || current.name;
  const nextName = normalizeSkillName(requestedName);
  if (!nextName) throw new Error("Please provide a valid skill name.");

  const currentPath = getManagedSkillPath(current.name);
  const nextPath = getManagedSkillPath(nextName);
  if (!currentPath || !existsSync(currentPath)) {
    throw new Error(`Managed skill directory was not found: ${current.name}`);
  }
  if (currentPath !== nextPath && existsSync(nextPath)) {
    throw new Error(`Skill directory already exists: ${nextPath}`);
  }

  const description = makeSkillDescription(input, nextName);
  const displayName = requestedName || titleCaseSkillName(nextName);
  const skillMarkdown = makeSkillMarkdown(nextName, displayName, description);
  validateSkillMarkdown(nextName, skillMarkdown);

  if (currentPath !== nextPath) {
    await fs.rename(currentPath, nextPath);
  }
  await ensureDirectory(join(nextPath, "agents"));
  await fs.writeFile(join(nextPath, "SKILL.md"), skillMarkdown, "utf8");
  await fs.writeFile(join(nextPath, "agents", "openai.yaml"), makeOpenAiYaml(nextName, displayName, description), "utf8");
  await runtime.addSkillRoots([userSkillRoot]);
  return {
    id: `skill-${nextName}`,
    name: nextName,
    summary: description,
    status: input.status === "disabled" ? "disabled" : input.status === "planned" ? "planned" : "enabled",
    icon: input.icon?.trim() || current.icon,
    source: input.source?.trim() || current.source,
    scope: input.scope?.trim() || current.scope,
    path: input.path?.trim() || current.path
  };
}

async function deleteManagedSkillScaffold(skill: SkillSpec) {
  const skillPath = getManagedSkillPath(skill.name);
  if (!skillPath || !existsSync(skillPath)) return;
  const normalizedRoot = resolve(userSkillRoot);
  const normalizedPath = resolve(skillPath);
  if (normalizedPath === normalizedRoot || !normalizedPath.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error(`Refusing to delete skill outside managed root: ${skillPath}`);
  }
  await fs.rm(normalizedPath, { recursive: true, force: true });
  await runtime.addSkillRoots([userSkillRoot]);
}

async function createSkillScaffold(input: FeatureItemInput): Promise<SkillSpec> {
  const requestedName = input.name?.trim() || input.title?.trim() || input.id?.trim() || "";
  const skillName = normalizeSkillName(requestedName);
  if (!skillName) {
    throw new Error("Please provide a skill name containing at least one English letter or digit.");
  }
  const skillDir = join(userSkillRoot, skillName);
  if (existsSync(skillDir)) {
    throw new Error(`Skill directory already exists: ${skillDir}`);
  }

  const displayName = requestedName || titleCaseSkillName(skillName);
  const description = makeSkillDescription(input, skillName);
  const skillMarkdown = makeSkillMarkdown(skillName, displayName, description);
  validateSkillMarkdown(skillName, skillMarkdown);

  await ensureDirectory(skillDir);
  await ensureDirectory(join(skillDir, "agents"));
  await fs.writeFile(join(skillDir, "SKILL.md"), skillMarkdown, "utf8");
  await fs.writeFile(join(skillDir, "agents", "openai.yaml"), makeOpenAiYaml(skillName, displayName, description), "utf8");
  await runtime.addSkillRoots([userSkillRoot]);

  return {
    id: input.id?.trim() || `skill-${skillName}`,
    name: skillName,
    summary: description,
    status: input.status === "disabled" ? "disabled" : input.status === "planned" ? "planned" : "enabled",
    icon: input.icon?.trim() || undefined,
    source: input.source?.trim() || "local",
    scope: input.scope?.trim() || "workspace",
    path: input.path?.trim() || "SKILL.md"
  };
}

function normalizePluginName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "")
    .slice(0, 64);
}

async function createPluginScaffold(input: FeatureItemInput) {
  const pluginName = normalizePluginName(input.name ?? "");
  if (!pluginName) {
    throw new Error("请输入有效的插件名称。名称需要包含英文字母或数字。");
  }
  const version = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(input.version?.trim() ?? "")
    ? input.version!.trim()
    : "0.1.0";
  const parentDirectory = input.source?.trim()
    ? resolve(input.source.trim())
    : join(os.homedir(), "plugins");
  const pluginRoot = join(parentDirectory, pluginName);
  if (existsSync(pluginRoot)) {
    throw new Error(`插件目录已经存在：${pluginRoot}`);
  }

  const summary = input.summary?.trim() || `${pluginName} plugin for NewBrain.`;
  const manifest = {
    name: pluginName,
    version,
    description: summary,
    author: { name: "NewBrain" },
    interface: {
      displayName: input.name?.trim() || pluginName,
      shortDescription: summary.slice(0, 120),
      longDescription: summary,
      developerName: "NewBrain",
      category: "Productivity",
      capabilities: ["Interactive"]
    }
  };
  const manifestDirectory = join(pluginRoot, ".codex-plugin");
  await ensureDirectory(manifestDirectory);
  await fs.writeFile(
    join(manifestDirectory, "plugin.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  return pluginRoot;
}

async function readFeatureConfig(): Promise<FeatureConfigFile> {
  try {
    const raw = await fs.readFile(featureConfigPath, "utf8");
    if (!stripJsonBom(raw).trim()) {
      throw new SyntaxError("empty feature config");
    }
    const normalized = normalizeFeatureConfig(parseJsonText<Partial<FeatureConfigFile>>(raw));
    return syncDiscoveredSkills({ ...normalized, plugins: mergeBuiltinPluginSpecs(normalized.plugins) });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const bundledConfig = await readBundledFeatureConfig();
      const initialConfig = bundledConfig ?? defaultFeatureConfig;
      await ensureDirectory(dirname(featureConfigPath));
      await fs.writeFile(featureConfigPath, `${JSON.stringify(initialConfig, null, 2)}\n`, "utf8");
      return syncDiscoveredSkills({ ...initialConfig, plugins: mergeBuiltinPluginSpecs(initialConfig.plugins) });
    }
    if (error instanceof SyntaxError) {
      await backupCorruptJsonFile(featureConfigPath, error.message);
      const bundledConfig = await readBundledFeatureConfig();
      const initialConfig = bundledConfig ?? defaultFeatureConfig;
      await ensureDirectory(dirname(featureConfigPath));
      await fs.writeFile(featureConfigPath, `${JSON.stringify(initialConfig, null, 2)}\n`, "utf8");
      return syncDiscoveredSkills({ ...initialConfig, plugins: mergeBuiltinPluginSpecs(initialConfig.plugins) });
    }

    throw error;
  }
}

async function readPolicyRules(): Promise<DesktopPolicyRule[]> {
  try {
    const parsed = parseJsonText<{ rules?: DesktopPolicyRule[] }>(await fs.readFile(policyRulesPath, "utf8"));
    return Array.isArray(parsed.rules) ? parsed.rules : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await ensureDirectory(dirname(policyRulesPath));
    await fs.writeFile(policyRulesPath, `${JSON.stringify({ version: 1, rules: [] }, null, 2)}\n`, "utf8");
    return [];
  }
}

async function writePolicyRules(rules: DesktopPolicyRule[]) {
  const normalized: DesktopPolicyRule[] = rules.map((rule, index) => ({
    id: rule.id?.trim() || `rule-${index + 1}`,
    toolName: rule.toolName?.trim() || "*",
    commandPrefix: rule.commandPrefix?.trim() || "",
    decision: rule.decision === "allow" || rule.decision === "deny" ? rule.decision : "ask",
    enabled: rule.enabled !== false,
    reason: rule.reason?.trim() || ""
  }));
  await ensureDirectory(dirname(policyRulesPath));
  await fs.writeFile(policyRulesPath, `${JSON.stringify({ version: 1, rules: normalized }, null, 2)}\n`, "utf8");
  runtime.setPolicyRules(normalized);
  return normalized;
}

function normalizeFeatureConfig(parsed: Partial<FeatureConfigFile>): FeatureConfigFile {
  const isPortableFeaturePath = (value?: string) => {
    const trimmed = value?.trim();
    if (!trimmed || trimmed === "builtin" || trimmed.startsWith("builtin:")) {
      return true;
    }
    if (/^https?:\/\//i.test(trimmed)) {
      return true;
    }
    const resolved = resolve(trimmed);
    const relativeToWorkspaceState = relative(workspaceStateRoot, resolved);
    const relativeToWorkspace = relative(workspacePath, resolved);
    return (
      (!relativeToWorkspaceState.startsWith("..") && !isAbsolute(relativeToWorkspaceState)) ||
      (!relativeToWorkspace.startsWith("..") && !isAbsolute(relativeToWorkspace))
    );
  };
  const normalizePluginForCurrentInstall = (plugin: PluginSpec) => {
    if (!app.isPackaged || plugin.source === "builtin" || String(plugin.source || "").startsWith("builtin:")) {
      return plugin;
    }
    const sourceOk = isPortableFeaturePath(plugin.source);
    const manifestOk = isPortableFeaturePath(plugin.manifestPath);
    const skillRoots = Array.isArray(plugin.skillRoots)
      ? plugin.skillRoots.filter((root) => isPortableFeaturePath(root))
      : [];
    if (!sourceOk || !manifestOk) {
      return null;
    }
    return { ...plugin, skillRoots };
  };
  const plugins = (Array.isArray(parsed.plugins) ? parsed.plugins : defaultFeatureConfig.plugins)
    .map((plugin) => normalizePluginForCurrentInstall(plugin))
    .filter((plugin): plugin is PluginSpec => Boolean(plugin));
  return {
    skills: (Array.isArray(parsed.skills) ? parsed.skills : defaultFeatureConfig.skills).map((skill) => ({
      ...skill,
      status: skill.status === "planned" || skill.status === "disabled" ? skill.status : "enabled"
    })),
    plugins,
    automations: Array.isArray(parsed.automations) ? parsed.automations : defaultFeatureConfig.automations,
    runtime: {
      rustCoreTools: parsed.runtime?.rustCoreTools === "read" || parsed.runtime?.rustCoreTools === "read-write"
        ? parsed.runtime.rustCoreTools
        : "disabled"
    }
  };
}

function createThreadEvent(
  type: ThreadEventType,
  payload: Record<string, unknown>,
  turnId?: string
): ThreadEventRecord {
  return { id: makeId("thread-event"), type, createdAt: nowIso(), turnId, payload };
}

function toRolloutThreadEvent(threadId: string, event: ThreadEventRecord) {
  return createRolloutEvent({
    recordType: event.type,
    threadId,
    turnId: event.turnId,
    timestamp: event.createdAt,
    payload: { eventId: event.id, ...event.payload }
  });
}

function estimateMessageTokens(messages: Array<{ content: string }>) {
  return Math.ceil(messages.reduce((total, message) => total + message.content.length, 0) / 3.5);
}

function summarizeCompactedMessages(messages: ChatMessage[]) {
  const lines = messages.slice(-60).map((message) => {
    const normalized = message.content.replace(/\s+/g, " ").trim();
    const concise = normalized.length > 280 ? `${normalized.slice(0, 277)}...` : normalized;
    return `${message.role === "user" ? "用户" : message.role === "assistant" ? "助手" : "系统"}: ${concise}`;
  });
  const header = "以下是较早对话的压缩上下文。保留用户目标、已作决定、文件路径、执行结果与未完成事项；如与最近原始消息冲突，以最近消息为准。";
  const body = lines.join("\n");
  return `${header}\n${body.length > 22_000 ? body.slice(-22_000) : body}`;
}

function compactThreadMessages(
  messages: ChatMessage[],
  previous?: ThreadContextState,
  modelContextWindow = 128_000
) {
  const estimatedTokens = estimateMessageTokens(messages);
  const threshold = Math.floor(modelContextWindow * 0.72);
  if (estimatedTokens <= threshold || messages.length <= 12) {
    return {
      messages,
      context: {
        ...(previous ?? { version: 1 as const, summary: "", compactedMessageIds: [] }),
        estimatedTokens,
        modelContextWindow
      },
      compacted: false
    };
  }

  const keepCount = Math.min(10, messages.length);
  const alreadyCompacted = new Set(previous?.compactedMessageIds ?? []);
  const allOlderMessages = messages.slice(0, -keepCount).filter((message) => message.role !== "system");
  const olderMessages = allOlderMessages.filter((message) => !alreadyCompacted.has(message.id));
  const recentMessages = messages.slice(-keepCount);
  const combinedSummary = [previous?.summary, olderMessages.length ? summarizeCompactedMessages(olderMessages) : ""]
    .filter(Boolean)
    .join("\n\n");
  const summary = combinedSummary.length > 24_000 ? combinedSummary.slice(-24_000) : combinedSummary;
  const compactedMessages: ChatMessage[] = [
    { id: makeId("context-summary"), role: "system", content: summary, createdAt: nowIso() },
    ...recentMessages
  ];
  return {
    messages: compactedMessages,
    context: {
      version: 1 as const,
      summary,
      compactedMessageIds: [...new Set([...(previous?.compactedMessageIds ?? []), ...allOlderMessages.map((message) => message.id)])],
      estimatedTokens: estimateMessageTokens(compactedMessages),
      modelContextWindow,
      lastCompactedAt: nowIso()
    },
    compacted: true
  };
}

async function readBundledFeatureConfig(): Promise<FeatureConfigFile | null> {
  try {
    const raw = await fs.readFile(bundledFeatureConfigPath, "utf8");
    return normalizeFeatureConfig(parseJsonText<Partial<FeatureConfigFile>>(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    await appendDesktopDebugLog(`bundled feature config read failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function writeFeatureConfig(nextConfig: FeatureConfigFile) {
  const payload: FeatureConfigFile = {
    skills: Array.isArray(nextConfig.skills) ? nextConfig.skills : [],
    plugins: Array.isArray(nextConfig.plugins) ? nextConfig.plugins : [],
    automations: Array.isArray(nextConfig.automations) ? nextConfig.automations : [],
    runtime: {
      rustCoreTools: nextConfig.runtime?.rustCoreTools === "read" || nextConfig.runtime?.rustCoreTools === "read-write"
        ? nextConfig.runtime.rustCoreTools
        : "disabled"
    }
  };
  await fs.writeFile(featureConfigPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

function computeNextRunAt(intervalMinutes?: number) {
  return typeof intervalMinutes === "number" && intervalMinutes > 0
    ? new Date(Date.now() + intervalMinutes * 60_000).toISOString()
    : undefined;
}

async function addFeatureItem(kind: ManagedFeatureKind, input: FeatureItemInput) {
  const config = await readFeatureConfig();

  if (kind === "skills") {
    const nextItem = await createSkillScaffold(input);
    return writeFeatureConfig({
      ...config,
      skills: [nextItem, ...config.skills.filter((item) => item.id !== nextItem.id && item.name !== nextItem.name)]
    });
  }

  if (kind === "plugins") {
    if (!input.manifestPath?.trim() && (input.source === "Codex" || input.source === "NewBrain")) {
      const nextPlugin: PluginSpec = {
        id: input.id?.trim() || makeId("plugin"),
        name: input.name?.trim() || "Unnamed plugin",
        summary: input.summary?.trim() || "No plugin description.",
        version: input.version?.trim() || "local",
        status: input.status === "disabled" ? "disabled" : "connected",
        source: input.source,
        manifestPath: "",
        capabilities: normalizeCapabilityList(input.capabilities),
        skillRoots: [],
        mcpServerIds: [],
        lastError: "Plugin is connected without a manifest, so no skills, MCP servers, or app contributions are enabled."
      };
      return writeFeatureConfig({
        ...config,
        plugins: [nextPlugin, ...config.plugins.filter((item) => item.id !== nextPlugin.id)]
      });
    }

    const requestedSource = (input.manifestPath || input.source || "").trim();
    const requestedSourceExists = requestedSource
      ? existsSync(resolve(workspacePath, requestedSource))
      : false;
    const shouldCreatePlugin =
      input.action === "create_plugin" ||
      (!requestedSourceExists && Boolean(input.name?.trim()));
    const source = shouldCreatePlugin
      ? await createPluginScaffold(input)
      : undefined;
    const nextItem = await activatePlugin(await resolvePluginManifest({
      ...input,
      ...(source ? { source, manifestPath: "" } : {})
    }));
    return writeFeatureConfig({
      ...config,
      plugins: [nextItem, ...config.plugins.filter((item) => item.id !== nextItem.id)]
    });
  }

  const parsedInterval = Number.parseInt(input.intervalMinutes ?? "", 10);
  const nextStatus =
    input.status === "scheduled" ||
    input.status === "running" ||
    input.status === "paused"
      ? input.status
      : "idle";
  const nextAutomation: AutomationSpec = {
    id: input.id?.trim() || makeId("automation"),
    title: input.title?.trim() || "未命名自动化",
    status: nextStatus,
    trigger: input.trigger?.trim() || "待配置触发说明",
    workspaceId: input.workspaceId?.trim() || activeWorkspaceId || undefined,
    threadId: input.threadId?.trim() || activeThreadId || undefined,
    action:
      input.action === "git_status" || input.action === "workspace_scan"
        ? input.action
        : "workspace_scan",
    intervalMinutes: parsedInterval > 0 ? parsedInterval : undefined,
    nextRunAt:
      nextStatus === "scheduled" || nextStatus === "running"
        ? computeNextRunAt(parsedInterval)
        : undefined
  };

  return writeFeatureConfig({
    ...config,
    automations: [nextAutomation, ...config.automations]
  });
}

async function updateFeatureItem(kind: ManagedFeatureKind, id: string, input: FeatureItemInput) {
  const config = await readFeatureConfig();

  if (kind === "skills") {
    const current = config.skills.find((item) => item.id === id);
    if (!current) return config;
    const nextItem = await updateManagedSkillScaffold(current, input);
    return writeFeatureConfig({
      ...config,
      skills: config.skills.map((item) => (item.id === id ? nextItem : item))
    });
  }

  if (kind === "plugins") {
    const current = config.plugins.find((item) => item.id === id);
    if (!current) return config;
    const requestedStatus =
      input.status === "disabled" || input.status === "planned" || input.status === "connected" || input.status === "enabled"
        ? input.status
        : current.status;
    let nextPlugin: PluginSpec = {
      ...current,
      name: input.name?.trim() || current.name,
      summary: input.summary?.trim() || current.summary,
      version: input.version?.trim() || current.version,
      source: input.source?.trim() || current.source,
      manifestPath: input.manifestPath?.trim() || current.manifestPath,
      capabilities: normalizeCapabilityList(input.capabilities).length
        ? normalizeCapabilityList(input.capabilities)
        : current.capabilities,
      status: requestedStatus
    };
    if (requestedStatus === "disabled" || requestedStatus === "planned") {
      await deactivatePlugin(current);
    } else if (requestedStatus === "enabled" || requestedStatus === "connected") {
      nextPlugin = await activatePlugin(nextPlugin);
    }
    return writeFeatureConfig({
      ...config,
      plugins: config.plugins.map((item) => item.id === id ? nextPlugin : item)
    });
  }

  const runNow = input.status === "run_now";
  const nextConfig = await writeFeatureConfig({
    ...config,
    automations: config.automations.map((item) => {
      if (item.id !== id) {
        return item;
      }

      if (runNow) {
        return {
          ...item,
          status: "scheduled" as const,
          nextRunAt: new Date(Date.now() - 1_000).toISOString()
        };
      }

      const parsedInterval = Number.parseInt(input.intervalMinutes ?? "", 10);
      const nextInterval = parsedInterval > 0 ? parsedInterval : item.intervalMinutes;
      const nextStatus =
        input.status === "scheduled" ||
        input.status === "running" ||
        input.status === "paused" ||
        input.status === "idle"
          ? input.status
          : item.status;

      return {
        ...item,
        title: input.title?.trim() || item.title,
        trigger: input.trigger?.trim() || item.trigger,
        status: nextStatus,
        workspaceId: input.workspaceId?.trim() || item.workspaceId,
        threadId: input.threadId?.trim() || item.threadId,
        action:
          input.action === "git_status" || input.action === "workspace_scan"
            ? input.action
            : item.action,
        intervalMinutes: nextInterval,
        nextRunAt:
          nextStatus === "scheduled" || nextStatus === "running"
            ? computeNextRunAt(nextInterval)
            : undefined
      };
    })
  });
  if (runNow) {
    void tickAutomations();
  }
  return nextConfig;
}

async function deleteFeatureItem(kind: ManagedFeatureKind, id: string) {
  const config = await readFeatureConfig();

  if (kind === "skills") {
    const skill = config.skills.find((item) => item.id === id);
    if (skill) await deleteManagedSkillScaffold(skill);
    return writeFeatureConfig({
      ...config,
      skills: config.skills.filter((item) => item.id !== id)
    });
  }

  if (kind === "plugins") {
    const plugin = config.plugins.find((item) => item.id === id);
    if (plugin) await deactivatePlugin(plugin);
    return writeFeatureConfig({
      ...config,
      plugins: config.plugins.filter((item) => item.id !== id)
    });
  }

  return writeFeatureConfig({
    ...config,
    automations: config.automations.filter((item) => item.id !== id)
  });
}

async function readUsableWorkspaceCatalogText(): Promise<string | null> {
  let raw = "";
  try {
    raw = await readTextWithTransientRetry(workspaceCatalogPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const usable = (value: string) => {
    const trimmed = stripJsonBom(value).trim();
    if (!trimmed) return false;
    try {
      parseJsonText<Partial<WorkspaceCatalogFile>>(trimmed);
      return true;
    } catch {
      return false;
    }
  };
  if (usable(raw)) return raw;
  const recovered = await recoverDurableText(workspaceCatalogPath);
  if (recovered && usable(recovered)) {
    await restoreTextFile(workspaceCatalogPath, recovered.endsWith("\n") ? recovered : `${recovered}\n`);
    void appendDesktopDebugLog(`recovered workspace catalog from crash sidecar path=${workspaceCatalogPath}`);
    return recovered;
  }
  if (raw && !usable(raw)) {
    await backupCorruptJsonFile(workspaceCatalogPath, "unreadable workspace catalog");
  }
  return null;
}

async function readWorkspaceCatalog(): Promise<WorkspaceCatalogFile> {
  try {
    const raw = await readUsableWorkspaceCatalogText();
    if (!raw || !stripJsonBom(raw).trim()) {
      const initialCatalog = createDefaultWorkspaceCatalog();
      await writeWorkspaceCatalog(initialCatalog.workspaces);
      return initialCatalog;
    }
    let parsed: Partial<WorkspaceCatalogFile>;
    try {
      parsed = parseJsonText<Partial<WorkspaceCatalogFile>>(raw);
    } catch (error) {
      await backupCorruptJsonFile(
        workspaceCatalogPath,
        error instanceof Error ? error.message : String(error)
      );
      const initialCatalog = createDefaultWorkspaceCatalog();
      await writeWorkspaceCatalog(initialCatalog.workspaces);
      return initialCatalog;
    }
    const parsedWorkspaces = Array.isArray(parsed.workspaces)
      ? parsed.workspaces.map(normalizeWorkspace)
      : createDefaultWorkspaceCatalog().workspaces;
    for (const workspace of parsedWorkspaces) {
      await recoverRolloutThreads(workspace);
      const persistedThreads = codexStorage.listThreads(workspace.path);
      const placeholderThreads = persistedThreads.filter((thread) =>
        thread.title === "默认线程" &&
        (!thread.preview.trim() || thread.preview === "线程已创建" || thread.preview === "暂无线程摘要。")
      );
      for (const thread of placeholderThreads) {
        codexStorage.deleteThread(thread.id);
        await fs.rm(getThreadStatePath(workspace.id, thread.id), { force: true }).catch(() => undefined);
        await fs.rm(getThreadEventLogPath(workspace.id, thread.id), { force: true }).catch(() => undefined);
        void appendDesktopDebugLog(`removed unused default thread ${thread.id} from workspace ${workspace.id}`);
      }
      const usableThreads = persistedThreads.filter((thread) => !placeholderThreads.includes(thread));
      if (usableThreads.length) {
        workspace.threads = usableThreads.map((thread) => normalizeThread({
          id: thread.id,
          title: thread.title,
          summary: thread.preview,
          scope: thread.scope,
          updatedAt: new Date(thread.updatedAt).toISOString(),
          lastEventSummary: thread.preview,
          status: thread.status as WorkspaceThreadRecord["status"],
          branch: thread.gitBranch
        }));
      } else {
        workspace.threads = [];
      }
    }
    // 不再按“路径必须位于 workspacePath 下”过滤（打包版会静默删掉用户添加的外部项目，
    // 造成重启后项目丢失）。仅剔除目录已不存在的项目，且不回写 catalog，保证下次目录恢复后项目仍能出现。
    const usableWorkspaces = parsedWorkspaces.filter((workspace) => {
      const exists = existsSync(workspace.path);
      if (!exists) void appendDesktopDebugLog(`workspace path missing, hidden from catalog: ${workspace.path}`);
      return exists;
    });
    return {
      workspaces: usableWorkspaces.length > 0 ? usableWorkspaces : createDefaultWorkspaceCatalog().workspaces
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const initialCatalog = createDefaultWorkspaceCatalog();
      await writeWorkspaceCatalog(initialCatalog.workspaces);
      return initialCatalog;
    }

    throw error;
  }
}

async function recoverRolloutThreads(workspace: WorkspaceCatalogItem) {
  const threadsDir = join(getWorkspaceStateDir(workspace.id), "threads");
  let entries;
  try {
    entries = await fs.readdir(threadsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  const knownThreadIds = new Set(codexStorage.listThreads(workspace.path).map((thread) => thread.id));
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".rollout.jsonl")) continue;
    const threadId = entry.name.slice(0, -".rollout.jsonl".length);
    if (!threadId || knownThreadIds.has(threadId)) continue;

    const rolloutPath = getThreadEventLogPath(workspace.id, threadId);
    let snapshot: Partial<ThreadStateFile> | null = null;
    try {
      const records = await readRolloutRecords(rolloutPath);
      snapshot = records
        .map((record) => record as { record_type?: string; state?: Partial<ThreadStateFile>; payload?: Partial<ThreadStateFile>; timestamp?: string })
        .filter((record) => record?.record_type === "state_snapshot")
        .map((record) => record.state ?? record.payload)
        .filter((state): state is Partial<ThreadStateFile> => Boolean(state))
        .reduce<Partial<ThreadStateFile> | null>((best, state) => {
          if (!best) return state;
          const score = (candidate: Partial<ThreadStateFile>) =>
            (candidate.messages ?? []).filter((message: any) => message.role === "user" || message.role === "assistant").length * 10 +
            (candidate.messages ?? []).length;
          return score(state) >= score(best) ? state : best;
        }, null);
    } catch (error) {
      void appendDesktopDebugLog(`recover rollout thread failed: ${threadId}: ${error instanceof Error ? error.message : String(error)}`);
    }

    const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : [];
    const lastUserOrAssistant = [...messages].reverse().find((message: any) => message.role === "user" || message.role === "assistant");
    if (!lastUserOrAssistant) {
      continue;
    }
    const titleSource = messages.find((message: any) => message.role === "user") ?? lastUserOrAssistant;
    const title = String((titleSource as any)?.content ?? "").trim().slice(0, 40) || "新对话";
    const preview = String((lastUserOrAssistant as any)?.content ?? "").trim().slice(0, 160);
    const stat = await fs.stat(rolloutPath);
    const updatedAt = stat.mtimeMs || Date.now();
    codexStorage.upsertThread({
      id: threadId,
      rolloutPath,
      createdAt: stat.birthtimeMs || updatedAt,
      updatedAt,
      cwd: workspace.path,
      title,
      scope: "project",
      status: "idle",
      approvalMode: "on-request",
      archived: false,
      gitBranch: "",
      preview,
      memoryMode: "enabled",
      model: ""
    });
    knownThreadIds.add(threadId);
  }
}

async function writeWorkspaceCatalog(workspaces: WorkspaceCatalogItem[]) {
  const payload: WorkspaceCatalogFile = {
    workspaces: workspaces.map(normalizeWorkspace)
  };
  for (const workspace of payload.workspaces) {
    for (const thread of workspace.threads) {
      const updatedAt = Date.parse(thread.updatedAt) || Date.now();
      codexStorage.upsertThread({
        id: thread.id,
        rolloutPath: getThreadEventLogPath(workspace.id, thread.id),
        createdAt: updatedAt,
        updatedAt,
        cwd: workspace.path,
        title: thread.title,
        scope: thread.scope === "chat" ? "chat" : "project",
        status: thread.status ?? "idle",
        approvalMode: "on-request",
        archived: false,
        gitBranch: thread.branch ?? "",
        preview: thread.summary || thread.lastEventSummary || "",
        memoryMode: "enabled",
        model: ""
      });
    }
  }
  // Workspace-only settings remain JSON; Codex-compatible thread identity and recency live in state_5.sqlite.
  const workspaceSettings = {
    workspaces: payload.workspaces.map((workspace) => ({ ...workspace, threads: [] }))
  };
  await writeTextAtomically(workspaceCatalogPath, `${JSON.stringify(workspaceSettings, null, 2)}\n`);
  return payload;
}

async function readBootstrapConfig(): Promise<BootstrapConfigFile> {
  try {
    const raw = await fs.readFile(bootstrapConfigPath, "utf8");
    return normalizeBootstrapConfig(parseJsonText<Partial<BootstrapConfigFile>>(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return (await readBundledBootstrapConfig()) ?? defaultBootstrapConfig;
    }
    throw error;
  }
}

function normalizeBootstrapConfig(parsed: Partial<BootstrapConfigFile>): BootstrapConfigFile {
  const environments = Array.isArray(parsed.environments)
    ? parsed.environments
        .map((item) => ({
          id: typeof item?.id === "string" ? item.id.trim() : "",
          label: typeof item?.label === "string" ? item.label.trim() : undefined,
          enabled: item?.enabled !== false,
          command: typeof item?.command === "string" ? item.command.trim() : undefined,
          args: Array.isArray(item?.args) ? item.args.filter((arg): arg is string => typeof arg === "string") : undefined,
          cwd: typeof item?.cwd === "string" ? item.cwd.trim() : undefined
        }))
        .filter((item) => item.id)
    : [];
  return environments.length > 0 ? { environments } : defaultBootstrapConfig;
}

async function readBundledBootstrapConfig(): Promise<BootstrapConfigFile | null> {
  try {
    const raw = await fs.readFile(bundledBootstrapConfigPath, "utf8");
    return normalizeBootstrapConfig(parseJsonText<Partial<BootstrapConfigFile>>(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    await appendDesktopDebugLog(`bundled bootstrap config read failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function getDesktopBootstrapTaskDefinitions(): Promise<DesktopBootstrapTaskDefinition[]> {
  const config = await readBootstrapConfig();
  return config.environments
    .filter((item) => item.enabled !== false)
    .map((item) => ({
      id: item.id,
      label: item.label?.trim() || item.id,
      enabled: item.enabled !== false,
      command: item.command,
      args: item.args,
      cwd: item.cwd
    }));
}

async function readDesktopBootstrapState(): Promise<DesktopBootstrapStateFile> {
  try {
    const raw = await fs.readFile(desktopBootstrapStatePath, "utf8");
    const parsed = parseJsonText<Partial<DesktopBootstrapStateFile>>(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    if (error instanceof SyntaxError) {
      await appendDesktopDebugLog(`desktop bootstrap state parse failed, resetting state: ${error.message}`);
      return {};
    }
    throw error;
  }
}

async function writeDesktopBootstrapState(nextState: DesktopBootstrapStateFile) {
  await ensureDirectory(workspaceStateRoot);
  await fs.writeFile(desktopBootstrapStatePath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
  return nextState;
}

async function createDesktopBootstrapTasks(state?: DesktopBootstrapStateFile | null): Promise<DesktopBootstrapTaskState[]> {
  const taskDefinitions = await getDesktopBootstrapTaskDefinitions();
  const existingTasks = Array.isArray(state?.tasks) ? state?.tasks : [];
  return taskDefinitions.map((definition) => {
    const existingTask = existingTasks.find((task) => task.id === definition.id);
    if (definition.id === "conda") {
      const derivedStatus =
        state?.conda?.status === "ready"
          ? "ready"
          : state?.conda?.status === "manual_required"
            ? "manual_required"
            : existingTask?.status ?? "pending";
      return {
        id: definition.id,
        label: definition.label,
        status: derivedStatus,
        detail: state?.conda?.reason ?? existingTask?.detail,
        startedAt: existingTask?.startedAt,
        completedAt: existingTask?.completedAt ?? state?.conda?.updatedAt
      };
    }

    if (definition.id === "python") {
      const derivedStatus =
        state?.python?.status === "ready"
          ? "ready"
          : state?.python?.status === "manual_required"
            ? "manual_required"
            : existingTask?.status ?? "pending";
      return {
        id: definition.id,
        label: definition.label,
        status: derivedStatus,
        detail: state?.python?.reason ?? state?.python?.version ?? existingTask?.detail,
        startedAt: existingTask?.startedAt,
        completedAt: existingTask?.completedAt ?? state?.python?.updatedAt
      };
    }

    if (definition.id === "node") {
      return {
        id: definition.id,
        label: definition.label,
        status:
          existingTask?.status ??
          (state?.node?.status === "ready"
            ? "ready"
            : state?.node?.status === "manual_required"
              ? "manual_required"
              : "pending"),
        detail: existingTask?.detail ?? state?.node?.reason ?? state?.node?.version,
        startedAt: existingTask?.startedAt,
        completedAt: existingTask?.completedAt ?? state?.node?.updatedAt
      };
    }

    if (definition.id === "project-deps") {
      const derivedStatus =
        state?.projectDeps?.status === "ready"
          ? "ready"
          : state?.projectDeps?.status === "manual_required"
            ? "manual_required"
            : existingTask?.status ?? "pending";
      return {
        id: definition.id,
        label: definition.label,
        status: derivedStatus,
        detail: state?.projectDeps?.reason ?? existingTask?.detail,
        startedAt: existingTask?.startedAt,
        completedAt: existingTask?.completedAt ?? state?.projectDeps?.updatedAt
      };
    }

    return {
      id: definition.id,
      label: definition.label,
      status: existingTask?.status ?? "pending",
      detail: existingTask?.detail,
      startedAt: existingTask?.startedAt,
      completedAt: existingTask?.completedAt
    };
  });
}

async function toDesktopBootstrapStatusPayload(
  state?: DesktopBootstrapStateFile | null
): Promise<DesktopBootstrapStatusPayload> {
  const tasks = await createDesktopBootstrapTasks(state);
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((task) => task.status === "ready" || task.status === "manual_required").length;
  const progressPercent = totalTasks === 0 ? 100 : Math.round((completedTasks / totalTasks) * 100);
  const hasRunning = tasks.some((task) => task.status === "running");
  const hasPending = tasks.some((task) => task.status === "pending");
  const hasManualRequired = tasks.some((task) => task.status === "manual_required");
  const derivedOverallStatus =
    hasRunning || hasPending
      ? (hasRunning ? "running" : "pending")
      : hasManualRequired
        ? "manual_required"
        : "ready";
  return {
    overall: {
      status: derivedOverallStatus,
      currentTaskId: state?.overall?.currentTaskId,
      message: state?.overall?.message,
      updatedAt: state?.overall?.updatedAt ?? state?.conda?.updatedAt,
      totalTasks,
      completedTasks,
      progressPercent
    },
    tasks,
    conda: {
      status: state?.conda?.status ?? "pending",
      initializedAt: state?.conda?.initializedAt,
      updatedAt: state?.conda?.updatedAt,
      source: state?.conda?.source,
      condaPath: state?.conda?.condaPath,
      reason: state?.conda?.reason
    }
  };
}

async function updateDesktopBootstrapTaskState(
  state: DesktopBootstrapStateFile,
  taskId: string,
  input: {
    overallStatus: "ready" | "manual_required" | "pending" | "running";
    message: string;
    detail?: string;
  }
) {
  const tasks = await createDesktopBootstrapTasks(state);
  return writeDesktopBootstrapState({
    ...state,
    overall: {
      status: input.overallStatus,
      currentTaskId: taskId,
      message: input.message,
      updatedAt: nowIso()
    },
    tasks: tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            status: input.overallStatus,
            detail: input.detail ?? input.message,
            startedAt: task.startedAt ?? nowIso(),
            completedAt:
              input.overallStatus === "ready" || input.overallStatus === "manual_required" ? nowIso() : undefined
          }
        : task
    )
  });
}

async function ensureDesktopCondaInitialized() {
  const bootstrapState = await readDesktopBootstrapState();
  if (
    (bootstrapState.conda?.status === "ready" || bootstrapState.conda?.status === "manual_required") &&
    bootstrapState.overall?.status !== "running"
  ) {
    return bootstrapState;
  }

  const runningTasks = await createDesktopBootstrapTasks(bootstrapState);
  await writeDesktopBootstrapState({
    ...bootstrapState,
    overall: {
      status: "running",
      currentTaskId: "conda",
      message: "正在检查系统 conda 并准备桌面环境...",
      updatedAt: nowIso()
    },
    tasks: runningTasks.map((task) =>
      task.id === "conda"
        ? {
            ...task,
            status: "running",
            detail: "正在检查系统 conda 并准备桌面环境...",
            startedAt: task.startedAt ?? nowIso(),
            completedAt: undefined
          }
        : task
    )
  });

  const preferred = await resolvePreferredCondaExecutable();
  if (preferred) {
    const readyTasks = await createDesktopBootstrapTasks(bootstrapState);
    return writeDesktopBootstrapState({
      ...bootstrapState,
      overall: {
        status: "ready",
        currentTaskId: "conda",
        message: preferred.source === "system" ? "已复用系统 conda。" : "已准备托管 conda。",
        updatedAt: nowIso()
      },
      tasks: readyTasks.map((task) =>
        task.id === "conda"
          ? {
              ...task,
              status: "ready",
              detail: preferred.source === "system" ? "已复用系统 conda。" : "已准备托管 conda。",
              startedAt: task.startedAt ?? nowIso(),
              completedAt: nowIso()
            }
          : task
      ),
      conda: {
        status: "ready",
        initializedAt: bootstrapState.conda?.initializedAt || nowIso(),
        updatedAt: nowIso(),
        source: preferred.source,
        condaPath: preferred.condaPath
      }
    });
  }

  try {
    const managedCondaPath = await ensureManagedCondaInstalled();
    const managedTasks = await createDesktopBootstrapTasks(bootstrapState);
    return writeDesktopBootstrapState({
      ...bootstrapState,
      overall: {
        status: "ready",
        currentTaskId: "conda",
        message: "已完成托管 conda 安装。",
        updatedAt: nowIso()
      },
      tasks: managedTasks.map((task) =>
        task.id === "conda"
          ? {
              ...task,
              status: "ready",
              detail: "已完成托管 conda 安装。",
              startedAt: task.startedAt ?? nowIso(),
              completedAt: nowIso()
            }
          : task
      ),
      conda: {
        status: "ready",
        initializedAt: bootstrapState.conda?.initializedAt || nowIso(),
        updatedAt: nowIso(),
        source: "managed",
        condaPath: managedCondaPath
      }
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const manualTasks = await createDesktopBootstrapTasks(bootstrapState);
    await writeDesktopBootstrapState({
      ...bootstrapState,
      overall: {
        status: "manual_required",
        currentTaskId: "conda",
        message: "当前环境无法自动安装 conda，需要手动完成。",
        updatedAt: nowIso()
      },
      tasks: manualTasks.map((task) =>
        task.id === "conda"
          ? {
              ...task,
              status: "manual_required",
              detail: reason,
              startedAt: task.startedAt ?? nowIso(),
              completedAt: nowIso()
            }
          : task
      ),
      conda: {
        status: "manual_required",
        initializedAt: bootstrapState.conda?.initializedAt || nowIso(),
        updatedAt: nowIso(),
        reason
      }
    });
    return bootstrapState;
  }
}

async function ensureDesktopPythonInitialized() {
  const bootstrapState = await readDesktopBootstrapState();
  if (
    (bootstrapState.python?.status === "ready" || bootstrapState.python?.status === "manual_required") &&
    bootstrapState.overall?.status !== "running"
  ) {
    return bootstrapState;
  }

  const runningState = await updateDesktopBootstrapTaskState(bootstrapState, "python", {
    overallStatus: "running",
    message: "正在检查 Python 运行时..."
  });

  const desktopConda = await getDesktopReadyCondaExecutable();
  if (!desktopConda) {
    return writeDesktopBootstrapState({
      ...runningState,
      python: {
        status: "manual_required",
        updatedAt: nowIso(),
        reason: "Python 运行时依赖 conda，当前 conda 尚未就绪。"
      }
    });
  }

  const catalog = await readWorkspaceCatalog();
  const workspace = catalog.workspaces[0];
  if (!workspace?.conda?.envPath?.trim()) {
    return writeDesktopBootstrapState({
      ...runningState,
      python: {
        status: "manual_required",
        updatedAt: nowIso(),
        reason: "未检测到工作区 conda 环境路径，暂时无法确认 Python 运行时。"
      }
    });
  }

  const pythonPath = process.platform === "win32"
    ? join(workspace.conda.envPath, "python.exe")
    : join(workspace.conda.envPath, "bin", "python");
  if (!(await pathExists(pythonPath))) {
    return writeDesktopBootstrapState({
      ...runningState,
      python: {
        status: "manual_required",
        updatedAt: nowIso(),
        reason: `未在 conda 环境中检测到 Python 可执行文件：${pythonPath}`
      }
    });
  }

  const versionResult = spawnSync(pythonPath, ["--version"], {
    cwd: workspace.path,
    encoding: "utf8",
    windowsHide: true
  });
  const version = String(versionResult.stdout || versionResult.stderr || "").trim() || workspace.conda.pythonVersion;
  return writeDesktopBootstrapState({
    ...runningState,
    overall: {
      status: "ready",
      currentTaskId: "python",
      message: "Python 运行时已就绪。",
      updatedAt: nowIso()
    },
    tasks: (await createDesktopBootstrapTasks(runningState)).map((task) =>
      task.id === "python"
        ? {
            ...task,
            status: "ready",
            detail: version || "已复用工作区 Python 运行时。",
            startedAt: task.startedAt ?? nowIso(),
            completedAt: nowIso()
          }
        : task
    ),
    python: {
      status: "ready",
      updatedAt: nowIso(),
      pythonPath,
      version
    }
  });
}

async function ensureDesktopNodeInitialized() {
  const bootstrapState = await readDesktopBootstrapState();
  if (
    (bootstrapState.node?.status === "ready" || bootstrapState.node?.status === "manual_required") &&
    bootstrapState.overall?.status !== "running"
  ) {
    return bootstrapState;
  }

  const runningState = await updateDesktopBootstrapTaskState(bootstrapState, "node", {
    overallStatus: "running",
    message: "正在检查 Node.js 运行时..."
  });

  let nodePath = resolvePreferredNodeExecutable();
  let source: "system" | "sandbox" = "system";
  if (!nodePath && process.platform === "win32") {
    const offlineNodeMsi = join(workspacePath, "windows", "_sandbox_tools", "node.msi");
    if (await pathExists(offlineNodeMsi)) {
      const installingState = await updateDesktopBootstrapTaskState(runningState, "node", {
        overallStatus: "running",
        message: "正在安装离线 Node.js 运行时...",
        detail: `使用离线安装包 ${offlineNodeMsi}`
      });
      const installResult = spawnSync("msiexec.exe", ["/i", offlineNodeMsi, "/qn", "/norestart"], {
        cwd: workspacePath,
        encoding: "utf8",
        windowsHide: true
      });
      if (installResult.status !== 0) {
        return writeDesktopBootstrapState({
          ...installingState,
          node: {
            status: "manual_required",
            updatedAt: nowIso(),
            source: "sandbox",
            reason: `离线 Node 安装失败：${String(installResult.stderr || installResult.stdout || installResult.status).trim()}`
          }
        });
      }
      nodePath = resolvePreferredNodeExecutable();
      source = "sandbox";
    }
  }

  if (!nodePath) {
    return writeDesktopBootstrapState({
      ...runningState,
      node: {
        status: "manual_required",
        updatedAt: nowIso(),
        reason: "未检测到系统 Node.js，请先安装 Node 18+。"
      }
    });
  }

  const versionResult = spawnSync(nodePath, ["--version"], {
    cwd: workspacePath,
    encoding: "utf8",
    windowsHide: true
  });
  const version = String(versionResult.stdout || versionResult.stderr || "").trim();
  source = source || "system";
  return writeDesktopBootstrapState({
    ...runningState,
    overall: {
      status: "ready",
      currentTaskId: "node",
      message: "Node.js 运行时已就绪。",
      updatedAt: nowIso()
    },
    tasks: (await createDesktopBootstrapTasks(runningState)).map((task) =>
      task.id === "node"
        ? {
            ...task,
            status: "ready",
            detail: version || "已复用系统 Node.js。",
            startedAt: task.startedAt ?? nowIso(),
            completedAt: nowIso()
          }
        : task
    ),
    node: {
      status: "ready",
      updatedAt: nowIso(),
      nodePath,
      version,
      source
    }
  });
}

async function ensureDesktopProjectDependenciesInitialized() {
  const bootstrapState = await readDesktopBootstrapState();
  if (
    (bootstrapState.projectDeps?.status === "ready" || bootstrapState.projectDeps?.status === "manual_required") &&
    bootstrapState.overall?.status !== "running"
  ) {
    return bootstrapState;
  }

  const runningState = await updateDesktopBootstrapTaskState(bootstrapState, "project-deps", {
    overallStatus: "running",
    message: "正在检查项目依赖..."
  });

  const installCwd = basename(workspacePath).toLowerCase() === "windows"
    ? workspacePath
    : join(workspacePath, "windows");
  const packageJsonPath = join(installCwd, "package.json");
  const pnpmLockPath = join(installCwd, "pnpm-lock.yaml");
  const packageLockPath = join(installCwd, "package-lock.json");
  const shrinkwrapPath = join(installCwd, "npm-shrinkwrap.json");
  if (!(await pathExists(packageJsonPath))) {
    return writeDesktopBootstrapState({
      ...runningState,
      projectDeps: {
        status: "manual_required",
        updatedAt: nowIso(),
        installCwd,
        reason: `未找到项目依赖入口文件：${packageJsonPath}`
      }
    });
  }

  const hasPnpmLock = await pathExists(pnpmLockPath);
  const hasNpmLock = (await pathExists(packageLockPath)) || (await pathExists(shrinkwrapPath));
  const packageManager: "pnpm" | "npm" = hasPnpmLock ? "pnpm" : "npm";
  const packageManagerReason =
    hasPnpmLock && hasNpmLock
      ? "同时检测到 pnpm 与 npm 锁文件，优先使用 pnpm。"
      : hasPnpmLock
        ? "检测到 pnpm 锁文件。"
        : hasNpmLock
          ? "检测到 npm 锁文件。"
          : "未检测到锁文件，回退使用 npm install。";

  const nodeModulesPath = join(installCwd, "node_modules");
  if (await pathExists(nodeModulesPath)) {
    return writeDesktopBootstrapState({
      ...runningState,
      overall: {
        status: "ready",
        currentTaskId: "project-deps",
        message: "项目依赖已存在。",
        updatedAt: nowIso()
      },
      tasks: (await createDesktopBootstrapTasks(runningState)).map((task) =>
        task.id === "project-deps"
          ? {
              ...task,
              status: "ready",
              detail: `已检测到 windows/node_modules。${packageManagerReason}`,
              startedAt: task.startedAt ?? nowIso(),
              completedAt: nowIso()
            }
          : task
      ),
      projectDeps: {
        status: "ready",
        updatedAt: nowIso(),
        packageManager,
        installCwd
      }
    });
  }

  const packageManagerPath = packageManager === "pnpm" ? detectCommandPath("pnpm") : detectCommandPath("npm");
  if (!packageManagerPath) {
    return writeDesktopBootstrapState({
      ...runningState,
      projectDeps: {
        status: "manual_required",
        updatedAt: nowIso(),
        packageManager,
        installCwd,
        reason:
          packageManager === "pnpm"
            ? `${packageManagerReason} 但未检测到 pnpm，当前无法自动安装项目依赖。`
            : "未检测到 npm，当前无法自动安装项目依赖。"
      }
    });
  }

  const installArgs =
    packageManager === "pnpm"
      ? ["install", "--frozen-lockfile"]
      : hasNpmLock
        ? ["ci"]
        : ["install"];
  const installResult = spawnSync(packageManagerPath, installArgs, {
    cwd: installCwd,
    encoding: "utf8",
    windowsHide: true
  });
  if (installResult.status !== 0) {
    return writeDesktopBootstrapState({
      ...runningState,
      projectDeps: {
        status: "manual_required",
        updatedAt: nowIso(),
        packageManager,
        installCwd,
        reason: `自动安装项目依赖失败：${String(installResult.stderr || installResult.stdout || installResult.status).trim()}`
      }
    });
  }

  return writeDesktopBootstrapState({
    ...runningState,
    overall: {
      status: "ready",
      currentTaskId: "project-deps",
      message: "项目依赖已安装完成。",
      updatedAt: nowIso()
    },
    tasks: (await createDesktopBootstrapTasks(runningState)).map((task) =>
      task.id === "project-deps"
        ? {
            ...task,
            status: "ready",
            detail: `${packageManagerReason} 已执行 ${packageManager} ${installArgs.join(" ")}。`,
            startedAt: task.startedAt ?? nowIso(),
            completedAt: nowIso()
          }
        : task
    ),
    projectDeps: {
      status: "ready",
      updatedAt: nowIso(),
      packageManager,
      installCwd
    }
  });
}

async function ensureDesktopCustomBootstrapTaskInitialized(
  task: DesktopBootstrapTaskDefinition,
  latestState: DesktopBootstrapStateFile
) {
  const currentTasks = await createDesktopBootstrapTasks(latestState);
  if (!task.command?.trim()) {
    return writeDesktopBootstrapState({
      ...latestState,
      tasks: currentTasks.map((item) =>
        item.id === task.id
          ? {
              ...item,
              status: "ready",
              detail: "未配置自动命令，已跳过该可选环境任务。",
              startedAt: item.startedAt ?? nowIso(),
              completedAt: nowIso()
            }
          : item
      )
    });
  }

  const runningState = await writeDesktopBootstrapState({
    ...latestState,
    overall: {
      status: "running",
      currentTaskId: task.id,
      message: `正在初始化 ${task.label}...`,
      updatedAt: nowIso()
    },
    tasks: currentTasks.map((item) =>
      item.id === task.id
        ? {
            ...item,
            status: "running",
            detail: `正在执行：${[task.command, ...(task.args ?? [])].join(" ")}`,
            startedAt: item.startedAt ?? nowIso()
          }
        : item
    )
  });
  const result = spawnSync(task.command, task.args ?? [], {
    cwd: task.cwd ? resolve(workspacePath, task.cwd) : workspacePath,
    env: activeShellEnv,
    encoding: "utf8",
    windowsHide: true
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  return writeDesktopBootstrapState({
    ...runningState,
    overall: {
      status: result.status === 0 ? "running" : "manual_required",
      currentTaskId: task.id,
      message: result.status === 0 ? `${task.label} 已完成。` : `${task.label} 执行失败，需要处理。`,
      updatedAt: nowIso()
    },
    tasks: (await createDesktopBootstrapTasks(runningState)).map((item) =>
      item.id === task.id
        ? {
            ...item,
            status: result.status === 0 ? "ready" : "manual_required",
            detail: output || result.error?.message || (result.status === 0 ? "自定义环境任务已完成。" : `命令退出码：${result.status ?? "未知"}`),
            startedAt: item.startedAt ?? nowIso(),
            completedAt: nowIso()
          }
        : item
    )
  });
}

async function ensureDesktopBootstrapInitialized() {
  const taskDefinitions = await getDesktopBootstrapTaskDefinitions();
  if (taskDefinitions.length === 0) {
    const currentState = await readDesktopBootstrapState();
    return writeDesktopBootstrapState({
      ...currentState,
      overall: {
        status: "ready",
        message: "未配置需要初始化的环境任务。",
        updatedAt: nowIso()
      },
      tasks: []
    });
  }

  let latestState = await readDesktopBootstrapState();
  for (const task of taskDefinitions) {
    if (task.id === "conda") {
      latestState = await ensureDesktopCondaInitialized();
      continue;
    }

    if (task.id === "python") {
      latestState = await ensureDesktopPythonInitialized();
      continue;
    }

    if (task.id === "node") {
      latestState = await ensureDesktopNodeInitialized();
      continue;
    }

    if (task.id === "project-deps") {
      latestState = await ensureDesktopProjectDependenciesInitialized();
      continue;
    }

    latestState = await ensureDesktopCustomBootstrapTaskInitialized(task, latestState);
  }

  return latestState;
}

function startDesktopBootstrapInitialization() {
  if (!desktopBootstrapPromise) {
    desktopBootstrapPromise = ensureDesktopBootstrapInitialized().finally(() => {
      desktopBootstrapPromise = null;
    });
  }
  return desktopBootstrapPromise;
}

async function startDesktopBootstrapAfterAuth() {
  await syncAuthenticatedDesktopControlPlane();
  await startDesktopBootstrapInitialization();
  const nextCatalog = await ensureWorkspaceCatalogConda(await readWorkspaceCatalog());
  await ensureCatalogState(nextCatalog);
  const activeWorkspace = activeWorkspaceId
    ? nextCatalog.workspaces.find((item) => item.id === activeWorkspaceId)
    : nextCatalog.workspaces[0];
  activeShellEnv = await buildWorkspaceShellEnvWithPreferences(activeWorkspace);
  runtime.setShellEnv(activeShellEnv);
  terminalSession.cwd = activeWorkspace?.path ?? runtime.workspacePath;
  return await toDesktopBootstrapStatusPayload(await readDesktopBootstrapState());
}

async function retryDesktopCondaInitialization() {
  const previousState = await readDesktopBootstrapState();
  const resetTasks = await createDesktopBootstrapTasks(previousState);
  await writeDesktopBootstrapState({
    ...previousState,
    overall: {
      status: "pending",
      currentTaskId: "conda",
      message: "准备重新初始化桌面环境...",
      updatedAt: nowIso()
    },
    tasks: resetTasks.map((task) =>
      task.id === "conda"
        ? {
            ...task,
            status: "pending",
            detail: undefined,
            startedAt: undefined,
            completedAt: undefined
          }
        : task
    ),
    conda: {
      status: "pending",
      initializedAt: previousState.conda?.initializedAt,
      updatedAt: nowIso(),
      source: previousState.conda?.source,
      condaPath: previousState.conda?.condaPath,
      reason: undefined
    }
  });

  return startDesktopBootstrapAfterAuth();
}

async function getDesktopReadyCondaExecutable(): Promise<ResolvedCondaExecutable | null> {
  const preferred = await resolvePreferredCondaExecutable();
  if (preferred) {
    return preferred;
  }

  const bootstrapState = await readDesktopBootstrapState();
  if (bootstrapState.conda?.status !== "ready" || !bootstrapState.conda.condaPath?.trim()) {
    return null;
  }

  const normalizedCondaPath = normalizeCondaExecutablePath(bootstrapState.conda.condaPath);
  if (!normalizedCondaPath) {
    return null;
  }

  if (!(await pathExists(normalizedCondaPath))) {
    return null;
  }

  return {
    source: bootstrapState.conda.source === "system" ? "system" : "managed",
    condaPath: normalizedCondaPath
  };
}

async function ensureManagedCondaInstalled() {
  const managedCondaPath = getManagedCondaExecutable();
  if (await pathExists(managedCondaPath)) {
    return managedCondaPath;
  }

  const environmentSummary = summarizeCondaBootstrapEnvironment();
  if (!environmentSummary.installerSpec) {
    await showCondaManualInstallPrompt("当前系统架构暂不支持自动下载安装 conda。", environmentSummary);
    throw new Error(`Unsupported platform for managed conda install: ${environmentSummary.platform} ${environmentSummary.arch}`);
  }

  const installerSpec = environmentSummary.installerSpec;
  const internetAvailable = await canReachPublicUrl(installerSpec.downloadUrl);
  if (!internetAvailable) {
    await showCondaManualInstallPrompt("未检测到可访问的公网下载地址，可能处于离线或仅局域网环境。", environmentSummary);
    throw new Error(`Public network unavailable for managed conda installer: ${installerSpec.downloadUrl}`);
  }

  const installerDir = join(workspacePath, "install");
  const installerPath = join(installerDir, installerSpec.fileName);

  await ensureDirectory(installerDir);
  if (!(await pathExists(installerPath))) {
    const downloader = process.platform === "win32"
      ? ["-NoLogo", "-NoProfile", "-Command", `Invoke-WebRequest -Uri ${quoteShellArgument(installerSpec.downloadUrl)} -OutFile ${quoteShellArgument(installerPath)}`]
      : ["-lc", `curl -L ${quoteShellArgument(installerSpec.downloadUrl)} -o ${quoteShellArgument(installerPath)}`];
    const downloadResult = spawnSync(process.platform === "win32" ? "powershell.exe" : "/bin/bash", downloader, {
      cwd: workspacePath,
      encoding: "utf8",
      windowsHide: true
    });
    if (downloadResult.status !== 0) {
      throw new Error(`Unable to download Miniconda installer: ${downloadResult.stderr || downloadResult.stdout || downloadResult.status}`);
    }
  }

  await ensureDirectory(getManagedCondaRoot());
  const installResult = installerSpec.installMode === "windows-exe"
    ? spawnSync(installerPath, ["/S", `/D=${getManagedCondaRoot()}`], {
        cwd: workspacePath,
        encoding: "utf8",
        windowsHide: true
      })
    : spawnSync("/bin/bash", ["-lc", `${quoteShellArgument(installerPath)} -b -p ${quoteShellArgument(getManagedCondaRoot())}`], {
        cwd: workspacePath,
        encoding: "utf8"
      });
  if (installResult.status !== 0) {
    throw new Error(`Unable to install managed Miniconda: ${installResult.stderr || installResult.stdout || installResult.status}`);
  }

  if (!(await pathExists(managedCondaPath))) {
    throw new Error(`Managed Miniconda install completed but conda was not found at ${managedCondaPath}`);
  }

  return managedCondaPath;
}

async function ensureWorkspaceCondaConfig(workspace: WorkspaceCatalogItem): Promise<CondaDiscoveryResult> {
  const preferred = await getDesktopReadyCondaExecutable();
  if (!preferred) {
    throw new Error("Desktop conda initialization has not completed yet.");
  }
  const source = preferred.source;
  const condaPath = preferred.condaPath;
  const envPath = workspace.conda?.envPath?.trim() || getWorkspaceEnvRoot(workspace.id);
  const envName = workspace.conda?.envName?.trim() || makeWorkspaceEnvName(workspace.id);
  const pythonVersion = getWorkspacePythonVersion(workspace);

  await ensureDirectory(dirname(envPath));
  const envExists = await pathExists(envPath);
  if (!envExists) {
    const createArgs = ["create", "--yes", "--prefix", envPath, `python=${pythonVersion}`];
    const createResult = condaPath.toLowerCase().endsWith(".bat")
      ? spawnSync("cmd.exe", ["/d", "/s", "/c", `"${condaPath}" ${createArgs.map((item) => quoteShellArgument(item)).join(" ")}`], {
          cwd: workspace.path,
          encoding: "utf8",
          windowsHide: true
        })
      : spawnSync(condaPath, createArgs, {
          cwd: workspace.path,
          encoding: "utf8",
          windowsHide: true
        });
    if (createResult.status !== 0) {
      throw new Error(`Unable to create conda env for ${workspace.name}: ${createResult.stderr || createResult.stdout || createResult.status}`);
    }
  }

  const config: WorkspaceCondaConfig = {
    source,
    condaPath,
    envPath,
    envName,
    pythonVersion,
    lastCheckedAt: nowIso(),
    lastProvisionedAt: workspace.conda?.lastProvisionedAt?.trim() || nowIso()
  };

  return {
    config,
    shellEnv: buildCondaShellEnv(condaPath, envPath)
  };
}

async function ensureWorkspaceCatalogConda(catalog: WorkspaceCatalogFile) {
  let changed = false;
  const nextWorkspaces: WorkspaceCatalogItem[] = [];

  for (const workspace of catalog.workspaces) {
    try {
      const discovery = await ensureWorkspaceCondaConfig(workspace);
      const nextWorkspace = normalizeWorkspace({
        ...workspace,
        conda: discovery.config
      });
      nextWorkspaces.push(nextWorkspace);
      if (JSON.stringify(workspace.conda ?? null) !== JSON.stringify(nextWorkspace.conda ?? null)) {
        changed = true;
      }
    } catch (error) {
      void appendDesktopDebugLog(`conda bootstrap failed for ${workspace.name}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      nextWorkspaces.push(normalizeWorkspace(workspace));
    }
  }

  if (changed) {
    return writeWorkspaceCatalog(nextWorkspaces);
  }
  return { workspaces: nextWorkspaces };
}

async function ensureWorkspaceThreads(workspace: WorkspaceCatalogItem) {
  await ensureDirectory(join(getWorkspaceStateDir(workspace.id), "threads"));

  for (const thread of workspace.threads) {
    const threadStatePath = getThreadStatePath(workspace.id, thread.id);
    try {
      await fs.access(threadStatePath);
    } catch {
      const defaultState = createDefaultThreadState(workspace.name, thread.title);
      await fs.writeFile(threadStatePath, `${JSON.stringify({ record_type: "state_snapshot", state: defaultState })}\n`, "utf8");
    }
  }
}

async function ensureCatalogState(catalog: WorkspaceCatalogFile) {
  await ensureDirectory(workspaceStateRoot);
  for (const workspace of catalog.workspaces) {
    await ensureWorkspaceThreads(workspace);
  }
}

async function reconcileInterruptedThreads(catalog: WorkspaceCatalogFile) {
  const interrupted: Array<{ workspace: WorkspaceCatalogItem; thread: WorkspaceThreadRecord }> = [];
  const workspaces = catalog.workspaces.map((workspace) => ({
    ...workspace,
    threads: workspace.threads.map((thread) => {
      if (thread.status !== "running") return thread;
      const nextThread = {
        ...thread,
        status: "failed" as const,
        statusLabel: "已中断",
        lastEventSummary: "应用退出前任务未正常结束"
      };
      interrupted.push({ workspace, thread: nextThread });
      return nextThread;
    })
  }));
  if (!interrupted.length) return catalog;
  const nextCatalog = await writeWorkspaceCatalog(workspaces);
  await ensureCatalogState(nextCatalog);
  for (const item of interrupted) {
    const nextWorkspace = nextCatalog.workspaces.find((workspace) => workspace.id === item.workspace.id);
    const nextThread = nextWorkspace?.threads.find((thread) => thread.id === item.thread.id);
    if (nextWorkspace && nextThread) {
      await appendThreadEvents(nextWorkspace, nextThread, [createThreadEvent("error", {
        stage: "startup_recovery",
        message: "应用退出前任务未正常结束"
      })]);
    }
  }
  return nextCatalog;
}

function getWorkspaceShellEnv(workspace?: WorkspaceCatalogItem) {
  const baseEnv =
    workspace?.conda?.condaPath?.trim() && workspace.conda.envPath?.trim()
      ? buildCondaShellEnv(workspace.conda.condaPath, workspace.conda.envPath)
      : { ...(process.env as Record<string, string>) };
  return baseEnv;
}

async function getActiveDesktopPreferences() {
  const config = await readRootConfig();
  const preferences = normalizeDesktopPreferences(config.preferences);
  preferences.browser.agentPermissions.exceptions = await mergeBrowserPermissionsExceptions(
    workspaceStateRoot,
    preferences.browser.agentPermissions?.exceptions || []
  );
  cachedBrowserUsePreferences = preferences.browser;
  return preferences;
}

function installBrowserAgentPolicyGate(
  targetRuntime: Awaited<ReturnType<typeof createLocalRuntime>>
) {
  const original = targetRuntime.evaluateToolPolicy.bind(targetRuntime);
  targetRuntime.evaluateToolPolicy = (
    descriptor: { name?: string; kind?: string; risk?: string; requiresApproval?: boolean },
    argumentsValue: Record<string, unknown>,
    permissionMode?: "full" | "approval" | "agent"
  ) => {
    const currentUrl =
      previewWindowRef && !previewWindowRef.isDestroyed()
        ? previewWindowRef.webContents.getURL()
        : cachedBrowserUsePreferences.previewUrl;
    const browserDecision = evaluateBrowserToolPolicyDecision(
      cachedBrowserUsePreferences,
      String(descriptor?.name || ""),
      argumentsValue || {},
      currentUrl
    );
    if (browserDecision) {
      targetRuntime.sessionMachine.events.push({
        id: `policy_${Date.now().toString(36)}`,
        type: "policy_decision",
        timestamp: new Date().toISOString(),
        payload: {
          toolName: descriptor?.name,
          decision: browserDecision.decision,
          source: browserDecision.source,
          ruleId: browserDecision.ruleId,
          reason: browserDecision.reason
        }
      });
      return browserDecision;
    }
    return original(descriptor, argumentsValue, permissionMode);
  };
}

async function buildWorkspaceShellEnvWithPreferences(workspace?: WorkspaceCatalogItem) {
  const preferences = await getActiveDesktopPreferences();
  const baseEnv =
    workspace?.conda?.condaPath?.trim() && workspace.conda.envPath?.trim()
      ? buildCondaShellEnv(workspace.conda.condaPath, workspace.conda.envPath)
      : { ...(process.env as Record<string, string>) };
  return {
    ...baseEnv,
    ...preferences.environment.extraEnv
  };
}

function showMainWindowFromShortcut() {
  const window = mainWindowRef;
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function registerPopupShortcut(shortcut: string) {
  const normalizedShortcut = shortcut.trim();
  if (registeredPopupShortcut) {
    try {
      globalShortcut.unregister(registeredPopupShortcut);
    } catch (error) {
      void appendDesktopDebugLog(`popup shortcut unregister failed ${error instanceof Error ? error.message : String(error)}`);
    }
    registeredPopupShortcut = "";
  }

  if (!normalizedShortcut) {
    return;
  }

  try {
    const ok = globalShortcut.register(normalizedShortcut, showMainWindowFromShortcut);
    if (ok) {
      registeredPopupShortcut = normalizedShortcut;
    } else {
      void appendDesktopDebugLog(`popup shortcut register rejected ${normalizedShortcut}`);
    }
  } catch (error) {
    void appendDesktopDebugLog(`popup shortcut register failed ${normalizedShortcut}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function sendDictationCommand(action: "start" | "toggle", source: "hold" | "toggle") {
  const window = mainWindowRef;
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  window.webContents.send("phase1:dictation-command", { action, source });
}

function registerDictationShortcuts(dictation: DesktopPreferences["dictation"]) {
  for (const shortcut of registeredDictationShortcuts) {
    try {
      globalShortcut.unregister(shortcut);
    } catch (error) {
      void appendDesktopDebugLog(`dictation shortcut unregister failed ${shortcut}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  registeredDictationShortcuts.clear();

  const candidates = [
    { shortcut: dictation.holdShortcut.trim(), action: "start", source: "hold" },
    { shortcut: dictation.toggleShortcut.trim(), action: "toggle", source: "toggle" }
  ].filter((item) => item.shortcut) as Array<{ shortcut: string; action: "start" | "toggle"; source: "hold" | "toggle" }>;

  for (const item of candidates) {
    if (registeredDictationShortcuts.has(item.shortcut)) continue;
    try {
      const ok = globalShortcut.register(item.shortcut, () => sendDictationCommand(item.action, item.source));
      if (ok) {
        registeredDictationShortcuts.add(item.shortcut);
      } else {
        void appendDesktopDebugLog(`dictation shortcut register rejected ${item.shortcut}`);
      }
    } catch (error) {
      void appendDesktopDebugLog(`dictation shortcut register failed ${item.shortcut}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function applyDesktopPreferences(preferences: DesktopPreferences) {
  try {
    applyLoginItemSettings(app, preferences.launchAtLogin !== false);
  } catch (error) {
    void appendDesktopDebugLog(`login item update failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  cachedBrowserUsePreferences = preferences.browser;
  terminalSession.shell = preferences.environment.terminalShell;
  registerPopupShortcut(preferences.popup.shortcut);
  registerDictationShortcuts(preferences.dictation);
  const catalog = await readWorkspaceCatalog();
  const activeWorkspace = catalog.workspaces.find((item) => item.id === activeWorkspaceId);
  activeShellEnv = await buildWorkspaceShellEnvWithPreferences(activeWorkspace);
  runtime?.setShellEnv(activeShellEnv);

  if (terminalSession.process && terminalSession.isRunning) {
    terminalSession.process.kill();
    terminalSession.process = null;
    terminalSession.isRunning = false;
  }
  setupWorkspaceWatcher(preferences);
}

function resolveThemePreference(preferences: DesktopPreferences) {
  if (preferences.appearance.theme !== "system") {
    return preferences.appearance.theme;
  }
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

async function ensurePreviewWindow(targetUrl: string) {
  const preferences = await getActiveDesktopPreferences();
  if (preferences.browser.enabled === false) {
    throw new Error("Browser Use 已关闭。请在设置 → 浏览器中开启。");
  }
  const partition = "persist:newbrain-browser";
  if (previewWindowRef && !previewWindowRef.isDestroyed()) {
    if (!preferences.browser.preserveTabs || previewWindowRef.webContents.getURL() !== targetUrl) {
      await previewWindowRef.loadURL(targetUrl);
    }
    previewWindowRef.show();
    void recordBrowserHistoryVisit(
      { rootDir: workspaceStateRoot },
      { url: previewWindowRef.webContents.getURL(), title: previewWindowRef.webContents.getTitle() }
    ).catch(() => undefined);
    return previewWindowRef;
  }

  const previewWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    title: "NewBrain 浏览器",
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition
    }
  });
  const downloadDir = String(preferences.browser.downloadDir || "").trim();
  void downloadDir;
  previewWindow.webContents.session.removeAllListeners("will-download");
  previewWindow.webContents.session.on("will-download", (_event, item) => {
    void applyBrowserDownloadItemPolicy({
      item,
      browser: preferences.browser,
      askApproval: askBrowserDownloadApprovalDialog,
      askSavePath: pickBrowserDownloadSavePath
    });
  });
  const syncPreviewTitle = () => {
    const pageUrl = previewWindow.webContents.getURL();
    const pageTitle = previewWindow.webContents.getTitle();
    if (preferences.browser.showFullUrl) {
      previewWindow.setTitle(pageUrl || "NewBrain 浏览器");
    } else {
      previewWindow.setTitle(pageTitle ? `${pageTitle} — NewBrain` : "NewBrain 浏览器");
    }
  };
  previewWindow.webContents.on("page-title-updated", syncPreviewTitle);
  previewWindow.webContents.on("did-navigate", () => {
    syncPreviewTitle();
  });
  previewWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const normalized = requireWebUrl(url);
      const target = resolveBrowserLinkOpenTarget(preferences.browser, normalized);
      if (target === "system") {
        void electronShell.openExternal(normalized);
      } else {
        void previewWindow.loadURL(normalized);
      }
    } catch {
      // deny non-http(s)
    }
    return { action: "deny" };
  });
  previewWindow.webContents.on("will-navigate", (event, url) => {
    try {
      requireWebUrl(url);
    } catch {
      event.preventDefault();
    }
  });
  previewWindow.webContents.on("did-navigate", (_event, url) => {
    void recordBrowserHistoryVisit(
      { rootDir: workspaceStateRoot },
      { url, title: previewWindow.webContents.getTitle() }
    ).catch(() => undefined);
  });
  previewWindowRef = previewWindow;
  previewWindow.on("closed", () => {
    if (previewWindowRef === previewWindow) {
      previewWindowRef = null;
    }
  });
  await previewWindow.loadURL(targetUrl);
  previewWindow.show();
  return previewWindow;
}

function requireWebUrl(value: unknown) {
  return normalizeBrowserPreviewUrl(value);
}

function registerBrowserAgentTools() {
  runtime.unregisterExternalTools("browser");
  runtime.registerExternalTool({
    name: "browser.open",
    title: "打开网页",
    description: "Open an HTTP or HTTPS URL in the NewBrain browser.",
    kind: "read",
    risk: "low",
    requiresApproval: true,
    namespace: "browser",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "Absolute HTTP or HTTPS URL." } },
      required: ["url"],
      additionalProperties: false
    }
  }, async (input: { url?: string }) => {
    const preferences = await getActiveDesktopPreferences();
    const url = requireWebUrl(input.url);
    const origin = browserOriginFromUrl(url);
    assertBrowserAgentPermission(preferences.browser, origin, "browse");
    const window = await ensurePreviewWindow(url);
    if (preferences.browser.fullCdpAccess) {
      await attachBrowserCdpIfAllowed({
        fullCdpAccess: true,
        webContents: window.webContents
      });
    }
    if (preferences.browser.siteToolsEnabled) {
      void probeBrowserSiteTools({ siteToolsEnabled: true, pageUrl: url }).catch(() => undefined);
    }
    return {
      ok: true,
      exitCode: 0,
      output: JSON.stringify({ url: window.webContents.getURL(), title: window.webContents.getTitle() })
    };
  });
  runtime.registerExternalTool({
    name: "browser.read_page",
    title: "读取网页",
    description: "Read the current browser page title, URL, visible text, and links.",
    kind: "read",
    risk: "low",
    requiresApproval: false,
    namespace: "browser",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  }, async () => {
    const preferences = await getActiveDesktopPreferences();
    const currentUrl = previewWindowRef?.webContents.getURL() || preferences.browser.previewUrl;
    assertBrowserAgentPermission(preferences.browser, browserOriginFromUrl(currentUrl), "browse");
    const window = await ensurePreviewWindow(currentUrl);
    const page = await window.webContents.executeJavaScript(`(() => {
      const visible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const links = Array.from(document.querySelectorAll("a[href]"))
        .filter(visible)
        .slice(0, 100)
        .map((link) => ({ text: (link.textContent || "").trim(), url: link.href }));
      return {
        url: location.href,
        title: document.title,
        text: (document.body?.innerText || "").slice(0, 30000),
        links
      };
    })()`, true);
    return { ok: true, exitCode: 0, output: JSON.stringify(page) };
  });
  runtime.registerExternalTool({
    name: "browser.click",
    title: "点击网页元素",
    description: "Click an element in the current page using a CSS selector.",
    kind: "write",
    risk: "medium",
    requiresApproval: true,
    namespace: "browser",
    inputSchema: {
      type: "object",
      properties: { selector: { type: "string" } },
      required: ["selector"],
      additionalProperties: false
    }
  }, async (input: { selector?: string }) => {
    if (!previewWindowRef || previewWindowRef.isDestroyed()) throw new Error("No browser page is open.");
    const preferences = await getActiveDesktopPreferences();
    assertBrowserAgentPermission(
      preferences.browser,
      browserOriginFromUrl(previewWindowRef.webContents.getURL()),
      "browse"
    );
    const selector = String(input.selector ?? "").trim();
    if (!selector) throw new Error("A CSS selector is required.");
    const result = await previewWindowRef.webContents.executeJavaScript(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return { ok: false, detail: "Element not found." };
      element.click();
      return { ok: true, detail: "Element clicked." };
    })()`, true);
    return { ok: Boolean(result?.ok), exitCode: result?.ok ? 0 : 1, output: String(result?.detail ?? "") };
  });
  runtime.registerExternalTool({
    name: "browser.type",
    title: "输入网页内容",
    description: "Replace the value of an input or textarea selected by CSS and dispatch input/change events.",
    kind: "write",
    risk: "medium",
    requiresApproval: true,
    namespace: "browser",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string" },
        text: { type: "string" }
      },
      required: ["selector", "text"],
      additionalProperties: false
    }
  }, async (input: { selector?: string; text?: string }) => {
    if (!previewWindowRef || previewWindowRef.isDestroyed()) throw new Error("No browser page is open.");
    const preferences = await getActiveDesktopPreferences();
    assertBrowserAgentPermission(
      preferences.browser,
      browserOriginFromUrl(previewWindowRef.webContents.getURL()),
      "browse"
    );
    const selector = String(input.selector ?? "").trim();
    if (!selector) throw new Error("A CSS selector is required.");
    const result = await previewWindowRef.webContents.executeJavaScript(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
        return { ok: false, detail: "Editable element not found." };
      }
      element.focus();
      element.value = ${JSON.stringify(String(input.text ?? ""))};
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, detail: "Text entered." };
    })()`, true);
    return { ok: Boolean(result?.ok), exitCode: result?.ok ? 0 : 1, output: String(result?.detail ?? "") };
  });
  runtime.registerExternalTool({
    name: "browser.screenshot",
    title: "网页截图",
    description: "Capture the current NewBrain browser page and return the PNG path.",
    kind: "read",
    risk: "low",
    requiresApproval: false,
    namespace: "browser",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  }, async () => {
    if (!previewWindowRef || previewWindowRef.isDestroyed()) throw new Error("No browser page is open.");
    const preferences = await getActiveDesktopPreferences();
    assertBrowserAgentPermission(
      preferences.browser,
      browserOriginFromUrl(previewWindowRef.webContents.getURL()),
      "browse"
    );
    const image = await previewWindowRef.webContents.capturePage();
    await ensureDirectory(workspaceStateRoot);
    await fs.writeFile(desktopPreviewScreenshotPath, image.toPNG());
    const pageUrl = previewWindowRef.webContents.getURL();
    const annotationPath = await writeBrowserScreenshotAnnotation({
      mode: preferences.browser.annotatedScreenshots || "always",
      path: desktopPreviewScreenshotPath,
      url: pageUrl,
      title: previewWindowRef.webContents.getTitle(),
      ask: askBrowserAnnotationDialog
    });
    return {
      ok: true,
      exitCode: 0,
      output: JSON.stringify({ path: desktopPreviewScreenshotPath, url: pageUrl, annotationPath })
    };
  });
}

async function capturePreviewWindow() {
  const preferences = await getActiveDesktopPreferences();
  const targetUrl = previewWindowRef?.webContents.getURL() || preferences.browser.previewUrl;
  const previewWindow = await ensurePreviewWindow(targetUrl);
  if (preferences.browser.highResScreenshots) {
    previewWindow.webContents.setZoomFactor(1.5);
  }
  const image = await previewWindow.webContents.capturePage();
  await ensureDirectory(workspaceStateRoot);
  await fs.writeFile(desktopPreviewScreenshotPath, image.toPNG());
  const annotationPath = await writeBrowserScreenshotAnnotation({
    mode: preferences.browser.annotatedScreenshots || "always",
    path: desktopPreviewScreenshotPath,
    url: targetUrl,
    title: previewWindow.webContents.getTitle(),
    ask: askBrowserAnnotationDialog
  });
  if (preferences.browser.highResScreenshots) {
    previewWindow.webContents.setZoomFactor(1);
  }
  await appendDiagnosticsLog(`captured preview screenshot ${desktopPreviewScreenshotPath}`);
  return { ok: true, path: desktopPreviewScreenshotPath, url: targetUrl, annotationPath };
}

function setupWorkspaceWatcher(preferences: DesktopPreferences) {
  workspaceWatcher?.close();
  workspaceWatcher = null;
  let localPreview = false;
  try {
    const hostname = new URL(preferences.browser.previewUrl).hostname;
    localPreview = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    localPreview = false;
  }
  if (!preferences.browser.autoOpenPreview || !localPreview || !activeWorkspaceId) {
    return;
  }
  void readWorkspaceCatalog().then((catalog) => {
    const workspace = catalog.workspaces.find((item) => item.id === activeWorkspaceId);
    if (!workspace) {
      return;
    }
    workspaceWatcher = watch(workspace.path, { recursive: true }, (_event, filename) => {
      const name = String(filename ?? "");
      if (!/\.(tsx?|jsx?|css|html|vue|svelte)$/i.test(name)) {
        return;
      }
      if (workspaceWatchDebounce) {
        clearTimeout(workspaceWatchDebounce);
      }
      workspaceWatchDebounce = setTimeout(() => {
        void ensurePreviewWindow(preferences.browser.previewUrl).catch((error) => {
          void appendDesktopDebugLog(`auto preview failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      }, 500);
    });
  }).catch((error) => {
    void appendDesktopDebugLog(`workspace watcher failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}

async function readThreadState(workspace: WorkspaceCatalogItem, thread: WorkspaceThreadRecord) {
  await ensureWorkspaceThreads(workspace);
  const threadStatePath = getThreadStatePath(workspace.id, thread.id);

  try {
    // Prefer reverse EOF scan so multi-hundred-MB rollouts do not blow UTF-8 string limits.
    const snapshot = await readLatestStateSnapshot<Partial<ThreadStateFile>>(threadStatePath);
    if (!snapshot) throw new Error(`Thread rollout has no state snapshot: ${threadStatePath}`);
    const parsed = snapshot;
    return {
      version: 2 as const,
      messages: Array.isArray(parsed.messages)
        ? parsed.messages
        : createDefaultThreadState(workspace.name, thread.title).messages,
      memories: Array.isArray(parsed.memories) ? parsed.memories : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      timeline: Array.isArray(parsed.timeline) ? parsed.timeline : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
      context: parsed.context?.version === 1
        ? parsed.context
        : { version: 1 as const, summary: "", compactedMessageIds: [], estimatedTokens: 0, modelContextWindow: 128_000 }
      };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const legacyThreadStatePath = getLegacyThreadStatePath(workspace.id, thread.id);
      try {
        const raw = await fs.readFile(legacyThreadStatePath, "utf8");
        const parsed = JSON.parse(raw) as Partial<ThreadStateFile>;
        if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
          const migratedState: ThreadStateFile = {
            version: 2,
            messages: parsed.messages,
            memories: Array.isArray(parsed.memories) ? parsed.memories : [],
            runs: Array.isArray(parsed.runs) ? parsed.runs : [],
            timeline: Array.isArray(parsed.timeline) ? parsed.timeline : [],
            events: Array.isArray(parsed.events) ? parsed.events : [],
            context: parsed.context?.version === 1
              ? parsed.context
              : { version: 1, summary: "", compactedMessageIds: [], estimatedTokens: 0, modelContextWindow: 128_000 }
          };
          await writeThreadState(workspace, thread, migratedState);
          return migratedState;
        }
      } catch (legacyError) {
        if ((legacyError as NodeJS.ErrnoException).code !== "ENOENT") {
          await appendDesktopDebugLog(
            `legacy thread state read failed workspace=${workspace.id} thread=${thread.id}: ${
              legacyError instanceof Error ? legacyError.message : String(legacyError)
            }`
          );
        }
      }
      const defaultState = createDefaultThreadState(workspace.name, thread.title);
      await writeThreadState(workspace, thread, defaultState);
      return defaultState;
    }

    throw error;
  }
}

async function writeThreadState(
  workspace: WorkspaceCatalogItem,
  thread: WorkspaceThreadRecord,
  state: ThreadStateFile
) {
  await ensureWorkspaceThreads(workspace);
  const threadStatePath = getThreadStatePath(workspace.id, thread.id);
  const normalizedState: ThreadStateFile = { ...state, version: 2, events: state.events ?? [] };
  await appendStateSnapshotCompacting(threadStatePath, createStateSnapshot({
    threadId: thread.id,
    state: normalizedState
  }));
  const sourceUpdatedAt = Date.parse(thread.updatedAt) || Date.now();
  for (const memory of normalizedState.memories) {
    codexStorage.upsertMemory({
      threadId: thread.id,
      sourceUpdatedAt,
      rawMemory: JSON.stringify(memory),
      rolloutSummary: String((memory as any).summary ?? (memory as any).content ?? ""),
      rolloutSlug: thread.id,
      generatedAt: sourceUpdatedAt,
      usageCount: 0,
      lastUsage: sourceUpdatedAt
    });
  }
}

async function appendThreadEvents(
  workspace: WorkspaceCatalogItem,
  thread: WorkspaceThreadRecord,
  events: ThreadEventRecord[]
) {
  if (!events.length) return;
  await ensureWorkspaceThreads(workspace);
  const state = await readThreadState(workspace, thread);
  state.events = [...(state.events ?? []), ...events].slice(-500);
  await writeThreadState(workspace, thread, state);
  await appendRolloutRecords(
    getThreadEventLogPath(workspace.id, thread.id),
    events.map((event) => toRolloutThreadEvent(thread.id, event))
  );
}

async function appendRuntimeEventsSince(
  offset: number,
  turnId = makeId("runtime-turn"),
  target?: {
    runtime: Awaited<ReturnType<typeof createLocalRuntime>>;
    workspaceId: string;
    threadId: string;
  }
) {
  // Freeze write target at call entry so a mid-await UI thread switch cannot redirect rollout writes.
  const targetRuntime = target?.runtime ?? runtime;
  const workspaceId = target?.workspaceId ?? activeWorkspaceId;
  const threadId = target?.threadId ?? activeThreadId;
  const events = targetRuntime.sessionMachine.events.slice(offset);
  if (!events.length || !workspaceId || !threadId) return;
  const catalog = await readWorkspaceCatalog();
  const workspace = catalog.workspaces.find((item) => item.id === workspaceId);
  const thread = workspace?.threads.find((item) => item.id === threadId);
  if (!workspace || !thread) return;
  await appendRolloutRecords(
    getThreadEventLogPath(workspace.id, thread.id),
    events.map((event: any) => createRolloutEvent({
      recordType: event.type,
      threadId: thread.id,
      turnId,
      timestamp: event.timestamp,
      payload: event.payload
    }))
  );
}

async function appendTimelineEvent(
  workspace: WorkspaceCatalogItem,
  thread: WorkspaceThreadRecord,
  event: WorkspaceTimelineEvent
) {
  const state = await readThreadState(workspace, thread);
  state.timeline = [event, ...(state.timeline ?? [])].slice(0, 80);
  await writeThreadState(workspace, thread, state);
}

async function cloneThreadState(
  workspace: WorkspaceCatalogItem,
  sourceThread: WorkspaceThreadRecord,
  nextThread: WorkspaceThreadRecord
) {
  const sourceState = await readThreadState(workspace, sourceThread);
  const nextState: ThreadStateFile = {
    version: 2,
    messages: [...sourceState.messages],
    memories: [...sourceState.memories],
    runs: [...sourceState.runs],
    timeline: [
      createTimelineEvent("thread", "线程已分叉", `从线程 ${sourceThread.title} 分叉而来`),
      ...(sourceState.timeline ?? [])
    ].slice(0, 80),
    events: [
      ...(sourceState.events ?? []),
      createThreadEvent("message", { kind: "thread_fork", sourceThreadId: sourceThread.id })
    ].slice(-500),
    context: sourceState.context ? { ...sourceState.context, compactedMessageIds: [...sourceState.context.compactedMessageIds] } : undefined
  };
  await writeThreadState(workspace, nextThread, nextState);
}

async function updateThreadMetadata(input: {
  workspaceId: string;
  threadId: string;
  title?: string;
  summary?: string;
  lastEventSummary?: string;
  status?: WorkspaceThreadRecord["status"];
  statusLabel?: string;
  branch?: string;
  touchUpdatedAt?: boolean;
}) {
  const catalog = await readWorkspaceCatalog();
  const nextWorkspaces = catalog.workspaces.map((workspace) => {
    if (workspace.id !== input.workspaceId) {
      return workspace;
    }

    const nextThreads = workspace.threads.map((thread) => {
      if (thread.id !== input.threadId) {
        return thread;
      }

      return normalizeThread({
        ...thread,
        title: input.title ?? thread.title,
        summary: input.summary ?? thread.summary,
        lastEventSummary: input.lastEventSummary ?? thread.lastEventSummary,
        status: input.status ?? thread.status,
        statusLabel: input.statusLabel ?? thread.statusLabel,
        branch: input.branch ?? thread.branch,
        updatedAt: input.touchUpdatedAt === false ? thread.updatedAt : nowIso()
      });
    });

    return {
      ...workspace,
      threads: sortThreads(nextThreads)
    };
  });

  return writeWorkspaceCatalog(nextWorkspaces);
}

async function addWorkspace(input: { name: string; path: string; brainWorkspaceKey?: string }) {
  const catalog = await readWorkspaceCatalog();
  const resolvedPath = resolve(input.path.trim());

  if (!input.path.trim()) {
    throw new Error("Workspace path is required.");
  }

  await ensureExistingDirectory(resolvedPath, "Workspace path");

  const duplicate = catalog.workspaces.find(
    (workspace) => workspace.path.toLowerCase() === resolvedPath.toLowerCase()
  );

  if (duplicate) {
    return catalog;
  }

  const nextWorkspace = normalizeWorkspace({
    name: input.name,
    path: resolvedPath,
    brainWorkspaceKey: input.brainWorkspaceKey as any,
    threads: [
      normalizeThread({
        title: "默认线程",
        summary: `围绕 ${input.name.trim() || basename(resolvedPath)} 的初始上下文线程。`,
        lastEventSummary: "线程已创建"
      })
    ]
  });

  const nextCatalog = await writeWorkspaceCatalog([...catalog.workspaces, nextWorkspace]);
  await ensureCatalogState(nextCatalog);
  return nextCatalog;
}

async function addWorkspaceThread(input: {
  workspaceId: string;
  title: string;
  summary: string;
  scope?: "project" | "chat";
  brainWorkspaceKey?: import("@codex-forge/protocol").BrainWorkspaceKey;
}) {
  const catalog = await readWorkspaceCatalog();
  const nextThread = normalizeThread({
    title: input.title,
    summary: input.summary,
    scope: input.scope,
    ...(input.brainWorkspaceKey ? { brainWorkspaceKey: input.brainWorkspaceKey } : {}),
    lastEventSummary: "线程已创建"
  });

  const nextWorkspaces = catalog.workspaces.map((workspace) => {
    if (workspace.id !== input.workspaceId) {
      return workspace;
    }

    return {
      ...workspace,
      threads: sortThreads([nextThread, ...workspace.threads])
    };
  });

  const nextCatalog = await writeWorkspaceCatalog(nextWorkspaces);
  const workspace = nextCatalog.workspaces.find((item) => item.id === input.workspaceId);
  if (workspace) {
    await writeThreadState(workspace, nextThread, createDefaultThreadState(workspace.name, nextThread.title));
  }
  await ensureCatalogState(nextCatalog);
  return nextCatalog;
}

async function forkWorkspaceThread(input: {
  workspaceId: string;
  sourceThreadId: string;
  title: string;
  owner?: "planner" | "researcher" | "verifier" | "editor";
  instruction?: string;
}) {
  const catalog = await readWorkspaceCatalog();
  const workspace = catalog.workspaces.find((item) => item.id === input.workspaceId);
  const sourceThread = workspace?.threads.find((item) => item.id === input.sourceThreadId);

  if (!workspace || !sourceThread) {
    throw new Error("Source thread was not found.");
  }

  const nextThread = normalizeThread({
    title: input.title.trim(),
    summary: sourceThread.summary,
    lastEventSummary: `从 ${sourceThread.title} 分叉`
  });

  const nextCatalog = await writeWorkspaceCatalog(
    catalog.workspaces.map((item) =>
      item.id === workspace.id
        ? { ...item, threads: sortThreads([nextThread, ...item.threads]) }
        : item
    )
  );

  const nextWorkspace = nextCatalog.workspaces.find((item) => item.id === workspace.id);
  if (nextWorkspace) {
    await cloneThreadState(nextWorkspace, sourceThread, nextThread);
    const owner = input.owner ?? "researcher";
    const instruction = input.instruction?.trim() || `Continue from ${sourceThread.title} in an isolated child thread.`;
    codexStorage.linkThreadSpawn({
      parentThreadId: sourceThread.id,
      childThreadId: nextThread.id,
      status: "queued"
    });
    codexStorage.setThreadAgentMetadata(nextThread.id, {
      nickname: input.title.trim() || owner,
      role: owner,
      agentPath: `${sourceThread.id}/${nextThread.id}`
    });
    const delegatedTask = runtime.delegateAgentTask({
      id: nextThread.id,
      parentThreadId: sourceThread.id,
      childThreadId: nextThread.id,
      title: input.title.trim() || nextThread.title,
      instruction,
      owner
    });
    codexStorage.upsertDelegatedAgentTask(delegatedTask);
    await appendThreadEvents(nextWorkspace, sourceThread, [createThreadEvent("tool_call", {
      kind: "agent_delegate",
      childThreadId: nextThread.id,
      owner,
      instruction,
      status: "queued"
    })]);
  }

  return nextCatalog;
}

async function runDelegatedAgent(input: { workspaceId: string; childThreadId: string }) {
  const task = runtime.listDelegatedTasks().find((item) => item.childThreadId === input.childThreadId);
  if (!task) throw new Error(`Delegated task was not found for ${input.childThreadId}.`);
  const catalog = await readWorkspaceCatalog();
  const workspace = catalog.workspaces.find((item) => item.id === input.workspaceId);
  const childThread = workspace?.threads.find((item) => item.id === input.childThreadId);
  if (!workspace || !childThread) throw new Error("Delegated child thread was not found.");

  codexStorage.updateThreadSpawnStatus(childThread.id, "running");
  await updateThreadMetadata({
    workspaceId: workspace.id,
    threadId: childThread.id,
    status: "running",
    statusLabel: "子 Agent 运行中",
    lastEventSummary: task.instruction
  });

  const completed = await runtime.runDelegatedTask(task.id, async (currentTask) => {
    const config = await readRootConfig();
    const state = await readThreadState(workspace, childThread);
    const userMessage: ChatMessage = {
      id: makeId("msg"),
      role: "user",
      content: currentTask.instruction,
      createdAt: nowIso()
    };
    const childSystemPrompt = [
      config.llm.systemPrompt,
      `You are the ${currentTask.owner} child agent for parent thread ${currentTask.parentThreadId}.`,
      "Work only on the bounded delegated instruction. Return evidence and a concise result for the parent agent."
    ].filter(Boolean).join("\n\n");
    const childMessages = [...state.messages.filter((message) => message.role !== "tool"), userMessage];
    const childAbortController = new AbortController();
    const response = await executeDelegatedModelStep(desktopModelChatStepService, {
      modelInput: {
        ...config.llm,
        requestId: childThread.id,
        workspaceId: workspace.id,
        threadId: childThread.id,
        systemPrompt: childSystemPrompt,
        messages: []
      },
      messages: childMessages,
      tools: [],
      systemPrompt: childSystemPrompt,
      abortSignal: childAbortController.signal,
      requestId: childThread.id,
      onReasoningDelta: () => undefined,
      onRetry: (requestId, attempt, maxAttempts, delayMs) => {
        void appendDesktopDebugLog(
          `child model step retry child=${childThread.id} requestId=${requestId} attempt=${attempt} maxAttempts=${maxAttempts} delayMs=${delayMs}`
        );
      }
    });
    const assistantMessage: ChatMessage = {
      id: makeId("msg"),
      role: "assistant",
      content: response.content,
      createdAt: nowIso()
    };
    state.messages = [...state.messages, userMessage, assistantMessage];
    state.timeline = [
      createTimelineEvent("thread", "子 Agent 已完成", response.content.slice(0, 160)),
      ...(state.timeline ?? [])
    ].slice(0, 80);
    await writeThreadState(workspace, childThread, state);
    await appendThreadEvents(workspace, childThread, [
      createThreadEvent("message", { role: "user", messageId: userMessage.id, content: userMessage.content }),
      createThreadEvent("message", { role: "assistant", messageId: assistantMessage.id, content: assistantMessage.content })
    ]);
    return { content: response.content, summary: response.content.replace(/\s+/g, " ").slice(0, 500) };
  });

  const edgeStatus = completed.status === "completed" ? "completed" : "failed";
  codexStorage.upsertDelegatedAgentTask(completed);
  codexStorage.updateThreadSpawnStatus(childThread.id, edgeStatus);
  await updateThreadMetadata({
    workspaceId: workspace.id,
    threadId: childThread.id,
    status: completed.status === "completed" ? "idle" : "failed",
    statusLabel: completed.status === "completed" ? "" : "子 Agent 失败",
    summary: completed.summary || completed.error,
    lastEventSummary: completed.status === "completed" ? "子 Agent 已完成，等待父线程合并" : completed.error
  });
  return completed;
}

async function mergeDelegatedAgentResults(input: {
  workspaceId: string;
  parentThreadId: string;
  childThreadIds: string[];
}) {
  const catalog = await readWorkspaceCatalog();
  const workspace = catalog.workspaces.find((item) => item.id === input.workspaceId);
  const parentThread = workspace?.threads.find((item) => item.id === input.parentThreadId);
  if (!workspace || !parentThread) throw new Error("Parent thread was not found.");
  const merged = await runtime.mergeDelegatedResults(
    input.parentThreadId,
    input.childThreadIds,
    async (tasks) => ({
      content: tasks.map((task) => {
        const resultContent = task.result && typeof task.result === "object" && "content" in task.result
          ? String((task.result as { content?: unknown }).content ?? "")
          : "";
        return `### ${task.title}（${task.owner}）\n\n${resultContent || task.summary}`;
      }).join("\n\n")
    })
  );
  const state = await readThreadState(workspace, parentThread);
  const message: ChatMessage = {
    id: makeId("msg"),
    role: "assistant",
    content: `## 子 Agent 合并结果\n\n${merged.content}`,
    createdAt: nowIso()
  };
  state.messages = [...state.messages, message];
  state.timeline = [
    createTimelineEvent("thread", "已合并子 Agent 结果", `${input.childThreadIds.length} 个结果已回并`),
    ...(state.timeline ?? [])
  ].slice(0, 80);
  await writeThreadState(workspace, parentThread, state);
  await appendThreadEvents(workspace, parentThread, [createThreadEvent("tool_result", {
    kind: "agent_merge",
    childThreadIds: input.childThreadIds,
    content: merged.content
  })]);
  return { ...merged, snapshot: buildSnapshotWithTimeline(runtime.getSnapshot(), state) };
}

async function createBlankWorkspace(input: { name: string; brainWorkspaceKey?: string }) {
  const name = input.name.trim();
  const folderName = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();

  if (!folderName) {
    throw new Error("Project name is required.");
  }

  const projectPath = join(workspaceStateRoot, "projects", folderName);
  await fs.mkdir(projectPath, { recursive: true });
  return addWorkspace({ name, path: projectPath, brainWorkspaceKey: input.brainWorkspaceKey });
}

async function renameWorkspace(input: { workspaceId: string; name: string }) {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Project name is required.");
  }
  const catalog = await readWorkspaceCatalog();
  const nextCatalog = await writeWorkspaceCatalog(
    catalog.workspaces.map((workspace) =>
      workspace.id === input.workspaceId ? { ...workspace, name } : workspace
    )
  );
  return nextCatalog;
}

async function removeWorkspace(input: { workspaceId: string }) {
  const catalog = await readWorkspaceCatalog();
  if (catalog.workspaces.length <= 1) {
    throw new Error("At least one project must remain.");
  }
  return writeWorkspaceCatalog(
    catalog.workspaces.filter((workspace) => workspace.id !== input.workspaceId)
  );
}

async function openWorkspaceLocation(input: { workspaceId: string; target: "finder" | "system" | "vscode" }) {
  const catalog = await readWorkspaceCatalog();
  const workspace = catalog.workspaces.find((item) => item.id === input.workspaceId);
  if (!workspace) throw new Error("Project not found.");
  if (input.target === "vscode") {
    const executable = process.platform === "win32" ? "where.exe" : "which";
    const availability = spawnSync(executable, ["code"], { encoding: "utf8", windowsHide: true });
    if (availability.status !== 0) {
      return { ok: false, detail: "未检测到 Visual Studio Code 命令。" };
    }
    try {
      spawn("code", [workspace.path], { detached: true, stdio: "ignore", windowsHide: true }).unref();
      return { ok: true, detail: "已在 Visual Studio Code 中打开。" };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }
  const detail = await electronShell.openPath(workspace.path);
  return { ok: !detail, detail: detail || "已在 Finder 中打开。" };
}

async function openSkillLocation(input: { id?: string; name?: string }) {
  const config = await readFeatureConfig();
  const skill = config.skills.find((item) => item.id === input.id || item.name === input.name);
  const skillName = normalizeSkillName(skill?.name || input.name || "");
  if (!skillName) throw new Error("Skill not found.");
  const candidates = [
    join(workspacePath, "skills", skillName),
    join(os.homedir(), ".codex", "skills", skillName)
  ];
  const skillPath = candidates.find((candidate) => existsSync(join(candidate, "SKILL.md")));
  if (!skillPath) throw new Error(`Skill directory was not found: ${skillName}`);
  const detail = await electronShell.openPath(skillPath);
  return { ok: !detail, detail: detail || "Skill directory opened." };
}

async function openLogLocation() {
  await ensureDirectory(workspacePath);
  const detail = await electronShell.openPath(workspacePath);
  return {
    ok: !detail,
    detail: detail || "Log directory opened.",
    path: workspacePath,
    files: {
      debug: desktopDebugLogPath,
      diagnostics: desktopDiagnosticsLogPath,
      auth: authAuditLogPath,
      sqlite: join(workspaceStateRoot, "logs_2.sqlite")
    }
  };
}

async function spawnDetachedAndConfirm(
  command: string,
  args: string[],
  options: { cwd?: string; windowsHide?: boolean } = {}
) {
  await new Promise<void>((resolveLaunch, rejectLaunch) => {
    let settled = false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: options.windowsHide ?? true
    });
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        rejectLaunch(error);
        return;
      }
      child.unref();
      resolveLaunch();
    };
    const timer = setTimeout(() => finish(), 350);
    child.once("error", finish);
    child.once("spawn", () => setTimeout(() => finish(), 100));
  });
}

async function openSystemTool(input: { toolId: string; workspaceId?: string }) {
  const tool = getSystemTools().find((item) => item.id === input.toolId);
  if (!tool || !tool.available) {
    return { ok: false, detail: "未找到可用应用。" };
  }
  const catalog = await readWorkspaceCatalog();
  const workspace = input.workspaceId
    ? catalog.workspaces.find((item) => item.id === input.workspaceId)
    : catalog.workspaces.find((item) => item.id === activeWorkspaceId);
  const targetPath = workspace?.path || runtime.workspacePath;

  try {
    if (tool.id === "finder") {
      const detail = await electronShell.openPath(targetPath);
      return { ok: !detail, detail: detail || `已在${tool.label}中打开。` };
    }
    if (process.platform === "darwin") {
      await spawnDetachedAndConfirm("open", ["-a", tool.appName, targetPath]);
      return { ok: true, detail: `已在 ${tool.label} 中打开当前项目。` };
    }

    const command = resolveSystemToolCommand(tool);
    if (!command) return { ok: false, detail: `未检测到 ${tool.label} 命令。` };
    let args = [targetPath];
    let cwd = targetPath;
    let windowsHide = true;
    if (tool.id === "terminal" && process.platform === "win32") {
      windowsHide = false;
      if (/^wt(?:\.exe)?$/i.test(command)) {
        args = ["-d", targetPath];
      } else if (/powershell/i.test(command)) {
        args = ["-NoExit", "-Command", `Set-Location -LiteralPath '${targetPath.replace(/'/g, "''")}'`];
      } else {
        args = ["/K", `cd /d "${targetPath.replace(/"/g, '""')}"`];
      }
    } else if (tool.id === "terminal") {
      args = [];
    }
    await spawnDetachedAndConfirm(command, args, { cwd, windowsHide });
    return { ok: true, detail: `已在 ${tool.label} 中打开当前项目。` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function getWorkspaceHeaderStatus(workspaceId: string) {
  const catalog = await readWorkspaceCatalog();
  const workspace = catalog.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) throw new Error("Project not found.");
  const runGit = (args: string[]) =>
    spawnSync("git", args, { cwd: workspace.path, encoding: "utf8", windowsHide: true });
  const branchResult = runGit(["branch", "--show-current"]);
  const statusResult = runGit(["status", "--porcelain"]);
  const numstatResult = runGit(["diff", "--no-ext-diff", "--numstat", "HEAD", "--", "."]);
  let additions = 0;
  let deletions = 0;
  if (numstatResult.status === 0) {
    for (const line of (numstatResult.stdout || "").split(/\r?\n/)) {
      const [added, deleted] = line.split(/\s+/);
      if (/^\d+$/.test(added)) additions += Number(added);
      if (/^\d+$/.test(deleted)) deletions += Number(deleted);
    }
  }
  const untrackedResult = runGit(["ls-files", "--others", "--exclude-standard", "-z", "--", "."]);
  const untrackedFiles = (untrackedResult.stdout || "").split("\0").filter(Boolean);
  for (const relativePath of untrackedFiles) {
    try {
      const filePath = resolve(workspace.path, relativePath);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;
      const content = await fs.readFile(filePath);
      if (content.includes(0)) continue;
      const text = content.toString("utf8");
      additions += text.length === 0 ? 0 : text.split(/\r?\n/).length;
    } catch {
      // A file can disappear while Git status is being refreshed.
    }
  }
  const ghResult = spawnSync("gh", ["--version"], { encoding: "utf8", windowsHide: true });
  return {
    branch: branchResult.stdout?.trim() || "main",
    changes: (statusResult.stdout || "").split(/\r?\n/).filter(Boolean).length,
    additions,
    deletions,
    githubCliAvailable: ghResult.status === 0
  };
}

async function getWorkspaceReviewChanges(input: { workspaceId?: string; threadId?: string }) {
  const catalog = await readWorkspaceCatalog();
  const workspace = catalog.workspaces.find((item) => item.id === (input.workspaceId || activeWorkspaceId));
  if (!workspace) throw new Error("Project not found.");
  const thread = workspace.threads.find((item) => item.id === (input.threadId || activeThreadId));
  const workspaceRoot = resolve(workspace.path);
  const eventPaths = new Set<string>();

  if (thread) {
    const state = await readThreadState(workspace, thread);
    for (const event of state.events ?? []) {
      if (event.type !== "file_change") continue;
      const rawPath = event.payload.path ?? event.payload.filePath;
      if (typeof rawPath !== "string" || !rawPath.trim()) continue;
      const absolutePath = isAbsolute(rawPath) ? resolve(rawPath) : resolve(workspaceRoot, rawPath);
      const relativePath = relative(workspaceRoot, absolutePath);
      if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) continue;
      eventPaths.add(relativePath.replace(/\\/g, "/"));
    }
  }

  const runGit = (args: string[]) =>
    spawnSync("git", args, { cwd: workspace.path, encoding: "utf8", windowsHide: true });
  const statusResult = runGit(["status", "--porcelain"]);
  const statusPaths = new Map<string, string>();
  for (const line of (statusResult.stdout || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const status = line.slice(0, 2).trim() || "M";
    const rawPath = line.slice(3).replace(/^"|"$/g, "");
    const finalPath = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop() || rawPath : rawPath;
    if (finalPath) statusPaths.set(finalPath.replace(/\\/g, "/"), status);
  }

  const candidatePaths = new Set<string>(eventPaths.size > 0 ? [...eventPaths] : [...statusPaths.keys()]);
  for (const path of eventPaths) candidatePaths.add(path);

  const files = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const filePath of [...candidatePaths].sort((a, b) => a.localeCompare(b))) {
    const absolutePath = resolve(workspaceRoot, filePath);
    const relativePath = relative(workspaceRoot, absolutePath);
    if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) continue;

    const status = statusPaths.get(filePath) || "modified";
    const numstatResult = runGit(["diff", "--numstat", "HEAD", "--", filePath]);
    let additions = 0;
    let deletions = 0;
    const numstatLine = (numstatResult.stdout || "").split(/\r?\n/).find(Boolean);
    if (numstatLine) {
      const [added, deleted] = numstatLine.split(/\s+/);
      if (/^\d+$/.test(added)) additions = Number(added);
      if (/^\d+$/.test(deleted)) deletions = Number(deleted);
    }

    let diff = runGit(["diff", "--", filePath]).stdout || "";
    if (!diff.trim()) {
      diff = runGit(["diff", "--cached", "--", filePath]).stdout || "";
    }

    if (!diff.trim() && existsSync(absolutePath)) {
      try {
        const buffer = await fs.readFile(absolutePath);
        if (!buffer.includes(0)) {
          const text = buffer.toString("utf8");
          const lines = text.length ? text.split(/\r?\n/) : [];
          additions = additions || lines.length;
          diff = [
            `diff --git a/${filePath} b/${filePath}`,
            "new file or thread-local change",
            `--- /dev/null`,
            `+++ b/${filePath}`,
            `@@ -0,0 +1,${lines.length} @@`,
            ...lines.slice(0, 400).map((line) => `+${line}`),
            lines.length > 400 ? `+... ${lines.length - 400} more lines` : ""
          ].filter(Boolean).join("\n");
        }
      } catch {
        // The file may have been deleted or moved after the event was recorded.
      }
    }

    const diffLines = diff.split(/\r?\n/);
    if (!additions && !deletions) {
      additions = diffLines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
      deletions = diffLines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
    }
    totalAdditions += additions;
    totalDeletions += deletions;

    files.push({
      filePath,
      status,
      additions,
      deletions,
      diff,
      source: eventPaths.has(filePath) ? "thread" : "git"
    });
  }

  return {
    workspaceId: workspace.id,
    threadId: thread?.id ?? "",
    files,
    additions: totalAdditions,
    deletions: totalDeletions
  };
}

async function getWorkspaceBranches(workspaceId: string) {
  const catalog = await readWorkspaceCatalog();
  const workspace = catalog.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) throw new Error("Project not found.");
  const branches = spawnSync("git", ["branch", "--format=%(refname:short)"], { cwd: workspace.path, encoding: "utf8", windowsHide: true });
  const current = spawnSync("git", ["branch", "--show-current"], { cwd: workspace.path, encoding: "utf8", windowsHide: true });
  const status = spawnSync("git", ["status", "--porcelain"], { cwd: workspace.path, encoding: "utf8", windowsHide: true });
  if (branches.status !== 0) throw new Error((branches.stderr || branches.stdout || "无法读取 Git 分支").trim());
  return {
    current: current.stdout?.trim() || "",
    branches: (branches.stdout || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    changedFiles: (status.stdout || "").split(/\r?\n/).filter(Boolean).length
  };
}

async function switchWorkspaceBranch(input: { workspaceId: string; branch: string; create?: boolean }) {
  const catalog = await readWorkspaceCatalog();
  const workspace = catalog.workspaces.find((item) => item.id === input.workspaceId);
  if (!workspace) throw new Error("Project not found.");
  const branch = input.branch.trim();
  if (!branch || !/^[A-Za-z0-9._\/-]+$/.test(branch)) throw new Error("分支名称无效");
  const args = input.create ? ["switch", "-c", branch] : ["switch", branch];
  const result = spawnSync("git", args, { cwd: workspace.path, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "切换分支失败").trim());
  return getWorkspaceBranches(input.workspaceId);
}

async function selectWorkspaceFolder() {
  const options = {
    title: "Select Project Root",
    defaultPath: dirname(workspacePath),
    properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">
  };
  const result = mainWindowRef
    ? await dialog.showOpenDialog(mainWindowRef, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0] ?? null;
}

async function selectComposerImages() {
  const options = {
    title: "选择文件或图片",
    properties: ["openFile", "multiSelections"] as Array<"openFile" | "multiSelections">,
    filters: [{ name: "所有文件", extensions: ["*"] }]
  };
  const result = mainWindowRef
    ? await dialog.showOpenDialog(mainWindowRef, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled) return [];
  return Promise.all(result.filePaths.slice(0, 8).map((path) => storeComposerAttachment(path, basename(path))));
}

async function importComposerAttachments(paths: string[]) {
  const uniquePaths = [...new Set(paths.map((path) => path.trim()).filter(Boolean))].slice(0, 8);
  return Promise.all(uniquePaths.map((path) => storeComposerAttachment(path, basename(path))));
}

async function storeComposerAttachment(sourcePath: string, originalName: string) {
  const attachmentDirectory = join(workspaceStateRoot, "attachments");
  await ensureDirectory(attachmentDirectory);
  const safeExtension = extname(originalName).replace(/[^a-z0-9.]/gi, "");
  const filePath = join(attachmentDirectory, `${Date.now()}-${randomUUID()}${safeExtension}`);
  await fs.copyFile(sourcePath, filePath);
  return { name: originalName || basename(sourcePath), path: filePath, url: await makeComposerPreviewUrl(filePath) };
}

function makeComposerAttachmentUrl(filePath: string) {
  return `newbrain-attachment:///${encodeURIComponent(basename(filePath))}`;
}

function getImageMimeType(filePath: string) {
  switch (extname(filePath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".bmp":
      return "image/bmp";
    case ".svg":
      return "image/svg+xml";
    default:
      return "";
  }
}

async function makeComposerPreviewUrl(filePath: string, mimeType = "") {
  const imageMimeType = mimeType.startsWith("image/") ? mimeType : getImageMimeType(filePath);
  if (!imageMimeType) {
    return makeComposerAttachmentUrl(filePath);
  }
  const bytes = await fs.readFile(filePath);
  return `data:${imageMimeType};base64,${bytes.toString("base64")}`;
}

async function createWorkspaceGitWorktree(input: { workspaceId: string; branchName?: string }) {
  const preferences = await getActiveDesktopPreferences();
  if (!preferences.worktree.defaultIsolated) {
    return { ok: false, detail: "工作树隔离未启用。", path: "" };
  }

  const catalog = await readWorkspaceCatalog();
  const workspace = catalog.workspaces.find((item) => item.id === input.workspaceId);
  if (!workspace) {
    throw new Error("Workspace was not found.");
  }

  await ensureDirectory(preferences.worktree.rootDir);
  const branchName =
    input.branchName?.trim() ||
    `${preferences.git.branchPrefix}${workspace.name.replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase()}-${Date.now()}`;
  const worktreePath = join(preferences.worktree.rootDir, branchName.replace(/[\\/]/g, "-"));
  const result = spawnSync("git", ["worktree", "add", "-b", branchName, worktreePath], {
    cwd: workspace.path,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    return {
      ok: false,
      detail: (result.stderr || result.stdout || "git worktree add failed").trim(),
      path: worktreePath
    };
  }

  const bindings = await readWorktreeBindings();
  await writeWorktreeBindings([
    ...bindings.bindings.filter((item) => item.path !== worktreePath),
    {
      workspaceId: workspace.id,
      threadId: activeThreadId || undefined,
      branchName,
      path: worktreePath,
      createdAt: nowIso()
    }
  ]);
  await saveActiveThreadState(`已创建 Git 工作树: ${worktreePath}`);
  return { ok: true, detail: `已创建 ${branchName}`, path: worktreePath };
}

async function cleanupThreadWorktrees(workspaceId: string, threadId: string) {
  const preferences = await getActiveDesktopPreferences();
  if (preferences.worktree.keepArchived) {
    return;
  }
  const bindingFile = await readWorktreeBindings();
  const toRemove = bindingFile.bindings.filter((item) => item.workspaceId === workspaceId && item.threadId === threadId);
  for (const binding of toRemove) {
    const result = spawnSync("git", ["worktree", "remove", "--force", binding.path], {
      cwd: workspacePath,
      encoding: "utf8"
    });
    if (result.status !== 0) {
      await appendDesktopDebugLog(`git worktree remove failed ${binding.path}: ${result.stderr || result.stdout}`);
    }
  }
  await writeWorktreeBindings(
    bindingFile.bindings.filter((item) => !(item.workspaceId === workspaceId && item.threadId === threadId))
  );
}

async function runPreferenceHookScript(label: string, script: string) {
  const trimmed = script.trim();
  if (!trimmed) {
    return;
  }
  const result = spawnSync(process.platform === "win32" ? "powershell.exe" : "/bin/bash", process.platform === "win32" ? ["-NoLogo", "-NoProfile", "-Command", trimmed] : ["-lc", trimmed], {
    cwd: runtime.workspacePath,
    env: activeShellEnv,
    encoding: "utf8"
  });
  await saveActiveThreadState(`钩子脚本 ${label}: ${result.status === 0 ? "完成" : "失败"}`);
  await appendDiagnosticsLog(`hook ${label} status=${result.status} ${result.stdout || result.stderr || ""}`);
}

function extractAssistantShellCommands(content: string) {
  // Only explicitly tagged shell blocks may launch commands. Requiring a tag
  // prevents a closing Python fence followed by prose from being parsed as shell.
  const fencePattern = /^[ \t]*```(?:bash|sh|shell|cmd|powershell|ps1)[ \t]*\r?\n([\s\S]*?)^[ \t]*```[ \t]*$/gim;
  const commands: string[] = [];
  const allowedCommand =
    /^(?:python|py|python3|pip|pip3|pyinstaller|node|npm|pnpm|yarn|npx|bun|deno|mvn|mvnw|\.\/mvnw|\.\\mvnw|gradle|gradlew|\.\/gradlew|\.\\gradlew|git|cargo|go|dotnet|java|javac|tsc|vite)\b/i;
  const destructiveCommand =
    /(?:\brm\s+-rf\b|\brmdir\s+\/s\b|\bdel\s+\/[sq]\b|\bformat\b|\bdiskpart\b|\bshutdown\b|Remove-Item\b[^\r\n]*-Recurse|git\s+(?:reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--))/i;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(content)) !== null) {
    const lines = match[1]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("//"));
    for (const line of lines) {
      const normalized = line.replace(/^(?:PS>\s*|\$\s*|>\s*)/, "").trim();
      if (allowedCommand.test(normalized) && !destructiveCommand.test(normalized)) {
        commands.push(normalized);
      }
    }
  }
  return [...new Set(commands)];
}

function extractPythonCodeBlock(content: string) {
  const fencePattern = /```(?:python|py)\s*\r?\n([\s\S]*?)```/i;
  const match = fencePattern.exec(content);
  return match?.[1]?.trimEnd() ?? "";
}

function extractAssistantFileBlocks(content: string) {
  const fencePattern = /^[ \t]*```([^\r\n`]*)\r?\n([\s\S]*?)^[ \t]*```[ \t]*$/gim;
  const files = new Map<string, string>();
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(content)) !== null) {
    const header = match[1].trim();
    const explicitPath =
      /(?:^|\s)(?:path|file|filename)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s]+))/i.exec(header);
    const trailingPath = /\s([^\s"'`]+\.[a-z0-9]+)\s*$/i.exec(header);
    const targetPath =
      explicitPath?.[1] ??
      explicitPath?.[2] ??
      explicitPath?.[3] ??
      trailingPath?.[1] ??
      "";
    if (!targetPath || /^(?:bash|sh|shell|cmd|powershell|ps1)$/i.test(header)) continue;
    files.set(targetPath, match[2].trimEnd());
  }
  const inlineFileFence = /^[ \t]*```[a-z0-9_-]+\s+(?:path|file|filename)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s]+))\s+(.+?)\s*```?[ \t]*$/gim;
  while ((match = inlineFileFence.exec(content)) !== null) {
    const targetPath = match[1] ?? match[2] ?? match[3] ?? "";
    const fileContent = match[4] ?? "";
    if (targetPath && fileContent) files.set(targetPath, fileContent);
  }
  return files;
}

function extractPythonTargetPath(command: string) {
  const tokenPattern = /"([^"]+\.py)"|'([^']+\.py)'|([^\s"'`]+\.py)/i;
  const match = tokenPattern.exec(command);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function extractRequestedFilePath(content: string) {
  const explicit =
    /(?:输出|生成|创建|新建|写入|保存|落盘|produce|create|write|save)[\s\S]{0,80}(?:"([^"]+\.[a-z0-9]{1,12})"|'([^']+\.[a-z0-9]{1,12})'|([^\s"'`，。；、]+?\.[a-z0-9]{1,12}))/i.exec(content) ??
    /(?:"([^"]+\.[a-z0-9]{1,12})"|'([^']+\.[a-z0-9]{1,12})'|([^\s"'`，。；、]+?\.[a-z0-9]{1,12}))/i.exec(content);
  return explicit?.[1] ?? explicit?.[2] ?? explicit?.[3] ?? "";
}

function requestsWorkspaceFile(content: string) {
  return /(?:输出|生成|创建|新建|写入|保存|落盘|produce|create|write|save)[\s\S]{0,48}(?:\.[a-z0-9]{1,12}\b|文件|file)/i.test(content);
}

function requestsTextFile(content: string) {
  return /(?:输出|生成|创建|新建|写入|保存|落盘|produce|create|write|save)[\s\S]{0,80}(?:\.txt\b|txt\s*文件|文本文件|小说)/i.test(content);
}

function requestsPythonFile(content: string) {
  return /(?:输出|生成|创建|新建|写入|保存|落盘|produce|create|write|save)[\s\S]{0,32}(?:\.py\b|py\s*文件|python\s*文件)/i.test(content);
}

function inferPythonTargetPath(request: string, response: string) {
  const explicitPath = extractPythonTargetPath(request) || extractPythonTargetPath(response);
  return explicitPath || "generated_script.py";
}

function inferWorkspaceTargetPath(request: string, response: string) {
  const explicitPath = extractRequestedFilePath(request) || extractRequestedFilePath(response);
  if (explicitPath) return explicitPath;
  if (requestsTextFile(request)) return "output.txt";
  return "generated_output.txt";
}

function countChangedLines(previous: string, next: string) {
  const before = previous.replace(/\r\n/g, "\n").split("\n");
  const after = next.replace(/\r\n/g, "\n").split("\n");
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    additions: Math.max(0, after.length - prefix - suffix),
    deletions: Math.max(0, before.length - prefix - suffix)
  };
}

interface WorkspaceFileSnapshotEntry {
  content: string;
  mtimeMs: number;
  size: number;
}

type WorkspaceFileSnapshot = Map<string, WorkspaceFileSnapshotEntry>;

function isIgnoredWorkspaceSnapshotPath(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/");
  return (
    normalized === ".git" ||
    normalized.startsWith(".git/") ||
    normalized === "node_modules" ||
    normalized.startsWith("node_modules/") ||
    normalized === "out" ||
    normalized.startsWith("out/") ||
    normalized === "dist" ||
    normalized.startsWith("dist/") ||
    normalized === ".desktop-profile" ||
    normalized.startsWith(".desktop-profile/") ||
    normalized === ".desktop-profile-debug" ||
    normalized.startsWith(".desktop-profile-debug/")
  );
}

async function readWorkspaceFileSnapshot(rootPath: string): Promise<WorkspaceFileSnapshot> {
  const snapshot: WorkspaceFileSnapshot = new Map();
  const workspaceRoot = resolve(rootPath);
  const walk = async (directory: string) => {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const relativePath = relative(workspaceRoot, absolutePath).replace(/\\/g, "/");
      if (!relativePath || isIgnoredWorkspaceSnapshotPath(relativePath)) continue;
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = await fs.stat(absolutePath);
        if (stat.size > 1024 * 1024) continue;
        const content = await fs.readFile(absolutePath, "utf8");
        snapshot.set(relativePath, { content, mtimeMs: stat.mtimeMs, size: stat.size });
      } catch {
        // Binary or concurrently removed files are skipped instead of breaking command reporting.
      }
    }
  };
  await walk(workspaceRoot);
  return snapshot;
}

async function collectWorkspaceFileChangesSinceSnapshot(
  rootPath: string,
  beforeSnapshot: WorkspaceFileSnapshot
) {
  const afterSnapshot = await readWorkspaceFileSnapshot(rootPath);
  const paths = new Set<string>([...beforeSnapshot.keys(), ...afterSnapshot.keys()]);
  const changes: Array<{ path: string; additions: number; deletions: number }> = [];
  for (const filePath of [...paths].sort((left, right) => left.localeCompare(right))) {
    const before = beforeSnapshot.get(filePath);
    const after = afterSnapshot.get(filePath);
    if (before && after && before.mtimeMs === after.mtimeMs && before.size === after.size) continue;
    const previousContent = before?.content ?? "";
    const nextContent = after?.content ?? "";
    if (previousContent === nextContent) continue;
    const changedLines = countChangedLines(previousContent, nextContent);
    changes.push({ path: filePath, ...changedLines });
  }
  return changes;
}

async function materializeAssistantFile(targetPath: string, fileContent: string, workspacePath = runtime.workspacePath) {
  if (!targetPath) {
    return null;
  }

  const resolvedTargetPath = resolve(workspacePath, targetPath);
  const workspaceRoot = resolve(workspacePath);
  if (resolvedTargetPath !== workspaceRoot && !resolvedTargetPath.startsWith(`${workspaceRoot}${sep}`)) {
    throw new Error(`Assistant output path must stay inside the active workspace: ${targetPath}`);
  }
  const workspaceRealPath = await fs.realpath(workspaceRoot);
  let existingAncestor = existsSync(resolvedTargetPath) ? resolvedTargetPath : dirname(resolvedTargetPath);
  while (!existsSync(existingAncestor)) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) break;
    existingAncestor = parent;
  }
  const ancestorRealPath = await fs.realpath(existingAncestor);
  if (ancestorRealPath !== workspaceRealPath && !ancestorRealPath.startsWith(`${workspaceRealPath}${sep}`)) {
    throw new Error(`Assistant output path resolves outside the active workspace: ${targetPath}`);
  }
  if (existsSync(resolvedTargetPath)) {
    const targetRealPath = await fs.realpath(resolvedTargetPath);
    if (targetRealPath !== workspaceRealPath && !targetRealPath.startsWith(`${workspaceRealPath}${sep}`)) {
      throw new Error(`Assistant output file resolves outside the active workspace: ${targetPath}`);
    }
  }

  if (!fileContent.trim()) {
    return null;
  }

  const nextContent = `${fileContent.trimEnd()}\n`;
  const previouslyExisted = existsSync(resolvedTargetPath);
  const previousContent = previouslyExisted ? await fs.readFile(resolvedTargetPath, "utf8") : "";
  if (previousContent === nextContent) {
    return { path: targetPath, additions: 0, deletions: 0, changed: false };
  }
  const changedLines = countChangedLines(previousContent, nextContent);
  await ensureDirectory(dirname(resolvedTargetPath));
  await fs.writeFile(resolvedTargetPath, nextContent, "utf8");
  return { path: targetPath, ...changedLines, changed: true };
}

async function appendActiveAssistantActivities(
  activities: Array<{ type: "patch" | "run"; title: string; detail: string }>,
  target?: AssistantExecutionTarget
) {
  if (!activities.length) return;
  if (!target) {
    throw new Error("appendActiveAssistantActivities requires an explicit AssistantExecutionTarget (TurnScope-bound).");
  }
  const workspace = target.workspace;
  const thread = target.thread;
  const state = await readThreadState(workspace, thread);
  const events = activities.map((activity) => createTimelineEvent(activity.type, activity.title, activity.detail)).reverse();
  state.timeline = [...events, ...(state.timeline ?? [])].slice(0, 80);
  await writeThreadState(workspace, thread, state);
  target.runtime.setThreadState(state);
}

function publishAssistantActivity(activity: { type: "patch" | "run" | "complete"; title: string; detail: string }, requestId = "") {
  mainWindowRef?.webContents.send("phase1:assistant-activity", requestId ? { ...activity, requestId } : activity);
}

interface AssistantExecutionTarget {
  runtime: Awaited<ReturnType<typeof createLocalRuntime>>;
  workspace: WorkspaceCatalogItem;
  thread: WorkspaceThreadRecord;
}

interface AssistantExecutionReport {
  handled: boolean;
  awaitingApproval: boolean;
  verifiedFiles: string[];
  editedFiles: string[];
  failedFiles: Array<{ path: string; reason: string }>;
  executedCommands: number;
  failedCommands: number;
  commandResults: Array<{ command: string; status: string; exitCode?: number; output: string }>;
}

function buildExecutionRepairPrompt(userRequest: string, assistantContent: string, report: AssistantExecutionReport, attempt: number) {
  const failedCommands = report.commandResults.filter((result) => result.status === "failed");
  const commandDetails = failedCommands.map((result, index) => [
    `Failed command ${index + 1}: ${result.command}`,
    `Exit code: ${result.exitCode ?? "unknown"}`,
    "Output:",
    "```text",
    result.output || "(no output)",
    "```"
  ].join("\n")).join("\n\n");
  const failedFiles = report.failedFiles.map((item) => `- ${item.path}: ${item.reason}`).join("\n");
  return [
    "The previous tool execution failed. Do not continue as if it succeeded.",
    "Analyze the error output, correct the plan, and return a revised answer with only the files and shell commands that should be executed next.",
    "If the failure means the user's requested result can still be completed another way, use that way.",
    "If execution cannot proceed, explain the blocker clearly and do not emit more shell commands.",
    `Repair attempt: ${attempt}`,
    "",
    "Original user request:",
    userRequest,
    "",
    "Previous assistant answer:",
    assistantContent,
    "",
    commandDetails ? `Command failures:\n${commandDetails}` : "",
    failedFiles ? `File failures:\n${failedFiles}` : ""
  ].filter(Boolean).join("\n");
}

async function runAssistantCommandsIfPresent(
  content: string,
  userRequest = "",
  permissionMode: "full" | "approval" | "agent" = "approval",
  requestId = "",
  target?: AssistantExecutionTarget
): Promise<AssistantExecutionReport> {
  // 显式执行目标：所有文件写入、命令执行、事件/状态持久化都绑定该任务自己的 runtime 与线程，
  // 禁止回退到全局 activeThreadId（后台任务会串写到用户当前正在查看的其他线程）。
  if (!target) {
    throw new Error("runAssistantCommandsIfPresent requires an explicit AssistantExecutionTarget (TurnScope-bound).");
  }
  const targetRuntime = target.runtime;
  const saveThreadState = (eventSummary?: string, options: { touchUpdatedAt?: boolean } = {}) =>
    saveRuntimeThreadState(target.runtime, target.workspace, target.thread, eventSummary, options);
  const appendTargetThreadEvents = async (events: ThreadEventRecord[]) => {
    if (!events.length) return;
    await appendThreadEvents(target.workspace, target.thread, events);
  };
  const publishActivity = (activity: { type: "patch" | "run" | "complete"; title: string; detail: string }) =>
    publishAssistantActivity(activity, requestId);
  const commands = extractAssistantShellCommands(content);
  const pythonCode = extractPythonCodeBlock(content);
  const fileArtifacts = extractAssistantFileBlocks(content);
  for (const command of commands) {
    const pythonTarget = extractPythonTargetPath(command);
    if (pythonTarget && pythonCode && !fileArtifacts.has(pythonTarget)) {
      fileArtifacts.set(pythonTarget, pythonCode);
    }
  }
  if (pythonCode && requestsPythonFile(userRequest)) {
    const pythonTarget = inferPythonTargetPath(userRequest, content);
    if (!fileArtifacts.has(pythonTarget)) fileArtifacts.set(pythonTarget, pythonCode);
  }
  const requestedWorkspaceFile = requestsWorkspaceFile(userRequest);
  const missingRequestedFilePath = requestedWorkspaceFile && !fileArtifacts.size
    ? inferWorkspaceTargetPath(userRequest, content)
    : "";
  if (!commands.length && !fileArtifacts.size) {
    if (missingRequestedFilePath) {
      const reason = "模型回复没有提供带 path=... 的完整文件代码块，未写入任何文件。";
      const activity = { type: "patch" as const, title: "文件输出失败", detail: `${missingRequestedFilePath}\n${reason}` };
      const event = createThreadEvent("error", { path: missingRequestedFilePath, message: reason, status: "failed" });
      publishActivity(activity);
      await saveThreadState(reason);
      await appendActiveAssistantActivities([activity], target);
      await appendTargetThreadEvents([event]);
      publishActivity({ type: "complete", title: "处理失败", detail: reason });
      return {
        handled: true,
        awaitingApproval: false,
        verifiedFiles: [],
        editedFiles: [],
        failedFiles: [{ path: missingRequestedFilePath, reason }],
        executedCommands: 0,
        failedCommands: 0,
        commandResults: []
      } satisfies AssistantExecutionReport;
    }
    return { handled: false, awaitingApproval: false, verifiedFiles: [], editedFiles: [], failedFiles: [], executedCommands: 0, failedCommands: 0, commandResults: [] } satisfies AssistantExecutionReport;
  }

  const activities: Array<{ type: "patch" | "run"; title: string; detail: string }> = [];
  const executionEvents: ThreadEventRecord[] = [];
  const editedPaths = new Set<string>();
  const verifiedPaths = new Set<string>();
  let executedCommandCount = 0;
  let failedCommandCount = 0;
  const commandResults: AssistantExecutionReport["commandResults"] = [];
  for (const [targetPath, fileContent] of fileArtifacts) {
    const materialized = await materializeAssistantFile(targetPath, fileContent, targetRuntime.workspacePath);
    if (materialized) verifiedPaths.add(materialized.path);
    if (materialized?.changed && !editedPaths.has(materialized.path)) {
      editedPaths.add(materialized.path);
      const activity = {
        type: "patch" as const,
        title: `已编辑 ${materialized.path}`,
        detail: `+${materialized.additions} -${materialized.deletions}`
      };
      activities.push(activity);
      executionEvents.push(createThreadEvent("file_change", {
        path: materialized.path,
        additions: materialized.additions,
        deletions: materialized.deletions,
        status: "completed"
      }));
      publishActivity(activity);
      await appendDesktopDebugLog(
        `assistant python file materialized: ${materialized.path} +${materialized.additions} -${materialized.deletions}`
      );
    }
  }

  for (const command of commands) {
    const runningActivity = { type: "run" as const, title: "正在执行命令", detail: command };
    publishActivity(runningActivity);
    await appendDesktopDebugLog(`assistant command detected: ${command}`);
    const preferences = await getActiveDesktopPreferences();
    const effectivePermissionMode =
      permissionMode === "full" || !preferences.configuration.requireApprovalForShell ? "full" : permissionMode;
    const beforeCommandSnapshot = await readWorkspaceFileSnapshot(targetRuntime.workspacePath);
    let nextSnapshot = await targetRuntime.queueShellCommand(command, { permissionMode: effectivePermissionMode });
    if (nextSnapshot.approval) {
      if (permissionMode !== "full" && preferences.configuration.requireApprovalForShell) {
        const approvalActivity = { type: "run" as const, title: "等待批准", detail: command };
        activities.push(approvalActivity);
        executionEvents.push(createThreadEvent("approval", { command, status: "awaiting-approval" }));
        publishActivity(approvalActivity);
        await saveThreadState("命令等待用户批准");
        await appendActiveAssistantActivities(activities, target);
        await appendTargetThreadEvents(executionEvents);
        return {
          handled: true,
          awaitingApproval: true,
          verifiedFiles: [...verifiedPaths],
          editedFiles: [...editedPaths],
          failedFiles: [],
          executedCommands: executedCommandCount,
          failedCommands: failedCommandCount,
          commandResults
        } satisfies AssistantExecutionReport;
      }
      nextSnapshot = await targetRuntime.respondToApproval(true);
    }
    const latestRun = nextSnapshot.runs?.[0];
    const completedActivity = {
      type: "run" as const,
      title: latestRun?.status === "failed" ? "命令执行失败" : "已执行命令",
      detail: latestRun?.output ? `${command}\n${latestRun.output}` : command
    };
    activities.push(completedActivity);
    executedCommandCount += 1;
    if (latestRun?.status === "failed") failedCommandCount += 1;
    commandResults.push({
      command,
      status: latestRun?.status ?? "completed",
      exitCode: latestRun?.exitCode,
      output: latestRun?.output ?? ""
    });
    executionEvents.push(createThreadEvent("run_status", {
      command,
      status: latestRun?.status ?? "completed",
      exitCode: latestRun?.exitCode,
      output: latestRun?.output ?? ""
    }));
    publishActivity(completedActivity);
    if (latestRun?.status !== "failed") {
      const commandFileChanges = await collectWorkspaceFileChangesSinceSnapshot(targetRuntime.workspacePath, beforeCommandSnapshot);
      for (const fileChange of commandFileChanges) {
        if (editedPaths.has(fileChange.path)) continue;
        editedPaths.add(fileChange.path);
        verifiedPaths.add(fileChange.path);
        const activity = {
          type: "patch" as const,
          title: `已编辑 ${fileChange.path}`,
          detail: `+${fileChange.additions} -${fileChange.deletions}`
        };
        activities.push(activity);
        executionEvents.push(createThreadEvent("file_change", {
          path: fileChange.path,
          additions: fileChange.additions,
          deletions: fileChange.deletions,
          status: "completed"
        }));
        publishActivity(activity);
      }
    }
  }

  await saveThreadState(undefined, { touchUpdatedAt: false });
  await appendActiveAssistantActivities(activities, target);
  await appendTargetThreadEvents(executionEvents);
  await saveThreadState(
    `编辑了 ${editedPaths.size} 个文件，执行了 ${executedCommandCount} 条命令${failedCommandCount ? `，失败 ${failedCommandCount} 条` : ""}`
  );
  publishActivity({
    type: "complete",
    title: failedCommandCount ? "处理完成但有失败" : "处理完成",
    detail: `编辑了 ${editedPaths.size} 个文件，执行了 ${executedCommandCount} 条命令${failedCommandCount ? `，失败 ${failedCommandCount} 条` : ""}`
  });
  return {
    handled: true,
    awaitingApproval: false,
    verifiedFiles: [...verifiedPaths],
    editedFiles: [...editedPaths],
    failedFiles: [],
    executedCommands: executedCommandCount,
    failedCommands: failedCommandCount,
    commandResults
  } satisfies AssistantExecutionReport;
}

async function renameWorkspaceThread(input: {
  workspaceId: string;
  threadId: string;
  title: string;
  summary: string;
}) {
  const nextCatalog = await updateThreadMetadata({
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    title: input.title.trim(),
    summary: input.summary.trim(),
    lastEventSummary: "线程信息已更新"
  });
  await ensureCatalogState(nextCatalog);
  return nextCatalog;
}

async function deleteWorkspaceThread(input: {
  workspaceId: string;
  threadId: string;
}) {
  const catalog = await readWorkspaceCatalog();

  const nextWorkspaces = catalog.workspaces.map((workspace) => {
    if (workspace.id !== input.workspaceId) {
      return workspace;
    }

    if (workspace.threads.length <= 1) {
      throw new Error("At least one thread must remain in a workspace.");
    }

    return {
      ...workspace,
      threads: workspace.threads.filter((thread) => thread.id !== input.threadId)
    };
  });

  await cleanupThreadWorktrees(input.workspaceId, input.threadId);
  codexStorage.deleteThread(input.threadId);
  await safeUnlink(getThreadStatePath(input.workspaceId, input.threadId));
  await safeUnlink(getThreadEventLogPath(input.workspaceId, input.threadId));
  const nextCatalog = await writeWorkspaceCatalog(nextWorkspaces);
  return nextCatalog;
}

function describeSnapshotEvent() {
  const snapshot = runtime.getSnapshot();

  if (snapshot.patch?.summary) {
    return `补丁更新: ${snapshot.patch.summary}`;
  }

  if (snapshot.approval?.message) {
    return `审批请求: ${snapshot.approval.message}`;
  }

  if (snapshot.runs.length > 0) {
    const latestRun = snapshot.runs[0];
    return `运行记录: ${latestRun.label}`;
  }

  return "线程内容已更新";
}

function deriveThreadStatusMetadata() {
  const snapshot = runtime.getSnapshot();
  const latestRun = snapshot.runs[0];

  if (snapshot.approval) {
    return {
      status: "awaiting-approval" as const,
      statusLabel: "等待批准"
    };
  }

  if (snapshot.session.status === "running" || latestRun?.status === "running" || latestRun?.status === "queued") {
    return {
      status: "running" as const,
      statusLabel: "运行中"
    };
  }

  if (snapshot.session.status === "failed" || latestRun?.status === "failed") {
    return {
      status: "failed" as const,
      statusLabel: "执行失败"
    };
  }

  return {
    status: "idle" as const,
    statusLabel: ""
  };
}

function readWorkspaceBranch(workspacePath: string, fallback = "") {
  const result = spawnSync("git", ["branch", "--show-current"], {
    cwd: workspacePath,
    encoding: "utf8",
    windowsHide: true
  });
  const branch = result.status === 0 ? result.stdout.trim() : "";
  return branch || fallback;
}

function mergeThreadStateForPersistence(exportedState: ThreadStateFile, persistedState: ThreadStateFile): ThreadStateFile {
  const mergeById = <T extends { id?: string }>(persisted: T[] = [], exported: T[] = []) => {
    const merged = [...persisted];
    const seen = new Set(merged.map((item) => item.id).filter(Boolean));
    for (const item of exported) {
      if (item.id && seen.has(item.id)) {
        const index = merged.findIndex((current) => current.id === item.id);
        merged[index] = { ...merged[index], ...item };
        continue;
      }
      merged.push(item);
      if (item.id) seen.add(item.id);
    }
    return merged;
  };

  const exportedMessages = Array.isArray(exportedState.messages) ? exportedState.messages : [];
  const persistedMessages = Array.isArray(persistedState.messages) ? persistedState.messages : [];
  const exportedLooksTruncated =
    persistedMessages.length > 1 &&
    exportedMessages.length < persistedMessages.length &&
    !exportedMessages.some((message) => message.role === "user" || message.role === "assistant");

  return {
    ...exportedState,
    version: 2,
    messages: exportedLooksTruncated
      ? persistedMessages
      : mergeById(persistedMessages, exportedMessages),
    memories: mergeById(persistedState.memories ?? [], exportedState.memories ?? []),
    runs: mergeById(persistedState.runs ?? [], exportedState.runs ?? []),
    timeline: mergeById(persistedState.timeline ?? [], exportedState.timeline ?? []),
    events: persistedState.events ?? [],
    context: persistedState.context ?? exportedState.context
  };
}

async function saveActiveThreadState(eventSummary?: string, options: { touchUpdatedAt?: boolean } = {}) {
  // UI-focus write only: freeze ids at entry. Background model tasks must use saveRuntimeThreadState + TurnScope.
  const workspaceId = activeWorkspaceId;
  const threadId = activeThreadId;
  const targetRuntime = runtime;
  if (!workspaceId || !threadId || !targetRuntime) {
    return;
  }

  const catalog = await readWorkspaceCatalog();
  const workspace = catalog.workspaces.find((item) => item.id === workspaceId);
  const thread = workspace?.threads.find((item) => item.id === threadId);

  if (!workspace || !thread) {
    return;
  }

  const exportedState = targetRuntime.exportThreadState() as ThreadStateFile;
  const persistedState = await readThreadState(workspace, thread);
  const snapshotState = mergeThreadStateForPersistence(exportedState, persistedState);
  await writeThreadState(workspace, thread, snapshotState);
  await updateThreadMetadata({
    workspaceId: workspace.id,
    threadId: thread.id,
    summary: snapshotState.memories?.[0]?.summary || thread.summary,
    lastEventSummary: eventSummary ?? describeSnapshotEvent(),
    branch: readWorkspaceBranch(workspace.path, thread.branch),
    touchUpdatedAt: options.touchUpdatedAt,
    ...deriveThreadStatusMetadata()
  });

  if (eventSummary) {
    await appendTimelineEvent(
      workspace,
      thread,
      createTimelineEvent("thread", eventSummary, describeSnapshotEvent())
    );
  }
  if (workspace.id === activeWorkspaceId && thread.id === activeThreadId) {
    mainWindowRef?.webContents.send("phase1:snapshot-update", targetRuntime.getSnapshot());
  }
}

async function saveRuntimeThreadState(
  targetRuntime: Awaited<ReturnType<typeof createLocalRuntime>>,
  workspace: WorkspaceCatalogItem,
  thread: WorkspaceThreadRecord,
  eventSummary?: string,
  options: { touchUpdatedAt?: boolean } = {}
) {
  const exportedState = targetRuntime.exportThreadState() as ThreadStateFile;
  const persistedState = await readThreadState(workspace, thread);
  const snapshotState = mergeThreadStateForPersistence(exportedState, persistedState);
  const snapshot = targetRuntime.getSnapshot();
  const latestRun = snapshot.runs[0];
  const statusMetadata = snapshot.approval
    ? { status: "awaiting-approval" as const, statusLabel: "等待批准" }
    : snapshot.session.status === "running" || latestRun?.status === "running" || latestRun?.status === "queued"
    ? { status: "running" as const, statusLabel: "运行中" }
    : snapshot.session.status === "failed" || latestRun?.status === "failed"
    ? { status: "failed" as const, statusLabel: "执行失败" }
    : { status: "idle" as const, statusLabel: "" };
  await writeThreadState(workspace, thread, snapshotState);
  await updateThreadMetadata({
    workspaceId: workspace.id,
    threadId: thread.id,
    summary: snapshotState.memories?.[0]?.summary || thread.summary,
    lastEventSummary: eventSummary ?? (latestRun ? `运行记录: ${latestRun.label}` : "线程内容已更新"),
    branch: readWorkspaceBranch(workspace.path, thread.branch),
    touchUpdatedAt: options.touchUpdatedAt,
    ...statusMetadata
  });

  if (workspace.id === activeWorkspaceId && thread.id === activeThreadId) {
    mainWindowRef?.webContents.send("phase1:snapshot-update", buildSnapshotWithTimeline(snapshot, snapshotState));
  }
}

async function refreshRuntimeWorkspaceTree(targetRuntime: Awaited<ReturnType<typeof createLocalRuntime>>) {
  const scan = await targetRuntime.invokeTool("workspace.scan", {}, { permissionMode: "full" });
  if (scan.ok && Array.isArray(scan.workspace)) {
    targetRuntime.sessionMachine.snapshot.workspace = scan.workspace;
  }
  return scan;
}

function buildSnapshotWithTimeline(snapshot: ReturnType<typeof runtime.getSnapshot>, threadState: ThreadStateFile) {
  return {
    ...snapshot,
    messages: threadState.messages,
    memories: threadState.memories,
    runs: threadState.runs,
    timeline: threadState.timeline
  };
}

async function searchWorkspaceFiles(keyword: string) {
  const catalog = await readWorkspaceCatalog();
  const results: SearchResultSpec[] = [];
  const skippedDirectories = new Set([".git", "node_modules", ".newbrain", ".desktop-profile", "out", "dist", "build", "target"]);

  for (const workspace of catalog.workspaces) {
    const pending = [workspace.path];
    while (pending.length > 0 && results.length < 40) {
      const directory = pending.shift()!;
      let entries;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const entryPath = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!skippedDirectories.has(entry.name)) pending.push(entryPath);
          continue;
        }
        const relativePath = entryPath.slice(workspace.path.length + 1);
        if (!keyword || entry.name.toLowerCase().includes(keyword) || relativePath.toLowerCase().includes(keyword)) {
          results.push({
            id: `file-${workspace.id}-${relativePath}`,
            kind: "file",
            title: entry.name,
            detail: relativePath,
            workspaceId: workspace.id,
            filePath: entryPath
          });
        }
        if (results.length >= 40) break;
      }
    }
    if (results.length >= 40) break;
  }
  return results;
}

async function readWorkspaceFile(input: { workspaceId: string; filePath: string }) {
  const catalog = await readWorkspaceCatalog();
  const workspace = catalog.workspaces.find((item) => item.id === input.workspaceId);
  if (!workspace) throw new Error("Project not found.");
  const workspaceRoot = resolve(workspace.path);
  const targetPath = isAbsolute(input.filePath) ? resolve(input.filePath) : resolve(workspaceRoot, input.filePath);
  const relativePath = relative(workspaceRoot, targetPath);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("File must stay inside the selected project.");
  }
  const stat = await fs.stat(targetPath);
  if (!stat.isFile()) throw new Error("Selected path is not a file.");
  const maxBytes = 512 * 1024;
  const handle = await fs.open(targetPath, "r");
  try {
    const bytesToRead = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(bytesToRead);
    await handle.read(buffer, 0, bytesToRead, 0);
    const binary = buffer.includes(0);
    const extension = extname(targetPath).slice(1).toLowerCase();
    return {
      path: relativePath,
      name: basename(targetPath),
      language: extension || "text",
      content: binary ? "" : buffer.toString("utf8"),
      binary,
      truncated: stat.size > maxBytes,
      size: stat.size
    };
  } finally {
    await handle.close();
  }
}

async function searchWorkspaceThreads(query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const fileOnly = normalizedQuery.startsWith("file:");
  const keyword = fileOnly ? normalizedQuery.slice(5).trim() : normalizedQuery;
  if (fileOnly) {
    return searchWorkspaceFiles(keyword);
  }
  if (!keyword) {
    return [] as SearchResultSpec[];
  }

  const catalog = await readWorkspaceCatalog();
  const results: SearchResultSpec[] = [];

  for (const workspace of catalog.workspaces) {
    for (const thread of workspace.threads) {
      const titleMatches = thread.title.toLowerCase().includes(keyword);
      const summaryMatches = thread.summary.toLowerCase().includes(keyword);
      let matchingMessage: ChatMessage | null = null;

      if (!titleMatches && !summaryMatches) {
        const threadState = await readThreadState(workspace, thread);
        matchingMessage = (threadState.messages ?? []).find((message) =>
          message.content.toLowerCase().includes(keyword)
        ) ?? null;
      }

      if (
        titleMatches ||
        summaryMatches ||
        matchingMessage
      ) {
        results.push({
          id: `thread-${workspace.id}-${thread.id}`,
          kind: "thread",
          title: thread.title,
          detail: matchingMessage
            ? matchingMessage.content.slice(0, 120)
            : thread.summary || workspace.name,
          workspaceId: workspace.id,
          threadId: thread.id,
          createdAt: matchingMessage?.createdAt ?? thread.updatedAt
        });
      }
    }
  }

  return results
    .sort((left, right) => new Date(right.createdAt ?? 0).getTime() - new Date(left.createdAt ?? 0).getTime())
    .slice(0, 40);
}

function getLocalIpv4Address() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return "127.0.0.1";
}

function mobilePageHtml(token: string) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NewBrain Mobile</title><style>
*{box-sizing:border-box}body{margin:0;background:#fff;color:#17191d;font:15px system-ui,-apple-system,sans-serif}
main{max-width:520px;margin:auto;padding:24px 20px 100px}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:26px}
h1{margin:0;font-size:29px}small{color:#6f7782}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#20b15a;margin-right:6px}
  h2{font-size:14px;margin:28px 0 10px}.row{width:100%;display:flex;align-items:center;gap:10px;min-height:46px;border:0;border-bottom:1px solid #eef0f2;border-radius:0;background:transparent;color:#17191d;padding:0;text-align:left;font-weight:400}
  .row b{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.folder{font-size:20px}.status{color:#168f42}
  footer{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid #e5e7eb;padding:14px 20px}
  footer div{max-width:480px;margin:auto;display:flex;gap:10px}input{flex:1;height:44px;border:1px solid #dfe3e8;border-radius:22px;padding:0 16px}
  footer button{border:0;border-radius:22px;background:#0787f8;color:#fff;padding:0 20px;font-weight:650}
</style></head><body><main><header><div><h1>NewBrain</h1><small><span class="dot"></span>已连接桌面端</small></div><b>•••</b></header>
<section id="content">正在同步项目...</section></main><footer><div><input placeholder="搜索聊天"><button>聊天</button></div></footer>
<script>
const token=${JSON.stringify(token)};
  let state={projects:[],chats:[]};const content=document.querySelector('#content');const search=document.querySelector('input');
  async function action(payload){await fetch('/api/action?token='+encodeURIComponent(token),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})}
  function row(label,meta,onClick,folder){const button=document.createElement('button');button.className='row';button.onclick=onClick;if(folder){const icon=document.createElement('span');icon.className='folder';icon.textContent='▱';button.append(icon)}const title=document.createElement('b');title.textContent=label;button.append(title);const suffix=document.createElement('span');suffix.className=meta?'status':'';suffix.textContent=meta||'›';button.append(suffix);return button}
  function render(){const keyword=search.value.trim().toLowerCase();content.replaceChildren();const projectTitle=document.createElement('h2');projectTitle.textContent='项目';content.append(projectTitle);for(const p of state.projects.filter(x=>x.name.toLowerCase().includes(keyword))){content.append(row(p.name,'',()=>action({action:'select-project',workspaceId:p.id}),true))}const chatTitle=document.createElement('h2');chatTitle.textContent='聊天';content.append(chatTitle);for(const c of state.chats.filter(x=>x.title.toLowerCase().includes(keyword))){content.append(row(c.title,c.status,()=>action({action:'select-thread',workspaceId:c.workspaceId,threadId:c.id}),false))}}
  async function refresh(){const r=await fetch('/api/state?token='+encodeURIComponent(token));if(!r.ok){content.textContent='连接已失效';return}state=await r.json();render()}
  search.addEventListener('input',render);document.querySelector('footer button').onclick=()=>action({action:'new-chat'});
  refresh();setInterval(refresh,2000);
</script></body></html>`;
}

async function startMobilePairing(): Promise<MobilePairingState> {
  if (mobileBridgeServer) {
    await new Promise<void>((resolveClose) => mobileBridgeServer!.close(() => resolveClose()));
    mobileBridgeServer = null;
  }
  mobilePairingToken = randomUUID();
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    const token = requestUrl.searchParams.get("token") ?? "";
    if (token !== mobilePairingToken || Date.now() > new Date(mobilePairingState.expiresAt).getTime()) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Pairing link expired.");
      return;
    }
    mobilePairingState = {
      ...mobilePairingState,
      status: "connected",
      deviceName: request.headers["user-agent"]?.slice(0, 80) || "移动设备"
    };
    if (requestUrl.pathname === "/api/state") {
      const catalog = await readWorkspaceCatalog();
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({
        projects: catalog.workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name })),
        chats: catalog.workspaces.flatMap((workspace) => workspace.threads.map((thread) => ({
          id: thread.id,
          workspaceId: workspace.id,
          title: thread.title,
          status: thread.statusLabel || (thread.status === "running" ? "运行中" : "")
        }))).slice(0, 20)
      }));
      return;
    }
    if (requestUrl.pathname === "/api/action" && request.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      let action: any = null;
      try {
        action = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, detail: "Invalid action payload." }));
        return;
      }
      mainWindowRef?.webContents.send("phase1:mobile-action", action);
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(mobilePageHtml(mobilePairingToken));
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "0.0.0.0", () => resolveListen());
  });
  mobileBridgeServer = server;
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  mobilePairingState = {
    status: "waiting",
    url: `http://${getLocalIpv4Address()}:${port}/?token=${mobilePairingToken}`,
    code,
    deviceName: "",
    expiresAt
  };
  return mobilePairingState;
}

async function stopMobilePairing() {
  if (mobileBridgeServer) {
    await new Promise<void>((resolveClose) => mobileBridgeServer!.close(() => resolveClose()));
    mobileBridgeServer = null;
  }
  mobilePairingToken = "";
  mobilePairingState = { status: "stopped", url: "", code: "", deviceName: "", expiresAt: "" };
  return mobilePairingState;
}

async function runScheduledAutomation(automation: AutomationSpec) {
  if (!runtime || !automation.workspaceId || !automation.threadId) {
    throw new Error(
      !runtime
        ? "Automation runtime is not available."
        : "Automation target workspace/thread is missing."
    );
  }

  const startedAt = nowIso();
  const currentConfig = await readFeatureConfig();
  await writeFeatureConfig({
    ...currentConfig,
    automations: currentConfig.automations.map((item) =>
      item.id === automation.id
        ? {
            ...item,
            status: "running",
            lastRunAt: startedAt
          }
        : item
    )
  });

  const catalog = await readWorkspaceCatalog();
  const workspace = catalog.workspaces.find((item) => item.id === automation.workspaceId);
  const thread = workspace?.threads.find((item) => item.id === automation.threadId);
  if (!workspace || !thread) throw new Error("Automation target workspace/thread was not found.");
  const threadState = await readThreadState(workspace, thread);
  const shellEnv = await buildWorkspaceShellEnvWithPreferences(workspace);
  const automationRuntime = await createLocalRuntime({
    runtimeId: `automation-${automation.id}`,
    workspacePath: workspace.path,
    platformLabel,
    shellLabel,
    shellEnv
  });
  automationRuntime.setPolicyRules(await readPolicyRules());
  automationRuntime.setThreadState(threadState);
  const eventOffset = automationRuntime.sessionMachine.events.length;
  const snapshot = automation.action === "git_status"
    ? await automationRuntime.queueGitStatus({ permissionMode: "agent" })
    : await automationRuntime.queueWorkspaceScan({ permissionMode: "agent" });
  if (snapshot.session.status === "failed") {
    throw new Error(snapshot.runs?.[0]?.output || `Automation ${automation.title} failed.`);
  }
  const exported = automationRuntime.exportThreadState();
  await writeThreadState(workspace, thread, {
    ...threadState,
    ...exported,
    version: 2
  });
  await appendRolloutRecords(
    getThreadEventLogPath(workspace.id, thread.id),
    automationRuntime.sessionMachine.events.slice(eventOffset).map((event: any) => createRolloutEvent({
      recordType: event.type,
      threadId: thread.id,
      timestamp: event.timestamp,
      payload: { automationId: automation.id, ...event.payload }
    }))
  );
  await updateThreadMetadata({
    workspaceId: workspace.id,
    threadId: thread.id,
    lastEventSummary: `自动化执行：${automation.title}`
  });

  const latestConfig = await readFeatureConfig();
  await writeFeatureConfig({
    ...latestConfig,
    automations: latestConfig.automations.map((item) =>
      item.id === automation.id
        ? {
            ...item,
            status: "scheduled",
            lastRunAt: startedAt,
            nextRunAt: computeNextRunAt(item.intervalMinutes),
            failureCount: 0,
            lastError: undefined
          }
        : item
    )
  });
}

async function tickAutomations() {
  if (automationTickRunning) return;
  automationTickRunning = true;
  try {
  const config = await readFeatureConfig();
  const dueItems = config.automations.filter((item) => {
    if (item.status !== "scheduled" && item.status !== "running") {
      return false;
    }
    if (!item.nextRunAt || !item.intervalMinutes || item.intervalMinutes <= 0) {
      return false;
    }
    return new Date(item.nextRunAt).getTime() <= Date.now();
  });

  for (const automation of dueItems) {
    try {
      await runScheduledAutomation(automation);
    } catch (error) {
      const latestConfig = await readFeatureConfig();
      await writeFeatureConfig({
        ...latestConfig,
        automations: latestConfig.automations.map((item) =>
          item.id === automation.id
            ? (() => {
                const failureCount = (item.failureCount ?? 0) + 1;
                const paused = failureCount >= 3;
                return {
                  ...item,
                  status: paused ? "paused" as const : "scheduled" as const,
                  failureCount,
                  lastError: error instanceof Error ? error.message : String(error),
                  nextRunAt: paused
                    ? undefined
                    : new Date(Date.now() + Math.min(60, 5 * 2 ** (failureCount - 1)) * 60_000).toISOString()
                };
              })()
            : item
        )
      });
      safeConsoleError(`Automation failed: ${automation.title}`, error);
    }
  }
  } finally {
    automationTickRunning = false;
  }
}

function ensureAutomationTimer() {
  if (automationTimer) {
    return;
  }

  automationTimer = setInterval(() => {
    void tickAutomations();
  }, automationTickMs);
}

async function activateWorkspaceThread(input: { workspaceId: string; threadId: string }) {
  const catalog = await readWorkspaceCatalog();
  await ensureCatalogState(catalog);

  const workspace = catalog.workspaces.find((item) => item.id === input.workspaceId);
  if (!workspace) {
    throw new Error("Workspace was not found.");
  }

  const thread = workspace.threads.find((item) => item.id === input.threadId);
  if (!thread) {
    throw new Error("Workspace thread was not found.");
  }

  await ensureActivatableWorkspaceDirectory(workspace);

  await saveActiveThreadState();

  if (runtime.workspacePath !== resolve(workspace.path)) {
    await runtime.switchWorkspace(workspace.path);
  }

  activeShellEnv = await buildWorkspaceShellEnvWithPreferences(workspace);
  runtime.setShellEnv(activeShellEnv);
  terminalSession.cwd = workspace.path;
  if (terminalSession.process && terminalSession.isRunning) {
    terminalSession.process.kill();
    terminalSession.process = null;
    terminalSession.isRunning = false;
  }

  const threadState = await readThreadState(workspace, thread);
  const runningTask = [...concurrentModelTasks.values()].find((task) => task.workspaceId === workspace.id && task.threadId === thread.id);
  runtime.setThreadState(threadState);
  await refreshRuntimeWorkspaceTree(runtime);

  activeWorkspaceId = workspace.id;
  activeThreadId = thread.id;

  const snapshotRuntime = runningTask?.runtime ?? runtime;
  if (snapshotRuntime !== runtime) {
    await refreshRuntimeWorkspaceTree(snapshotRuntime);
  }
  const selectedWorkspaceSnapshot = runtime.getSnapshot();
  return buildSnapshotWithTimeline({
    ...snapshotRuntime.getSnapshot(),
    workspace: selectedWorkspaceSnapshot.workspace
  }, threadState);
}

function buildApiEndpoint(baseUrl: string, wireApi: ModelConfig["wireApi"]) {
  const trimmedBaseUrl = baseUrl.replace(/\/+$/, "");
  return wireApi === "responses" ? `${trimmedBaseUrl}/responses` : `${trimmedBaseUrl}/chat/completions`;
}

function resolveGatewayOrigin(baseUrl: string) {
  const normalized = baseUrl.trim();
  if (!normalized) {
    throw new Error("Model base URL is required.");
  }
  try {
    return new URL(normalized).origin;
  } catch (error) {
    throw new Error(`Invalid model base URL: ${normalized}`);
  }
}

function resolveGatewayBaseUrl(baseUrl: string) {
  const normalized = baseUrl.trim();
  if (!normalized) {
    throw new Error("Model base URL is required.");
  }
  return normalized.replace(/\/+$/, "");
}

async function readGatewayBaseUrl() {
  const config = await readRootConfig();
  return resolveGatewayBaseUrl(configuredGatewayBaseUrlEnv || config.llm.baseUrl);
}

async function readGatewayOrigin() {
  return resolveGatewayOrigin(await readGatewayBaseUrl());
}

function extractResponsesText(payload: any) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const outputs = Array.isArray(payload?.output) ? payload.output : [];
  const parts: string[] = [];

  for (const output of outputs) {
    const contents = Array.isArray(output?.content) ? output.content : [];
    for (const item of contents) {
      if (typeof item?.text === "string" && item.text.trim()) {
        parts.push(item.text.trim());
      }
    }
  }

  return parts.join("\n\n").trim();
}

function extractResponsesTextFromSse(rawText: string) {
  const textParts: string[] = [];
  const completedBodies: any[] = [];
  const eventBlocks = rawText.split(/\r?\n\r?\n/);
  for (const block of eventBlocks) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());
    if (!dataLines.length) continue;
    const dataText = dataLines.join("\n").trim();
    if (!dataText || dataText === "[DONE]") continue;
    let payload: any = null;
    try {
      payload = JSON.parse(dataText);
    } catch {
      continue;
    }
    const type = String(payload?.type ?? "");
    if (
      type === "response.output_text.delta" ||
      type === "response.refusal.delta"
    ) {
      if (typeof payload.delta === "string") textParts.push(payload.delta);
      continue;
    }
    if (type === "response.completed" && payload.response) {
      completedBodies.push(payload.response);
      continue;
    }
  }
  const streamedText = textParts.join("").trim();
  if (streamedText) return streamedText;
  for (const body of completedBodies.reverse()) {
    const completedText = extractResponsesText(body);
    if (completedText) return completedText;
  }
  return "";
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function isRetryableModelGatewayError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /HTTP\s+(?:429|500|502|503|504)\b|可重试|retry/i.test(message);
}

function shouldRetryModelGatewayResponse(response: Response, payload: unknown) {
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    return true;
  }
  return Boolean(payload && typeof payload === "object" && (payload as { retryable?: unknown }).retryable === true);
}

function requestLikelyNeedsLocalTools(prompt: string) {
  const text = prompt.trim().toLowerCase();
  if (!text) return false;
  if (/^(hi|hello|hey|你好|您好|在吗|嗨|哈喽)[\s!！。,.，?？]*$/i.test(text)) {
    return false;
  }
  return /(?:运行|执行|命令|终端|shell|powershell|cmd|bash|测试|构建|启动|重启|安装|修复|修改|创建|写入|删除|移动|复制|重命名|读取文件|查看文件|打开文件|搜索|查找|git|npm|pnpm|yarn|python|node|build|test|run|start|restart|install|fix|edit|create|write|delete|move|copy|rename|read file|open file|search|find)/i.test(text);
}

async function callModelApi(input: {
  requestId?: string;
  signal?: AbortSignal;
  onTextDelta?: (delta: string) => void;
  provider: string;
  baseUrl: string;
  apiKey: string;
  wireApi: "responses" | "chat.completions";
  model: string;
  reviewModel: string;
  reasoningEffort: "low" | "medium" | "high" | "xhigh";
  disableResponseStorage: boolean;
  systemPrompt: string;
  tools?: Array<{
    type: "function";
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict: boolean;
  }>;
    messages: Array<{
      id?: string;
      role: "system" | "user" | "assistant" | "tool";
      content: string;
      reasoningSummary?: string;
      providerReasoningContent?: string;
      toolCallId?: string;
      name?: string;
      toolCalls?: Array<{ id: string; name: string; arguments: string | Record<string, unknown> }>;
      createdAt?: string;
      attachments?: Array<{ name: string; path: string; url: string }>;
  }>;
}) {
  const ownedCustom = isCustomModelSelection(input.model)
    ? await customModelEndpointStore.resolveChatRequest(input.model)
    : null;
  if (isCustomModelSelection(input.model) && !ownedCustom) {
    throw new Error("自备模型不存在或已被删除。请在模型菜单里重新添加。");
  }
  if (ownedCustom) {
    input = {
      ...input,
      provider: ownedCustom.label,
      baseUrl: ownedCustom.baseUrl,
      apiKey: ownedCustom.apiKey,
      wireApi: ownedCustom.wireApi,
      model: ownedCustom.model
    };
  }
  let baseUrl = input.baseUrl.trim();
  const configuredApiKey = ownedCustom
    ? ownedCustom.apiKey
    : await resolveTrustedPrivateModelCredential(
      input.apiKey,
      () => privateModelCredentialVault.readForTrustedRequest()
    );
  let bearerToken = "";
  let authSource: "desktop_access_token" | "configured_api_key" | "none" = "none";
  const model = input.model.trim();

  const authState = await readDesktopAuthState();
  if (ownedCustom) {
    bearerToken = ownedCustom.apiKey;
    authSource = "configured_api_key";
  } else if (authState?.mode === "desktop_token" && authState.access_token) {
    bearerToken = authState.access_token;
    authSource = "desktop_access_token";
    baseUrl = await readGatewayBaseUrl();
  } else if (configuredApiKey) {
    bearerToken = configuredApiKey;
    authSource = "configured_api_key";
  }

  if (!baseUrl) {
    throw new Error("Model base URL is required.");
  }

  if (!bearerToken) {
    throw new Error("A login session or API Key is required.");
  }

  if (!model) {
    throw new Error("Model name is required.");
  }

  const apiUrl = buildApiEndpoint(baseUrl, input.wireApi);
  await appendDesktopDebugLog(
    `model request auth=${authSource} endpoint=${apiUrl} tokenPresent=${Boolean(bearerToken)} tokenLength=${bearerToken.length}`
  );
  const imageMimeTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp"
  };
  const encodeAttachments = async (message: (typeof input.messages)[number]) => {
    const attachments = (message.attachments ?? []).slice(0, 5);
    if (!attachments.length) return message.content.trim();
    const images: string[] = [];
    const files: string[] = [];
    for (const attachment of attachments) {
      const extension = extname(attachment.path).toLowerCase();
      const mimeType = imageMimeTypes[extension];
      const stat = await fs.stat(attachment.path);
      if (!stat.isFile()) throw new Error(`Attachment is not a file: ${attachment.name}`);
      if (mimeType) {
        if (stat.size > 10 * 1024 * 1024) throw new Error(`Image attachment exceeds 10 MB: ${attachment.name}`);
        const bytes = await fs.readFile(attachment.path);
        images.push(`data:${mimeType};base64,${bytes.toString("base64")}`);
      } else {
        files.push(`附件文件：${attachment.name}\n本地路径：${attachment.path}`);
      }
    }
    const text = [message.content.trim(), ...files].filter(Boolean).join("\n\n") || "请查看附件图片";
    return input.wireApi === "responses"
      ? [
          { type: "input_text", text },
          ...images.map((imageUrl) => ({ type: "input_image", image_url: imageUrl }))
        ]
      : [
          { type: "text", text },
          ...images.map((imageUrl) => ({ type: "image_url", image_url: { url: imageUrl } }))
        ];
  };
  const encodedMessages = await Promise.all(
    input.messages
      .filter((message) =>
        message.content.trim()
        || message.attachments?.length
        || message.toolCalls?.length
        || message.reasoningSummary?.trim()
        || message.providerReasoningContent?.trim()
        || message.role === "tool"
      )
      .map(async (message) => ({
        role: message.role,
        content: await encodeAttachments(message),
        toolCallId: message.toolCallId,
        name: message.name,
        reasoningSummary: message.reasoningSummary,
        providerReasoningContent: message.providerReasoningContent,
        toolCalls: message.toolCalls
      }))
  );
  const upstreamMessages: any[] = input.systemPrompt.trim()
    ? [{ role: "system" as const, content: input.systemPrompt.trim() }]
    : [];
  const enableThinking = /deepseek|qwen|doubao|ark|kimi|moonshot|minimax|thinking|reasoner/i
    .test(`${input.provider} ${model}`);
  for (const message of encodedMessages) {
    if (input.wireApi === "responses") {
      if (message.role === "tool") {
        upstreamMessages.push({
          type: "function_call_output",
          call_id: message.toolCallId,
          output: typeof message.content === "string" ? message.content : JSON.stringify(message.content)
        });
        continue;
      }
      const hasText = Boolean(
        message.content && (typeof message.content !== "string" || message.content.trim())
      );
      const reasoning = message.role === "assistant"
        ? String(message.providerReasoningContent || "").trim()
        : "";
      // Thinking-mode vendors require prior assistant reasoning_content before
      // function_call items (Auto + Kimi / DeepSeek via gateway).
      if (hasText || reasoning) {
        upstreamMessages.push({
          role: message.role,
          content: hasText
            ? message.content
            : (typeof message.content === "string" ? message.content : ""),
          ...(reasoning ? { reasoning_content: reasoning } : {})
        });
      }
      for (const call of message.toolCalls ?? []) {
        upstreamMessages.push({
          type: "function_call",
          call_id: call.id,
          name: call.name,
          arguments: typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments)
        });
      }
    } else if (message.role === "tool") {
      upstreamMessages.push({ role: "tool", tool_call_id: message.toolCallId, name: message.name, content: message.content });
    } else {
      upstreamMessages.push({
        role: message.role,
        content: message.content,
        ...(message.role === "assistant" && message.providerReasoningContent?.trim()
          ? { reasoning_content: message.providerReasoningContent.trim() }
          : {}),
        ...(message.toolCalls?.length ? {
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: {
              name: call.name,
              arguments: typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments)
            }
          }))
        } : {})
      });
    }
  }

  const modelTools = formatToolDefinitions(input.tools ?? [], input.wireApi, {
    webSearch: input.wireApi === "responses"
  });

  const requestBody = JSON.stringify(
    input.wireApi === "responses"
      ? {
          model,
          stream: true,
          input: upstreamMessages,
          store: !input.disableResponseStorage,
          reasoning: {
            effort: input.reasoningEffort,
            summary: "auto" as const
          },
          ...(modelTools.length ? { tools: modelTools } : {})
        }
      : {
          model,
          stream: true,
          messages: upstreamMessages,
          ...(enableThinking
            ? { reasoning_effort: input.reasoningEffort, thinking: { type: "enabled" as const } }
            : { temperature: 0.7 }),
          ...(modelTools.length ? { tools: modelTools } : {})
        }
  );
  const fetchModelResponse = () => fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearerToken}`
    },
    signal: input.signal,
    body: requestBody
  });

  let response: Response;
  try {
    response = await fetchModelResponse();
  } catch (error) {
    throw new Error(formatModelNetworkError(error, apiUrl));
  }

  const responseContentType = response.headers.get("content-type") ?? "";
  const isEventStreamResponse = responseContentType.toLowerCase().includes("text/event-stream");
  let rawText = "";
  if (isEventStreamResponse && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    while (true) {
      if (input.signal?.aborted) throw new DOMException("Model request aborted", "AbortError");
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      rawText += chunk;
      pending += chunk;
      const blocks = pending.split(/\r?\n\r?\n/);
      pending = blocks.pop() ?? "";
      for (const block of blocks) {
        const dataText = block.split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n").trim();
        if (!dataText || dataText === "[DONE]") continue;
        try {
          const event = JSON.parse(dataText);
          // Reasoning deltas (Responses + chat-compat) are harvested from rawText
          // by extract*EnvelopeFromSse so tool continuations can echo them.
          const delta = input.wireApi === "responses"
            ? (event.type === "response.output_text.delta" || event.type === "response.refusal.delta" ? event.delta : "")
            : event.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) input.onTextDelta?.(delta);
        } catch {
          // Keep malformed or partial events in rawText for the final envelope parser.
        }
      }
    }
    rawText += decoder.decode();
  } else {
    rawText = await response.text();
  }
  let parsed: any = null;

  if (!isEventStreamResponse) {
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok && !input.signal?.aborted && shouldRetryModelGatewayResponse(response, parsed)) {
      await appendDesktopDebugLog(`model gateway retry status=${response.status} endpoint=${apiUrl}`);
      await sleep(1200);
      try {
        response = await fetchModelResponse();
      } catch (error) {
        throw new Error(formatModelNetworkError(error, apiUrl));
      }
      rawText = await response.text();
      try {
        parsed = rawText ? JSON.parse(rawText) : null;
      } catch {
        parsed = null;
      }
    }
  }

  if (!response.ok) {
    const requestId = response.headers.get("X-Gateway-Request-ID") ?? "";
    throw new Error(
      parsed
        ? formatModelGatewayError(parsed, response.status, requestId)
        : rawText || `模型网关请求失败（HTTP ${response.status}）`
    );
  }

  const envelope = isEventStreamResponse
    ? input.wireApi === "responses"
      ? extractResponsesEnvelopeFromSse(rawText)
      : extractChatEnvelopeFromSse(rawText)
    : input.wireApi === "responses"
      ? extractResponsesEnvelope(parsed)
      : extractChatEnvelope(parsed);

  if (!envelope.content && !envelope.toolCalls.length) {
    throw new Error("Model response did not include assistant content or tool calls.");
  }

  return {
    content: appendUrlCitations(envelope.content, envelope.citations),
    reasoningSummary: envelope.reasoningSummary ?? "",
    providerReasoningContent: envelope.reasoningSummary ?? "",
    toolCalls: envelope.toolCalls,
    webSearchCalls: envelope.webSearchCalls,
    citations: envelope.citations,
    usage: envelope.usage ?? parsed?.usage
  };
}

function createMainWindow() {
  const rendererUrls = process.env.ELECTRON_RENDERER_URL
    ? [
        process.env.ELECTRON_RENDERER_URL,
        process.env.ELECTRON_RENDERER_URL.replace("localhost", "[::1]"),
        process.env.ELECTRON_RENDERER_URL.replace("localhost", "127.0.0.1")
      ]
    : [];
  let loadAttempts = 0;
  const maxLoadAttempts = 9;
  const rendererCrashTimes: number[] = [];
  const { workAreaSize } = screen.getPrimaryDisplay();
  const horizontalMargin = workAreaSize.width >= 1600 ? 120 : 48;
  const verticalMargin = workAreaSize.height >= 1000 ? 96 : 48;
  const initialWidth = Math.max(
    Math.min(980, workAreaSize.width - 24),
    Math.min(1520, workAreaSize.width - horizontalMargin)
  );
  const initialHeight = Math.max(
    Math.min(640, workAreaSize.height - 24),
    Math.min(980, workAreaSize.height - verticalMargin)
  );
  const minimumWidth = Math.max(560, Math.min(980, workAreaSize.width - 24));
  const minimumHeight = Math.max(420, Math.min(700, workAreaSize.height - 24));

  const packagedIconPath = join(process.resourcesPath, "newbrain.ico");
  const devIconPath = join(appDirectory, "..", "..", "build", "icon.ico");
  const legacyDevIconPath = join(workspacePath, "apps/desktop/build/icon.ico");
  const iconPath = app.isPackaged ? packagedIconPath : devIconPath;
  const resolvedIconPath = existsSync(iconPath) ? iconPath : legacyDevIconPath;

  const window = new BrowserWindow({
    width: initialWidth,
    height: initialHeight,
    minWidth: minimumWidth,
    minHeight: minimumHeight,
    ...(process.platform === "darwin"
      ? {
          frame: false,
          titleBarStyle: "hidden" as const
        }
      : {}),
    title: "NewBrain",
    backgroundColor: "#efe7d8",
    icon: resolvedIconPath,
    frame: false,
    titleBarOverlay: {
      color: "#ffffff",
      symbolColor: "#111827",
      height: 42
    },
    webPreferences: {
      preload: join(appDirectory, "../preload/index.mjs"),
      contextIsolation: true,
      sandbox: false
    }
  });

  // Prefer Ctrl+wheel font-size scaling in the renderer; block Chromium page zoom.
  try {
    window.webContents.setVisualZoomLevelLimits(1, 1);
  } catch {
    // Older Electron builds may not expose visual zoom limits.
  }

  const loadRenderer = () => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      return;
    }

    if (rendererUrls.length > 0) {
      const rendererUrl = rendererUrls[loadAttempts % rendererUrls.length];
      loadAttempts += 1;
      void window.loadURL(rendererUrl);
      return;
    }

    void window.loadFile(join(appDirectory, "../renderer/index.html"));
  };

  loadRenderer();

  window.webContents.on("did-start-loading", () => {
    safeConsoleLog("renderer did-start-loading");
    void appendDesktopDebugLog("renderer did-start-loading");
  });

  window.webContents.on("dom-ready", () => {
    safeConsoleLog("renderer dom-ready");
    void appendDesktopDebugLog("renderer dom-ready");
  });

  window.webContents.on("did-finish-load", () => {
    safeConsoleLog("renderer did-finish-load");
    void appendDesktopDebugLog("renderer did-finish-load");
    void window.webContents
      .executeJavaScript(
        `({
          href: window.location.href,
          title: document.title,
          rootExists: Boolean(document.getElementById("root")),
          bodyText: document.body?.innerText?.slice(0, 400) ?? "",
          bodyHtml: document.body?.innerHTML?.slice(0, 400) ?? ""
        })`,
        true
      )
      .then((payload) => {
        safeConsoleLog("renderer snapshot", payload);
        void appendDesktopDebugLog(`renderer snapshot ${JSON.stringify(payload)}`);
      })
      .catch((error) => {
        safeConsoleError("renderer snapshot failed", error);
        void appendDesktopDebugLog(`renderer snapshot failed ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      });
    setTimeout(() => {
      if (window.isDestroyed() || window.webContents.isDestroyed()) {
        return;
      }
      void window.webContents
        .executeJavaScript(
          `({
            bodyText: document.body?.innerText?.slice(0, 800) ?? "",
            bodyHtml: document.body?.innerHTML?.slice(0, 1000) ?? ""
          })`,
          true
        )
        .then((payload) => appendDesktopDebugLog(`renderer delayed snapshot ${JSON.stringify(payload)}`))
        .catch((error) => appendDesktopDebugLog(`renderer delayed snapshot failed ${error instanceof Error ? error.stack ?? error.message : String(error)}`));
    }, 8000);
  });

  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    safeConsoleLog("renderer console", { level, message, line, sourceId });
    void appendDesktopDebugLog(
      `renderer console ${JSON.stringify({ level, message, line, sourceId })}`
    );
  });

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    safeConsoleError("renderer load failed", {
      errorCode,
      errorDescription,
      validatedURL
    });
    void appendDesktopDebugLog(
      `renderer load failed ${JSON.stringify({ errorCode, errorDescription, validatedURL })}`
    );

    if (rendererUrls.length > 0 && loadAttempts < maxLoadAttempts) {
      setTimeout(() => {
        if (window.isDestroyed() || window.webContents.isDestroyed()) {
          return;
        }
        loadRenderer();
      }, 800);
    }
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    safeConsoleError("renderer process gone", details);
    void appendDesktopDebugLog(`renderer process gone ${JSON.stringify(details)}`);
    if (details.reason !== "crashed" && details.reason !== "oom") return;
    const now = Date.now();
    rendererCrashTimes.push(now);
    while (rendererCrashTimes.length && now - rendererCrashTimes[0] > 60_000) {
      rendererCrashTimes.shift();
    }
    if (rendererCrashTimes.length > 3) {
      void appendDesktopDebugLog("renderer automatic recovery stopped after 3 crashes in 60 seconds");
      return;
    }
    setTimeout(() => {
      if (window.isDestroyed() || window.webContents.isDestroyed()) return;
      void appendDesktopDebugLog(`renderer automatic recovery attempt=${rendererCrashTimes.length}`);
      loadRenderer();
    }, 600);
  });

  const shouldOpenDevTools =
    process.argv.includes("--open-devtools") ||
    process.env.NEWBRAIN_OPEN_DEVTOOLS === "1";

  if (shouldOpenDevTools) {
    window.webContents.openDevTools({ mode: "detach" });
  }

  mainWindowRef = window;
  window.on("closed", () => {
    if (mainWindowRef === window) {
      mainWindowRef = null;
    }
  });

  return window;
}

function readModelUsageTokens(usage: unknown) {
  if (!usage || typeof usage !== "object") return 0;
  const value = usage as Record<string, unknown>;
  const total = Number(value.total_tokens ?? value.totalTokens);
  if (Number.isFinite(total) && total >= 0) return Math.trunc(total);
  const input = Number(value.input_tokens ?? value.prompt_tokens ?? value.inputTokens ?? 0);
  const output = Number(value.output_tokens ?? value.completion_tokens ?? value.outputTokens ?? 0);
  return Math.max(0, Math.trunc((Number.isFinite(input) ? input : 0) + (Number.isFinite(output) ? output : 0)));
}
function createDesktopModelChatStepService() {
  return new ModelChatStepService({
    callModel: (stepInput) => callModelApi(stepInput as Parameters<typeof callModelApi>[0]),
    isRetryableError: isRetryableModelGatewayError,
    readUsageTokens: (usage) => readModelUsageTokens(usage),
    containsPrivatePlanning: containsPrivatePlanningNarration,
    sanitizeVisibleContent: sanitizeVisibleModelContent,
    extractPlanningNarration: extractPrivatePlanningNarration
  });
}
const desktopModelChatStepService = createDesktopModelChatStepService();

async function scheduleAutomaticUserKnowledgeSync(input?: {
  projectWorkspacePath?: string;
  projectKey?: string;
  delayMs?: number;
}) {
  try {
    const authState = await readDesktopAuthState();
    const bearerToken = authState?.access_token?.trim() || "";
    if (!bearerToken) return;
    const gatewayBaseUrl = await readGatewayBaseUrl();
    scheduleUserKnowledgeSync({
      auth: { gatewayBaseUrl, bearerToken },
      paths: {
        userNewbrainRoot: userKnowledgeRoot,
        projectWorkspacePath: input?.projectWorkspacePath,
        projectKey: input?.projectKey
      },
      delayMs: input?.delayMs,
      onResult: (result) => {
        void appendDesktopDebugLog(
          `user-knowledge auto-sync status=${result.status} gen=${result.generation} pulled=${result.pulled} pushed=${result.pushed} conflicts=${result.conflictRetried}`
        );
      },
      onError: (error) => {
        void appendDesktopDebugLog(
          `user-knowledge auto-sync error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  } catch (error) {
    await appendDesktopDebugLog(
      `user-knowledge auto-sync schedule failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

const readAuthorizedDesktopModelConfig = createReadAuthorizedDesktopModelConfig({
  readRootConfig,
  readBundledRootConfig,
  readDesktopAuthState,
  readPrivateModelCredential: () => privateModelCredentialVault.readForTrustedRequest(),
  readGatewayOrigin,
  createDesktopAuthHeaders,
  collectDesktopDeviceFingerprint,
  appendDesktopDebugLog,
  ensureDirectory,
  parseJsonText,
  normalizeModelConfig,
  authorizedModelsCachePath,
  desktopControlPlaneStatePath,
  configuredGatewayBaseUrlEnv,
  productionGatewayBaseUrl,
  defaultGatewayBaseUrl,
  isPackaged: app.isPackaged,
  setCachedAuthorizedModels: (models) => { cachedAuthorizedModels = models; }
});

function createAgentTurnControlPlane() {
  const getConnection = async () => {
    const authState = await readDesktopAuthState();
    const e2eCredential = !app.isPackaged && process.env.NEWBRAIN_E2E_AUTH_BYPASS === "1" && configuredGatewayBaseUrlEnv
      ? process.env.NEWBRAIN_E2E_AUTH_TOKEN?.trim() || "newbrain-e2e"
      : "";
    const accessToken = authState?.access_token?.trim() || e2eCredential;
    if (!accessToken) throw new Error("AGENT_TURN_AUTH_REQUIRED");
    const device = collectDesktopDeviceFingerprint();
    return {
      gatewayOrigin: await readGatewayOrigin(),
      headers: createDesktopAuthHeaders({ accessToken, device })
    };
  };
  return new AgentTurnControlPlaneService({
    getConnection,
    isEnabled: async () => {
      try {
        const auth = await resolveDesktopAuthStatus();
        return Boolean(auth.authenticated);
      } catch {
        return false;
      }
    },
    onCorrelationMismatch: (message) => {
      void appendDesktopDebugLog(message);
      void appendDiagnosticsLog(message);
    }
  });
}

const agentTurnControlPlane = createAgentTurnControlPlane();

async function resolveBrainLocalOwnerId() {
  const authState = await readDesktopAuthState().catch(() => null);
  const accountId = authState?.user?.id?.trim() || authState?.user?.email?.trim().toLowerCase() || "";
  return accountId ? `account:${accountId}` : `device:${collectDesktopDeviceFingerprint().device_id}`;
}

function registerIpc() {
  brainFlowExecution = registerBrainWorkspaceIpcHandlers({
    storage: brainWorkspaceStorage,
    readWorkspaceCatalog,
    quant: quantSimulationService,
    queryQuantMarketOverview: (limit) => desktopMarketOverviewClient.queryOverview(limit),
    queryQuantMarketScreener: (criteria) => desktopMarketOverviewClient.queryScreener(criteria),
    ingestDocument: (input) => documentWorkerProcess.ingest(input),
    acquireRustCore: (binding) => getRustCoreService().acquire(binding),
    platform: process.platform,
    openSoftwareTerminal: async ({ projectRoot }) => {
      const previous = terminalSession.process;
      if (previous && terminalSession.isRunning) {
        await new Promise<void>((resolveExit) => {
          previous.once("exit", () => resolveExit());
          previous.kill();
        });
      }
      terminalSession.cwd = projectRoot;
      terminalSession.lines = [];
      ensureTerminalSession();
      return { ok: true };
    },
    confirmGamePreview: async ({ projectName, command }) =>
      confirmBrainSceneUiAction({
        kind: "game_preview",
        summary: `${projectName} · ${command}`
      }),
    confirmSoftwareTask: async ({ projectId, script }) =>
      confirmBrainSceneUiAction({
        kind: "software_task",
        projectId,
        summary: `${script.label} · ${script.executable} ${script.args.join(" ")}`
      }),
    confirmFlowApproval: async ({ projectId, nodeId }) => {
      const result = await dialog.showMessageBox(mainWindowRef ?? undefined, { type: "warning", title: "Flow 人工审批", message: `允许项目 ${projectId} 的 Flow 继续执行吗？`, detail: `审批节点：${nodeId}\n\n批准后仅会执行主进程注册的受限工具。`, buttons: ["批准", "拒绝"], defaultId: 1, cancelId: 1, noLink: true });
      return result.response === 0;
    },
    resolveOwnerId: resolveBrainLocalOwnerId,
    resolveWorkspaceRoot: async (workspaceId) => {
      const workspace = (await readWorkspaceCatalog()).workspaces.find((item) => item.id === workspaceId);
      if (!workspace) throw new Error("BRAIN_LOCAL_WORKSPACE_NOT_AUTHORIZED");
      const root = await fs.realpath(workspace.path);
      if (!(await fs.stat(root)).isDirectory()) throw new Error("BRAIN_LOCAL_WORKSPACE_NOT_DIRECTORY");
      return root;
    }
  });
  ipcMain.handle(
    "phase1:show-app-menu",
    async (
      event,
      input: { menu: "file" | "edit" | "view" | "window" | "help"; x: number; y: number }
    ) => {
      const window = BrowserWindow.fromWebContents(event.sender) ?? mainWindowRef;
      if (!window) return { ok: false };

      const sendAppCommand = (id: string) => {
        const targetWindow = window.isDestroyed() ? mainWindowRef : window;
        const targetContents = targetWindow && !targetWindow.isDestroyed()
          ? targetWindow.webContents
          : event.sender;
        if (!targetContents.isDestroyed()) {
          targetContents.send("phase1:app-command", id);
        }
      };
      const command = (
        label: string,
        id: string,
        accelerator?: string
      ): MenuItemConstructorOptions => ({
        label,
        accelerator,
        click: () => sendAppCommand(id)
      });
      const separator: MenuItemConstructorOptions = { type: "separator" };
      const templates: Record<typeof input.menu, MenuItemConstructorOptions[]> = {
        file: [
          { label: "新建窗口", accelerator: "Ctrl+Shift+N", click: () => createMainWindow() },
          command("新建对话", "new-chat", "Ctrl+N"),
          command("快速对话", "quick-chat", "Ctrl+Alt+N"),
          command("打开文件夹...", "open-folder", "Ctrl+O"),
          { role: "close", label: "关闭", accelerator: "Ctrl+W" },
          separator,
          command("设置...", "settings", "Ctrl+,"),
          separator,
          command("退出登录", "logout"),
          { role: "quit", label: "退出", accelerator: "Ctrl+Q" }
        ],
        edit: [
          { role: "undo", label: "撤销", accelerator: "Ctrl+Z" },
          { role: "redo", label: "重做", accelerator: "Ctrl+Y" },
          separator,
          { role: "cut", label: "剪切", accelerator: "Ctrl+X" },
          { role: "copy", label: "复制", accelerator: "Ctrl+C" },
          { role: "paste", label: "粘贴", accelerator: "Ctrl+V" },
          { role: "delete", label: "删除" },
          separator,
          { role: "selectAll", label: "全选", accelerator: "Ctrl+A" }
        ],
        view: [
          command("切换侧边栏", "toggle-sidebar", "Ctrl+B"),
          command("切换底部面板", "toggle-bottom-panel", "Ctrl+J"),
          command("切换文件树", "toggle-file-tree", "Ctrl+Shift+E"),
          command("打开浏览器标签", "open-browser", "Ctrl+T"),
          { role: "reload", label: "重新加载页面", accelerator: "Ctrl+R" },
          command("切换右侧面板", "toggle-side-panel", "Ctrl+Alt+B"),
          command("查找", "find", "Ctrl+F"),
          separator,
          command("上一个对话", "previous-chat", "Ctrl+Shift+["),
          command("下一个对话", "next-chat", "Ctrl+Shift+]"),
          command("后退", "back", "Ctrl+["),
          command("前进", "forward", "Ctrl+]"),
          separator,
          { role: "zoomIn", label: "放大", accelerator: "Ctrl+Shift+=" },
          { role: "zoomOut", label: "缩小", accelerator: "Ctrl+-" },
          { role: "resetZoom", label: "实际大小", accelerator: "Ctrl+0" },
          separator,
          { role: "togglefullscreen", label: "切换全屏", accelerator: "F11" }
        ],
        window: [
          { role: "minimize", label: "最小化" },
          { role: "zoom", label: "最大化或还原" },
          { role: "close", label: "关闭" }
        ],
        help: [
          {
            label: "NewBrain 文档",
            click: () => void electronShell.openExternal("https://developers.openai.com/codex/")
          },
          {
            label: "新增功能",
            click: () => void electronShell.openExternal("https://developers.openai.com/codex/changelog/")
          },
          separator,
          command("自动化", "automations"),
          command("本地环境", "local-environments"),
          command("工作树", "worktrees"),
          command("技能", "skills"),
          command("模型上下文协议", "mcp"),
          {
            label: "故障排除",
            click: () => void electronShell.openExternal("https://developers.openai.com/codex/troubleshooting/")
          },
          separator,
          {
            label: "发送反馈",
            click: () => void electronShell.openExternal("https://github.com/openai/codex/issues")
          },
          command("键盘快捷键", "shortcuts", "Ctrl+Shift+/"),
          separator,
          {
            label: "关于 NewBrain",
            click: () => void dialog.showMessageBox(window, {
              type: "info",
              title: "关于 NewBrain",
              message: "NewBrain",
              detail: `版本 ${resolveElectronAppVersion(app)}\n面向 Windows 的智能编程协作桌面应用。`
            })
          }
        ]
      };

      const popup = Menu.buildFromTemplate(templates[input.menu]);
      return new Promise<{ ok: boolean }>((resolve) => {
        popup.popup({
          window,
          x: Math.round(input.x),
          y: Math.round(input.y),
          callback: () => resolve({ ok: true })
        });
      });
    }
  );

  ipcMain.handle("phase1:window-control", async (_event, action: "minimize" | "maximize" | "close") => {
    const window = mainWindowRef;
    if (!window) {
      return { ok: false };
    }
    if (action === "minimize") {
      window.minimize();
      return { ok: true };
    }
    if (action === "maximize") {
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
      return { ok: true };
    }
    window.close();
    return { ok: true };
  });

  ipcMain.handle("phase1:bootstrap", async () => {
    return {
      appName: "NewBrain",
      platform: platformLabel,
      phase: "phase-1",
      shell: shellLabel,
      workspacePath: runtime.workspacePath
    };
  });

  ipcMain.handle("phase1:get-snapshot", async () => {
    const catalog = await readWorkspaceCatalog();
    const workspace = catalog.workspaces.find((item) => item.id === activeWorkspaceId);
    const thread = workspace?.threads.find((item) => item.id === activeThreadId);
    if (!workspace || !thread) {
      return runtime.getSnapshot();
    }
    const threadState = await readThreadState(workspace, thread);
    if (runtime.workspacePath === resolve(workspace.path)) {
      await refreshRuntimeWorkspaceTree(runtime);
    }
    return buildSnapshotWithTimeline(runtime.getSnapshot(), threadState);
  });

  ipcMain.handle("phase1:queue-workspace-scan", async () => {
    const eventOffset = runtime.sessionMachine.events.length;
    const nextSnapshot = await runtime.queueWorkspaceScan();
    await saveActiveThreadState("已刷新工作区文件树");
    await appendRuntimeEventsSince(eventOffset);
    return nextSnapshot;
  });

  ipcMain.handle("phase1:queue-git-status", async () => {
    const preferences = await getActiveDesktopPreferences();
    const eventOffset = runtime.sessionMachine.events.length;
    const permissionMode = preferences.configuration.requireApprovalForShell ? "approval" : "full";
    const nextSnapshot = await runtime.queueShellCommand(preferences.git.statusCommand, { permissionMode });
    await saveActiveThreadState("已记录 Git 状态");
    await appendRuntimeEventsSince(eventOffset);
    return nextSnapshot;
  });

  ipcMain.handle("phase1:get-goal", async (_event, input?: { threadId?: string }) => {
    const threadId = String(input?.threadId || "").trim();
    if (!threadId) throw new Error("get-goal 需要 threadId。");
    return codexStorage.getGoal(threadId);
  });

  ipcMain.handle("phase1:create-goal", async (_event, input: { objective: string; tokenBudget?: number; threadId?: string }) => {
    const threadId = String(input.threadId || "").trim();
    if (!threadId) throw new Error("create-goal 需要 threadId。");
    const goal = codexStorage.createGoal(threadId, input.objective, input.tokenBudget);
    codexStorage.appendLog({ level: "info", target: "goal.create", body: goal.objective, threadId, processUuid });
    return goal;
  });

  ipcMain.handle("phase1:update-goal", async (_event, input: {
    status: "complete" | "blocked";
    tokensUsed?: number;
    timeUsedSeconds?: number;
    threadId?: string;
  }) => {
    const threadId = String(input.threadId || "").trim();
    if (!threadId) throw new Error("update-goal 需要 threadId。");
    const goal = codexStorage.updateGoal(threadId, input.status, input);
    codexStorage.appendLog({ level: "info", target: "goal.update", body: input.status, threadId, processUuid });
    return goal;
  });

  ipcMain.handle("phase1:cancel-model-request", async (_event, input?: { requestId?: string }) => {
    const requestId = String(input?.requestId || "").trim();
    const task = requestId ? concurrentModelTasks.get(requestId) : undefined;
    if (!requestId || !task) {
      return { ok: false, detail: "取消模型任务需要有效的 requestId。" };
    }
    canceledModelRequestIds.add(requestId);
    task.abortController.abort();
    (task.runtime as { cancelAgentLoop?: (reason: string) => void } | undefined)?.cancelAgentLoop?.("User requested cancellation.");
    if (task.workspaceId && task.threadId) {
      await updateThreadMetadata({
        workspaceId: task.workspaceId,
        threadId: task.threadId,
        status: "failed",
        statusLabel: "Cancelled",
        lastEventSummary: "用户已请求停止当前任务"
      });
    }
    return { ok: true, detail: "已请求停止当前任务。" };
  });

  ipcMain.handle("phase1:queue-shell-command", async (_event, command: string) => {
    const preferences = await getActiveDesktopPreferences();
    const eventOffset = runtime.sessionMachine.events.length;
    if (preferences.hooks.beforeCommand) {
      await saveActiveThreadState(`钩子 beforeCommand: ${command}`);
      await runPreferenceHookScript("beforeCommand", preferences.hooks.beforeCommandScript);
    }
    const rawCommand = command.trim();
    const rawLoweredCommand = rawCommand.toLowerCase();
    const effectiveCommand = preferences.git.forcePushWithLease
      && /^git\s+push\b/.test(rawLoweredCommand)
      && !/\s--force(?:-with-lease)?\b/.test(rawLoweredCommand)
        ? rawCommand.replace(/^git\s+push\b/i, "git push --force-with-lease")
        : command;
    const loweredCommand = effectiveCommand.trim().toLowerCase();
    const forceApproval = preferences.git.confirmBeforePush && /^git\s+push\b/.test(loweredCommand);
    const permissionMode = !preferences.configuration.requireApprovalForShell && !forceApproval ? "full" : "approval";
    if (preferences.git.showDiffBeforeCommit && /^git\s+commit\b/.test(loweredCommand)) {
      await runtime.queueShellCommand("git diff --cached --stat", { permissionMode: "full" });
      if (preferences.hooks.beforeCommit) {
        await runPreferenceHookScript("beforeCommit", preferences.hooks.beforeCommitScript);
      }
      await saveActiveThreadState("提交前钩子：已生成 staged diff 摘要");
    }
    const nextSnapshot = await runtime.queueShellCommand(effectiveCommand, { permissionMode });
    if (preferences.git.confirmBeforePush && /^git\s+push\b/.test(loweredCommand)) {
      await saveActiveThreadState("推送前确认已启用：命令将保留审批请求");
    }
    if (preferences.hooks.afterCommand) {
      await runPreferenceHookScript("afterCommand", preferences.hooks.afterCommandScript);
      await saveActiveThreadState(`钩子 afterCommand: ${command}`);
    }
    if (preferences.hooks.afterTask) {
      await runPreferenceHookScript("afterTask", preferences.hooks.afterTaskScript);
    }
    await saveActiveThreadState(`已提交命令: ${command}`);
    await appendRuntimeEventsSince(eventOffset);
    return nextSnapshot;
  });

  ipcMain.handle("phase1:get-terminal-session", async () => {
    ensureTerminalSession();
    return getTerminalSnapshot();
  });

  ipcMain.handle("phase1:write-terminal-input", async (_event, input: string) => {
    const session = ensureTerminalSession();
    session.stdin.write(input, "utf8");
    return getTerminalSnapshot();
  });

  ipcMain.handle("phase1:restart-terminal-session", async () => {
    if (terminalSession.process && terminalSession.isRunning) {
      terminalSession.process.kill();
    }
    clearTerminalSession();
    ensureTerminalSession();
    return getTerminalSnapshot();
  });

  ipcMain.handle("phase1:open-system-terminal", async (_event, cwd: string) => {
    const safeCwd = typeof cwd === "string" && cwd.trim().length > 0 ? cwd.trim() : runtime.workspacePath;
    // Open system terminal (PowerShell) in the given working directory.
    spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NoExit",
        "-Command",
        `Set-Location -LiteralPath '${safeCwd.replace(/'/g, "''")}'`
      ],
      { detached: true, stdio: "ignore", env: activeShellEnv }
    ).unref();
    await saveActiveThreadState(`已打开系统终端: ${safeCwd}`);
    return { ok: true };
  });

  ipcMain.handle("phase1:respond-approval", async (_event, input: boolean | { approved: boolean; requestId?: string }) => {
    const approved = typeof input === "boolean" ? input : Boolean(input.approved);
    const requestId = typeof input === "object" ? input.requestId?.trim() || "" : "";
    if (!requestId) {
      throw new Error("respond-approval 需要 requestId，不能回退到当前 UI 线程。");
    }
    if ([...concurrentModelTasks.values()].some((task) => task.abortController.signal.aborted)) {
      throw new Error("Cannot respond to approval after the task was cancelled.");
    }

    const pendingTask = concurrentModelTasks.get(requestId);
    if (!pendingTask) {
      throw new Error("当前审批请求已失效：对应的运行任务不存在。请重新发送这条任务。");
    }
    const effectiveRequestId = requestId;
    const targetRuntime = pendingTask.runtime;
    if (!targetRuntime) {
      throw new Error("当前审批请求已失效：运行时尚未就绪。请重新发送这条任务。");
    }
    const targetWorkspaceId = pendingTask.scope?.workspaceId ?? pendingTask.workspaceId;
    const targetThreadId = pendingTask.scope?.threadId ?? pendingTask.threadId;
    const targetModelCallback = pendingTask.modelCallback;
    const agentLoopStatus = targetRuntime.getAgentLoopSnapshot()?.status;
    const agentLoopPending = agentLoopStatus === "awaiting-approval";
    const agentLoopCanAdvance = agentLoopStatus === "running";
    const agentEventOffset = targetRuntime.sessionMachine.events.length;
    let resumedAgentLoop: Awaited<ReturnType<typeof runtime.resumeAgentApproval>> | null = null;
    let nextSnapshot;

    if (!agentLoopPending && !agentLoopCanAdvance && !targetRuntime.getSnapshot().approval) {
      if (targetWorkspaceId && targetThreadId) {
        await updateThreadMetadata({
          workspaceId: targetWorkspaceId,
          threadId: targetThreadId,
          status: "failed",
          statusLabel: "审批已失效",
          lastEventSummary: "审批对应的运行任务已不存在，请重新发送任务"
        });
      }
      throw new Error("当前审批已失效：没有可继续执行的工具调用。请重新发送任务。");
    }

    try {
      if (agentLoopPending && targetModelCallback) {
        const loopSnapshot = await targetRuntime.resumeAgentApproval(approved, targetModelCallback);
        resumedAgentLoop = loopSnapshot;
        nextSnapshot = targetRuntime.getSnapshot();
        if (loopSnapshot.status !== "awaiting-approval") {
          pendingTask.modelCallback = undefined;
        }
      } else if (agentLoopCanAdvance && targetModelCallback && approved) {
        const loopSnapshot = await targetRuntime.advanceAgentLoop(targetModelCallback);
        resumedAgentLoop = loopSnapshot;
        nextSnapshot = targetRuntime.getSnapshot();
        if (loopSnapshot.status !== "awaiting-approval") {
          pendingTask.modelCallback = undefined;
        }
      } else {
        nextSnapshot = await targetRuntime.respondToApproval(approved);
      }
    } catch (error) {
      if (!isRetryableModelGatewayError(error)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      nextSnapshot = targetRuntime.getSnapshot();
      publishAssistantActivity({
        type: "run",
        title: "模型网关暂时不可用",
        detail: `${message}\n请稍后再次点击批准并继续。`
      }, effectiveRequestId);
      if (targetWorkspaceId && targetThreadId) {
        const catalog = await readWorkspaceCatalog();
        const workspace = catalog.workspaces.find((item) => item.id === targetWorkspaceId);
        const thread = workspace?.threads.find((item) => item.id === targetThreadId);
        if (workspace && thread) {
          await appendThreadEvents(workspace, thread, [createThreadEvent("error", {
            stage: "approval_resume_model",
            message,
            retryable: true
          })]);
          await updateThreadMetadata({
            workspaceId: workspace.id,
            threadId: thread.id,
            status: "awaiting-approval",
            statusLabel: "可重试",
            lastEventSummary: "模型网关暂时不可用，请稍后重试批准继续"
          });
        }
      }
      return nextSnapshot;
    }

    const latestRun = nextSnapshot.runs?.[0];
    if (approved && latestRun) {
      const activity = {
        type: "run" as const,
        title: latestRun.status === "failed" ? "命令执行失败" : "已执行命令",
        detail: latestRun.output
          ? `${latestRun.command}\n退出码：${latestRun.exitCode ?? "未知"}\n${latestRun.output}`
          : `${latestRun.command}\n退出码：${latestRun.exitCode ?? "未知"}\n（命令没有输出）`
      };
      publishAssistantActivity(activity, effectiveRequestId);
    }

    if (resumedAgentLoop?.status === "completed") {
      const latestUser = [...nextSnapshot.messages].reverse().find((message) => message.role === "user");
      await targetRuntime.rememberExchangeWithShadow({
        user: latestUser?.content ?? "",
        assistant: resumedAgentLoop.finalContent,
        scope: "session"
      });
    }

    if (targetWorkspaceId && targetThreadId) {
      const catalog = await readWorkspaceCatalog();
      const workspace = catalog.workspaces.find((item) => item.id === targetWorkspaceId);
      const thread = workspace?.threads.find((item) => item.id === targetThreadId);
      if (workspace && thread) {
        const agentEvents = targetRuntime.sessionMachine.events.slice(agentEventOffset);
        if (agentEvents.length) {
          await appendRolloutRecords(
            getThreadEventLogPath(workspace.id, thread.id),
            agentEvents.map((event: any) => createRolloutEvent({
              recordType: event.type,
              threadId: thread.id,
              timestamp: event.timestamp,
              payload: event.payload
            }))
          );
        }
        await appendThreadEvents(workspace, thread, [createThreadEvent("approval", {
          approved,
          status: approved ? latestRun?.status ?? "completed" : "canceled",
          command: latestRun?.command ?? "",
          exitCode: latestRun?.exitCode
        })]);
        await saveRuntimeThreadState(
          targetRuntime,
          workspace,
          thread,
          approved
            ? nextSnapshot.approval
              ? "审批已处理，等待下一次批准"
              : latestRun?.status === "failed" ? "审批后命令执行失败" : "审批后命令已执行"
            : "审批已拒绝",
          { touchUpdatedAt: false }
        );
        await updateThreadMetadata({
          workspaceId: workspace.id,
          threadId: thread.id,
          ...(nextSnapshot.approval
            ? { status: "awaiting-approval" as const, statusLabel: "等待批准" }
            : approved && latestRun?.status === "failed"
            ? { status: "failed" as const, statusLabel: "执行失败" }
            : { status: "idle" as const, statusLabel: "" }),
          lastEventSummary: approved
            ? nextSnapshot.approval
              ? "审批已处理，等待下一次批准"
              : latestRun?.status === "failed" ? "审批后命令执行失败" : "审批后命令已执行"
            : "审批已拒绝"
        });
      }
    }
    if (!nextSnapshot.approval) {
      concurrentModelTasks.delete(effectiveRequestId);
      canceledModelRequestIds.delete(effectiveRequestId);
      await appendDesktopDebugLog(`model task approval completed request=${effectiveRequestId}`);
    }
    return nextSnapshot;
  });

  ipcMain.handle(
    "phase1:generate-patch",
    async (_event, input: { filePath: string; searchText: string; replaceText: string }) => {
      const nextSnapshot = await runtime.generatePatch(input);
      await saveActiveThreadState(`已生成补丁: ${input.filePath}`);
      return nextSnapshot;
    }
  );

  ipcMain.handle("phase1:apply-patch", async () => {
    const nextSnapshot = await runtime.applyPatch();
    await saveActiveThreadState("已应用补丁");
    return nextSnapshot;
  });

  ipcMain.handle("phase1:get-model-config", async () => {
    const config = await readRootConfig();
    return config.llm;
  });
  registerCustomModelEndpointIpc(customModelEndpointStore);

  ipcMain.handle("phase1:get-desktop-preferences", async () => {
    return getActiveDesktopPreferences();
  });

  ipcMain.handle("phase1:save-desktop-preferences", async (_event, preferences: DesktopPreferences) => {
    return writeDesktopPreferences(preferences);
  });

  ipcMain.handle("phase1:get-desktop-bootstrap-status", async () => {
    const state = await readDesktopBootstrapState();
    return await toDesktopBootstrapStatusPayload(state);
  });

  ipcMain.handle("phase1:retry-desktop-conda-bootstrap", async () => {
    return retryDesktopCondaInitialization();
  });

  ipcMain.handle("phase1:start-desktop-bootstrap", async () => {
    return startDesktopBootstrapAfterAuth();
  });

  ipcMain.handle("phase1:get-auth-status", async () => {
    return resolveDesktopAuthStatus();
  });

  ipcMain.handle("phase1:get-billing-subscription", async () => {
    return fetchDesktopBillingSubscription();
  });

  ipcMain.handle("phase1:send-login-code", async (_event, input: DesktopAuthSendCodeInput) => {
    return sendDesktopLoginCode(input);
  });

  ipcMain.handle("phase1:login-auth", async (_event, input: DesktopAuthLoginInput) => {
    return loginDesktopAuth(input);
  });

  ipcMain.handle("phase1:load-remembered-login", () => rememberedLoginStore.load());
  ipcMain.handle("phase1:save-remembered-login", (_event, input: unknown) => rememberedLoginStore.save(input));
  ipcMain.handle("phase1:clear-remembered-login", () => rememberedLoginStore.clear());

  ipcMain.handle("phase1:logout-auth", async () => {
    return logoutDesktopAuth();
  });

  ipcMain.handle("phase1:get-mcp-servers", async () => {
    return readMcpServers();
  });

  ipcMain.handle("phase1:get-feature-config", async () => {
    return readFeatureConfig();
  });

  ipcMain.handle(
    "phase1:add-feature-item",
    async (_event, input: { kind: ManagedFeatureKind; item: FeatureItemInput }) => {
      return addFeatureItem(input.kind, input.item);
    }
  );

  ipcMain.handle(
    "phase1:update-feature-item",
    async (_event, input: { kind: ManagedFeatureKind; id: string; item: FeatureItemInput }) => {
      return updateFeatureItem(input.kind, input.id, input.item);
    }
  );

  ipcMain.handle(
    "phase1:delete-feature-item",
    async (_event, input: { kind: ManagedFeatureKind; id: string }) => {
      return deleteFeatureItem(input.kind, input.id);
    }
  );

  ipcMain.handle("phase1:search-workspaces", async (_event, query: string) => {
    return searchWorkspaceThreads(query);
  });

  ipcMain.handle(
    "phase1:read-workspace-file",
    async (_event, input: { workspaceId: string; filePath: string }) => readWorkspaceFile(input)
  );

  ipcMain.handle("phase1:start-mobile-pairing", async () => startMobilePairing());
  ipcMain.handle("phase1:get-mobile-pairing-status", async () => mobilePairingState);
  ipcMain.handle("phase1:stop-mobile-pairing", async () => stopMobilePairing());

  ipcMain.handle("phase1:save-model-config", async (_event, config: ModelConfig) => {
    const saved = await writeRootConfig(config);
    return saved.llm;
  });

  const browserPreviewService = new BrowserPreviewService({
    getPreferences: getActiveDesktopPreferences,
    openWindow: ensurePreviewWindow,
    closeWindow: () => {
      if (previewWindowRef && !previewWindowRef.isDestroyed()) previewWindowRef.close();
      previewWindowRef = null;
    },
    captureWindow: capturePreviewWindow,
    saveThreadState: saveActiveThreadState,
    appendDiagnostics: appendDiagnosticsLog,
    openExternal: async (url) => {
      const { shell } = await import("electron");
      await shell.openExternal(url);
    }
  });
  registerBrowserIpcHandlers({
    openPreview: (url) => browserPreviewService.open(url),
    closePreview: () => browserPreviewService.close(),
    capturePreview: () => browserPreviewService.capture(),
    clearBrowsingData: async () => {
      await clearNewbrainBrowserSessionData("persist:newbrain-browser");
      await clearBrowserHistory({ rootDir: workspaceStateRoot });
      return { ok: true, detail: "已清除内置浏览器数据与历史。" };
    },
    listHistory: async () => {
      const preferences = await getActiveDesktopPreferences();
      await assertBrowserHistoryAccess(preferences.browser.historyAccess, () =>
        askBrowserHistoryAccessDialog("访问浏览历史")
      );
      return listBrowserHistory({ rootDir: workspaceStateRoot });
    },
    removeHistoryEntry: async (id) => {
      const preferences = await getActiveDesktopPreferences();
      await assertBrowserHistoryAccess(preferences.browser.historyAccess, () =>
        askBrowserHistoryAccessDialog("删除浏览历史")
      );
      return removeBrowserHistoryEntry({ rootDir: workspaceStateRoot }, id);
    },
    clearHistory: async () => {
      const preferences = await getActiveDesktopPreferences();
      await assertBrowserHistoryAccess(preferences.browser.historyAccess, () =>
        askBrowserHistoryAccessDialog("清空浏览历史")
      );
      await clearBrowserHistory({ rootDir: workspaceStateRoot });
      return { ok: true };
    },
    selectDownloadDir: () => pickBrowserDownloadDirectory(),
    listCredentials: () => listBrowserCredentials({ rootDir: workspaceStateRoot }),
    upsertCredential: (input) => upsertBrowserCredential({ rootDir: workspaceStateRoot }, input),
    removeCredential: (id) => removeBrowserCredential({ rootDir: workspaceStateRoot }, id),
    listContacts: () => listBrowserContacts({ rootDir: workspaceStateRoot }),
    upsertContact: (input) => upsertBrowserContact({ rootDir: workspaceStateRoot }, input),
    removeContact: (id) => removeBrowserContact({ rootDir: workspaceStateRoot }, id),
    getCdpAccess: async () => {
      const preferences = await getActiveDesktopPreferences();
      return resolveBrowserCdpAccess({ fullCdpAccess: Boolean(preferences.browser.fullCdpAccess) });
    },
    probeSiteTools: async () => {
      const preferences = await getActiveDesktopPreferences();
      const pageUrl =
        previewWindowRef && !previewWindowRef.isDestroyed()
          ? previewWindowRef.webContents.getURL()
          : preferences.browser.previewUrl;
      return probeBrowserSiteTools({
        siteToolsEnabled: preferences.browser.siteToolsEnabled !== false,
        pageUrl
      });
    }
  });

  ipcMain.handle("phase1:save-mcp-servers", async (_event, servers: McpServerConfig[]) => {
    return writeMcpServers(servers);
  });

  ipcMain.handle("phase1:test-mcp-server", async (_event, server: McpServerConfig) => {
    return testMcpServer(normalizeMcpServer(server));
  });

  ipcMain.handle("phase1:start-mcp-server", async (_event, server: McpServerConfig) => {
    return startMcpServer(normalizeMcpServer(server));
  });

  ipcMain.handle("phase1:stop-mcp-server", async (_event, server: McpServerConfig) => {
    return stopMcpServer(normalizeMcpServer(server));
  });

  ipcMain.handle("phase1:get-mcp-server-logs", async (_event, serverId: string) => {
    return mcpRuntimeLogs.get(serverId) ?? [];
  });

  ipcMain.handle("phase1:clear-mcp-server-logs", async (_event, serverId: string) => {
    mcpRuntimeLogs.set(serverId, []);
    return [];
  });

  ipcMain.handle("phase1:inspect-mcp-server", async (_event, server: McpServerConfig) => {
    const normalized = normalizeMcpServer(server);
    const inspection = await inspectMcpServer(normalized);
    if (inspection.ok) {
      await persistMcpInspection(normalized, inspection);
    }
    return inspection;
  });

  ipcMain.handle("phase1:get-mcp-discovered-tools", async () => {
    return readMcpDiscoveredTools();
  });

  registerSystemIpcHandlers({
    getTools: () => getSystemTools().filter((tool) => tool.available),
    openTool: (input) => openSystemTool(input),
    openSkillLocation: (input) => openSkillLocation(input),
    openLogLocation: () => openLogLocation(),
    reportRendererFailure,
    reportRendererDiagnostic,
    synthesizeNovelSpeech: (input) => novelTtsService.synthesize(input),
    cancelNovelSpeech: () => {
      novelTtsService.cancel();
      return { ok: true as const };
    }
  });

  ipcMain.handle("phase1:get-policy-rules", async () => readPolicyRules());
  ipcMain.handle("phase1:save-policy-rules", async (_event, rules: DesktopPolicyRule[]) => {
    const normalized = await writePolicyRules(Array.isArray(rules) ? rules : []);
    codexStorage.appendLog({
      level: "info",
      target: "policy.rules.updated",
      body: `Saved ${normalized.length} policy rules.`,
      threadId: activeThreadId || undefined,
      processUuid
    });
    return normalized;
  });

  ipcMain.handle("phase1:call-mcp-tool", async (_event, input: { toolId: string; query: string }) => {
    const turnId = makeId("tool-turn");
    let activePair: { workspace: WorkspaceCatalogItem; thread: WorkspaceThreadRecord } | null = null;
    if (activeWorkspaceId && activeThreadId) {
      const catalog = await readWorkspaceCatalog();
      const workspace = catalog.workspaces.find((item) => item.id === activeWorkspaceId);
      const thread = workspace?.threads.find((item) => item.id === activeThreadId);
      if (workspace && thread) {
        activePair = { workspace, thread };
        await appendThreadEvents(workspace, thread, [createThreadEvent("tool_call", {
          toolId: input.toolId,
          query: input.query
        }, turnId)]);
      }
    }
    try {
      const result = await callMcpTool(input.toolId, input.query);
      if (activePair) {
        await appendThreadEvents(activePair.workspace, activePair.thread, [createThreadEvent("tool_result", {
          toolId: input.toolId,
          ok: result.ok,
          detail: result.detail,
          content: result.content
        }, turnId)]);
      }
      return result;
    } catch (error) {
      if (activePair) {
        await appendThreadEvents(activePair.workspace, activePair.thread, [createThreadEvent("error", {
          stage: "tool_call",
          toolId: input.toolId,
          message: error instanceof Error ? error.message : String(error)
        }, turnId)]);
      }
      throw error;
    }
  });

  ipcMain.handle("phase1:list-workspaces", async () => {
    const catalog = await readWorkspaceCatalog();
    await ensureCatalogState(catalog);
    return catalog.workspaces;
  });

  ipcMain.handle(
    "phase1:add-workspace",
    async (_event, input: { name: string; path: string }) => {
      const catalog = await addWorkspace(input);
      return catalog.workspaces;
    }
  );

  ipcMain.handle(
    "phase1:add-workspace-thread",
    async (_event, input: { workspaceId: string; title: string; summary: string; scope?: "project" | "chat" }) => {
      const catalog = await addWorkspaceThread(input);
      return catalog.workspaces;
    }
  );

  ipcMain.handle(
    "phase1:fork-workspace-thread",
    async (_event, input: {
      workspaceId: string;
      sourceThreadId: string;
      title: string;
      owner?: "planner" | "researcher" | "verifier" | "editor";
      instruction?: string;
    }) => {
      const catalog = await forkWorkspaceThread(input);
      return catalog.workspaces;
    }
  );

  ipcMain.handle(
    "phase1:run-delegated-agent",
    async (_event, input: { workspaceId: string; childThreadId: string }) => runDelegatedAgent(input)
  );

  ipcMain.handle(
    "phase1:merge-delegated-agent-results",
    async (_event, input: { workspaceId: string; parentThreadId: string; childThreadIds: string[] }) =>
      mergeDelegatedAgentResults(input)
  );

  ipcMain.handle("phase1:create-blank-workspace", async (_event, input: { name: string }) => {
    const catalog = await createBlankWorkspace(input);
    return catalog.workspaces;
  });

  ipcMain.handle("phase1:select-workspace-folder", async () => {
    return selectWorkspaceFolder();
  });

  ipcMain.handle("phase1:select-composer-images", async () => {
    return selectComposerImages();
  });

  ipcMain.handle("phase1:import-composer-attachments", async (_event, input: { paths: string[] }) => {
    return importComposerAttachments(Array.isArray(input?.paths) ? input.paths : []);
  });

  ipcMain.handle("phase1:show-input-context-menu", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? mainWindowRef;
    if (!window) return { ok: false };
    const menu = Menu.buildFromTemplate([
      { role: "cut", label: "剪切" },
      { role: "copy", label: "复制" },
      { role: "paste", label: "粘贴" },
      { type: "separator" },
      { role: "selectAll", label: "全选" }
    ]);
    menu.popup({ window });
    return { ok: true };
  });

  ipcMain.handle(
    "phase1:save-composer-clipboard-file",
    async (_event, input: { name: string; mimeType: string; data: ArrayBuffer }) => {
      const clipboardDirectory = join(workspaceStateRoot, "attachments");
      await fs.mkdir(clipboardDirectory, { recursive: true });
      const mimeExtension = input.mimeType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin";
      const sourceExtension = extname(input.name).replace(/[^a-z0-9.]/gi, "");
      const fileName = `${Date.now()}-${randomUUID()}${sourceExtension || `.${mimeExtension}`}`;
      const filePath = join(clipboardDirectory, fileName);
      await fs.writeFile(filePath, Buffer.from(input.data));
      return { name: input.name || fileName, path: filePath, url: await makeComposerPreviewUrl(filePath, input.mimeType) };
    }
  );

  ipcMain.handle("phase1:rename-workspace", async (_event, input: { workspaceId: string; name: string }) => {
    const catalog = await renameWorkspace(input);
    return catalog.workspaces;
  });

  ipcMain.handle("phase1:remove-workspace", async (_event, input: { workspaceId: string }) => {
    const catalog = await removeWorkspace(input);
    return catalog.workspaces;
  });

  ipcMain.handle("phase1:open-workspace-location", async (_event, input: { workspaceId: string; target: "finder" | "system" | "vscode" }) => {
    return openWorkspaceLocation(input);
  });

  ipcMain.handle("phase1:get-workspace-header-status", async (_event, workspaceId: string) => {
    return getWorkspaceHeaderStatus(workspaceId);
  });
  ipcMain.handle(
    "phase1:get-review-changes",
    async (_event, input: { workspaceId?: string; threadId?: string }) => getWorkspaceReviewChanges(input ?? {})
  );
  ipcMain.handle("phase1:get-workspace-branches", async (_event, workspaceId: string) => getWorkspaceBranches(workspaceId));
  ipcMain.handle("phase1:switch-workspace-branch", async (_event, input: { workspaceId: string; branch: string; create?: boolean }) => switchWorkspaceBranch(input));

  ipcMain.handle(
    "phase1:record-message-feedback",
    async (_event, input: { workspaceId?: string; threadId?: string; messageId: string; rating: "helpful" | "unhelpful" }) => {
      const targetWorkspaceId = input.workspaceId?.trim();
      const targetThreadId = input.threadId?.trim();
      if (!targetWorkspaceId || !targetThreadId) {
        throw new Error("record-message-feedback 缺少 workspaceId/threadId。");
      }
      const catalog = await readWorkspaceCatalog();
      const workspace = catalog.workspaces.find((item) => item.id === targetWorkspaceId);
      const thread = workspace?.threads.find((item) => item.id === targetThreadId);
      if (!workspace || !thread) throw new Error("Thread not found.");
      await appendThreadEvents(workspace, thread, [createThreadEvent("feedback", {
        messageId: input.messageId,
        rating: input.rating
      })]);
      await updateThreadMetadata({
        workspaceId: workspace.id,
        threadId: thread.id,
        lastEventSummary: input.rating === "helpful" ? "用户标记回复有帮助" : "用户标记回复没有帮助"
      });
      return { ok: true };
    }
  );

  ipcMain.handle(
    "phase1:create-workspace-worktree",
    async (_event, input: { workspaceId: string; branchName?: string }) => {
      return createWorkspaceGitWorktree(input);
    }
  );

  ipcMain.handle(
    "phase1:rename-workspace-thread",
    async (_event, input: { workspaceId: string; threadId: string; title: string; summary: string }) => {
      const catalog = await renameWorkspaceThread(input);
      return catalog.workspaces;
    }
  );

  ipcMain.handle(
    "phase1:delete-workspace-thread",
    async (_event, input: { workspaceId: string; threadId: string }) => {
      const catalog = await deleteWorkspaceThread(input);
      if (activeWorkspaceId === input.workspaceId && activeThreadId === input.threadId) {
        const workspace = catalog.workspaces.find((item) => item.id === input.workspaceId);
        const fallbackThread = workspace?.threads[0];
        if (workspace && fallbackThread) {
          await activateWorkspaceThread({ workspaceId: workspace.id, threadId: fallbackThread.id });
        } else {
          activeWorkspaceId = input.workspaceId;
          activeThreadId = "";
          runtime.setThreadState(createDefaultThreadState(workspace?.name || "workspace", "新对话"));
        }
      }
      return catalog.workspaces;
    }
  );

  ipcMain.handle(
    "phase1:activate-workspace-thread",
    async (_event, input: { workspaceId: string; threadId: string }) => {
      return activateWorkspaceThread(input);
    }
  );

  composeAndRegisterModelChat({
    concurrentModelTasks,
    canceledModelRequestIds,
    remoteAgentEventObservers,
    codexStorage,
    agentHostLoopBridge,
    agentTurnControlPlane,
    desktopErrorCollector,
    governmentWritingSpecificationService,
    userSkillRoot,
    userKnowledgeRoot,
    configuredGatewayBaseUrlEnv,
    platformLabel,
    shellLabel,
    activeWorkspaceId: () => activeWorkspaceId,
    activeThreadId: () => activeThreadId,
    getCachedAuthorizedModels: () => cachedAuthorizedModels,
    readAuthorizedDesktopModelConfig,
    resolveCustomModelEndpoint: (modelId: string) => customModelEndpointStore.find(modelId),
    readWorkspaceCatalog,
    readThreadState,
    writeThreadState,
    appendThreadEvents,
    createThreadEvent,
    updateThreadMetadata,
    createLocalRuntime,
    buildWorkspaceShellEnvWithPreferences,
    readPolicyRules,
    callModelApi,
    isRetryableModelGatewayError,
    readModelUsageTokens,
    saveRuntimeThreadState,
    publishAssistantActivity,
    appendDesktopDebugLog,
    appendDiagnosticsLog,
    readGatewayBaseUrl,
    readDesktopAuthState,
    refreshDesktopAccessToken: refreshDesktopAccessTokenForGateway,
    attachmentRoots: [join(workspaceStateRoot, "attachments")],
    getActiveDesktopPreferences,
    defaultDesktopPreferences,
    makeId,
    nowIso,
    getThreadEventLogPath,
    appendRolloutRecords,
    createRolloutEvent,
    toRolloutThreadEvent,
    createTimelineEvent,
    estimateMessageTokens,
    projectThreadEvents: appendThreadEvents,
    readThreadEvents: async (workspace, thread) => {
      const state = await readThreadState(workspace, thread);
      return state.events ?? [];
    },
    runtimeSetup: {
      userSkillRoot,
      readFeatureSkills: async () => (await readFeatureConfig()).skills,
      officialGovernmentWebService,
      desktopWebSearchClient,
      readWorkspaceCatalog,
      getActiveWorkspaceId: () => activeWorkspaceId,
      publishWorkspaceFilePreview: (event) => publishWorkspaceFilePreviewFromMain(mainWindowRef, event)
    },
    scheduleAutomaticUserKnowledgeSync
  });
}

function setupAppMenu(window: BrowserWindow) {
  const template: Array<MenuItemConstructorOptions> = [
    {
      label: "文件",
      submenu: [{ role: "quit", label: "退出" }]
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" }
      ]
    },
    {
      label: "查看",
      submenu: [
        {
          label: "后退",
          accelerator: "Alt+Left",
          enabled: window.webContents.canGoBack(),
          click: () => {
            if (window.webContents.canGoBack()) window.webContents.goBack();
          }
        },
        {
          label: "前进",
          accelerator: "Alt+Right",
          enabled: window.webContents.canGoForward(),
          click: () => {
            if (window.webContents.canGoForward()) window.webContents.goForward();
          }
        },
        { type: "separator" },
        { role: "reload", label: "重新加载" },
        { role: "forceReload", label: "强制重新加载" },
        { type: "separator" },
        { role: "resetZoom", label: "重置缩放" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "toggleDevTools", label: "开发者工具" }
      ]
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "close", label: "关闭" }
      ]
    },
    {
      label: "帮助",
      submenu: [{ role: "about", label: "关于 NewBrain" }]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(menu);
  } else {
    // Renderer already renders a custom menu bar; avoid duplicating it on Windows/Linux.
    Menu.setApplicationMenu(null);
    window.setMenuBarVisibility(false);
    window.setAutoHideMenuBar(true);
  }

  const refreshNavItems = () => {
    const currentMenu = Menu.getApplicationMenu();
    if (!currentMenu) return;
    const viewMenu = currentMenu.items.find((item) => item.label === "查看");
    if (!viewMenu?.submenu) return;
    const backItem = viewMenu.submenu.items.find((item) => item.label === "后退");
    const forwardItem = viewMenu.submenu.items.find((item) => item.label === "前进");
    if (backItem) backItem.enabled = window.webContents.canGoBack();
    if (forwardItem) forwardItem.enabled = window.webContents.canGoForward();
  };

  window.webContents.on("did-navigate", refreshNavItems);
  window.webContents.on("did-navigate-in-page", refreshNavItems);
}

const processQuitCoordinator = createAgentHostQuitCoordinator({
  shutdown: async () => {
    await Promise.all([agentHostClient.shutdown(), rustCoreService?.shutdown(), documentWorkerProcess.shutdown()]);
  },
  quit: () => app.quit(),
  onError: (error) => console.error("BRAIN process shutdown failed", error)
});
app.on("before-quit", (event) => processQuitCoordinator.beforeQuit(event));

app.whenReady().then(async () => {
  protocol.handle("newbrain-attachment", async (request) => {
    const attachmentRoot = resolve(workspaceStateRoot, "attachments");
    const fileName = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, "");
    const filePath = resolve(attachmentRoot, fileName);
    const relativePath = relative(attachmentRoot, filePath);
    if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      return new Response("Attachment not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).href);
  });
  try {
    let catalog = await readWorkspaceCatalog();
    catalog = await reconcileInterruptedThreads(catalog);
    await ensureCatalogState(catalog);

    const initialWorkspace = catalog.workspaces[0];
    const initialThread = initialWorkspace?.threads[0];
    if (initialWorkspace?.path) {
      await ensureDirectory(initialWorkspace.path);
    }
    activeShellEnv = await buildWorkspaceShellEnvWithPreferences(initialWorkspace);
    terminalSession.cwd = initialWorkspace?.path ?? workspacePath;

    runtime = await createLocalRuntime({
      runtimeId: "agentd-local",
      workspacePath: initialWorkspace?.path ?? workspacePath,
      platformLabel,
      shellLabel,
      shellEnv: activeShellEnv
    });
    runtime.setPolicyRules(await readPolicyRules());
    registerBrowserAgentTools();
    installBrowserAgentPolicyGate(runtime);
    await activateConfiguredPlugins();
    await syncMcpToolsToRuntime();
    await restoreEnabledMcpServers();
    for (const restoredTask of runtime.restoreDelegatedTasks(codexStorage.listDelegatedAgentTasks())) {
      codexStorage.upsertDelegatedAgentTask(restoredTask);
    }

    if (initialWorkspace && initialThread) {
      activeWorkspaceId = initialWorkspace.id;
      activeThreadId = initialThread.id;
      const threadState = await readThreadState(initialWorkspace, initialThread);
      runtime.setThreadState(threadState);
    }
    await queueStartupDailyBriefing();
  } catch (error) {
    await appendDesktopDebugLog(`startup runtime init failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    throw error;
  }

  registerIpc();
  ensureAutomationTimer();
  const mainWindow = createMainWindow();
  setupAppMenu(mainWindow);
  await applyDesktopPreferences(await getActiveDesktopPreferences());
  void quantStrategyScheduler.tick();
  quantStrategyTimer = setInterval(() => { void quantStrategyScheduler.tick(); }, 60_000);
  quantStrategyTimer.unref();
  void quantStrategyTaskRunner.tick();
  quantStrategyTaskTimer = setInterval(() => { void quantStrategyTaskRunner.tick(); }, 15_000);
  quantStrategyTaskTimer.unref();
  if (brainFlowExecution) {
    const flowScheduler = new FlowScheduler({
      store: { listEnabled: (ownerId) => brainWorkspaceStorage.listEnabledFlowSchedules(ownerId), claim: async (scheduleId, occurrence) => brainWorkspaceStorage.claimFlowScheduleOccurrence({ ownerId: await resolveBrainLocalOwnerId(), scheduleId, occurrence }), fail: async (scheduleId, occurrence, errorCode) => brainWorkspaceStorage.completeFlowScheduleOccurrence(await resolveBrainLocalOwnerId(), scheduleId, occurrence, errorCode), complete: async (scheduleId, occurrence) => brainWorkspaceStorage.completeFlowScheduleOccurrence(await resolveBrainLocalOwnerId(), scheduleId, occurrence) },
      resolveOwnerId: resolveBrainLocalOwnerId,
      getFlow: (ownerId, flowId) => brainWorkspaceStorage.getFlow(ownerId, flowId),
      execute: async (ownerId, flow) => { await brainFlowExecution!.start(ownerId, { flowId: flow.id }); }
    });
    void flowScheduler.tick();
    flowSchedulerTimer = setInterval(() => { void flowScheduler.tick(); }, 60_000);
    flowSchedulerTimer.unref();
  }
  const authStatus = await resolveDesktopAuthStatus();
  if (authStatus.authenticated) {
    void startDesktopBootstrapAfterAuth().catch((error) => {
      void appendDesktopDebugLog(
        `desktop bootstrap failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`
      );
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (terminalSession.process && terminalSession.isRunning) {
    terminalSession.process.kill();
    terminalSession.process = null;
    terminalSession.isRunning = false;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  if (quantStrategyTimer) clearInterval(quantStrategyTimer);
  quantStrategyTimer = null;
  if (quantStrategyTaskTimer) clearInterval(quantStrategyTaskTimer);
  quantStrategyTaskTimer = null;
  if (registeredPopupShortcut) {
    try { globalShortcut.unregister(registeredPopupShortcut); } catch { /* shortcut already released */ }
    registeredPopupShortcut = "";
  }
  for (const shortcut of registeredDictationShortcuts) {
    try { globalShortcut.unregister(shortcut); } catch { /* shortcut already released */ }
  }
  registeredDictationShortcuts.clear();
  globalShortcut.unregisterAll();
  for (const child of mcpRuntimeProcesses.values()) {
    try { child.kill("SIGTERM"); } catch { /* process already exited */ }
  }
  mcpRuntimeProcesses.clear();
  brainWorkspaceStorage.close();
  codexStorage.close();
});
