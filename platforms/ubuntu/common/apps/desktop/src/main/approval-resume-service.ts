interface ApprovalSender {
  send: (channel: string, payload: unknown) => void;
}

import { sanitizeVisibleModelContent } from "../shared/model-content-visibility.js";
import {
  buildEmptyTurnFallbackContent,
  ensureApprovalSnapshotForPendingLoop
} from "./approval-continuation-policy.ts";
import {
  formatApprovalResumeFailureMessage,
  isTerminalAgentLoopFailure
} from "./approval-resume-failure-policy.ts";
import { extractPendingApprovalCommand } from "./approval-memory.ts";

interface ApprovalResumeServiceOptions {
  getTasks: () => Map<string, any>;
  getActiveWorkspaceId: () => string;
  getActiveThreadId: () => string;
  getDefaultRuntime: () => any;
  getActiveModelCallback: () => any;
  clearActiveModelCallback: () => void;
  isRetryableError: (error: unknown) => boolean;
  publishActivity: (activity: any, requestId: string) => void;
  appendActiveActivities: (activities: any[]) => Promise<unknown>;
  readWorkspaceCatalog: () => Promise<any>;
  appendThreadEvents: (workspace: any, thread: any, events: any[]) => Promise<unknown>;
  createThreadEvent: (type: string, payload: any) => any;
  updateThreadMetadata: (input: any) => Promise<unknown>;
  formatWrittenArtifacts: (workspacePath: string, artifacts: any[]) => string;
  streamDeltaChannel: string;
  saveActiveThreadState: (summary?: string, options?: { touchUpdatedAt?: boolean }) => Promise<unknown>;
  appendRolloutRecords: (path: string, records: any[]) => Promise<unknown>;
  getThreadEventLogPath: (workspaceId: string, threadId: string) => string;
  createRolloutEvent: (input: any) => any;
  saveRuntimeThreadState: (runtime: any, workspace: any, thread: any, summary: string, options: any) => Promise<unknown>;
  readThreadState: (workspace: any, thread: any) => Promise<any>;
  disposeRuntime: (runtime: any) => Promise<unknown>;
  removeTask: (requestId: string) => void;
  clearCanceledRequest: (requestId: string) => void;
  appendDebugLog: (message: string) => Promise<unknown>;
  observeAgentEvents?: (requestId: string, events: Array<{ type: string; payload?: unknown }>) => void;
  /**
   * Hybrid: resolve spring approval before local tool side effects.
   * Must return sideEffectAllowed=false when decision is deny or spring denies.
   */
  resolveSpringApproval?: (input: {
    approvalId: string;
    decision: "approve" | "deny";
  }) => Promise<{ sideEffectAllowed: boolean; offline?: boolean; status?: string }>;
  /** Register a gated tool/approval on spring when local approval is shown. */
  proposeSpringTool?: (input: {
    sessionId: string;
    turnId: string;
    toolCallId?: string;
    name: string;
    approvalMessage?: string;
  }) => Promise<{ approvalId?: string; sideEffectAllowed: boolean; offline?: boolean }>;
  /**
   * Persist an approved shell command so identical later calls skip the approval UI.
   * Called after a successful local approve, before/while the tool runs.
   */
  rememberApprovedCommand?: (input: { toolName: string; command: string }) => Promise<void> | void;
}

/** Owns approval resume as one ordered transaction across runtime, UI, rollout, and thread state. */
export class ApprovalResumeService {
  private readonly options: ApprovalResumeServiceOptions;

  constructor(options: ApprovalResumeServiceOptions) {
    this.options = options;
  }

  async respond(sender: ApprovalSender, input: boolean | { approved: boolean; requestId?: string; approvalId?: string }) {
    const approved = typeof input === "boolean" ? input : Boolean(input.approved);
    const requestId = typeof input === "object" ? input.requestId?.trim() || "" : "";
    const approvalId = typeof input === "object" ? input.approvalId?.trim() || "" : "";
    const tasks = this.options.getTasks();
    if (!requestId && !approvalId) {
      throw new Error("respond-approval 需要 requestId 或 approvalId，不能回退到当前 UI 线程。");
    }
    let pendingTask = requestId ? tasks.get(requestId) : undefined;
    const defaultRuntime = this.options.getDefaultRuntime();
    let matchedDefaultApproval = false;
    if (approvalId) {
      const matchedTaskEntry = [...tasks.entries()].find(([, task]) => task.runtime?.getSnapshot().approval?.id === approvalId);
      if (defaultRuntime.getSnapshot().approval?.id === approvalId) {
        pendingTask = undefined;
        matchedDefaultApproval = true;
      }
      else if (matchedTaskEntry) pendingTask = matchedTaskEntry[1];
      else throw new Error("当前审批已失效：审批标识与运行任务不匹配。请重新发起操作。");
    }
    const effectiveRequestId = [...tasks.entries()].find(([, task]) => task === pendingTask)?.[0] || requestId;
    if (pendingTask?.abortController?.signal?.aborted) {
      throw new Error("当前审批已失效：任务已被取消。请重新发送任务。");
    }
    if (!pendingTask && !matchedDefaultApproval) {
      throw new Error("当前审批请求已失效：对应的运行任务不存在。请重新发送这条任务。");
    }
    const targetRuntime = pendingTask?.runtime ?? (matchedDefaultApproval ? defaultRuntime : undefined);
    if (!targetRuntime) {
      throw new Error("当前审批请求已失效：运行时尚未就绪。请重新发送这条任务。");
    }
    const targetWorkspaceId = pendingTask?.scope?.workspaceId ?? pendingTask?.workspaceId;
    const targetThreadId = pendingTask?.scope?.threadId ?? pendingTask?.threadId;
    if (!matchedDefaultApproval && (!targetWorkspaceId || !targetThreadId)) {
      throw new Error("当前审批请求缺少 TurnScope 线程绑定。");
    }
    const targetModelCallback = pendingTask?.modelCallback ?? (matchedDefaultApproval ? this.options.getActiveModelCallback() : undefined);
    const agentLoopStatus = targetRuntime.getAgentLoopSnapshot()?.status;
    if (agentLoopStatus === "failed" || agentLoopStatus === "cancelled" || agentLoopStatus === "canceled") {
      throw new Error("当前审批已失效：Agent loop 已取消或失败。请重新发送任务。");
    }
    const agentLoopPending = agentLoopStatus === "awaiting-approval";
    const agentLoopCanAdvance = agentLoopStatus === "running";
    const agentEventOffset = targetRuntime.sessionMachine.events.length;
    let resumedAgentLoop: any = null;
    let nextSnapshot: any;

    // Legacy default-runtime approval: freeze UI focus once; never re-read mid-await.
    const focusedWorkspaceId = matchedDefaultApproval ? this.options.getActiveWorkspaceId() : "";
    const focusedThreadId = matchedDefaultApproval ? this.options.getActiveThreadId() : "";
    const resolvedWorkspaceId = targetWorkspaceId || focusedWorkspaceId;
    const resolvedThreadId = targetThreadId || focusedThreadId;

    if (!agentLoopPending && !agentLoopCanAdvance && !targetRuntime.getSnapshot().approval) {
      if (resolvedWorkspaceId && resolvedThreadId) {
        await this.options.updateThreadMetadata({
          workspaceId: resolvedWorkspaceId, threadId: resolvedThreadId, status: "failed",
          statusLabel: "审批已失效", lastEventSummary: "审批对应的运行任务已不存在，请重新发送任务"
        });
      }
      throw new Error("当前审批已失效：没有可继续执行的工具调用。请重新发送任务。");
    }

    const springApprovalId = typeof pendingTask?.springApprovalId === "string"
      ? pendingTask.springApprovalId.trim()
      : "";
    if (this.options.resolveSpringApproval && springApprovalId) {
      const springDecision = approved ? "approve" as const : "deny" as const;
      const springResult = await this.options.resolveSpringApproval({
        approvalId: springApprovalId,
        decision: springDecision
      });
      if (approved && springResult.sideEffectAllowed !== true) {
        throw new Error("服务端未批准该工具执行，已阻止副作用。");
      }
      if (!approved && springResult.sideEffectAllowed === true) {
        // Defensive: deny must never open side effects.
        throw new Error("审批拒绝状态异常：服务端仍允许副作用。");
      }
    }

    if (approved && this.options.rememberApprovedCommand) {
      try {
        const loopPending = targetRuntime.getAgentLoopSnapshot?.()?.pending
          ?? targetRuntime.getSnapshot?.()?.pending
          ?? null;
        const pendingCommand = extractPendingApprovalCommand(
          targetRuntime.getSnapshot?.() ?? null,
          loopPending
        );
        if (pendingCommand?.command) {
          await this.options.rememberApprovedCommand(pendingCommand);
        }
      } catch (error) {
        await this.options.appendDebugLog(
          `approval memory persist failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    try {
      if (agentLoopPending && targetModelCallback) {
        resumedAgentLoop = await targetRuntime.resumeAgentApproval(approved, targetModelCallback);
        nextSnapshot = targetRuntime.getSnapshot();
        if (resumedAgentLoop.status !== "awaiting-approval") {
          if (pendingTask) pendingTask.modelCallback = undefined;
          else this.options.clearActiveModelCallback();
        }
      } else if (agentLoopCanAdvance && targetModelCallback && approved) {
        resumedAgentLoop = await targetRuntime.advanceAgentLoop(targetModelCallback);
        nextSnapshot = targetRuntime.getSnapshot();
        if (resumedAgentLoop.status !== "awaiting-approval") {
          if (pendingTask) pendingTask.modelCallback = undefined;
          else this.options.clearActiveModelCallback();
        }
      } else {
        nextSnapshot = await targetRuntime.respondToApproval(approved);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.options.isRetryableError(error) && !isTerminalAgentLoopFailure(error)) {
        nextSnapshot = targetRuntime.getSnapshot();
        this.options.publishActivity({
          type: "run", title: "模型网关暂时不可用", detail: `${message}\n请稍后再次点击批准并继续。`
        }, effectiveRequestId);
        await this.persistRetryableFailure(resolvedWorkspaceId, resolvedThreadId, message);
        return nextSnapshot;
      }
      const failureMessage = formatApprovalResumeFailureMessage(error);
      await this.persistTerminalFailure({
        workspaceId: resolvedWorkspaceId,
        threadId: resolvedThreadId,
        requestId: effectiveRequestId,
        runtime: targetRuntime,
        pendingTask,
        message: failureMessage
      });
      throw new Error(failureMessage);
    }

    // Hosted loops can return awaiting-approval before session.approval is synced.
    // Keep an actionable approval card so the renderer does not treat the turn as finished.
    if (resumedAgentLoop?.status === "awaiting-approval") {
      nextSnapshot = ensureApprovalSnapshotForPendingLoop({
        snapshot: nextSnapshot,
        loopStatus: resumedAgentLoop.status,
        pending: resumedAgentLoop.pending ?? null
      });
      try {
        const sessionSnapshot = targetRuntime.sessionMachine?.snapshot;
        if (sessionSnapshot && nextSnapshot.approval) {
          sessionSnapshot.approval = nextSnapshot.approval;
          sessionSnapshot.pendingTool = nextSnapshot.pendingTool;
          sessionSnapshot.session = {
            ...(sessionSnapshot.session ?? {}),
            status: "awaiting-approval"
          };
        }
      } catch {
        // Best-effort: returned snapshot is still enough for the renderer.
      }
    }

    const latestRun = nextSnapshot.runs?.[0];
    if (approved && latestRun) {
      const activity = this.toRunActivity(latestRun);
      this.options.publishActivity(activity, effectiveRequestId);
    }
    if (resumedAgentLoop?.status === "completed") {
      if (!String(resumedAgentLoop.finalContent || "").trim()) {
        const failedRuns = (nextSnapshot.runs ?? [])
          .filter((run: any) => run?.status === "failed")
          .map((run: any) => ({
            command: run.command,
            failureMessage: run.failureMessage,
            stderr: run.stderr
          }));
        resumedAgentLoop.finalContent = buildEmptyTurnFallbackContent({
          latestUserText: [...(nextSnapshot.messages ?? [])].reverse()
            .find((message: any) => message?.role === "user")?.content,
          failedCommands: failedRuns
        });
      }
      nextSnapshot = await this.finalizeAssistantContent(
        sender, pendingTask, targetRuntime, resolvedWorkspaceId, effectiveRequestId, resumedAgentLoop, nextSnapshot
      );
    } else if (
      approved
      && (resumedAgentLoop?.status === "failed" || resumedAgentLoop?.status === "cancelled" || resumedAgentLoop?.status === "canceled")
    ) {
      const failureMessage = formatApprovalResumeFailureMessage(
        new Error(String(resumedAgentLoop.finalContent || "Agent loop stalled: no tool progress"))
      );
      resumedAgentLoop.finalContent = failureMessage;
      nextSnapshot = await this.finalizeAssistantContent(
        sender, pendingTask, targetRuntime, resolvedWorkspaceId, effectiveRequestId, resumedAgentLoop, nextSnapshot
      );
      nextSnapshot = {
        ...nextSnapshot,
        approval: null,
        pendingTool: null
      };
    }
    await this.persistOutcome({
      approved, pendingTask, targetRuntime,
      targetWorkspaceId: resolvedWorkspaceId,
      targetThreadId: resolvedThreadId,
      effectiveRequestId, agentEventOffset, resumedAgentLoop, nextSnapshot, latestRun
    });
    return nextSnapshot;
  }

  private async persistRetryableFailure(workspaceId: string, threadId: string, message: string) {
    if (!workspaceId || !threadId) return;
    const catalog = await this.options.readWorkspaceCatalog();
    const workspace = catalog.workspaces.find((item: any) => item.id === workspaceId);
    const thread = workspace?.threads.find((item: any) => item.id === threadId);
    if (!workspace || !thread) return;
    await this.options.appendThreadEvents(workspace, thread, [this.options.createThreadEvent("error", {
      stage: "approval_resume_model", message, retryable: true
    })]);
    await this.options.updateThreadMetadata({
      workspaceId, threadId, status: "awaiting-approval", statusLabel: "可重试",
      lastEventSummary: "模型网关暂时不可用，请稍后重试批准继续"
    });
  }

  /** Ends the busy turn after a non-retryable loop failure so UI cannot stick on 处理中. */
  private async persistTerminalFailure(input: {
    workspaceId: string;
    threadId: string;
    requestId: string;
    runtime: any;
    pendingTask: any;
    message: string;
  }) {
    const { workspaceId, threadId, requestId, runtime, pendingTask, message } = input;
    try {
      const snapshot = runtime?.getSnapshot?.() ?? {};
      if (snapshot && typeof snapshot === "object") {
        snapshot.approval = null;
        snapshot.pendingTool = null;
        if (snapshot.session && typeof snapshot.session === "object") {
          snapshot.session = { ...snapshot.session, status: "failed" };
        }
      }
      try {
        const sessionSnapshot = runtime?.sessionMachine?.snapshot;
        if (sessionSnapshot && typeof sessionSnapshot === "object") {
          sessionSnapshot.approval = null;
          sessionSnapshot.pendingTool = null;
          sessionSnapshot.session = {
            ...(sessionSnapshot.session ?? {}),
            status: "failed"
          };
        }
      } catch {
        // Best-effort session sync.
      }
      if (workspaceId && threadId) {
        const catalog = await this.options.readWorkspaceCatalog();
        const workspace = catalog.workspaces.find((item: any) => item.id === workspaceId);
        const thread = workspace?.threads.find((item: any) => item.id === threadId);
        if (workspace && thread) {
          await this.options.appendThreadEvents(workspace, thread, [this.options.createThreadEvent("error", {
            stage: "approval_resume_terminal", message, retryable: false
          })]);
          await this.options.updateThreadMetadata({
            workspaceId, threadId, status: "failed", statusLabel: "执行失败",
            lastEventSummary: message
          });
          try {
            await this.options.saveRuntimeThreadState(runtime, workspace, thread, message, { touchUpdatedAt: true });
          } catch {
            // Metadata + event already mark the terminal failure.
          }
        }
      }
      this.options.publishActivity({
        type: "complete",
        title: "本轮已结束",
        detail: message,
        status: "failed"
      }, requestId);
    } finally {
      if (pendingTask) pendingTask.modelCallback = undefined;
      else this.options.clearActiveModelCallback();
      if (runtime) {
        try {
          await this.options.disposeRuntime(runtime);
        } catch {
          // Still drop the task registry entry below.
        }
      }
      if (requestId) {
        this.options.removeTask(requestId);
        this.options.clearCanceledRequest(requestId);
      }
      await this.options.appendDebugLog(
        `model task approval terminal failure request=${requestId || "(none)"} message=${message}`
      );
    }
  }

  private toRunActivity(run: any) {
    return {
      type: "run", title: run.status === "failed" ? "命令执行失败" : "已执行命令", detail: run.command,
      executionId: run.id, callId: run.callId, toolName: run.toolName ?? run.label, command: run.command,
      cwd: run.cwd, status: run.status, exitCode: run.exitCode, durationMs: run.durationMs,
      stdout: run.stdout, stderr: run.stderr, output: run.output, failureMessage: run.failureMessage,
      outputTruncated: run.outputTruncated, originalOutputBytes: run.originalOutputBytes
    };
  }

  private async finalizeAssistantContent(
    sender: ApprovalSender, task: any, runtime: any, workspaceId: string,
    requestId: string, resumed: any, snapshot: any
  ) {
    const catalog = await this.options.readWorkspaceCatalog();
    const workspace = catalog.workspaces.find((item: any) => item.id === workspaceId);
    const artifactSummary = workspace
      ? this.options.formatWrittenArtifacts(workspace.path, task?.writtenArtifacts ?? []) : "";
    const canonicalContent = [sanitizeVisibleModelContent(resumed.finalContent), artifactSummary].filter(Boolean).join("\n\n");
    resumed.finalContent = canonicalContent;
    const finalAssistant = [...(runtime.sessionMachine?.snapshot?.messages ?? [])].reverse()
      .find((message: any) => message.role === "assistant");
    if (finalAssistant) finalAssistant.content = canonicalContent;
    if (requestId && canonicalContent) {
      sender.send(this.options.streamDeltaChannel, { requestId, delta: "", reset: true });
      sender.send(this.options.streamDeltaChannel, { requestId, delta: canonicalContent });
    }
    const latestUser = [...(snapshot.messages ?? [])].reverse().find((message: any) => message.role === "user");
    if (typeof runtime.rememberExchangeWithShadow === "function") {
      await runtime.rememberExchangeWithShadow({
        user: latestUser?.content ?? "", assistant: canonicalContent, scope: "session"
      });
    }
    return runtime.getSnapshot();
  }

  private async persistOutcome(context: any) {
    const { approved, pendingTask, targetRuntime, targetWorkspaceId, targetThreadId,
      effectiveRequestId, agentEventOffset, resumedAgentLoop, nextSnapshot, latestRun } = context;
    if (targetWorkspaceId && targetThreadId) {
      const catalog = await this.options.readWorkspaceCatalog();
      const workspace = catalog.workspaces.find((item: any) => item.id === targetWorkspaceId);
      const thread = workspace?.threads.find((item: any) => item.id === targetThreadId);
      if (workspace && thread) {
        const agentEvents = targetRuntime.sessionMachine.events.slice(agentEventOffset);
        // A successful approval response is itself the authoritative state transition.
        // Some runtimes consume the approval without appending an approval_resolved event;
        // remote WorkItems would otherwise remain stuck in waiting_approval forever.
        if (!agentEvents.some((event: any) =>
          event.type === "approval_resolved" || event.type === "approval.resolved")) {
          this.options.observeAgentEvents?.(effectiveRequestId, [{
            type: "approval_resolved",
            payload: { approved }
          }]);
        }
        this.options.observeAgentEvents?.(effectiveRequestId, agentEvents);
        if (agentEvents.length) {
          await this.options.appendRolloutRecords(
            this.options.getThreadEventLogPath(workspace.id, thread.id),
            agentEvents.map((event: any) => this.options.createRolloutEvent({
              recordType: event.type, threadId: thread.id, timestamp: event.timestamp, payload: event.payload
            }))
          );
        }
        await this.options.appendThreadEvents(workspace, thread, [this.options.createThreadEvent("approval", {
          approved, status: approved ? latestRun?.status ?? "completed" : "canceled",
          command: latestRun?.command ?? "", exitCode: latestRun?.exitCode
        })]);
        const summary = approved
          ? nextSnapshot.approval ? "审批已处理，等待下一次批准"
            : latestRun?.status === "failed" ? "审批后命令执行失败" : "审批后命令已执行"
          : "审批已拒绝";
        await this.options.saveRuntimeThreadState(targetRuntime, workspace, thread, summary, { touchUpdatedAt: false });
        if (resumedAgentLoop?.status === "completed" && resumedAgentLoop.finalContent) {
          const completedState = await this.options.readThreadState(workspace, thread);
          const finalAssistant = [...completedState.messages].reverse()
            .find((message: any) => message.role === "assistant" && message.content === resumedAgentLoop.finalContent);
          if (finalAssistant) {
            await this.options.appendThreadEvents(workspace, thread, [this.options.createThreadEvent("message", {
              role: "assistant", messageId: finalAssistant.id, content: resumedAgentLoop.finalContent
            })]);
          }
        }
        await this.options.updateThreadMetadata({
          workspaceId: workspace.id, threadId: thread.id,
          ...(nextSnapshot.approval ? { status: "awaiting-approval", statusLabel: "等待批准" }
            : approved && latestRun?.status === "failed" ? { status: "failed", statusLabel: "执行失败" }
            : { status: "idle", statusLabel: "" }),
          lastEventSummary: summary
        });
      }
    }
    // The session snapshot can momentarily omit `approval` while the resumed loop
    // has already requested its next tool approval. Keep the remote task alive
    // until the agent loop itself reaches a terminal state.
    const remoteAgentLoopFinished = resumedAgentLoop
      ? resumedAgentLoop.status !== "awaiting-approval" && resumedAgentLoop.status !== "running"
      : !nextSnapshot.approval;
    if (pendingTask && remoteAgentLoopFinished) {
      // Normalize the returned snapshot so the renderer does not keep「处理中」
      // because session.status was left as awaiting-approval after a finished loop.
      if (!nextSnapshot.approval) {
        nextSnapshot.approval = null;
        nextSnapshot.pendingTool = null;
        if (nextSnapshot.session && typeof nextSnapshot.session === "object") {
          nextSnapshot.session = {
            ...nextSnapshot.session,
            status: resumedAgentLoop?.status === "failed" || resumedAgentLoop?.status === "cancelled"
              || resumedAgentLoop?.status === "canceled"
              ? "failed"
              : "idle"
          };
        }
      }
      this.options.publishActivity({
        type: "complete",
        title: resumedAgentLoop?.status === "completed" ? "本轮已完成" : "本轮已结束",
        detail: String(resumedAgentLoop?.finalContent || "").slice(0, 240),
        status: resumedAgentLoop?.status === "completed" ? "completed" : "failed"
      }, effectiveRequestId);
      await this.options.disposeRuntime(targetRuntime);
      this.options.removeTask(effectiveRequestId);
      this.options.clearCanceledRequest(effectiveRequestId);
      await this.options.appendDebugLog(`model task approval completed request=${effectiveRequestId}`);
    }
  }
}
