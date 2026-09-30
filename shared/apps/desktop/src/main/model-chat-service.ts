import type {
  MemoryRecord,
  ModelChatInput,
  WorkspaceCatalogItem,
  WorkspaceThreadRecord
} from "@codex-forge/protocol";
import {
  buildTurnReplayMetadata,
  enrichBoundaryEventsForPersistence
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
} from "./agent-loop-boundary-persistence.ts";
import type { PersistedGoalSnapshot } from "./codex-storage.js";
import {
  isGovernmentResearchWritingSkill
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
} from "./central-skills.ts";
import type { ModelChatGoalRuntime, ModelChatGoalSession } from "./model-chat-goal-service.js";
import type { LoadedModelSkill } from "./model-chat-skill-service.js";
import type { NativeWebSearchProjection } from "./model-chat-step-service.js";
import type { WrittenArtifact } from "./output-summary.js";
import type { SkillDescriptor } from "./skill-selection.js";
import type { ThreadStateFile } from "./thread-state-factory.js";
import { isAutoModelFallbackEnabled, isModelAutoSelection, MODEL_AUTO_ID } from "./model-auto-router.ts";
import { resolveAutoParentDisplayName } from "./auto-parent-display-policy.ts";
import {
  resolveMediaGenerationKind,
  shouldRunMediaGenerationTurn
} from "./media-generation-turn.ts";
import type { MediaGenerationKind } from "./media-generation-gateway.ts";
import {
  ModelChatTiming,
  type ModelChatTimingMark,
  type ModelChatTimingStage
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
} from "./model-chat-timing.ts";
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
import { expandLetterChoiceRequest } from "./letter-choice-policy.ts";
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
import { appendAutoDelegateTurnConstraint } from "./auto-orchestrator-policy.ts";

function orphanToolRepairContext(
  runtime: { sessionMachine?: { events?: unknown[] } },
  error?: unknown
): {
  failureReason?: string;
  supplementalEvents: Array<{ type: string; payload?: unknown; turnId?: string }>;
} {
  const failureReason = error instanceof Error
    ? error.message
    : error != null
      ? String(error)
      : undefined;
  const supplementalEvents = (runtime.sessionMachine?.events ?? [])
    .filter((event): event is Record<string, unknown> =>
      typeof event === "object" && event !== null && typeof (event as { type?: unknown }).type === "string"
    )
    .map((event) => ({
      type: String(event.type),
      payload: event.payload,
      turnId: typeof event.turnId === "string" ? event.turnId : undefined
    }));
  return { failureReason, supplementalEvents };
}

interface ModelChatRuntime extends ModelChatGoalRuntime {
  getToolDescriptors(): Array<{
    name: string;
    kind?: string;
    risk?: string;
    requiresApproval?: boolean;
    replaySafe?: boolean;
  }>;
  loadSkill(name: string): Promise<LoadedModelSkill>;
  searchMemories(query: string, options: { limit: number }): MemoryRecord[];
  setThreadState(state: ThreadStateFile): unknown;
  getAgentLoopSnapshot(): { status: string } | null;
  rememberExchangeWithShadow(input: { user: string; assistant: string; scope: "session" }): Promise<{
    memory?: MemoryRecord | null;
    shadow: {
      changed: string[];
      skillName: string;
      threadDeliveryPreferences?: ThreadStateFile["deliveryPreferences"];
      deliveryPreferencesText?: string;
    };
  }>;
  prepareShadowLearning?(user: string): Promise<{
    shouldAsk?: boolean;
    openQuestions?: string[];
    personalizationGuidance?: string;
    deliveryPreferencesText?: string;
    changed?: string[];
  }>;
  getMemories(): MemoryRecord[];
  getDeliveryPreferences?(): ThreadStateFile["deliveryPreferences"];
}

interface ModelChatResult {
  content: string;
  reasoningSummary: string;
  toolCalls: unknown[];
  webSearchCalls: unknown[];
  citations: unknown[];
  usage?: unknown;
  awaitingApproval?: boolean;
  runtimeSnapshot?: unknown;
  softStopReason?: "max_steps";
}

interface AgentLoopRun {
  skillDisclosure: string;
  canonicalContent: string;
  result: ModelChatResult;
  loopSnapshot: {
    status: string;
    pending: null | { call: { name: string } };
  };
  agentEvents: Array<{ type: string; timestamp?: string; payload?: unknown }>;
  flushedEventCount?: number;
}

export interface ModelChatSender {
  send(channel: string, payload: unknown): void;
}

export interface ModelChatRemoteExecutionContext {
  workItemId: string;
  knowledgeSnapshotId?: string;
  allowedToolNames: string[];
}

export function reconcileStreamedContent(streamedContent: string, canonicalContent: string) {
  if (!canonicalContent || canonicalContent === streamedContent) return [];
  if (canonicalContent.startsWith(streamedContent)) {
    return [{ delta: canonicalContent.slice(streamedContent.length) }];
  }
  return [{ delta: "", reset: true }, { delta: canonicalContent }];
}

export interface ModelChatServiceDependencies {
  reasoningChannel: string;
  streamChannel: string;
  /** Renew agent-host model inactivity while stream/reasoning deltas are flowing. */
  onHostModelProgress?: () => void;
  prepare: (input: ModelChatInput) => Promise<{
    input: ModelChatInput;
    workspace: WorkspaceCatalogItem;
    thread: WorkspaceThreadRecord;
    autoDecision?: {
      mode: string;
      task_class?: string;
      model: {
        requested: string;
        selected: string;
        reason_codes: string[];
        fallback_chain: string[];
        fallback_index: number;
      };
      notes?: string;
      [key: string]: unknown;
    };
    autoParentDisplayName?: string;
  }>;
  persistAutoDecision?: (input: {
    workspace: WorkspaceCatalogItem;
    thread: WorkspaceThreadRecord;
    turnId: string;
    model?: string;
    decision: Record<string, unknown>;
  }) => Promise<unknown>;
  startTask: (input: {
    requestId: string;
    workspace: WorkspaceCatalogItem;
    thread: WorkspaceThreadRecord;
    abortController: AbortController;
    turnId?: string;
  }) => Promise<{
    runtime: ModelChatRuntime;
    initialThreadState: ThreadStateFile;
    scope: {
      workspaceId: string;
      threadId: string;
      requestId: string;
      turnId: string;
      runtimeId?: string;
      springSessionId?: string;
      springTurnId?: string;
      mediaJobId?: string;
    };
  }>;
  bindTurnScope?: (
    requestId: string,
    patch: Partial<{
      turnId: string;
      runtimeId: string;
      springSessionId: string;
      springTurnId: string;
      mediaJobId: string;
    }>
  ) => unknown;
  startGoal: (input: {
    modelInput: ModelChatInput;
    runtime: ModelChatRuntime;
    threadId: string;
    turnId: string;
    latestUserRequest: string;
    autoSkillEnabled?: boolean;
  }) => ModelChatGoalSession;
  /** Settings personalization.autoSkillEnabled — defaults to false when omitted. */
  isAutoSkillEnabled?: () => boolean | Promise<boolean>;
  /** Load disk-cached global + project knowledge for every-turn injection (no network). */
  loadLocalKnowledgeText?: (input: {
    workspace: WorkspaceCatalogItem;
    projectKey?: string;
  }) => Promise<string> | string;
  loadSceneKnowledgeText?: (input: { workspace: WorkspaceCatalogItem; query: string }) => Promise<string> | string;
  /** Load repo-root Project OS (NEWBRAIN.md / CLAUDE.md / AGENTS.md). */
  loadProjectOs?: (input: {
    workspace: WorkspaceCatalogItem;
  }) => Promise<{ sourceFile: string | null; text: string } | string> | { sourceFile: string | null; text: string } | string;
  loadSkills: (input: {
    requestId: string;
    selectedLocalSkillNames: string[];
    centralSkillNames: string[];
    loadSkill: (name: string) => Promise<LoadedModelSkill>;
  }) => Promise<{
    loadedLocalSkills: LoadedModelSkill[];
    disclosedSkills: SkillDescriptor[];
    disclosure: string;
  }>;
  /** Resolve Expert Marketplace summon bound to the current thread (optional). */
  resolveExpertSummon?: (input: {
    workspace: WorkspaceCatalogItem;
    thread: WorkspaceThreadRecord;
  }) => Promise<{
    expertId: string;
    profession: string;
    displayName: string;
    skillNames: string[];
    systemInstruction: string;
    allowedDelegateRoles: string[];
  } | null> | {
    expertId: string;
    profession: string;
    displayName: string;
    skillNames: string[];
    systemInstruction: string;
    allowedDelegateRoles: string[];
  } | null;
  /** Catalog + usage text so skills can decide whether to summon experts. */
  loadSkillExpertBridgeInstruction?: (input: {
    workspace: WorkspaceCatalogItem;
    thread: WorkspaceThreadRecord;
    skillNames: string[];
  }) => Promise<string> | string;
  prepareContext: (input: {
    workspace: WorkspaceCatalogItem;
    thread: WorkspaceThreadRecord;
    state: ThreadStateFile;
    messages: ModelChatInput["messages"];
    persistedAt: string;
    turnId: string;
    loadedSkills: LoadedModelSkill[];
    disclosedSkills: SkillDescriptor[];
    recalledMemories: MemoryRecord[];
    modelInput: ModelChatInput;
    abortSignal: AbortSignal;
    setRuntimeState: (state: ThreadStateFile) => void;
  }) => Promise<{ state: ThreadStateFile; requestMessages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
    reasoningSummary?: string;
    attachments?: unknown[];
  }> }>;
  buildSystemPrompt: (input: Record<string, unknown>) => string;
  /** Optional authorized model catalog for main-agent economics briefing. */
  getAuthorizedModels?: () => Array<Record<string, unknown>>;
  updateModelContext: (input: {
    workspace: WorkspaceCatalogItem;
    thread: WorkspaceThreadRecord;
    state: ThreadStateFile;
    turnId: string;
    systemPrompt: string;
    provider: string;
    model: string;
    setRuntimeState: (state: ThreadStateFile) => void;
  }) => Promise<ThreadStateFile>;
  updateRunningMetadata: (workspaceId: string, threadId: string) => Promise<unknown>;
  runAgentLoop: (input: Record<string, unknown>) => Promise<AgentLoopRun>;
  /**
   * Optional spring-app media generation short-circuit.
   * Image/video prefer Auto tools (image_generate / video_generate) on spring-app.
   * When omitted, specialty intents still fall through to the agent loop.
   */
  runMediaGeneration?: (input: {
    kind: MediaGenerationKind;
    model: string;
    prompt: string;
    imageUrl?: string;
    requestId: string;
    workspaceId?: string;
    threadId?: string;
    turnId?: string;
    toolName?: string;
    mediaExecution?: "server" | "client";
    signal: AbortSignal;
    onProgress?: (detail: string) => void;
    onJobId?: (mediaJobId: string) => void;
  }) => Promise<{ content: string }>;
  persistRun: (input: {
    workspace: WorkspaceCatalogItem;
    thread: WorkspaceThreadRecord;
    turnId: string;
    agentEvents: AgentLoopRun["agentEvents"];
    nativeWebSearches: NativeWebSearchProjection[];
    awaitingApproval: boolean;
    pendingToolName?: string;
    toolDescriptors?: Array<{ name: string; kind?: string; risk?: string; requiresApproval?: boolean; replaySafe?: boolean }>;
    replayMetadata?: { hadPotentialSideEffects: boolean; replaySafe: boolean } | null;
  }) => Promise<unknown>;
  persistBoundaryEvents?: (input: {
    workspace: WorkspaceCatalogItem;
    thread: WorkspaceThreadRecord;
    turnId: string;
    agentEvents: AgentLoopRun["agentEvents"];
    awaitingApproval?: boolean;
    pendingToolName?: string;
    toolDescriptors?: Array<{ name: string; kind?: string; risk?: string; requiresApproval?: boolean; replaySafe?: boolean }>;
  }) => Promise<unknown>;
  repairOrphanToolCalls?: (input: {
    workspace: WorkspaceCatalogItem;
    thread: WorkspaceThreadRecord;
    turnId: string;
    failureReason?: string;
    supplementalEvents?: Array<{ type: string; payload?: unknown; turnId?: string }>;
  }) => Promise<unknown>;
  persistCancellation: (workspace: WorkspaceCatalogItem, thread: WorkspaceThreadRecord, turnId: string) => Promise<unknown>;
  persistFailure: (input: {
    workspace: WorkspaceCatalogItem;
    thread: WorkspaceThreadRecord;
    requestId: string;
    turnId: string;
    reasoningSummary: string;
    partialContent?: string;
    error: unknown;
  }) => Promise<unknown>;
  persistSuccess: (input: {
    workspace: WorkspaceCatalogItem;
    thread: WorkspaceThreadRecord;
    turnId: string;
    latestUserRequest: string;
    result: ModelChatResult;
    reasoningSummary: string;
    nativeWebSearches: NativeWebSearchProjection[];
    waitingForApproval: boolean;
    saveRuntimeState: (summary: string) => Promise<unknown>;
    rememberExchange: ModelChatRuntime["rememberExchangeWithShadow"];
    getMemories: () => MemoryRecord[];
  }) => Promise<unknown>;
  saveRuntimeState: (
    runtime: ModelChatRuntime,
    workspace: WorkspaceCatalogItem,
    thread: WorkspaceThreadRecord,
    summary: string
  ) => Promise<unknown>;
  getGoalSnapshot: (threadId: string) => PersistedGoalSnapshot | null;
  getGovernmentWritingSpecificationSnapshot: (threadId: string, goalId: string) => unknown;
  confirmGovernmentSpecificationFromChat?: (
    threadId: string,
    options?: { candidateTexts?: string[] }
  ) => Promise<{
    currentVersionId?: string;
    confirmedVersionId?: string;
    currentVersion?: { content?: unknown };
  }>;
  estimateTokens: (messages: Array<{ content: string }>) => number;
  isCanceled: (requestId: string) => boolean;
  attachArtifacts: (requestId: string, artifacts: WrittenArtifact[]) => void;
  attachSkillDisclosure: (requestId: string, disclosure: string) => void;
  setModelCallback: (requestId: string, callback: unknown) => void;
  publishActivity: (activity: { type: "run" | "complete"; title: string; detail: string }, requestId?: string) => void;
  finishGoal: (session: ModelChatGoalSession, fallbackTokens: number) => void;
  finishTask: (requestId: string, options: { retainForApproval: boolean }) => void | Promise<void>;
  observePreTaskFailure?: (input: {
    requestId: string;
    workspaceId?: string;
    threadId?: string;
    error: unknown;
  }) => void | Promise<void>;
  observeAgentEvents?: (requestId: string, events: AgentLoopRun["agentEvents"]) => void;
  observeTiming?: (mark: ModelChatTimingMark) => void;
  nowMs?: () => number;
  nowIso: () => string;
  makeId: (prefix: string) => string;
}

/** Coordinates one model-chat turn by composing bounded application services. */
export class ModelChatService {
  private readonly dependencies: ModelChatServiceDependencies;

  constructor(dependencies: ModelChatServiceDependencies) {
    this.dependencies = dependencies;
  }

  async chat(
    sender: ModelChatSender,
    originalInput: ModelChatInput,
    remoteExecutionContext?: ModelChatRemoteExecutionContext
  ) {
    const abortController = new AbortController();
    let input = originalInput;
    let goalSession: ModelChatGoalSession | null = null;
    let streamedContent = "";
    let fallbackGoalTokens = 0;
    let retainForApproval = false;
    let firstDeltaObserved = false;
    const timing = new ModelChatTiming({
      requestId: originalInput.requestId,
      now: this.dependencies.nowMs
    });
    const markTiming = (stage: ModelChatTimingStage) => {
      this.dependencies.observeTiming?.(timing.mark(stage));
    };
    let taskStarted = false;
    try {
      const prepared = await this.dependencies.prepare(input);
      markTiming("prepared");
      input = prepared.input;
      const { workspace, thread } = prepared;
      const turnId = this.dependencies.makeId("turn");
      const { runtime, initialThreadState, scope } = await this.dependencies.startTask({
        requestId: input.requestId,
        workspace,
        thread,
        abortController,
        turnId
      });
      taskStarted = true;
      markTiming("task-started");
      const persistedAt = this.dependencies.nowIso();
      const reasoningSummaryParts: string[] = [];
      const emitReasoningSummary = (delta: string) => {
        if (!delta) return;
        reasoningSummaryParts.push(delta);
        sender.send(this.dependencies.reasoningChannel, { requestId: input.requestId, delta });
        this.dependencies.onHostModelProgress?.();
        // Mirror milestone-sized process lines into the activity lane. Skip token-sized
        // model reasoning chunks so the panel is not flooded.
        const line = delta.replace(/\s+/g, " ").trim();
        if (line.length >= 12 && (/\n/.test(delta) || line.length >= 40)) {
          this.dependencies.publishActivity({
            type: "complete",
            title: "思考过程",
            detail: line.slice(0, 500)
          }, input.requestId);
        }
      };
      // Seed the visible thinking panel immediately so the marked process area is never blank
      // while skills/context/model setup are still running.
      emitReasoningSummary("正在分析请求目标、约束与当前上下文，过程会持续更新。\n");
      if (prepared.autoDecision?.mode === "auto" || String(prepared.autoDecision?.model?.requested || "").toLowerCase() === "auto") {
        const decision = prepared.autoDecision;
        const parentAutoLabel = resolveAutoParentDisplayName(prepared.autoParentDisplayName);
        const optimize = decision.optimize_for ? `，Optimize=${decision.optimize_for}` : "";
        emitReasoningSummary(
          `大模型 Auto：任务=${decision.task_class || "general"}，编排 ${parentAutoLabel}${optimize}`
          + `（出站 model=auto，由网关按订阅选型并记账${decision.notes ? `；${decision.notes}` : ""}）。\n`
        );
        this.dependencies.publishActivity({
          type: "complete",
          title: "大模型 Auto",
          detail: `auto → ${parentAutoLabel} · ${decision.task_class || "general"}${decision.optimize_for ? ` · ${decision.optimize_for}` : ""}`
        }, input.requestId);
        await this.dependencies.persistAutoDecision?.({
          workspace,
          thread,
          turnId,
          decision: decision as Record<string, unknown>
        });
      } else if (prepared.autoDecision?.mode === "manual" && (prepared.autoDecision.warnings?.length || prepared.autoDecision.notes?.includes("可能"))) {
        const decision = prepared.autoDecision;
        const warningText = (decision.warnings?.length ? decision.warnings.join("；") : decision.notes) || "";
        if (warningText) {
          emitReasoningSummary(`固定模型：${decision.model.selected}。${warningText}\n`);
          this.dependencies.publishActivity({
            type: "complete",
            title: "固定模型提示",
            detail: warningText.slice(0, 500)
          }, input.requestId);
        }
      }
      const rawLatestUserRequest = [...input.messages].reverse().find((message) => message.role === "user")?.content ?? "";
      const letterChoice = expandLetterChoiceRequest(rawLatestUserRequest, input.messages);
      const latestUserRequest = letterChoice.request;
      if (letterChoice.expanded) {
        emitReasoningSummary(
          letterChoice.letter
            ? `已识别选项 ${letterChoice.letter}${letterChoice.optionText ? `：${letterChoice.optionText}` : ""}，将直接执行而不是重复提问。\n`
            : "已识别重复选项抱怨，将按已完成进度继续推进。\n"
        );
      }
      // Auto: model chooses image_generate/video_generate via tool_calls — never short-circuit.
      // Pinned models may still use the legacy media short-circuit path.
      const mediaKind = !isModelAutoSelection(input.model)
        && this.dependencies.runMediaGeneration
        && shouldRunMediaGenerationTurn({ autoDecision: prepared.autoDecision })
        ? resolveMediaGenerationKind({ autoDecision: prepared.autoDecision })
        : null;
      if (mediaKind && this.dependencies.runMediaGeneration) {
        const mediaModel = String(prepared.autoDecision?.model.selected || input.model || "").trim();
        const latestUser = [...(input.messages ?? [])].reverse().find((message) => message.role === "user");
        const imageUrl = (latestUser?.attachments ?? [])
          .map((item) => String((item as { url?: string }).url || "").trim())
          .find((url) => /^https?:\/\//i.test(url) || /^data:image\//i.test(url));
        const mediaTool = prepared.autoDecision?.media_tool;
        const toolLabel = mediaTool?.tool_name
          || (mediaKind === "image" ? "image_generate" : mediaKind === "video" ? "video_generate" : mediaKind);
        emitReasoningSummary(
          `已识别${mediaKind === "image" ? "图片" : mediaKind === "video" ? "视频" : mediaKind === "music" ? "音乐" : "3D"}生成请求：`
          + `父 Auto 选型${mediaModel ? `（建议 ${mediaModel}）` : ""}，子工具 \`${toolLabel}\` 在 spring-app 执行`
          + `（效果优先、成本其次；密钥与多厂商适配在网关，禁止本地 curl/搜 key）。\n`
        );
        this.dependencies.publishActivity({
          type: "run",
          title: "媒体生成",
          detail: `父 Auto → 子工具 ${toolLabel}${mediaModel ? `（${mediaModel}）` : ""}…`
        }, input.requestId);
        try {
          const mediaResult = await this.dependencies.runMediaGeneration({
            kind: mediaKind,
            model: mediaModel,
            prompt: latestUserRequest || "generate",
            imageUrl,
            requestId: input.requestId,
            workspaceId: scope.workspaceId,
            threadId: scope.threadId,
            turnId: scope.turnId || turnId,
            toolName: mediaTool?.tool_name,
            mediaExecution: mediaTool?.execution,
            signal: abortController.signal,
            onProgress: (detail) => {
              this.dependencies.onHostModelProgress?.();
              this.dependencies.publishActivity({
                type: "run",
                title: "媒体生成进度",
                detail
              }, input.requestId);
              emitReasoningSummary(`${detail}\n`);
            },
            onJobId: (mediaJobId) => {
              this.dependencies.bindTurnScope?.(input.requestId, { mediaJobId });
            }
          });
          streamedContent = mediaResult.content;
          sender.send(this.dependencies.streamChannel, {
            requestId: input.requestId,
            delta: "",
            reset: true
          });
          sender.send(this.dependencies.streamChannel, {
            requestId: input.requestId,
            delta: mediaResult.content
          });
          const result: ModelChatResult = {
            content: mediaResult.content,
            reasoningSummary: reasoningSummaryParts.join(""),
            toolCalls: [],
            webSearchCalls: [],
            citations: []
          };
          await this.dependencies.persistSuccess({
            workspace,
            thread,
            turnId,
            model: mediaModel,
            latestUserRequest,
            result,
            reasoningSummary: reasoningSummaryParts.join(""),
            nativeWebSearches: [],
            waitingForApproval: false,
            saveRuntimeState: (summary) => this.dependencies.saveRuntimeState(runtime, workspace, thread, summary),
            rememberExchange: runtime.rememberExchangeWithShadow.bind(runtime),
            getMemories: () => runtime.getMemories()
          });
          this.dependencies.publishActivity({
            type: "complete",
            title: "媒体生成完成",
            detail: mediaResult.content.slice(0, 400)
          }, input.requestId);
          return result;
        } catch (error) {
          if (this.dependencies.isCanceled(input.requestId)) {
            await this.dependencies.persistCancellation(workspace, thread, turnId);
            throw error;
          }
          await this.dependencies.persistFailure({
            workspace,
            thread,
            requestId: input.requestId,
            turnId,
            reasoningSummary: reasoningSummaryParts.join(""),
            partialContent: streamedContent,
            error
          });
          throw error;
        }
      }
      const autoSkillEnabled = Boolean(await this.dependencies.isAutoSkillEnabled?.());
      goalSession = this.dependencies.startGoal({
        modelInput: input,
        runtime,
        threadId: thread.id,
        turnId,
        latestUserRequest,
        autoSkillEnabled
      });
      const {
        explicitSkillNames,
        composerModes,
        centralSkillNames,
        selectedLocalSkillNames: goalSelectedLocalSkillNames,
        goalRuntimeRequested,
        goalRuntimeEnabled,
        goalSnapshot
      } = goalSession;
      const expertSummon = typeof this.dependencies.resolveExpertSummon === "function"
        ? await this.dependencies.resolveExpertSummon({ workspace, thread })
        : null;
      const expertSummonActive = Boolean(expertSummon?.expertId);
      // Expert bind beats ordinary Composer skill selection on the same thread.
      const selectedLocalSkillNames = expertSummonActive
        ? [...new Set([...(expertSummon?.skillNames ?? []), ...goalSelectedLocalSkillNames])].slice(0, 6)
        : goalSelectedLocalSkillNames;
      if (expertSummonActive) {
        emitReasoningSummary(`参与专家：${expertSummon?.profession || expertSummon?.displayName || expertSummon?.expertId}\n`);
      }
      const skillExpertBridgeInstruction = typeof this.dependencies.loadSkillExpertBridgeInstruction === "function"
        ? await this.dependencies.loadSkillExpertBridgeInstruction({
          workspace,
          thread,
          skillNames: selectedLocalSkillNames
        })
        : "";
      if (
        centralSkillNames.some((name) => isGovernmentResearchWritingSkill(name))
        || selectedLocalSkillNames.some((name) => isGovernmentResearchWritingSkill(name))
      ) {
        emitReasoningSummary("已识别政务写作任务：先做写作规格分析，用户确认前不生成正文。\n");
      }
      const originalGoalRequest = goalSnapshot?.goal.objective?.trim() ?? "";
      const executionRequestContext = originalGoalRequest && originalGoalRequest !== latestUserRequest.trim()
        ? `原始交付要求：${originalGoalRequest}\n当前用户选择或补充：${latestUserRequest}`
        : latestUserRequest;
      const shadowLearning = typeof runtime.prepareShadowLearning === "function"
        ? await runtime.prepareShadowLearning(latestUserRequest)
        : null;
      if (shadowLearning?.shouldAsk) {
        emitReasoningSummary("检测到偏好缺口：将先向用户确认再执行。\n");
      }
      const loadedSkillResult = await this.dependencies.loadSkills({
        requestId: input.requestId,
        selectedLocalSkillNames,
        centralSkillNames,
        loadSkill: (name) => runtime.loadSkill(name)
      });
      if (loadedSkillResult.disclosure) {
        emitReasoningSummary(`本轮使用 Skill：${loadedSkillResult.disclosure}\n`);
      }
      emitReasoningSummary("正在准备上下文与执行计划…\n");
      const relevantMemories = runtime.searchMemories(latestUserRequest, { limit: 5 });
      const localKnowledgeText = typeof this.dependencies.loadLocalKnowledgeText === "function"
        ? await this.dependencies.loadLocalKnowledgeText({
          workspace,
          projectKey: workspace.name || workspace.id
        })
        : "";
      const projectOs = typeof this.dependencies.loadProjectOs === "function"
        ? await this.dependencies.loadProjectOs({ workspace })
        : "";
      const sceneKnowledgeText = typeof this.dependencies.loadSceneKnowledgeText === "function"
        ? await this.dependencies.loadSceneKnowledgeText({ workspace, query: latestUserRequest })
        : "";
      const preparedContext = await this.dependencies.prepareContext({
        workspace,
        thread,
        state: initialThreadState,
        messages: input.messages,
        persistedAt,
        turnId,
        loadedSkills: loadedSkillResult.loadedLocalSkills,
        disclosedSkills: loadedSkillResult.disclosedSkills,
        recalledMemories: relevantMemories,
        modelInput: input,
        abortSignal: abortController.signal,
        setRuntimeState: (state) => runtime.setThreadState(state)
      });
      let state = preparedContext.state;
      let requestMessages = letterChoice.expanded
        ? (() => {
          let lastUserIndex = -1;
          for (let index = preparedContext.requestMessages.length - 1; index >= 0; index -= 1) {
            if (preparedContext.requestMessages[index]?.role === "user") {
              lastUserIndex = index;
              break;
            }
          }
          if (lastUserIndex < 0) return preparedContext.requestMessages;
          return preparedContext.requestMessages.map((message, index) =>
            index === lastUserIndex ? { ...message, content: latestUserRequest } : message
          );
        })()
        : preparedContext.requestMessages;
      if (prepared.autoDecision?.mode === "auto" && prepared.autoDecision.allow_auto_delegate) {
        requestMessages = appendAutoDelegateTurnConstraint(requestMessages, {
          taskClass: prepared.autoDecision.task_class,
          latestUserText: latestUserRequest,
          expertSummonActive
        });
      }
      const effectiveSystemPrompt = this.dependencies.buildSystemPrompt({
        baseSystemPrompt: input.systemPrompt,
        composerModes,
        goalSnapshot,
        goalRuntimeRequested,
        explicitSkillNames,
        centralSkillNames,
        latestUserRequest: executionRequestContext,
        memories: relevantMemories,
        loadedSkills: loadedSkillResult.loadedLocalSkills,
        availableModels: this.dependencies.getAuthorizedModels?.() ?? [],
        personalizationGuidance: shadowLearning?.personalizationGuidance,
        deliveryPreferencesText: shadowLearning?.deliveryPreferencesText,
        localKnowledgeText,
        sceneKnowledgeText,
        brainWorkspaceKey: workspace.brainWorkspaceKey,
        projectOs,
        autoMode: prepared.autoDecision?.mode === "auto",
        autoTaskClass: prepared.autoDecision?.task_class,
        expertSummonActive,
        expertSummonInstruction: expertSummon?.systemInstruction || "",
        skillExpertBridgeInstruction
      });
      if (state.context) {
        state = await this.dependencies.updateModelContext({
          workspace,
          thread,
          state,
          turnId,
          systemPrompt: effectiveSystemPrompt,
          provider: input.provider,
          model: input.model,
          setRuntimeState: (nextState) => runtime.setThreadState(nextState)
        });
      }
      markTiming("context-ready");
      await this.dependencies.updateRunningMetadata(workspace.id, thread.id);
      const nativeWebSearches: NativeWebSearchProjection[] = [];
      const writtenArtifacts: WrittenArtifact[] = [];
      this.dependencies.attachArtifacts(input.requestId, writtenArtifacts);
      fallbackGoalTokens = goalRuntimeEnabled ? this.dependencies.estimateTokens(requestMessages) : 0;
      let result: ModelChatResult;
      try {
        markTiming("loop-started");
        const toolDescriptors = () => runtime.getToolDescriptors();
        let flushedEventCount = 0;
        const flushBoundaryEvents = this.dependencies.persistBoundaryEvents
          ? async (events: AgentLoopRun["agentEvents"]) => {
            if (!events.length) return;
            const approvalEvent = events.find((event) => event.type === "approval_requested");
            const approvalPayload = approvalEvent
              && typeof approvalEvent.payload === "object"
              && approvalEvent.payload !== null
              && !Array.isArray(approvalEvent.payload)
              ? approvalEvent.payload as { call?: { name?: string } }
              : null;
            await this.dependencies.persistBoundaryEvents!({
              workspace,
              thread,
              turnId,
              agentEvents: events,
              awaitingApproval: Boolean(approvalEvent),
              pendingToolName: approvalPayload?.call?.name,
              toolDescriptors: toolDescriptors()
            });
            flushedEventCount += events.length;
          }
          : undefined;
        const loopRun = await this.dependencies.runAgentLoop({
          modelInput: input,
          runtime,
          abortController,
          requestMessages,
          effectiveSystemPrompt,
          centralSkillNames,
          disclosedSkills: loadedSkillResult.disclosedSkills,
          nativeWebSearches,
          writtenArtifacts,
          workspacePath: workspace.path,
          threadId: thread.id,
          latestUserRequest: executionRequestContext,
          goalSnapshot: centralSkillNames.some((name) => isGovernmentResearchWritingSkill(name))
            ? this.dependencies.getGoalSnapshot(thread.id)
            : null,
          governmentSpecificationSnapshot: (() => {
            if (!centralSkillNames.some((name) => isGovernmentResearchWritingSkill(name))) return null;
            const goal = this.dependencies.getGoalSnapshot(thread.id)?.goal;
            return goal ? this.dependencies.getGovernmentWritingSpecificationSnapshot(thread.id, goal.goalId) : null;
          })(),
          reasoningSummaryParts,
          emitReasoningSummary,
          emitStream: (payload: unknown) => {
            const streamPayload = payload as { delta?: unknown; reset?: unknown };
            if (streamPayload.reset === true) streamedContent = "";
            if (typeof streamPayload.delta === "string") {
              streamedContent += streamPayload.delta;
              if (!firstDeltaObserved && streamPayload.delta.length > 0) {
                firstDeltaObserved = true;
                markTiming("first-delta");
              }
              if (streamPayload.delta.length > 0) {
                this.dependencies.onHostModelProgress?.();
              }
            }
            sender.send(this.dependencies.streamChannel, payload);
          },
          publishRetry: (requestId: string, attempt: number, maxAttempts: number, delayMs: number) => this.dependencies.publishActivity({
            type: "run",
            title: "模型步骤暂时失败，正在自动重试",
            detail: `正在进行第 ${attempt}/${maxAttempts} 次尝试${delayMs > 0 ? `，将在 ${delayMs / 1_000} 秒后继续` : ""}。目标进度已持久化，不会因单次超时丢失。`
          }, requestId),
          publishWebSearch: (action: unknown, requestId: string) => this.dependencies.publishActivity({
            type: "run",
            title: "已完成网络搜索",
            detail: JSON.stringify(action ?? {})
          }, requestId),
          publishActivity: this.dependencies.publishActivity,
          recordTokens: (tokens: number) => {
            if (goalSession?.accounting) goalSession.accounting.tokens += tokens;
          },
          setModelCallback: (callback: unknown) => this.dependencies.setModelCallback(input.requestId, callback),
          getGoalSnapshot: () => this.dependencies.getGoalSnapshot(thread.id),
          confirmGovernmentSpecificationFromChat: this.dependencies.confirmGovernmentSpecificationFromChat
            ? (options?: { candidateTexts?: string[] }) =>
              this.dependencies.confirmGovernmentSpecificationFromChat!(thread.id, options)
            : undefined,
          flushBoundaryEvents,
          modelFallback: isAutoModelFallbackEnabled(prepared.autoDecision)
            ? {
                enabled: true,
                selected: prepared.autoDecision!.model.selected,
                fallback_chain: [...(prepared.autoDecision!.model.fallback_chain ?? [])],
                fallback_index: prepared.autoDecision!.model.fallback_index ?? 0,
                onFallback: (info: { from: string; to: string; fallbackIndex: number; reason: string }) => {
                  this.dependencies.publishActivity({
                    type: "run",
                    title: "模型步骤异常，已切换备用模型",
                    detail: `${info.from || "当前模型"} → ${info.to}（第 ${info.fallbackIndex} 次切换）`
                  }, input.requestId);
                }
              }
            : undefined,
          ...(remoteExecutionContext ? {
            remoteExecutionContext: {
              ...remoteExecutionContext,
              registeredToolNames: runtime.getToolDescriptors().map((tool) => tool.name)
            }
          } : {})
        });
        markTiming("loop-completed");
        this.dependencies.observeAgentEvents?.(input.requestId, loopRun.agentEvents);
        this.dependencies.attachSkillDisclosure(input.requestId, loopRun.skillDisclosure);
        for (const update of reconcileStreamedContent(streamedContent, loopRun.canonicalContent)) {
          sender.send(this.dependencies.streamChannel, { requestId: input.requestId, ...update });
        }
        result = loopRun.result;
        if (this.dependencies.isCanceled(input.requestId)) {
          await this.dependencies.persistCancellation(workspace, thread, turnId);
          await this.dependencies.repairOrphanToolCalls?.({
            workspace,
            thread,
            turnId,
            ...orphanToolRepairContext(runtime, "当前任务已停止。")
          });
          throw new Error("当前任务已停止。");
        }
        const alreadyFlushed = loopRun.flushedEventCount ?? flushedEventCount;
        const remainingEvents = loopRun.agentEvents.slice(alreadyFlushed);
        const descriptors = toolDescriptors();
        const toolCallPayloads = enrichBoundaryEventsForPersistence(
          loopRun.agentEvents.filter((event) => event.type === "tool_call"),
          descriptors
        )
          .map((event) => event.payload as { replaySafe?: unknown })
          .filter(Boolean);
        await this.dependencies.persistRun({
          workspace,
          thread,
          turnId,
          agentEvents: remainingEvents,
          nativeWebSearches,
          awaitingApproval: loopRun.loopSnapshot.status === "awaiting-approval",
          pendingToolName: loopRun.loopSnapshot.pending?.call.name,
          toolDescriptors: descriptors,
          replayMetadata: toolCallPayloads.length ? buildTurnReplayMetadata(toolCallPayloads) : null
        });
        markTiming("run-persisted");
      } catch (error) {
        if (goalSession?.accounting) goalSession.accounting.lastError = error instanceof Error ? error.message : String(error);
        if (this.dependencies.isCanceled(input.requestId)) {
          await this.dependencies.persistCancellation(workspace, thread, turnId);
          await this.dependencies.repairOrphanToolCalls?.({
            workspace,
            thread,
            turnId,
            ...orphanToolRepairContext(runtime, error)
          });
          throw error;
        }
        await this.dependencies.persistFailure({
          workspace,
          thread,
          requestId: input.requestId,
          turnId,
          reasoningSummary: reasoningSummaryParts.join(""),
          partialContent: streamedContent,
          error
        });
        await this.dependencies.repairOrphanToolCalls?.({
          workspace,
          thread,
          turnId,
          ...orphanToolRepairContext(runtime, error)
        });
        throw error;
      }
      await this.dependencies.persistSuccess({
        workspace,
        thread,
        turnId,
        latestUserRequest,
        result,
        reasoningSummary: reasoningSummaryParts.join(""),
        nativeWebSearches,
        waitingForApproval: runtime.getAgentLoopSnapshot()?.status === "awaiting-approval",
        saveRuntimeState: (summary) => this.dependencies.saveRuntimeState(runtime, workspace, thread, summary),
        rememberExchange: (exchange) => runtime.rememberExchangeWithShadow(exchange),
        getMemories: () => runtime.getMemories()
      });
      retainForApproval = Boolean(result.awaitingApproval)
        || runtime.getAgentLoopSnapshot()?.status === "awaiting-approval";
      markTiming("success-persisted");
      return result;
    } catch (error) {
      if (!taskStarted) {
        await this.dependencies.observePreTaskFailure?.({
          requestId: originalInput.requestId,
          workspaceId: originalInput.workspaceId,
          threadId: originalInput.threadId,
          error
        });
      }
      throw error;
    } finally {
      if (goalSession) this.dependencies.finishGoal(goalSession, fallbackGoalTokens);
      await this.dependencies.finishTask(input.requestId, { retainForApproval });
      markTiming("finished");
    }
  }
}
