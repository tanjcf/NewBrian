import { join } from "node:path";
import type { WebContents } from "electron";
import type {
  ModelConfig,
  PhaseOneSnapshot,
  WorkspaceCatalogItem,
  WorkspaceThreadRecord
} from "@codex-forge/protocol";
import { desktopIpcChannels } from "@codex-forge/protocol";
import { AgentHostLoopBridge } from "./agent-host-loop-bridge.js";
import type { AgentTurnControlPlaneService } from "./agent-turn-control-plane.js";
import type { CodexStorage } from "./codex-storage.js";
import type { DesktopErrorCollector } from "./desktop-error-collector.js";
import type { AuthorizedModel } from "./authorized-model-catalog.js";
import { GovernmentFinalizationService } from "./government-finalization-service.js";
import { GovernmentOutlineService } from "./government-outline-service.js";
import {
  advanceGovernmentPlanAfterSpecificationConfirm,
  advanceGovernmentPlanAfterSpecificationSaved,
  extractGovernmentWritingSpecificationFromTexts
} from "./government-writing-specification.js";
import { advanceGovernmentPlanAfterOutlineAnswer } from "./government-outline-decision.js";
import { buildGovernmentWritingInitialPlan } from "./government-goal-workflow.js";
import type { GovernmentWritingSpecificationService } from "./government-writing-specification-service.js";
import { registerGoalRuntimeTools } from "./goal-runtime-registration.js";
import { executeMediaGenerationTurn } from "./media-generation-turn.js";
import { ModelChatAgentLoopService } from "./model-chat-agent-loop-service.js";
import { createModelChatCompositionBindings } from "./model-chat-composition-bindings.js";
import { ModelChatContextService } from "./model-chat-context-service.js";
import { ModelChatEventProjector } from "./model-chat-event-projector.js";
import { ModelChatFailureService } from "./model-chat-failure-service.js";
import { ModelChatGoalService } from "./model-chat-goal-service.js";
import { registerModelChatIpcHandlers } from "./model-chat-ipc.js";
import { ModelChatPreparationService } from "./model-chat-preparation-service.js";
import {
  displaceThreadModelTasks,
  pruneStaleThreadModelTasks
} from "./thread-model-task-gate.ts";
import { buildModelChatSystemPrompt } from "./model-chat-prompt-policy.js";
import { buildModelChatResult } from "./model-chat-result-policy.js";
import { ModelChatRunPersistenceService } from "./model-chat-run-persistence-service.js";
import { ModelChatService } from "./model-chat-service.js";
import { ModelChatSkillService } from "./model-chat-skill-service.js";
import { selectModelChatSkills } from "./model-chat-skill-policy.js";
import { ModelChatStepService } from "./model-chat-step-service.js";
import { ModelChatSuccessService } from "./model-chat-success-service.js";
import { ModelChatTaskService } from "./model-chat-task-service.js";
import {
  containsPrivatePlanningNarration,
  extractPrivatePlanningNarration,
  sanitizeVisibleModelContent
} from "./model-stream-visibility.js";
import { resolveDevE2eBearerToken, selectModelRequestAuth } from "./model-request-auth-policy.js";
import { configureModelChatRuntime, openWorkspaceMediaForAgent, type ModelChatRuntimeSetupDependencies } from "./model-chat-runtime-setup.js";
import { registerAutoMediaAgentTools } from "./auto-media-agent-tools.js";
import {
  inferSkillRoutingHint,
  readSkillRoutingHintFromDir,
  type SkillRoutingHint
} from "./skill-routing.js";
import { loadProjectOsInstruction } from "./project-os-prompt-policy.js";
import {
  loadLocalKnowledgeForInjection,
  mirrorProjectRulesToGlobal
} from "./user-knowledge-sync.js";
import { extractTextAttachment } from "./attachment-text.js";

type LocalRuntime = Awaited<ReturnType<typeof import("../../../agentd/src/runtime.js").createLocalRuntime>>;

export interface MacModelChatCompositionDeps {
  concurrentModelTasks: Map<string, {
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
    runtime?: LocalRuntime;
    pendingGuidance?: unknown[];
    pendingFollowups?: unknown[];
    modelCallback?: unknown;
    writtenArtifacts?: unknown[];
    skillDisclosure?: string;
    springTurnId?: string;
    springSessionId?: string;
    springApprovalId?: string;
    springToolCallId?: string;
    mediaJobId?: string;
  }>;
  canceledModelRequestIds: Set<string>;
  remoteAgentEventObservers: Map<string, (event: { type: string; payload?: unknown }) => void>;
  codexStorage: CodexStorage;
  agentHostLoopBridge: AgentHostLoopBridge;
  agentTurnControlPlane: AgentTurnControlPlaneService;
  desktopErrorCollector: DesktopErrorCollector;
  governmentWritingSpecificationService: GovernmentWritingSpecificationService;
  userSkillRoot: string;
  userKnowledgeRoot: string;
  configuredGatewayBaseUrlEnv: string;
  platformLabel: string;
  shellLabel: string;
  activeWorkspaceId: () => string;
  activeThreadId: () => string;
  getCachedAuthorizedModels: () => AuthorizedModel[];
  readAuthorizedDesktopModelConfig: (candidate?: Partial<ModelConfig>) => Promise<ModelConfig>;
  resolveCustomModelEndpoint?: (modelId: string) => Promise<import("../shared/custom-model-endpoint.js").CustomModelEndpointPublic | null>;
  readWorkspaceCatalog: () => Promise<{ workspaces: WorkspaceCatalogItem[] }>;
  readThreadState: (workspace: WorkspaceCatalogItem, thread: WorkspaceThreadRecord) => Promise<ThreadStateFile>;
  writeThreadState: (workspace: WorkspaceCatalogItem, thread: WorkspaceThreadRecord, state: ThreadStateFile) => Promise<void>;
  appendThreadEvents: (workspace: WorkspaceCatalogItem, thread: WorkspaceThreadRecord, events: ThreadEventRecord[]) => Promise<void>;
  createThreadEvent: (type: ThreadEventRecord["type"], payload: Record<string, unknown>, turnId?: string) => ThreadEventRecord;
  updateThreadMetadata: (input: {
    workspaceId: string;
    threadId: string;
    status?: string;
    statusLabel?: string;
    lastEventSummary?: string;
  }) => Promise<unknown>;
  createLocalRuntime: (input: {
    runtimeId: string;
    workspacePath: string;
    platformLabel: string;
    shellLabel: string;
    shellEnv: Record<string, string>;
  }) => Promise<LocalRuntime>;
  buildWorkspaceShellEnvWithPreferences: (workspace: WorkspaceCatalogItem) => Promise<Record<string, string>>;
  readPolicyRules: () => Promise<DesktopPolicyRule[]>;
  callModelApi: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  isRetryableModelGatewayError: (error: unknown) => boolean;
  readModelUsageTokens: (usage: unknown) => number;
  saveRuntimeThreadState: (
    targetRuntime: LocalRuntime,
    workspace: WorkspaceCatalogItem,
    thread: WorkspaceThreadRecord,
    summary: string,
    options?: { skipMetadata?: boolean }
  ) => Promise<unknown>;
  publishAssistantActivity: (activity: Record<string, unknown>, requestId?: string) => void;
  appendDesktopDebugLog: (line: string) => Promise<unknown>;
  appendDiagnosticsLog: (line: string) => Promise<unknown>;
  readGatewayBaseUrl: () => Promise<string>;
  readDesktopAuthState: () => Promise<Record<string, unknown> | null>;
  refreshDesktopAccessToken?: () => Promise<string>;
  /** Managed composer attachment directories for Auto media reference images. */
  attachmentRoots?: string[];
  getActiveDesktopPreferences: () => Promise<{ personalization?: { autoSkillEnabled?: boolean } }>;
  defaultDesktopPreferences: { personalization?: { autoSkillEnabled?: boolean } };
  makeId: (prefix: string) => string;
  nowIso: () => string;
  getThreadEventLogPath: (workspaceId: string, threadId: string) => string;
  appendRolloutRecords: (path: string, records: unknown[]) => Promise<unknown>;
  createRolloutEvent: (input: Record<string, unknown>) => unknown;
  toRolloutThreadEvent: (threadId: string, event: ThreadEventRecord) => unknown;
  createTimelineEvent: (type: string, title: string, detail: string) => unknown;
  estimateMessageTokens: (messages: Array<{ content: string }>) => number;
  projectThreadEvents: (
    workspace: WorkspaceCatalogItem,
    thread: WorkspaceThreadRecord,
    events: ThreadEventRecord[]
  ) => Promise<unknown>;
  readThreadEvents: (
    workspace: WorkspaceCatalogItem,
    thread: WorkspaceThreadRecord
  ) => Promise<Array<{ type: string; payload?: unknown; turnId?: string }>>;
  runtimeSetup: ModelChatRuntimeSetupDependencies;
  scheduleAutomaticUserKnowledgeSync: (input?: {
    projectWorkspacePath?: string;
    projectKey?: string;
    delayMs?: number;
  }) => Promise<void>;
}

interface ThreadStateFile {
  version: number;
  messages: Array<{ role: string; content: string }>;
  events?: ThreadEventRecord[];
  timeline?: unknown[];
  memories?: unknown[];
  runs?: unknown[];
  context?: unknown;
  agentCheckpoint?: unknown;
}

interface ThreadEventRecord {
  type: string;
  payload?: Record<string, unknown>;
  turnId?: string;
}

interface DesktopPolicyRule {
  id: string;
  [key: string]: unknown;
}

export function composeAndRegisterModelChat(deps: MacModelChatCompositionDeps): { modelChatService: ModelChatService } {
  const modelChatPreparationService = new ModelChatPreparationService({
    isRequestActive: (requestId) => deps.concurrentModelTasks.has(requestId),
    isThreadActive: (workspaceId, threadId) => [...deps.concurrentModelTasks.values()].some(
      (task) => task.workspaceId === workspaceId && task.threadId === threadId
    ),
    releaseThreadTasks: (workspaceId, threadId) => {
      pruneStaleThreadModelTasks(deps.concurrentModelTasks, workspaceId, threadId);
      if (![...deps.concurrentModelTasks.values()].some(
        (task) => task.workspaceId === workspaceId && task.threadId === threadId
      )) {
        return 0;
      }
      return displaceThreadModelTasks({
        tasks: deps.concurrentModelTasks,
        workspaceId,
        threadId,
        reason: "Displaced by a newer user turn on the same thread.",
        markCanceled: (requestId) => { deps.canceledModelRequestIds.add(requestId); },
        clearCanceled: (requestId) => { deps.canceledModelRequestIds.delete(requestId); }
      });
    },
    readCatalog: deps.readWorkspaceCatalog,
    readAuthorizedModelConfig: deps.readAuthorizedDesktopModelConfig,
    resolveCustomModelEndpoint: deps.resolveCustomModelEndpoint,
    resolveSkillRoutingHints: async ({ workspaceId, selectedSkillNames }) => {
      const hints: SkillRoutingHint[] = [];
      const catalog = await deps.readWorkspaceCatalog();
      const workspace = catalog.workspaces.find((item) => item.id === workspaceId);
      const projectRoots = workspace?.path
        ? [join(workspace.path, "skills"), join(workspace.path, ".newbrain", "skills")]
        : [];

      const tryScope = async (
        skillName: string,
        roots: string[],
        scope: "project" | "user"
      ): Promise<SkillRoutingHint | undefined> => {
        const { promises: fs } = await import("node:fs");
        for (const root of roots) {
          const skillDir = join(root, skillName);
          try {
            await fs.access(join(skillDir, "routing.json"));
            return await readSkillRoutingHintFromDir({ skillDir, skillName, scope });
          } catch {
            // continue
          }
          try {
            await fs.access(join(skillDir, "SKILL.md"));
            return inferSkillRoutingHint(skillName, scope);
          } catch {
            // continue
          }
        }
        return undefined;
      };

      for (const skillName of selectedSkillNames) {
        const name = String(skillName || "").trim();
        if (!name) continue;
        const projectHint = await tryScope(name, projectRoots, "project");
        if (projectHint) {
          hints.push(projectHint);
          continue;
        }
        const userHint = await tryScope(name, [deps.userSkillRoot], "user");
        if (userHint) {
          hints.push(userHint);
          continue;
        }
        const inferred = inferSkillRoutingHint(name, "central");
        if (inferred) hints.push(inferred);
      }
      return hints;
    },
    resolveServerAutoRoute: async ({
      latestUserText,
      optimizeFor,
      selectedSkillNames,
      hasImageAttachments,
      requestId,
      workspaceId,
      threadId
    }) => {
      const authState = await deps.readDesktopAuthState().catch(() => null);
      const authSelection = selectModelRequestAuth(authState as never, "");
      let bearerToken = authSelection.bearerToken;
      if (!bearerToken) {
        bearerToken = resolveDevE2eBearerToken();
      }
      if (!bearerToken && deps.refreshDesktopAccessToken) {
        bearerToken = await deps.refreshDesktopAccessToken().catch(() => "");
      }
      if (!bearerToken) {
        if (process.env.NEWBRAIN_E2E_AUTH_BYPASS === "1") {
          throw new Error(
            "E2E Auto 路由缺少凭证：请设置 NEWBRAIN_MODEL_BASE_URL，或启用 NEWBRAIN_E2E_REMOTE_DEBUG_PORT 远程调试会话。"
          );
        }
        throw new Error("Auto 路由需要已登录的桌面会话（spring-app Bearer），请先登录。");
      }
      const gatewayBaseUrl = await deps.readGatewayBaseUrl();
      const { fetchSpringAppAutoRoute } = await import("./spring-app-auto-route.js");
      return fetchSpringAppAutoRoute({
        gatewayBaseUrl,
        bearerToken,
        latestUserText,
        optimizeFor,
        selectedSkillNames,
        hasImageAttachments,
        workspaceId,
        threadId,
        requestId,
        onCorrelationMismatch: (message) => {
          void deps.appendDesktopDebugLog(message);
          void deps.appendDiagnosticsLog(message);
        }
      });
    }
  });

  const modelChatGoalService = new ModelChatGoalService({
    storage: deps.codexStorage,
    selectSkills: selectModelChatSkills,
    buildGovernmentWritingInitialPlan,
    advancePlanAfterQuestionAnswer: advanceGovernmentPlanAfterOutlineAnswer,
    registerGoalRuntimeTools: (targetRuntime, threadId, skillNames) => {
      registerGoalRuntimeTools(deps.codexStorage, targetRuntime as LocalRuntime, threadId, skillNames);
    }
  });

  const modelChatSkillService = new ModelChatSkillService({
    appendDiagnostics: deps.appendDiagnosticsLog,
    appendDebugLog: deps.appendDesktopDebugLog,
    publishActivity: deps.publishAssistantActivity
  });

  const modelChatContextService = new ModelChatContextService({
    makeId: deps.makeId,
    nowIso: deps.nowIso,
    getEventLogPath: deps.getThreadEventLogPath,
    writeThreadState: deps.writeThreadState,
    callModel: (compactionInput) => deps.callModelApi(compactionInput as never)
  });

  const modelChatEventProjector = new ModelChatEventProjector();
  const modelChatStepService = new ModelChatStepService({
    callModel: (stepInput) => deps.callModelApi(stepInput as never),
    isRetryableError: deps.isRetryableModelGatewayError,
    readUsageTokens: deps.readModelUsageTokens,
    containsPrivatePlanning: containsPrivatePlanningNarration,
    sanitizeVisibleContent: sanitizeVisibleModelContent,
    extractPlanningNarration: extractPrivatePlanningNarration
  });

  const governmentOutlineService = new GovernmentOutlineService({
    storage: deps.codexStorage,
    readAuthorizedModelConfig: deps.readAuthorizedDesktopModelConfig,
    callModel: (outlineInput) => deps.callModelApi(outlineInput as never),
    appendDiagnostics: deps.appendDiagnosticsLog,
    extractAttachmentText: (filePath, extension) => extractTextAttachment(filePath, extension)
  });

  const governmentFinalizationService = new GovernmentFinalizationService({
    storage: deps.codexStorage,
    readAuthorizedModelConfig: deps.readAuthorizedDesktopModelConfig,
    callModel: (finalizationInput) => deps.callModelApi(finalizationInput as never),
    appendDiagnostics: deps.appendDiagnosticsLog,
    appendDebugLog: deps.appendDesktopDebugLog
  });

  const modelChatFailureService = new ModelChatFailureService({
    nowIso: deps.nowIso,
    readThreadState: deps.readThreadState,
    writeThreadState: deps.writeThreadState,
    createEvent: deps.createThreadEvent,
    appendEvents: deps.appendThreadEvents,
    updateMetadata: deps.updateThreadMetadata,
    reportFailure: (failure) => deps.desktopErrorCollector.report(failure)
  });

  const modelChatSuccessService = new ModelChatSuccessService({
    readThreadState: deps.readThreadState,
    writeThreadState: deps.writeThreadState,
    createEvent: deps.createThreadEvent,
    createTimelineEvent: deps.createTimelineEvent as never,
    getEventLogPath: deps.getThreadEventLogPath,
    appendEvents: deps.appendThreadEvents,
    appendDiagnostics: deps.appendDiagnosticsLog,
    onShadowLearned: async ({ workspace }) => {
      await mirrorProjectRulesToGlobal({
        userNewbrainRoot: deps.userKnowledgeRoot,
        projectWorkspacePath: workspace.path,
        projectKey: workspace.name || workspace.id
      }).catch(() => undefined);
      await deps.scheduleAutomaticUserKnowledgeSync({
        projectWorkspacePath: workspace.path,
        projectKey: workspace.name || workspace.id,
        delayMs: 2_000
      });
    },
    updateMetadata: deps.updateThreadMetadata
  });

  const modelChatAgentLoopService = new ModelChatAgentLoopService<
    PhaseOneSnapshot,
    Awaited<ReturnType<typeof deps.callModelApi>> & {
      awaitingApproval?: boolean;
      runtimeSnapshot?: PhaseOneSnapshot;
    }
  >({
    executeStep: (stepInput) => modelChatStepService.execute(stepInput as never),
    projectEvent: (projectionInput, event) => modelChatEventProjector.project(projectionInput as never, event as never),
    runOutline: (outlineInput) => governmentOutlineService.run(outlineInput as never),
    runFinalization: (finalizationInput) => governmentFinalizationService.run(finalizationInput as never),
    buildResult: (resultInput) => buildModelChatResult(resultInput as never)
  });

  const modelChatRunPersistenceService = new ModelChatRunPersistenceService({
    makeId: deps.makeId,
    nowIso: deps.nowIso,
    getEventLogPath: deps.getThreadEventLogPath,
    appendAuditRecords: deps.appendRolloutRecords,
    createAuditRecord: deps.createRolloutEvent as never,
    createThreadEvent: deps.createThreadEvent,
    toRolloutThreadEvent: deps.toRolloutThreadEvent,
    projectEvents: deps.projectThreadEvents,
    updateMetadata: deps.updateThreadMetadata as never,
    readThreadEvents: deps.readThreadEvents
  });

  const modelChatTaskService = new ModelChatTaskService<
    LocalRuntime,
    ThreadStateFile,
    DesktopPolicyRule
  >({
    canceledRequestIds: deps.canceledModelRequestIds,
    registerTask: (requestId, task) => { deps.concurrentModelTasks.set(requestId, task); },
    getTask: (requestId) => deps.concurrentModelTasks.get(requestId),
    removeTask: (requestId) => { deps.concurrentModelTasks.delete(requestId); },
    createRuntime: (runtimeInput) => deps.createLocalRuntime({ ...runtimeInput, platformLabel: deps.platformLabel, shellLabel: deps.shellLabel })
      .then((localRuntime) => deps.agentHostLoopBridge.createRuntime(localRuntime, { ...runtimeInput, platformLabel: deps.platformLabel, shellLabel: deps.shellLabel })),
    disposeRuntime: (targetRuntime) => deps.agentHostLoopBridge.disposeRuntime(targetRuntime),
    buildShellEnv: deps.buildWorkspaceShellEnvWithPreferences,
    configureRuntime: async (targetRuntime, workspace, thread) => {
      await configureModelChatRuntime(deps.runtimeSetup, targetRuntime as never, workspace, thread);
      registerAutoMediaAgentTools(targetRuntime as never, {
        workspaceId: workspace.id,
        threadId: thread.id,
        workspaceRoot: workspace.path,
        attachmentRoots: deps.attachmentRoots,
        openLocalMedia: async ({ kind, relativePath }) => {
          await openWorkspaceMediaForAgent(deps.runtimeSetup, kind, relativePath, { workspaceId: workspace.id });
        },
        resolveAbortSignal: () => {
          for (const task of deps.concurrentModelTasks.values()) {
            if (task.workspaceId === workspace.id && task.threadId === thread.id) {
              return task.abortController.signal;
            }
          }
          return undefined;
        },
        resolveGateway: async () => {
          let baseUrl = await deps.readGatewayBaseUrl();
          const authState = await deps.readDesktopAuthState();
          const authSelection = selectModelRequestAuth(authState as never, "");
          let bearerToken = authSelection.bearerToken;
          if (!bearerToken) {
            bearerToken = resolveDevE2eBearerToken();
          }
          if (authSelection.useGatewayBaseUrl) baseUrl = await deps.readGatewayBaseUrl();
          return { baseUrl: String(baseUrl || ""), bearerToken: String(bearerToken || "") };
        }
      });
    },
    readPolicyRules: deps.readPolicyRules,
    readThreadState: deps.readThreadState,
    appendDebugLog: deps.appendDesktopDebugLog
  });

  const modelChatCompositionBindings = createModelChatCompositionBindings({
    getTask: (requestId) => deps.concurrentModelTasks.get(requestId),
    getAgentEventObserver: (requestId) => deps.remoteAgentEventObservers.get(requestId),
    appendDebugLog: deps.appendDesktopDebugLog
  });

  const modelChatService = new ModelChatService({
    reasoningChannel: desktopIpcChannels.events.modelReasoningDelta,
    streamChannel: desktopIpcChannels.model.streamDelta,
    onHostModelProgress: () => deps.agentHostLoopBridge.notifyModelStreamProgress(),
    prepare: (input) => modelChatPreparationService.prepare(input),
    persistAutoDecision: async ({ workspace, thread, turnId, decision }) => {
      await deps.appendThreadEvents(workspace, thread, [
        deps.createThreadEvent("auto_decision", decision, turnId)
      ]);
    },
    startTask: async (input) => {
      const started = await modelChatTaskService.start(input);
      const task = deps.concurrentModelTasks.get(input.requestId);
      if (task) {
        void deps.agentTurnControlPlane.startTurn({
          sessionId: input.thread.id,
          idempotencyKey: input.requestId,
          clientMessageId: input.requestId,
          content: "",
          modelHint: "",
          workspaceId: input.workspace.id,
          requestId: input.requestId
        }).then((result) => {
          if (!result.turnId || result.offline) return;
          modelChatTaskService.patchScope(input.requestId, {
            springTurnId: result.turnId,
            springSessionId: result.sessionId || input.thread.id
          });
        }).catch(() => undefined);
      }
      return started;
    },
    bindTurnScope: (requestId, patch) => modelChatTaskService.patchScope(requestId, patch),
    startGoal: (input) => modelChatGoalService.start(input),
    isAutoSkillEnabled: async () => {
      const preferences = await deps.getActiveDesktopPreferences().catch(() => deps.defaultDesktopPreferences);
      return preferences.personalization?.autoSkillEnabled === true;
    },
    loadLocalKnowledgeText: async ({ workspace, projectKey }) => loadLocalKnowledgeForInjection({
      userNewbrainRoot: deps.userKnowledgeRoot,
      projectWorkspacePath: workspace.path,
      projectKey: projectKey || workspace.name || workspace.id
    }),
    loadProjectOs: async ({ workspace }) => loadProjectOsInstruction(workspace.path),
    loadSkills: (input) => modelChatSkillService.load(input),
    prepareContext: (input) => modelChatContextService.prepare(input as never) as never,
    buildSystemPrompt: (input) => buildModelChatSystemPrompt(input as never),
    getAuthorizedModels: () => deps.getCachedAuthorizedModels(),
    updateModelContext: (input) => modelChatContextService.updateModelContext(input),
    updateRunningMetadata: (workspaceId, threadId) => deps.updateThreadMetadata({
      workspaceId,
      threadId,
      status: "running",
      statusLabel: "运行中",
      lastEventSummary: "模型正在处理请求"
    }),
    runAgentLoop: (input) => modelChatAgentLoopService.run(input as never) as never,
    runMediaGeneration: async (input) => {
      let baseUrl = await deps.readGatewayBaseUrl();
      const authState = await deps.readDesktopAuthState();
      const authSelection = selectModelRequestAuth(authState as never, "");
      let bearerToken = authSelection.bearerToken;
      if (!bearerToken) {
        bearerToken = resolveDevE2eBearerToken();
      }
      if (authSelection.useGatewayBaseUrl) baseUrl = await deps.readGatewayBaseUrl();
      if (!bearerToken) {
        throw new Error("媒体生成需要已登录的网关凭证。");
      }
      if (!baseUrl) {
        throw new Error("媒体生成需要已配置的模型网关地址。");
      }
      const result = await executeMediaGenerationTurn({
        gatewayBaseUrl: baseUrl,
        bearerToken,
        kind: input.kind,
        model: input.model,
        prompt: input.prompt,
        imageUrl: input.imageUrl,
        requestId: input.requestId,
        workspaceId: input.workspaceId,
        threadId: input.threadId,
        turnId: input.turnId,
        toolName: input.toolName,
        mediaExecution: input.mediaExecution,
        signal: input.signal,
        onProgress: (job) => {
          input.onProgress?.(`任务 ${job.id} · ${job.state}`);
        },
        onJobId: (mediaJobId) => {
          input.onJobId?.(mediaJobId);
        },
        onCorrelationMismatch: (message) => {
          void deps.appendDesktopDebugLog(message);
          void deps.appendDiagnosticsLog(message);
        }
      });
      return { content: result.content };
    },
    persistRun: (input) => modelChatRunPersistenceService.persist(input),
    persistBoundaryEvents: (input) => modelChatRunPersistenceService.persistEvents(input),
    repairOrphanToolCalls: (input) => modelChatRunPersistenceService.repairOrphanToolCalls(input),
    persistCancellation: (workspace, thread, turnId) =>
      modelChatFailureService.persistCancellation(workspace, thread, turnId),
    persistFailure: (input) => modelChatFailureService.persistFailure(input),
    persistSuccess: (input) => modelChatSuccessService.persist(input as never),
    saveRuntimeState: (targetRuntime, workspace, thread, summary) =>
      deps.saveRuntimeThreadState(targetRuntime as LocalRuntime, workspace, thread, summary),
    getGoalSnapshot: (threadId) => deps.codexStorage.getGoalSnapshot(threadId),
    getGovernmentWritingSpecificationSnapshot: (threadId, goalId) =>
      deps.governmentWritingSpecificationService.getSnapshot(threadId, goalId),
    confirmGovernmentSpecificationFromChat: async (threadId, options) => {
      const goalSnapshot = deps.codexStorage.getGoalSnapshot(threadId);
      const goal = goalSnapshot?.goal;
      if (!goal || goal.status !== "active") {
        throw new Error("当前没有可确认的政务写作目标。");
      }
      let specification = deps.governmentWritingSpecificationService.getSnapshot(threadId, goal.goalId);
      if (!specification?.currentVersionId) {
        const candidates: string[] = [...(options?.candidateTexts ?? [])];
        try {
          const catalog = await deps.readWorkspaceCatalog();
          const workspace = catalog.workspaces.find((item) =>
            item.threads.some((thread) => thread.id === threadId)
          ) ?? catalog.workspaces.find((item) => item.id === deps.activeWorkspaceId());
          const thread = workspace?.threads.find((item) => item.id === threadId);
          if (workspace && thread) {
            const state = await deps.readThreadState(workspace, thread);
            for (const message of [...(state.messages ?? [])].reverse()) {
              if (message.role === "assistant" && String(message.content || "").trim()) {
                candidates.push(String(message.content));
              }
            }
          }
        } catch (error) {
          void deps.appendDesktopDebugLog(
            `government specification recovery read failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
        for (const step of [...goalSnapshot.plan].reverse()) {
          if (String(step.result || "").trim()) candidates.push(String(step.result));
        }
        const recovered = extractGovernmentWritingSpecificationFromTexts(candidates);
        if (!recovered) {
          throw new Error(
            "当前没有可确认的写作规格。请先等待助手输出完整写作规格（含可解析的 JSON），或在规格面板保存后再回复「确认」。"
          );
        }
        deps.governmentWritingSpecificationService.ensureCurrentVersionFromContent({
          threadId,
          goalId: goal.goalId,
          content: recovered,
          source: "model",
          changeSummary: "从对话内容恢复写作规格"
        });
        const afterRecover = deps.codexStorage.getGoalSnapshot(threadId) ?? goalSnapshot;
        if (afterRecover.plan.some((step) => step.stepId === "specification-confirmation")) {
          deps.codexStorage.replaceGoalPlan(
            threadId,
            goal.goalId,
            advanceGovernmentPlanAfterSpecificationSaved(afterRecover.plan)
          );
        }
        specification = deps.governmentWritingSpecificationService.getSnapshot(threadId, goal.goalId);
      }
      if (!specification?.currentVersionId) {
        throw new Error(
          "当前没有可确认的写作规格。请先等待助手输出完整写作规格（含可解析的 JSON），或在规格面板保存后再回复「确认」。"
        );
      }
      const confirmed = deps.governmentWritingSpecificationService.confirmVersion(
        threadId,
        goal.goalId,
        specification.currentVersionId
      );
      const latestGoal = deps.codexStorage.getGoalSnapshot(threadId) ?? goalSnapshot;
      if (latestGoal.plan.some((step) => step.stepId === "specification-confirmation")) {
        deps.codexStorage.replaceGoalPlan(
          threadId,
          goal.goalId,
          advanceGovernmentPlanAfterSpecificationConfirm(
            latestGoal.plan,
            confirmed.currentVersion.content.structure
          )
        );
      }
      return confirmed;
    },
    estimateTokens: (messages) => deps.estimateMessageTokens(messages as never),
    isCanceled: (requestId) => deps.canceledModelRequestIds.has(requestId),
    ...modelChatCompositionBindings,
    observeAgentEvents: (requestId, events) => {
      modelChatCompositionBindings.observeAgentEvents(requestId, events);
      const task = deps.concurrentModelTasks.get(requestId);
      if (!task?.springTurnId || !task.springSessionId) return;
      for (const event of events) {
        if (event.type !== "approval_requested") continue;
        const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
          ? event.payload as { call?: { id?: string; name?: string; arguments?: Record<string, unknown> }; message?: string }
          : null;
        const call = payload?.call;
        if (!call?.name) continue;
        void deps.agentTurnControlPlane.proposeTool({
          sessionId: task.springSessionId,
          turnId: task.springTurnId,
          toolCallId: typeof call.id === "string" ? call.id : undefined,
          name: call.name,
          arguments: call.arguments,
          risk: "high",
          sideEffectClass: "workspace",
          requiresApproval: true,
          approvalMessage: typeof payload?.message === "string" ? payload.message : undefined
        }).then((result) => {
          if (result.approvalId) task.springApprovalId = result.approvalId;
          if (result.toolCallId) task.springToolCallId = result.toolCallId;
        }).catch(() => undefined);
      }
    },
    publishActivity: (activity, requestId) => deps.publishAssistantActivity(activity, requestId),
    finishGoal: (session, fallbackTokens) => modelChatGoalService.finish(session, fallbackTokens),
    finishTask: async (requestId, options) => {
      const task = deps.concurrentModelTasks.get(requestId);
      const { waitingForApproval } = await modelChatTaskService.finish(requestId, options);
      if (task && !waitingForApproval) {
        if (task.springTurnId && task.springSessionId) {
          void deps.agentTurnControlPlane.completeTurn({
            sessionId: task.springSessionId,
            turnId: task.springTurnId
          }).catch(() => undefined);
        }
        await deps.updateThreadMetadata({
          workspaceId: task.workspaceId,
          threadId: task.threadId,
          status: "idle",
          statusLabel: "",
          lastEventSummary: "模型处理完成"
        });
      }
    },
    nowIso: deps.nowIso,
    makeId: deps.makeId
  });

  registerModelChatIpcHandlers({
    chat: (event, input) => modelChatService.chat(event.sender as WebContents, input)
  });

  return { modelChatService };
}
