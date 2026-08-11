/** Classifies post-approval agent-loop failures that must end the busy turn. */

export function isTerminalAgentLoopFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Agent loop stalled|no tool progress|Agent loop exceeded \d+ model steps|Agent loop was cancelled/i
    .test(message);
}

/** User-visible Chinese summary for a terminal approval-resume failure. */
export function formatApprovalResumeFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/no tool progress|Agent loop stalled/i.test(message)) {
    return "本轮已停止：连续多步工具没有成功进展（可能被循环检测拦截）。请发新消息继续。";
  }
  if (/Agent loop exceeded \d+ model steps/i.test(message)) {
    return "本轮已停止：达到模型步数上限。请发新消息继续。";
  }
  if (/Agent loop was cancelled/i.test(message)) {
    return "当前审批已失效：Agent loop 已取消。请重新发送任务。";
  }
  return message.trim() || "本轮执行失败。请发新消息继续。";
}
