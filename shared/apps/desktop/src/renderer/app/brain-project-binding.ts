export type BrainProjectLike = {
  id: string;
  localWorkspaceId?: string | null;
};

export type BrainConversationLike = {
  id: string;
};

export type WorkspaceThreadLike = {
  id: string;
};

const LEGACY_CONVERSATION_PREFIX = "conversation_legacy_";

export function resolveBrainProjectForWorkspace(
  projects: readonly BrainProjectLike[],
  workspaceId: string | null | undefined
) {
  const normalized = String(workspaceId || "").trim();
  if (!normalized) return undefined;
  return projects.find((project) => String(project.localWorkspaceId || "").trim() === normalized);
}

export function parseLegacyConversationThreadId(conversationId: string) {
  const normalized = String(conversationId || "").trim();
  if (!normalized.startsWith(LEGACY_CONVERSATION_PREFIX)) return "";
  return normalized.slice(LEGACY_CONVERSATION_PREFIX.length);
}

export function resolveLegacyConversationIdForThread(threadId: string) {
  const normalized = String(threadId || "").trim();
  return normalized ? `${LEGACY_CONVERSATION_PREFIX}${normalized}` : "";
}

export function buildLegacyConversationThreadMappings(input: {
  conversations: readonly BrainConversationLike[];
  threads: readonly WorkspaceThreadLike[];
}) {
  const threadIds = new Set(input.threads.map((thread) => thread.id));
  const mappings: Record<string, string> = {};
  for (const conversation of input.conversations) {
    const threadId = parseLegacyConversationThreadId(conversation.id);
    if (threadId && threadIds.has(threadId)) {
      mappings[conversation.id] = threadId;
    }
  }
  return mappings;
}

export function shouldSyncBrainConversationThread(input: {
  sidebarRow: string | null | undefined;
  selectedWorkspaceId?: string | null;
  boundWorkspaceId?: string | null;
}) {
  const row = String(input.sidebarRow || "");
  if (
    row.startsWith("feature:")
    || row.startsWith("project:")
    || row.startsWith("project-thread:")
    || row.startsWith("chat:")
    || row.startsWith("task:")
  ) {
    return false;
  }
  if (!row.startsWith("brain-conversation:")) return false;
  const workspaceId = String(input.selectedWorkspaceId || "").trim();
  const boundWorkspaceId = String(input.boundWorkspaceId || "").trim();
  if (!workspaceId || !boundWorkspaceId) return false;
  return workspaceId === boundWorkspaceId;
}

export function mergeConversationThreadMappings(
  current: Record<string, string>,
  incoming: Record<string, string>
) {
  let changed = false;
  const next = { ...current };
  for (const [conversationId, threadId] of Object.entries(incoming)) {
    if (!threadId || next[conversationId] === threadId) continue;
    next[conversationId] = threadId;
    changed = true;
  }
  return changed ? next : current;
}
