export interface ManagedWorktree {
  repositoryRoot: string;
  worktreePath: string;
  branch: string;
  baseRef: string;
}
export class WorktreeManager {
  constructor(input: { workspacePath: string; storageRoot?: string });
  repositoryRoot(): Promise<string>;
  create(input: { taskId: string; baseRef?: string }): Promise<ManagedWorktree>;
  status(worktreePath: string): Promise<string>;
}
