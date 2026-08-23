import {
  INTERNAL_CHAT_WORKSPACE_ID,
  isBrainWorkspaceKey,
  type BrainWorkspaceKey,
  type SearchResultSpec,
  type WorkspaceCatalogItem
} from "@codex-forge/protocol";

/** Coerce IPC/catalog payloads into WorkspaceCatalogItem[]. Rejects `{ workspaces: [] }` object shapes. */
export function normalizeWorkspaceCatalog(value: unknown): WorkspaceCatalogItem[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is WorkspaceCatalogItem => Boolean(item) && typeof item === "object");
  }
  if (value && typeof value === "object") {
    const nested = (value as { workspaces?: unknown }).workspaces;
    if (Array.isArray(nested)) {
      return nested.filter((item): item is WorkspaceCatalogItem => Boolean(item) && typeof item === "object");
    }
  }
  return [];
}

export function resolveCatalogBrainWorkspaceKey(
  workspace: Pick<WorkspaceCatalogItem, "brainWorkspaceKey"> | { brainWorkspaceKey?: unknown } | null | undefined
): BrainWorkspaceKey {
  return isBrainWorkspaceKey(workspace?.brainWorkspaceKey) ? workspace.brainWorkspaceKey : "document";
}

export function filterWorkspaceCatalogByScene(
  workspaces: readonly WorkspaceCatalogItem[],
  sceneKey: BrainWorkspaceKey
): WorkspaceCatalogItem[] {
  return workspaces.filter((workspace) => resolveCatalogBrainWorkspaceKey(workspace) === sceneKey);
}

export function catalogWorkspaceRecencyMs(workspace: Pick<WorkspaceCatalogItem, "threads">) {
  let latest = 0;
  for (const thread of workspace.threads ?? []) {
    const at = Date.parse(String(thread.updatedAt || ""));
    if (Number.isFinite(at) && at > latest) latest = at;
  }
  return latest;
}

export function crossSceneRecentProjects(
  workspaces: readonly WorkspaceCatalogItem[],
  currentSceneKey: BrainWorkspaceKey,
  limit = 5
): WorkspaceCatalogItem[] {
  return [...workspaces]
    .filter((workspace) => isProjectVisible(workspace) && resolveCatalogBrainWorkspaceKey(workspace) !== currentSceneKey)
    .sort((left, right) => catalogWorkspaceRecencyMs(right) - catalogWorkspaceRecencyMs(left) || left.name.localeCompare(right.name))
    .slice(0, limit);
}

export function isProjectVisible(workspace: Pick<WorkspaceCatalogItem, "id">) {
  return workspace.id !== INTERNAL_CHAT_WORKSPACE_ID;
}

/** OpenClaw-style: internal subagent sessions stay out of the user thread surface. */
export function isUserVisibleThread(thread: { kind?: string | null }) {
  return thread.kind !== "subagent";
}

export function userVisibleThreads<T extends { kind?: string | null }>(threads: readonly T[]): T[] {
  return threads.filter(isUserVisibleThread);
}

export function resolveUserVisibleThreadSelection<
  T extends { id: string; kind?: string | null; parentThreadId?: string | null; updatedAt?: string }
>(threads: readonly T[], selectedThreadId: string | undefined | null): T | undefined {
  const visible = userVisibleThreads(threads);
  if (!visible.length) return undefined;
  const selectedId = String(selectedThreadId || "").trim();
  if (selectedId) {
    const direct = visible.find((thread) => thread.id === selectedId);
    if (direct) return direct;
    const hidden = threads.find((thread) => thread.id === selectedId);
    if (hidden?.kind === "subagent" && hidden.parentThreadId) {
      const parent = visible.find((thread) => thread.id === hidden.parentThreadId);
      if (parent) return parent;
    }
  }
  return [...visible].sort((left, right) => {
    const leftAt = Date.parse(String(left.updatedAt || ""));
    const rightAt = Date.parse(String(right.updatedAt || ""));
    const leftValue = Number.isFinite(leftAt) ? leftAt : 0;
    const rightValue = Number.isFinite(rightAt) ? rightAt : 0;
    return rightValue - leftValue || left.id.localeCompare(right.id);
  })[0];
}

export function projectWorkspaces(workspaces: readonly WorkspaceCatalogItem[]) {
  return workspaces
    .filter(isProjectVisible)
    .map((workspace) => ({
      ...workspace,
      threads: workspace.threads.filter((thread) => thread.scope !== "chat" && isUserVisibleThread(thread))
    }));
}

export function chatWorkspaces(workspaces: readonly WorkspaceCatalogItem[]) {
  return workspaces.flatMap((workspace) => {
    const threads = workspace.threads.filter((thread) => thread.scope === "chat" && isUserVisibleThread(thread));
    return threads.length > 0 ? [{ ...workspace, threads }] : [];
  });
}

export function projectSearchResults(
  results: readonly SearchResultSpec[],
  workspaces: readonly Pick<WorkspaceCatalogItem, "id" | "threads">[]
) {
  const projectWorkspacesById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  return results.filter((result) => {
    if (!result.workspaceId) return true;
    const workspace = projectWorkspacesById.get(result.workspaceId);
    if (!workspace) return false;
    return !result.threadId || workspace.threads.some((thread) => thread.id === result.threadId);
  });
}
