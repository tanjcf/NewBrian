/**
 * Frozen write-back identity for one model-chat turn.
 * UI focus (activeThreadId) must never replace these fields when persisting.
 */
export type TurnScope = {
  workspaceId: string;
  threadId: string;
  requestId: string;
  turnId: string;
  runtimeId?: string;
  springSessionId?: string;
  springTurnId?: string;
  mediaJobId?: string;
};

export function createTurnScope(input: {
  workspaceId: string;
  threadId: string;
  requestId: string;
  turnId?: string;
  runtimeId?: string;
}): TurnScope {
  const workspaceId = String(input.workspaceId || "").trim();
  const threadId = String(input.threadId || "").trim();
  const requestId = String(input.requestId || "").trim();
  if (!workspaceId) throw new Error("TurnScope.workspaceId is required.");
  if (!threadId) throw new Error("TurnScope.threadId is required.");
  if (!requestId) throw new Error("TurnScope.requestId is required.");
  return {
    workspaceId,
    threadId,
    requestId,
    turnId: String(input.turnId || "").trim(),
    runtimeId: input.runtimeId ? String(input.runtimeId).trim() : undefined
  };
}

export function patchTurnScope(
  scope: TurnScope,
  patch: Partial<Omit<TurnScope, "workspaceId" | "threadId" | "requestId">>
): TurnScope {
  return {
    ...scope,
    ...patch,
    workspaceId: scope.workspaceId,
    threadId: scope.threadId,
    requestId: scope.requestId
  };
}

/** Assert a background write target matches the frozen task scope. */
export function assertTurnScopeMatch(
  scope: TurnScope,
  target: { workspaceId: string; threadId: string }
): void {
  if (scope.workspaceId !== target.workspaceId || scope.threadId !== target.threadId) {
    throw new Error(
      `TurnScope mismatch: scope=${scope.workspaceId}/${scope.threadId} target=${target.workspaceId}/${target.threadId}`
    );
  }
}
