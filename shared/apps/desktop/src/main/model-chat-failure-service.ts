import type { WorkspaceCatalogItem, WorkspaceThreadRecord } from "@codex-forge/protocol";
import type { ThreadStateFile } from "./thread-state-factory.js";
import type { ThreadEventRecord } from "./thread-event-policy.js";

export interface ModelChatFailureDependencies {
  nowIso: () => string;
  readThreadState: (workspace: WorkspaceCatalogItem, thread: WorkspaceThreadRecord) => Promise<ThreadStateFile>;
  writeThreadState: (
    workspace: WorkspaceCatalogItem,
    thread: WorkspaceThreadRecord,
    state: ThreadStateFile
  ) => Promise<unknown>;
  createEvent: (type: "error", payload: Record<string, unknown>, turnId?: string) => ThreadEventRecord;
  appendEvents: (
    workspace: WorkspaceCatalogItem,
    thread: WorkspaceThreadRecord,
    events: ThreadEventRecord[]
  ) => Promise<unknown>;
  updateMetadata: (input: {
    workspaceId: string;
    threadId: string;
    status: "failed";
    statusLabel: string;
    lastEventSummary: string;
  }) => Promise<unknown>;
  reportFailure?: (input: {
    kind: string;
    message: string;
    stackTrace?: string;
    context: Record<string, unknown>;
  }) => Promise<unknown>;
}

/** Persists cancellation and model-request failure as one consistent thread transaction. */
export class ModelChatFailureService {
  private readonly dependencies: ModelChatFailureDependencies;

  constructor(dependencies: ModelChatFailureDependencies) {
    this.dependencies = dependencies;
  }

  async persistCancellation(
    workspace: WorkspaceCatalogItem,
    thread: WorkspaceThreadRecord,
    turnId: string
  ) {
    await this.dependencies.appendEvents(workspace, thread, [this.dependencies.createEvent("error", {
      stage: "model_request",
      code: "cancelled_by_user",
      message: "The user cancelled the current task."
    }, turnId)]);
    await this.dependencies.updateMetadata({
      workspaceId: workspace.id,
      threadId: thread.id,
      status: "failed",
      statusLabel: "Cancelled",
      lastEventSummary: "The user cancelled the current task."
    });
  }

  async persistFailure(input: {
    workspace: WorkspaceCatalogItem;
    thread: WorkspaceThreadRecord;
    requestId: string;
    turnId: string;
    reasoningSummary: string;
    partialContent?: string;
    error: unknown;
  }) {
    const failureMessage = input.error instanceof Error ? input.error.message : String(input.error);
    const failureCode = input.error instanceof Error && "code" in input.error
      ? String((input.error as { code?: unknown }).code ?? "")
      : /reasoning_content[\s\S]{0,120}must be passed back|must be passed back[\s\S]{0,120}reasoning_content/i.test(failureMessage)
        ? "gateway_reasoning_context_required"
      : /model callback timed out|model_callback_timeout/i.test(failureMessage)
        ? "model_callback_timeout"
        : /Tool Host exited|hostFailure|tool host/i.test(failureMessage)
          ? "tool_host_failure"
          : /ECONNREFUSED|无法连接模型网关/i.test(failureMessage)
            ? "gateway_unreachable"
            : "model_request_failed";
    const partialContent = String(input.partialContent ?? "").trim();
    const reasoningSummary = input.reasoningSummary.trim();
    // Always persist a visible failure assistant row. Approval/media/tool failures often
    // have empty streamed body; skipping write left activate/reconcile with only the
    // user bubble and a blank white transcript.
    const state = await this.dependencies.readThreadState(input.workspace, input.thread);
    const existing = state.messages.find((message) => message.id === input.requestId)
      ?? [...state.messages].reverse().find((message) =>
        message.role === "assistant" && !message.excludeFromModelContext);
    const persistedSummary = reasoningSummary
      ? `${reasoningSummary}\n\n本轮在完成前发生异常：${failureMessage}`
      : `本轮在完成前发生异常：${failureMessage}`;
    const failureContent = partialContent
      || (existing && String(existing.content || "").trim())
      || `本轮执行失败：${failureMessage}`;
    if (existing) {
      if (failureContent.length >= String(existing.content ?? "").length) {
        existing.content = failureContent;
      } else if (!String(existing.content || "").trim()) {
        existing.content = failureContent;
      }
      existing.reasoningSummary = persistedSummary;
      existing.excludeFromModelContext = true;
    } else {
      state.messages.push({
        id: input.requestId,
        role: "assistant",
        content: failureContent,
        createdAt: this.dependencies.nowIso(),
        reasoningSummary: persistedSummary,
        excludeFromModelContext: true
      });
    }
    await this.dependencies.writeThreadState(input.workspace, input.thread, state);
    const gatewayReasoningRepair = failureCode === "gateway_reasoning_context_required";
    await this.dependencies.appendEvents(input.workspace, input.thread, [this.dependencies.createEvent("error", {
      stage: "model_request",
      message: failureMessage,
      code: failureCode,
      ...(gatewayReasoningRepair ? {
        httpStatus: 400,
        remediation: "retry_without_stale_thinking_context"
      } : {})
    }, input.turnId)]);
    await this.dependencies.updateMetadata({
      workspaceId: input.workspace.id,
      threadId: input.thread.id,
      status: "failed",
      statusLabel: "执行失败",
      lastEventSummary: failureMessage.slice(0, 120) || "模型请求失败"
    });
    void this.dependencies.reportFailure?.({
      kind: "model_request_failed",
      message: failureMessage,
      stackTrace: input.error instanceof Error ? input.error.stack : undefined,
      context: {
        workspaceId: input.workspace.id,
        threadId: input.thread.id,
        requestId: input.requestId,
        turnId: input.turnId,
        stage: "model_request",
        failureCode,
        ...(gatewayReasoningRepair ? {
          httpStatus: 400,
          remediation: "retry_without_stale_thinking_context"
        } : {}),
        terminal: true
      }
    }).catch(() => undefined);
  }
}
