import type { WorkspaceCatalogItem, WorkspaceThreadRecord } from "@codex-forge/protocol";
import {
  isGuidePayloadEmpty,
  normalizeGuideRequest,
  toSteerAgentPayload,
  type GuideAttachment,
  type GuideDelivery,
  type NormalizedGuideRequest,
  type SteerAgentPayload
} from "./model-chat-guide.ts";
import { createTurnScope, patchTurnScope, type TurnScope } from "./turn-scope.ts";

export interface ModelChatTaskRuntime<TState, TPolicy> {
  setPolicyRules(rules: TPolicy[]): unknown;
  setThreadState(state: TState): unknown;
  steerAgentLoop(message: SteerAgentPayload): unknown;
  cancelAgentLoop?(reason?: string): unknown;
  getAgentLoopSnapshot(): { status: string } | null;
  getSnapshot(): { approval?: unknown };
}

export interface ModelChatTaskRecord<TRuntime> {
  abortController: AbortController;
  workspaceId: string;
  threadId: string;
  /** Frozen write-back identity; never replace with UI activeThreadId. */
  scope: TurnScope;
  runtime?: TRuntime;
  pendingGuidance: NormalizedGuideRequest[];
  pendingFollowups: NormalizedGuideRequest[];
  springTurnId?: string;
  springSessionId?: string;
  springApprovalId?: string;
  springToolCallId?: string;
  mediaJobId?: string;
  modelCallback?: unknown;
  writtenArtifacts?: unknown[];
  skillDisclosure?: string;
}

export interface ModelChatTaskDependencies<TRuntime, TState, TPolicy> {
  canceledRequestIds: Set<string>;
  registerTask: (requestId: string, task: ModelChatTaskRecord<TRuntime>) => void;
  getTask: (requestId: string) => ModelChatTaskRecord<TRuntime> | undefined;
  removeTask: (requestId: string) => void;
  createRuntime: (input: {
    runtimeId: string;
    projectId: string;
    workspacePath: string;
    shellEnv: Record<string, string>;
  }) => Promise<TRuntime>;
  disposeRuntime?: (runtime: TRuntime) => Promise<unknown>;
  buildShellEnv: (workspace: WorkspaceCatalogItem) => Promise<Record<string, string>>;
  configureRuntime: (
    runtime: TRuntime,
    workspace: WorkspaceCatalogItem,
    thread: WorkspaceThreadRecord
  ) => Promise<unknown>;
  readPolicyRules: () => Promise<TPolicy[]>;
  readThreadState: (workspace: WorkspaceCatalogItem, thread: WorkspaceThreadRecord) => Promise<TState>;
  appendDebugLog: (entry: string) => Promise<unknown>;
}

export type GuideTaskInput =
  | string
  | {
      message?: unknown;
      content?: unknown;
      attachments?: unknown;
      delivery?: unknown;
    };

/** Owns model-task runtime registration, initialization, approval retention, and cleanup. */
export class ModelChatTaskService<
  TRuntime extends ModelChatTaskRuntime<TState, TPolicy>,
  TState,
  TPolicy
> {
  private readonly dependencies: ModelChatTaskDependencies<TRuntime, TState, TPolicy>;

  constructor(dependencies: ModelChatTaskDependencies<TRuntime, TState, TPolicy>) {
    this.dependencies = dependencies;
  }

  async start(input: {
    requestId: string;
    workspace: WorkspaceCatalogItem;
    thread: WorkspaceThreadRecord;
    abortController: AbortController;
    turnId?: string;
  }) {
    this.dependencies.canceledRequestIds.delete(input.requestId);
    const runtimeId = `thread-${input.thread.id}-${input.requestId}`;
    const scope = createTurnScope({
      workspaceId: input.workspace.id,
      threadId: input.thread.id,
      requestId: input.requestId,
      turnId: input.turnId,
      runtimeId
    });
    const reservation: ModelChatTaskRecord<TRuntime> = {
      abortController: input.abortController,
      workspaceId: scope.workspaceId,
      threadId: scope.threadId,
      scope,
      pendingGuidance: [],
      pendingFollowups: []
    };
    this.dependencies.registerTask(input.requestId, reservation);
    let createdRuntime: TRuntime | undefined;
    try {
      const runtime = await this.dependencies.createRuntime({
        runtimeId,
        projectId: input.workspace.id,
        workspacePath: input.workspace.path,
        brainWorkspaceKey: (input.workspace as { brainWorkspaceKey?: string }).brainWorkspaceKey,
        shellEnv: await this.dependencies.buildShellEnv(input.workspace)
      });
      createdRuntime = runtime;
      await this.dependencies.configureRuntime(runtime, input.workspace, input.thread);
      runtime.setPolicyRules(await this.dependencies.readPolicyRules());
      const initialThreadState = await this.dependencies.readThreadState(input.workspace, input.thread);
      runtime.setThreadState(initialThreadState);
      if (input.abortController.signal.aborted) {
        throw input.abortController.signal.reason ?? new Error("Model request aborted during initialization.");
      }
      const pendingGuidance = this.dependencies.getTask(input.requestId)?.pendingGuidance ?? [];
      const pendingFollowups = this.dependencies.getTask(input.requestId)?.pendingFollowups ?? [];
      this.dependencies.registerTask(input.requestId, {
        ...reservation,
        runtime,
        pendingGuidance: [],
        pendingFollowups
      });
      for (const guidance of pendingGuidance) {
        runtime.steerAgentLoop(toSteerAgentPayload(guidance));
      }
      await this.dependencies.appendDebugLog(
        `model task started request=${scope.requestId} workspace=${scope.workspaceId} thread=${scope.threadId} turn=${scope.turnId || "-"}`
      );
      return { runtime, initialThreadState, scope };
    } catch (error) {
      if (createdRuntime) {
        await this.dependencies.disposeRuntime?.(createdRuntime);
      }
      this.dependencies.removeTask(input.requestId);
      this.dependencies.canceledRequestIds.delete(input.requestId);
      await this.dependencies.appendDebugLog(
        `model task initialization failed request=${scope.requestId} workspace=${scope.workspaceId} thread=${scope.threadId}`
      );
      throw error;
    }
  }

  /** Bind turn / spring / media ids onto the frozen task scope without changing workspace/thread/request. */
  patchScope(
    requestId: string,
    patch: Partial<Omit<TurnScope, "workspaceId" | "threadId" | "requestId">>
  ): TurnScope | undefined {
    const task = this.dependencies.getTask(requestId);
    if (!task) return undefined;
    const scope = patchTurnScope(task.scope, patch);
    this.dependencies.registerTask(requestId, {
      ...task,
      scope,
      springTurnId: scope.springTurnId ?? task.springTurnId,
      springSessionId: scope.springSessionId ?? task.springSessionId,
      mediaJobId: scope.mediaJobId ?? task.mediaJobId
    });
    return scope;
  }

  requireTask(requestId: string): ModelChatTaskRecord<TRuntime> {
    const task = this.dependencies.getTask(requestId);
    if (!task) {
      throw new Error(`Model task not found for requestId=${requestId}.`);
    }
    return task;
  }

  guide(requestId: string, input: GuideTaskInput) {
    const guidance = normalizeGuideRequest(input);
    if (isGuidePayloadEmpty(guidance)) {
      return {
        ok: false,
        code: "guide_empty",
        detail: "引用内容不能为空。"
      };
    }
    const task = this.dependencies.getTask(requestId);
    if (!task) {
      return {
        ok: false,
        code: "request_not_active",
        detail: "当前运行已经结束；请将引用内容作为下一轮继续执行。"
      };
    }

    if (guidance.delivery === "followup") {
      this.dependencies.registerTask(requestId, {
        ...task,
        pendingFollowups: [...task.pendingFollowups, guidance]
      });
      return {
        ok: true,
        code: "followup_queued",
        detail: "引用消息已排队，将在当前轮结束后作为下一轮发送。",
        delivery: "followup" as GuideDelivery,
        attachments: guidance.attachments
      };
    }

    if (guidance.delivery === "interrupt") {
      if (!task.runtime?.cancelAgentLoop) {
        return {
          ok: false,
          code: "guide_unavailable",
          detail: "当前运行暂不支持中断改发。"
        };
      }
      try {
        task.runtime.cancelAgentLoop("Interrupted by user guidance.");
      } catch (error) {
        return {
          ok: false,
          code: "guide_unavailable",
          detail: error instanceof Error
            ? `当前运行暂不可中断：${error.message}`
            : "当前运行暂不可中断。"
        };
      }
      this.dependencies.registerTask(requestId, {
        ...task,
        pendingFollowups: [...task.pendingFollowups, { ...guidance, delivery: "steer" }]
      });
      return {
        ok: true,
        code: "interrupt_requested",
        detail: "已请求中断当前运行；引用消息将作为下一轮立即发送。",
        delivery: "interrupt" as GuideDelivery,
        attachments: guidance.attachments
      };
    }

    if (!task.runtime) {
      this.dependencies.registerTask(requestId, {
        ...task,
        pendingGuidance: [...task.pendingGuidance, guidance]
      });
      return {
        ok: true,
        code: "guide_queued",
        detail: "引用消息将在运行初始化完成后发送。",
        delivery: "steer" as GuideDelivery,
        attachments: guidance.attachments
      };
    }
    try {
      task.runtime.steerAgentLoop(toSteerAgentPayload(guidance));
    } catch (error) {
      return {
        ok: false,
        code: "guide_unavailable",
        detail: error instanceof Error
          ? `当前运行暂不可引导：${error.message}`
          : "当前运行暂不可引导。"
      };
    }
    return {
      ok: true,
      code: "guided",
      detail: guidance.attachments.length
        ? `引用消息与 ${guidance.attachments.length} 个附件已发送到当前运行。`
        : "引用消息已发送到当前运行。",
      delivery: "steer" as GuideDelivery,
      attachments: guidance.attachments
    };
  }

  takeFollowups(requestId: string): NormalizedGuideRequest[] {
    const task = this.dependencies.getTask(requestId);
    if (!task?.pendingFollowups.length) return [];
    const followups = [...task.pendingFollowups];
    this.dependencies.registerTask(requestId, {
      ...task,
      pendingFollowups: []
    });
    return followups;
  }

  finish(requestId: string, options?: { retainForApproval?: boolean }) {
    const currentTask = this.dependencies.getTask(requestId);
    const runtime = currentTask?.runtime;
    const followups = currentTask?.pendingFollowups ?? [];
    const runtimeWaitingForApproval = runtime?.getAgentLoopSnapshot()?.status === "awaiting-approval"
      || Boolean(runtime?.getSnapshot().approval);
    const waitingForApproval = options?.retainForApproval === undefined
      ? runtimeWaitingForApproval
      : options.retainForApproval && runtimeWaitingForApproval;
    void this.dependencies.appendDebugLog(
      `model task ${waitingForApproval ? "paused for approval" : "finished"} request=${requestId}`
    );
    if (!waitingForApproval) {
      this.dependencies.removeTask(requestId);
      this.dependencies.canceledRequestIds.delete(requestId);
      if (runtime) {
        void Promise.resolve(this.dependencies.disposeRuntime?.(runtime)).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          void this.dependencies.appendDebugLog(`model task runtime disposal failed request=${requestId} error=${message}`);
        });
      }
    }
    return { waitingForApproval, followups: waitingForApproval ? [] : followups };
  }
}

export type { GuideAttachment, GuideDelivery, NormalizedGuideRequest, TurnScope };
