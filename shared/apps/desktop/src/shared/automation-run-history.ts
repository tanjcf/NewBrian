/**
 * Codex heartbeat automations keep one target thread.
 * Each run appends to that thread. A catalog snapshot that has not
 * refreshed yet must not start a second conversation.
 */
export function codexAutomationSendPlan(input: {
  boundWorkspaceId?: string;
  boundThreadId?: string;
  snapshotHasThread: boolean;
  threadJustEnsured: boolean;
}): { appendToBoundThread: boolean } {
  const workspaceId = String(input.boundWorkspaceId || "").trim();
  const threadId = String(input.boundThreadId || "").trim();
  if (!workspaceId || !threadId) return { appendToBoundThread: false };
  return { appendToBoundThread: input.snapshotHasThread || input.threadJustEnsured };
}
