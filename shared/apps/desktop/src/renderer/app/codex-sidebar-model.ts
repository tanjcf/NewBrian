export type CodexSidebarSortMode = "priority" | "updated";

export interface CodexSidebarThread {
  id: string;
  status?: string;
  updatedAt?: string | number;
}

function updatedAtMs(thread: CodexSidebarThread): number {
  if (typeof thread.updatedAt === "number") return thread.updatedAt;
  const parsed = Date.parse(thread.updatedAt ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function priorityRank(thread: CodexSidebarThread, unreadIds: ReadonlySet<string>): number {
  if (thread.status === "awaiting-approval") return 0;
  if (unreadIds.has(thread.id)) return 1;
  if (thread.status === "running") return 2;
  if (thread.status === "failed") return 3;
  return 4;
}

/** Mirrors Codex sidebar ordering: pinned, attention/unread, then recent activity. */
export function sortCodexSidebarThreads<T extends CodexSidebarThread>(
  threads: readonly T[],
  sortMode: CodexSidebarSortMode,
  pinnedIds: ReadonlySet<string>,
  unreadIds: ReadonlySet<string>
): T[] {
  return threads
    .map((thread, index) => ({ thread, index }))
    .sort((left, right) => {
      const pinned = Number(pinnedIds.has(right.thread.id)) - Number(pinnedIds.has(left.thread.id));
      if (pinned !== 0) return pinned;
      if (sortMode === "priority") {
        const priority = priorityRank(left.thread, unreadIds) - priorityRank(right.thread, unreadIds);
        if (priority !== 0) return priority;
      }
      return updatedAtMs(right.thread) - updatedAtMs(left.thread) || left.index - right.index;
    })
    .map(({ thread }) => thread);
}
