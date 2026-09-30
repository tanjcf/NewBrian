import { desktopIpcChannels } from "@codex-forge/protocol";
import type { CodexStorage } from "./codex-storage.js";
import { registerGoalIpcHandlers } from "./goal-ipc.js";
import { registerTerminalIpcHandlers } from "./terminal-ipc.js";
import { registerRuntimeControlIpcHandlers } from "./runtime-control-ipc.js";
import { registerCoreSessionIpcHandlers } from "./core-session-ipc.js";
import { CoreSessionService } from "./core-session-service.js";
import { RuntimeCommandService } from "./runtime-command-service.js";
import { ApprovalResumeService } from "./approval-resume-service.js";

interface DesktopSessionRuntimeCompositionDeps {
  appName: string;
  platformLabel: string;
  shellLabel: string;
  processUuid: string;
  codexStorage: CodexStorage;
  getActiveThreadId: () => string;
  getRuntime: () => any;
  readWorkspaceCatalog: () => Promise<any>;
  getActiveWorkspaceId: () => string;
  readThreadState: (workspace: any, thread: any) => Promise<any>;
  refreshRuntimeWorkspaceTree: (targetRuntime: any) => Promise<any>;
  buildSnapshotWithThreadState: (snapshot: any, threadState: any) => any;
  getActiveDesktopPreferences: () => Promise<any>;
  saveActiveThreadState: (summary?: string) => Promise<any>;
  appendRuntimeEventsSince: (offset: number) => Promise<any>;
  runPreferenceHookScript: (label: string, script: string) => Promise<any>;
  getActiveModelRequestId: () => string;
  getModelTask: (requestId: string) => any;
  markModelRequestCanceled: (requestId: string) => void;
  updateThreadMetadata: (input: any) => Promise<any>;
  getShellEnv: () => Record<string, string>;
  getConcurrentModelTasks: () => Map<string, any>;
  getActiveAgentModelCallback: () => any;
  clearActiveModelCallback: () => void;
  isRetryableModelGatewayError: (error: unknown) => boolean;
  publishAssistantActivity: (activity: any, requestId?: string) => void;
  appendActiveAssistantActivities: (activities: any[]) => Promise<any>;
  appendThreadEvents: (workspace: any, thread: any, events: any[]) => Promise<any>;
  createThreadEvent: (type: string, payload: any) => any;
  formatWrittenArtifactSummary: (workspacePath: string, artifacts: any[]) => string;
  appendRolloutRecords: (path: string, records: any[]) => Promise<any>;
  getThreadEventLogPath: (workspaceId: string, threadId: string) => string;
  createRolloutEvent: (input: any) => any;
  saveRuntimeThreadState: (
    runtime: any,
    workspace: any,
    thread: any,
    summary: string,
    options?: any
  ) => Promise<any>;
  disposeRuntime: (targetRuntime: any) => Promise<any>;
  removeModelTask: (requestId: string) => void;
  clearCanceledModelRequest: (requestId: string) => void;
  appendDesktopDebugLog: (message: string) => Promise<any>;
  observeRemoteAgentEvents: (requestId: string, events: Array<{ type: string; payload?: unknown }>) => void;
  getTerminalSession: () => any;
  writeTerminalInput: (input: string) => any;
  restartTerminalSession: () => any;
  cancelSpringTurn?: (input: {
    sessionId: string;
    turnId: string;
    reason: string;
  }) => Promise<unknown>;
  resolveSpringApproval?: (input: {
    approvalId: string;
    decision: "approve" | "deny";
  }) => Promise<{ sideEffectAllowed: boolean; offline?: boolean; status?: string }>;
  rememberApprovedCommand?: (input: { toolName: string; command: string }) => Promise<void> | void;
}

export function registerDesktopSessionRuntimeComposition(deps: DesktopSessionRuntimeCompositionDeps) {
  const coreSessionService = new CoreSessionService({
    appName: deps.appName,
    platform: deps.platformLabel,
    phase: "phase-1",
    shell: deps.shellLabel,
    getRuntime: () => deps.getRuntime(),
    getActiveThread: async () => {
      const catalog = await deps.readWorkspaceCatalog();
      const workspace = catalog.workspaces.find((item: { id: string }) => item.id === deps.getActiveWorkspaceId());
      return { workspace, thread: workspace?.threads.find((item: { id: string }) => item.id === deps.getActiveThreadId()) };
    },
    readThreadState: deps.readThreadState,
    refreshWorkspaceTree: deps.refreshRuntimeWorkspaceTree,
    mergeSnapshot: deps.buildSnapshotWithThreadState,
    getPreferences: deps.getActiveDesktopPreferences,
    saveActiveThreadState: deps.saveActiveThreadState,
    appendRuntimeEventsSince: deps.appendRuntimeEventsSince
  });
  const runtimeCommandService = new RuntimeCommandService({
    getRuntime: () => deps.getRuntime(),
    getPreferences: deps.getActiveDesktopPreferences,
    runHook: deps.runPreferenceHookScript,
    saveActiveThreadState: deps.saveActiveThreadState,
    appendRuntimeEventsSince: deps.appendRuntimeEventsSince,
    getActiveModelRequestId: deps.getActiveModelRequestId,
    getModelTask: deps.getModelTask,
    markModelRequestCanceled: deps.markModelRequestCanceled,
    removeModelTask: deps.removeModelTask,
    clearCanceledModelRequest: deps.clearCanceledModelRequest,
    updateThreadMetadata: deps.updateThreadMetadata,
    getShellEnv: deps.getShellEnv,
    cancelSpringTurn: deps.cancelSpringTurn
  });
  const approvalResumeService = new ApprovalResumeService({
    getTasks: deps.getConcurrentModelTasks,
    getActiveWorkspaceId: deps.getActiveWorkspaceId,
    getActiveThreadId: deps.getActiveThreadId,
    getDefaultRuntime: deps.getRuntime,
    getActiveModelCallback: deps.getActiveAgentModelCallback,
    clearActiveModelCallback: deps.clearActiveModelCallback,
    isRetryableError: deps.isRetryableModelGatewayError,
    publishActivity: deps.publishAssistantActivity,
    appendActiveActivities: deps.appendActiveAssistantActivities,
    readWorkspaceCatalog: deps.readWorkspaceCatalog,
    appendThreadEvents: deps.appendThreadEvents,
    createThreadEvent: (type, payload) => deps.createThreadEvent(type, payload),
    updateThreadMetadata: deps.updateThreadMetadata,
    formatWrittenArtifacts: deps.formatWrittenArtifactSummary,
    streamDeltaChannel: desktopIpcChannels.model.streamDelta,
    saveActiveThreadState: deps.saveActiveThreadState,
    appendRolloutRecords: deps.appendRolloutRecords,
    getThreadEventLogPath: deps.getThreadEventLogPath,
    createRolloutEvent: deps.createRolloutEvent,
    saveRuntimeThreadState: deps.saveRuntimeThreadState,
    readThreadState: deps.readThreadState,
    disposeRuntime: deps.disposeRuntime,
    removeTask: deps.removeModelTask,
    clearCanceledRequest: deps.clearCanceledModelRequest,
    appendDebugLog: deps.appendDesktopDebugLog,
    observeAgentEvents: deps.observeRemoteAgentEvents,
    resolveSpringApproval: deps.resolveSpringApproval,
    rememberApprovedCommand: deps.rememberApprovedCommand
  });
  registerGoalIpcHandlers({ storage: deps.codexStorage, getActiveThreadId: deps.getActiveThreadId, processUuid: deps.processUuid });
  registerTerminalIpcHandlers({
    getSession: deps.getTerminalSession,
    writeInput: deps.writeTerminalInput,
    restartSession: deps.restartTerminalSession,
    openSystem: (cwd) => runtimeCommandService.openSystemTerminal(cwd)
  });
  registerRuntimeControlIpcHandlers({
    cancelModelRequest: (input) => runtimeCommandService.cancelModelRequest(input),
    queueShellCommand: (command) => runtimeCommandService.queueShellCommand(command),
    respondApproval: (sender, input) => approvalResumeService.respond(sender, input)
  });
  registerCoreSessionIpcHandlers({
    bootstrap: () => coreSessionService.bootstrap(),
    getSnapshot: () => coreSessionService.snapshot(),
    queueWorkspaceScan: () => coreSessionService.queueWorkspaceScan(),
    queueGitStatus: () => coreSessionService.queueGitStatus(),
    generatePatch: (input) => coreSessionService.generatePatch(input),
    applyPatch: () => coreSessionService.applyPatch()
  });
  return { runtimeCommandService };
}
