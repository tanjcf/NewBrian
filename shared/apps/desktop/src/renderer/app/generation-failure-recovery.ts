const ACTIVE_THREAD_ERROR = "The selected thread already has a running task.";
const ACTIVE_THREAD_ERROR_ZH = "当前线程仍有未结束的任务。请先点击停止，或等待完成后再发送。";

function matchesActiveThreadError(message: string) {
  const text = String(message || "").trim();
  return text === ACTIVE_THREAD_ERROR
    || text === ACTIVE_THREAD_ERROR_ZH
    || text.includes(ACTIVE_THREAD_ERROR)
    || text.includes(ACTIVE_THREAD_ERROR_ZH);
}

interface ActiveThreadRetryInput<TSnapshot> {
  message: string;
  workspaceId: string;
  threadId: string;
  activateThread: (input: { workspaceId: string; threadId: string }) => Promise<TSnapshot>;
  /** Cancel/force-release stuck model tasks for this thread before activating. */
  releaseThreadTasks?: (input: { workspaceId: string; threadId: string }) => Promise<unknown> | unknown;
}

export async function recoverActiveThreadRetry<TSnapshot>(input: ActiveThreadRetryInput<TSnapshot>): Promise<
  { recovered: true; snapshot: TSnapshot } | { recovered: false }
> {
  if (!matchesActiveThreadError(input.message) || !input.workspaceId || !input.threadId) {
    return { recovered: false };
  }
  await input.releaseThreadTasks?.({
    workspaceId: input.workspaceId,
    threadId: input.threadId
  });
  const snapshot = await input.activateThread({
    workspaceId: input.workspaceId,
    threadId: input.threadId
  });
  return { recovered: true, snapshot };
}
