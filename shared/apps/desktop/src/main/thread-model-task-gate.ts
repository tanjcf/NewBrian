/**
 * Gate for one-thread-one-live-model-task.
 * Stale/aborted map entries must not block a new user turn.
 */

export const THREAD_ALREADY_RUNNING_ERROR = "The selected thread already has a running task.";

/** User-visible copy when a live task still blocks after displace. */
export const THREAD_ALREADY_RUNNING_ERROR_ZH =
  "当前线程仍有未结束的任务。请先点击停止，或等待完成后再发送。";

export interface ThreadModelTaskLike {
  workspaceId: string;
  threadId: string;
  abortController: AbortController;
  runtime?: {
    cancelAgentLoop?: (reason?: string) => unknown;
    getAgentLoopSnapshot?: () => { status?: string } | null;
    getSnapshot?: () => { approval?: unknown };
  };
}

export function isThreadModelTaskStale(task: ThreadModelTaskLike): boolean {
  if (task.abortController.signal.aborted) return true;
  const status = String(task.runtime?.getAgentLoopSnapshot?.()?.status ?? "").trim().toLowerCase();
  return status === "completed"
    || status === "failed"
    || status === "cancelled"
    || status === "canceled"
    || status === "idle";
}

export function listThreadModelTaskIds<T extends ThreadModelTaskLike>(
  tasks: Iterable<[string, T]>,
  workspaceId: string,
  threadId: string
): string[] {
  return [...tasks]
    .filter(([, task]) => task.workspaceId === workspaceId && task.threadId === threadId)
    .map(([requestId]) => requestId);
}

/**
 * Abort + force-remove every task for the thread (including approval-retained).
 * Returns how many entries were removed from the map.
 */
export function displaceThreadModelTasks<T extends ThreadModelTaskLike>(input: {
  tasks: Map<string, T>;
  workspaceId: string;
  threadId: string;
  reason?: string;
  markCanceled?: (requestId: string) => void;
  clearCanceled?: (requestId: string) => void;
}): number {
  const reason = input.reason?.trim() || "Displaced by a newer user turn on the same thread.";
  const requestIds = listThreadModelTaskIds(input.tasks.entries(), input.workspaceId, input.threadId);
  let removed = 0;
  for (const requestId of requestIds) {
    const task = input.tasks.get(requestId);
    if (!task) continue;
    input.markCanceled?.(requestId);
    try {
      if (!task.abortController.signal.aborted) task.abortController.abort();
    } catch {
      // ignore double-abort
    }
    try {
      task.runtime?.cancelAgentLoop?.(reason);
    } catch {
      // best-effort; map entry must still be cleared
    }
    if (input.tasks.delete(requestId)) removed += 1;
    input.clearCanceled?.(requestId);
  }
  return removed;
}

export function pruneStaleThreadModelTasks<T extends ThreadModelTaskLike>(
  tasks: Map<string, T>,
  workspaceId?: string,
  threadId?: string
): number {
  let removed = 0;
  for (const [requestId, task] of [...tasks.entries()]) {
    if (workspaceId && task.workspaceId !== workspaceId) continue;
    if (threadId && task.threadId !== threadId) continue;
    if (!isThreadModelTaskStale(task)) continue;
    if (tasks.delete(requestId)) removed += 1;
  }
  return removed;
}

export function matchesThreadAlreadyRunningError(message: string): boolean {
  const text = String(message || "").trim();
  return text === THREAD_ALREADY_RUNNING_ERROR
    || text === THREAD_ALREADY_RUNNING_ERROR_ZH
    || text.includes(THREAD_ALREADY_RUNNING_ERROR)
    || text.includes(THREAD_ALREADY_RUNNING_ERROR_ZH);
}
