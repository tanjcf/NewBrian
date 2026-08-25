export interface UpdatedThreadLike {
  id: string;
  updatedAt?: string;
}

function updatedAtValue(thread: UpdatedThreadLike) {
  const value = Date.parse(String(thread.updatedAt || ""));
  return Number.isFinite(value) ? value : 0;
}

export function sortThreadsByRecentActivity<T extends UpdatedThreadLike>(threads: T[]): T[] {
  return [...threads].sort((left, right) => {
    const activityDifference = updatedAtValue(right) - updatedAtValue(left);
    return activityDifference || left.id.localeCompare(right.id);
  });
}

export function mostRecentlyActiveThread<T extends UpdatedThreadLike>(threads: T[]): T | undefined {
  return sortThreadsByRecentActivity(threads)[0];
}

export function markThreadActiveInCatalog<
  TThread extends UpdatedThreadLike,
  TWorkspace extends { id: string; threads: TThread[] }
>(catalog: TWorkspace[], workspaceId: string, threadId: string, updatedAt: string): TWorkspace[] {
  return catalog.map((workspace) => workspace.id !== workspaceId ? workspace : {
    ...workspace,
    threads: workspace.threads.map((thread) => thread.id === threadId ? { ...thread, updatedAt } : thread)
  });
}

type ApprovalSettlingThread = UpdatedThreadLike & {
  status?: string;
  statusLabel?: string;
};

/**
 * Optimistically clear awaiting-approval catalog status after Approve/Reject.
 * Catalog state is a WorkspaceCatalogItem[] (not { workspaces: [] }); writing an
 * object shape makes App crash on workspaceCatalog.find during render.
 */
export function markThreadApprovalSettlingInCatalog<
  TThread extends ApprovalSettlingThread,
  TWorkspace extends { id: string; threads?: TThread[] }
>(
  catalog: TWorkspace[] | null | undefined,
  workspaceId: string,
  threadId: string,
  approved: boolean
): TWorkspace[] {
  if (!Array.isArray(catalog)) return [];
  return catalog.map((workspace) => {
    if (workspace.id !== workspaceId) return workspace;
    return {
      ...workspace,
      threads: (workspace.threads ?? []).map((thread) => {
        if (thread.id !== threadId) return thread;
        if (thread.status !== "awaiting-approval") return thread;
        return {
          ...thread,
          status: approved ? "running" : "idle",
          statusLabel: approved ? "执行中" : ""
        };
      })
    };
  });
}

/**
 * Drop sticky awaiting-approval metadata for one thread when activation proves
 * there is no live approval. Does not touch other workspaces/threads.
 */
export function clearStaleThreadApprovalInCatalog<
  TThread extends ApprovalSettlingThread,
  TWorkspace extends { id: string; threads?: TThread[] }
>(
  catalog: TWorkspace[] | null | undefined,
  workspaceId: string,
  threadId: string
): TWorkspace[] {
  return markThreadApprovalSettlingInCatalog(catalog, workspaceId, threadId, false);
}
