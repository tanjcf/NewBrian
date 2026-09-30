interface WorkspaceWithThreads {
  id: string;
  threads: Array<{ id: string }>;
}

/** Resolves an exact project/thread pair without cross-project fallback. */
export function requireWorkspaceThreadSelection<
  TWorkspace extends WorkspaceWithThreads
>(catalog: TWorkspace[], workspaceId: string, threadId: string): {
  workspace: TWorkspace;
  thread: TWorkspace["threads"][number];
} {
  const workspace = catalog.find((item) => item.id === workspaceId);
  if (!workspace) throw new Error("Project was not found.");
  const thread = workspace.threads.find((item) => item.id === threadId);
  if (!thread) throw new Error("Thread was not found in the selected project.");
  return { workspace, thread: thread as TWorkspace["threads"][number] };
}
