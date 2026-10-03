const APPROVAL_WAIT_LEAD = "已请求执行工具，等待你批准后继续。";
const APPROVAL_WAIT_TAIL = "批准后会继续生成可见结果；拒绝则本轮停止。";

/** True when the text is the temporary approval-wait copy, not a finished answer. */
export function isApprovalWaitNotice(content: string | null | undefined): boolean {
  return String(content ?? "").includes(APPROVAL_WAIT_TAIL);
}

/** Remove the approval-wait copy and keep any real answer that was stored beside it. */
export function stripApprovalWaitNotice(content: string | null | undefined): string {
  return String(content ?? "")
    .replaceAll(APPROVAL_WAIT_LEAD, "")
    .replace(/待确认工具：[^\n]*/g, "")
    .replaceAll(APPROVAL_WAIT_TAIL, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * After the user has approved or rejected, the wait notice must not remain the answer.
 * A real body is kept; a notice-only body becomes the supplied fallback.
 */
export function settleApprovalWaitFinalContent(content: string | null | undefined, fallback: string): string {
  const body = stripApprovalWaitNotice(content);
  if (body) return body;
  if (isApprovalWaitNotice(content) || !String(content ?? "").trim()) return fallback;
  return String(content ?? "").trim();
}
