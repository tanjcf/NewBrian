/** Where an automation should run when its saved thread is gone. */
export function planAutomationThreadTarget(input: {
  boundWorkspaceId?: string;
  boundThreadId?: string;
  workspaceExists: boolean;
  threadExists: boolean;
  fallbackWorkspaceId: string;
}): { workspaceId: string; createThread: boolean } {
  const boundWorkspaceId = String(input.boundWorkspaceId || "").trim();
  const boundThreadId = String(input.boundThreadId || "").trim();
  if (input.workspaceExists && input.threadExists && boundWorkspaceId && boundThreadId) {
    return { workspaceId: boundWorkspaceId, createThread: false };
  }
  if (input.workspaceExists && boundWorkspaceId) {
    return { workspaceId: boundWorkspaceId, createThread: true };
  }
  return { workspaceId: String(input.fallbackWorkspaceId || "").trim(), createThread: true };
}
