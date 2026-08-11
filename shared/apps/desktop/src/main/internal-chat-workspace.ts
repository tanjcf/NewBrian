import { dirname, join, resolve } from "node:path";
import { INTERNAL_CHAT_WORKSPACE_ID, type WorkspaceCatalogItem } from "@codex-forge/protocol";

export { INTERNAL_CHAT_WORKSPACE_ID } from "@codex-forge/protocol";

export function resolveInternalChatPath(input: {
  isPackaged: boolean;
  execPath: string;
  workspacePath: string;
}) {
  return join(input.isPackaged ? dirname(input.execPath) : input.workspacePath, "tmp");
}

export function isInternalChatWorkspace(input: Pick<WorkspaceCatalogItem, "id">) {
  return input.id === INTERNAL_CHAT_WORKSPACE_ID;
}

export function ensureInternalChatWorkspace(
  workspaces: WorkspaceCatalogItem[],
  path: string
): WorkspaceCatalogItem[] {
  const existing = workspaces.filter(isInternalChatWorkspace);
  const internal = normalizeInternalRecord(existing, path);
  if (existing.length === 0) return [...workspaces, internal];

  let internalInserted = false;
  return workspaces.flatMap((item) => {
    if (!isInternalChatWorkspace(item)) return [item];
    if (internalInserted) return [];
    internalInserted = true;
    return [internal];
  });
}

export function assertProjectWorkspace(workspaceId: string) {
  if (workspaceId === INTERNAL_CHAT_WORKSPACE_ID) {
    throw new Error("Project operations are not available for standalone chat.");
  }
}

function normalizeInternalRecord(existing: WorkspaceCatalogItem[], path: string): WorkspaceCatalogItem {
  return {
    id: INTERNAL_CHAT_WORKSPACE_ID,
    name: "__internal_chat__",
    path: resolve(path),
    threads: mergeInternalChatThreads(existing)
  };
}

function mergeInternalChatThreads(existing: WorkspaceCatalogItem[]) {
  const seenThreadIds = new Set<string>();
  return existing.flatMap((workspace) => workspace.threads.filter((thread) => {
    if (thread.scope !== "chat" || seenThreadIds.has(thread.id)) return false;
    seenThreadIds.add(thread.id);
    return true;
  }));
}
