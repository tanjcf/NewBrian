/** Ensures UI keeps the approval card when the agent loop pauses again after resume. */
export function ensureApprovalSnapshotForPendingLoop<T extends Record<string, unknown>>(input: {
  snapshot: T;
  loopStatus?: string | null;
  pending?: {
    call?: { id?: string; name?: string; arguments?: Record<string, unknown> };
    descriptor?: { kind?: string; description?: string; risk?: string; title?: string };
  } | null;
}): T {
  const snapshot = input.snapshot;
  if (input.loopStatus !== "awaiting-approval") return snapshot;
  if (snapshot.approval) return snapshot;
  const call = input.pending?.call;
  const descriptor = input.pending?.descriptor;
  if (!call?.id) {
    return {
      ...snapshot,
      session: {
        ...((snapshot.session as Record<string, unknown> | undefined) ?? {}),
        status: "awaiting-approval"
      }
    };
  }
  const command = call.name === "shell.exec"
    ? String(call.arguments?.command ?? "")
    : undefined;
  const toolName = String(call.name || "tool");
  return {
    ...snapshot,
    pendingTool: {
      id: call.id,
      kind: descriptor?.kind || "command",
      reason: descriptor?.description || `需要确认后继续执行 ${toolName}`,
      risk: descriptor?.risk || "medium",
      command
    },
    approval: {
      id: `approval-pending-${call.id}`,
      toolRequestId: call.id,
      message: descriptor?.description
        || (command ? `需要批准后执行：${command}` : `需要批准后继续：${toolName}`),
      requiresConfirmation: true
    },
    session: {
      ...((snapshot.session as Record<string, unknown> | undefined) ?? {}),
      status: "awaiting-approval"
    }
  };
}

/**
 * Hosted agent loops keep pending tool state on the loop snapshot, not on the
 * local sessionMachine. Write the synthesized approval onto the live session so
 * getSnapshot()/respondApproval stay consistent with the UI card.
 */
export function applyPendingApprovalToSessionSnapshot(input: {
  sessionSnapshot?: Record<string, unknown> | null;
  loopStatus?: string | null;
  pending?: {
    call?: { id?: string; name?: string; arguments?: Record<string, unknown> };
    descriptor?: { kind?: string; description?: string; risk?: string; title?: string };
  } | null;
}): Record<string, unknown> | null {
  if (!input.sessionSnapshot) return null;
  if (input.loopStatus !== "awaiting-approval") {
    if (input.sessionSnapshot.approval != null || input.sessionSnapshot.pendingTool != null) {
      input.sessionSnapshot.approval = undefined;
      input.sessionSnapshot.pendingTool = undefined;
    }
    return input.sessionSnapshot;
  }
  const ensured = ensureApprovalSnapshotForPendingLoop({
    snapshot: input.sessionSnapshot,
    loopStatus: input.loopStatus,
    pending: input.pending
  });
  if (ensured.approval) input.sessionSnapshot.approval = ensured.approval;
  if (ensured.pendingTool) input.sessionSnapshot.pendingTool = ensured.pendingTool;
  if (ensured.session) input.sessionSnapshot.session = ensured.session;
  return input.sessionSnapshot;
}

/** True when the renderer must keep the active model request after an approval response. */
export function shouldKeepApprovalRequestAlive(nextSnapshot: {
  approval?: unknown;
  session?: { status?: string } | null;
} | null | undefined): boolean {
  if (!nextSnapshot) return false;
  if (nextSnapshot.approval) return true;
  return nextSnapshot.session?.status === "awaiting-approval";
}

export function buildEmptyTurnFallbackContent(input: {
  latestUserText?: string;
  failedCommands?: Array<{ command?: string; failureMessage?: string; stderr?: string }>;
}): string {
  const failed = (input.failedCommands ?? []).filter((item) => item.command || item.failureMessage || item.stderr);
  const userAsk = String(input.latestUserText || "").trim();
  const lines = [
    "本轮没有生成可见回复。",
    userAsk ? `你的请求是：${userAsk}` : "",
    failed.length
      ? `已尝试的操作未能完成：\n${failed.slice(0, 3).map((item) => {
        const command = String(item.command || "命令").trim();
        const detail = String(item.failureMessage || item.stderr || "执行失败").trim().split(/\r?\n/)[0];
        return `- ${command}：${detail}`;
      }).join("\n")}`
      : "中间工具调用已结束，但模型没有写出最终说明。",
    "请再发一条消息继续，或手动选择可用模型后重试。"
  ];
  return lines.filter(Boolean).join("\n\n");
}
