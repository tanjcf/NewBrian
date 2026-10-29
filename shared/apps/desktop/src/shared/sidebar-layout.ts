export const SIDEBAR_PROJECT_ORDER_STORAGE_KEY = "newbrain.sidebarProjectOrder.v1";
export const PINNED_THREAD_STORAGE_KEY = "newbrain.pinnedThreadIds.v1";
export const THREAD_DRAG_TYPE = "application/x-newbrain-thread";
export const PROJECT_DRAG_TYPE = "application/x-newbrain-project";

export interface SidebarThreadRef {
  id: string;
}

export interface SidebarProjectRef<T extends SidebarThreadRef = SidebarThreadRef> {
  id: string;
  threads?: T[];
}

export function sameProjectOrder<T extends { id: string }>(left: readonly T[], right: readonly T[]) {
  return left.length === right.length && left.every((item, index) => item.id === right[index]?.id);
}

/**
 * Visual project order. Without a manual order, newest catalog entries stay first.
 * A saved drag order is kept, and projects created after that order are appended.
 * Pinned projects stay above the rest.
 */
export function orderProjectsForSidebar<T extends { id: string }>(
  workspaces: readonly T[],
  pinnedIds: ReadonlySet<string> = new Set(),
  manualOrderIds?: readonly string[]
): T[] {
  const base = manualOrderIds && manualOrderIds.length > 0
    ? applyManualProjectOrder(workspaces, manualOrderIds)
    : [...workspaces].reverse();
  return base.sort((left, right) => Number(pinnedIds.has(right.id)) - Number(pinnedIds.has(left.id)));
}

function applyManualProjectOrder<T extends { id: string }>(workspaces: readonly T[], manualOrderIds: readonly string[]): T[] {
  const byId = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const placed = new Set<string>();
  const ordered: T[] = [];
  for (const id of manualOrderIds) {
    const workspace = byId.get(id);
    if (!workspace || placed.has(id)) continue;
    placed.add(id);
    ordered.push(workspace);
  }
  const fresh = [...workspaces].reverse().filter((workspace) => !placed.has(workspace.id));
  return [...ordered, ...fresh];
}

/** Move projectId to the slot before beforeProjectId. Omit beforeProjectId to append. */
export function moveProjectBefore<T extends { id: string }>(
  projects: readonly T[],
  projectId: string,
  beforeProjectId?: string | null
): T[] {
  if (beforeProjectId && beforeProjectId === projectId) {
    throw new Error("cannot move a project before itself");
  }
  const fromIndex = projects.findIndex((item) => item.id === projectId);
  if (fromIndex < 0) throw new Error("project not found");
  const moving = projects[fromIndex];
  const rest = projects.filter((item) => item.id !== projectId);
  if (!beforeProjectId) return [...rest, moving];
  const beforeIndex = rest.findIndex((item) => item.id === beforeProjectId);
  if (beforeIndex < 0) throw new Error("before project not found");
  return [...rest.slice(0, beforeIndex), moving, ...rest.slice(beforeIndex)];
}

/** Reassign one thread to another existing project. The thread id stays the same. */
export function moveThreadBetweenProjects<T extends SidebarProjectRef>(
  projects: readonly T[],
  input: { threadId: string; fromWorkspaceId: string; toWorkspaceId: string }
): T[] {
  if (!input.threadId || !input.fromWorkspaceId || !input.toWorkspaceId) {
    throw new Error("thread move input is invalid");
  }
  if (input.fromWorkspaceId === input.toWorkspaceId) {
    throw new Error("thread is already in this project");
  }
  const source = projects.find((item) => item.id === input.fromWorkspaceId);
  const target = projects.find((item) => item.id === input.toWorkspaceId);
  if (!source) throw new Error("source project not found");
  if (!target) throw new Error("target project not found");
  const thread = (source.threads ?? []).find((item) => item.id === input.threadId);
  if (!thread) throw new Error("thread not found");
  return projects.map((project) => {
    if (project.id === source.id) {
      return { ...project, threads: (project.threads ?? []).filter((item) => item.id !== thread.id) };
    }
    if (project.id === target.id) {
      return { ...project, threads: [...(project.threads ?? []), thread] };
    }
    return project;
  });
}
