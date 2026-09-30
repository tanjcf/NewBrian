export type AssistantActivityLike = {
  type?: string;
  title?: string;
  status?: string;
  callId?: string;
  detail?: string;
  command?: string;
  [key: string]: unknown;
};

const REPLACEABLE_RUN_TITLES = new Set([
  "正在执行命令",
  "等待批准",
  "已执行命令",
  "命令执行失败"
]);

function sameRunIdentity(
  left: AssistantActivityLike | undefined,
  right: AssistantActivityLike | undefined
): boolean {
  if (!left || !right) return false;
  if (left.type !== "run" || right.type !== "run") return false;
  if (left.callId && right.callId) return left.callId === right.callId;
  if (left.callId || right.callId) return false;
  const leftDetail = String(left.detail || left.command || "");
  const rightDetail = String(right.detail || right.command || "");
  return Boolean(leftDetail) && leftDetail === rightDetail;
}

/**
 * Merge a live assistant activity into the request bucket.
 * Same-callId (or same command detail) run updates replace earlier pending rows
 * so "等待批准" does not stick after the tool finishes.
 */
export function mergeAssistantActivityItems<T extends AssistantActivityLike>(
  currentItems: T[],
  activity: T
): T[] {
  if (activity.type === "run") {
    const replaceIndex = currentItems.findIndex(
      (item) =>
        sameRunIdentity(item, activity)
        && REPLACEABLE_RUN_TITLES.has(String(item.title || ""))
    );
    if (replaceIndex >= 0) {
      const next = [...currentItems];
      next[replaceIndex] = { ...currentItems[replaceIndex], ...activity };
      return next.slice(-100);
    }
  }

  const previous = currentItems.at(-1);
  if (
    previous?.type === "run"
    && REPLACEABLE_RUN_TITLES.has(String(previous.title || ""))
    && activity.type === "run"
    && sameRunIdentity(previous, activity)
  ) {
    return [...currentItems.slice(0, -1), activity].slice(-100);
  }

  return [...currentItems, activity].slice(-100);
}

export function findLivePendingApprovalActivity(
  activities: AssistantActivityLike[] | null | undefined
): AssistantActivityLike | undefined {
  for (let index = (activities ?? []).length - 1; index >= 0; index -= 1) {
    const activity = activities![index];
    if (!(activity?.title === "等待批准" || activity?.status === "approval")) continue;
    if (
      activity.callId
      && (activities ?? []).some((item) =>
        item !== activity
        && sameRunIdentity(item, activity)
        && (item.title === "已执行命令" || item.title === "命令执行失败" || item.status === "failed" || item.status === "completed")
      )
    ) {
      continue;
    }
    return activity;
  }
  return undefined;
}

/**
 * Approval banners must clear once the runtime snapshot drops `approval`.
 * Catalog thread status alone is too sticky after approve + failed tool runs.
 */
export function resolveEffectiveApproval(input: {
  snapshotApproval?: { id?: string; message?: string; requiresConfirmation?: boolean } | null;
  selectedThreadAwaitingApproval?: boolean;
  selectedThreadMessage?: string;
  liveActivities?: AssistantActivityLike[] | null;
  /** True after the user clicked approve/reject and snapshot.approval was cleared. */
  approvalDecisionPending?: boolean;
  /**
   * Approval id the user already decided. Snapshot and activity replays of that
   * same id must not put the card back while resume is still running.
   */
  settledApprovalId?: string;
  /**
   * When false, ignore process-global snapshot.approval (owned by another thread)
   * and do not synthesize a banner from sticky catalog awaiting-approval alone.
   */
  selectedThreadOwnsLiveApproval?: boolean;
  /** True when this thread still has an in-flight request id. */
  selectedThreadHasLiveRequest?: boolean;
}): { message: string; requiresConfirmation: boolean } | null {
  if (input.approvalDecisionPending && !input.snapshotApproval) {
    return null;
  }
  const settledApprovalId = input.settledApprovalId?.trim() || "";
  const snapshotApprovalId = input.snapshotApproval?.id?.trim() || "";
  if (settledApprovalId && (!snapshotApprovalId || snapshotApprovalId === settledApprovalId)) {
    return null;
  }
  const ownsLiveApproval = input.selectedThreadOwnsLiveApproval !== false;
  if (input.snapshotApproval && ownsLiveApproval) {
    return {
      message: input.snapshotApproval.message || "运行此命令需要你的确认",
      requiresConfirmation: input.snapshotApproval.requiresConfirmation !== false
    };
  }
  const liveApproval = findLivePendingApprovalActivity(input.liveActivities);
  if (liveApproval && ownsLiveApproval) {
    return {
      message: String(liveApproval.detail || liveApproval.command || "运行此命令需要你的确认"),
      requiresConfirmation: true
    };
  }
  // Catalog-only synthesis is sticky across restarts and other scenes; only keep
  // it while this thread still owns a live request and has no activity rows yet.
  if (
    ownsLiveApproval
    && input.selectedThreadHasLiveRequest
    && input.selectedThreadAwaitingApproval
    && !(input.liveActivities && input.liveActivities.length)
  ) {
    return {
      message: input.selectedThreadMessage || "当前线程有工具调用等待批准",
      requiresConfirmation: true
    };
  }
  return null;
}

/** Optimistically replace sticky 等待批准 rows after the user clicks approve/reject. */
export function markApprovalActivitiesSettling<T extends AssistantActivityLike>(
  activities: T[],
  approved: boolean
): T[] {
  return activities.map((activity) => {
    if (!(activity?.title === "等待批准" || activity?.status === "approval")) return activity;
    if (approved) {
      return {
        ...activity,
        title: "正在执行命令",
        status: "running"
      } as T;
    }
    return {
      ...activity,
      title: "命令执行失败",
      status: "failed",
      failureMessage: "已拒绝批准"
    } as T;
  });
}
