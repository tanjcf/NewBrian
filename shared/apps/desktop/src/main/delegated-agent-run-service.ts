import type { WorkspaceCatalogItem, WorkspaceThreadRecord } from "@codex-forge/protocol";

interface WorkspaceCatalog {
  workspaces: WorkspaceCatalogItem[];
}

export interface DelegatedTaskRecord {
  id: string;
  childThreadId: string;
  instruction: string;
  status: string;
  summary?: string;
  error?: string;
}

export interface DelegatedExecutionResult {
  [key: string]: unknown;
  summary?: string;
  content?: string;
}

export interface DelegatedAgentRunDependencies<TTask extends DelegatedTaskRecord> {
  listTasks: () => TTask[];
  readCatalog: () => Promise<WorkspaceCatalog>;
  updateSpawnStatus: (childThreadId: string, status: "running" | "completed" | "failed") => unknown;
  updateMetadata: (input: {
    workspaceId: string;
    threadId: string;
    status: "running" | "idle" | "failed";
    statusLabel: string;
    summary?: string;
    lastEventSummary: string;
  }) => Promise<unknown>;
  runTask: (
    taskId: string,
    execute: (task: TTask) => Promise<DelegatedExecutionResult>
  ) => Promise<TTask>;
  persistTask: (task: TTask) => unknown;
}

/** Owns delegated-task validation and durable running/terminal lifecycle transitions. */
export class DelegatedAgentRunService<TTask extends DelegatedTaskRecord> {
  private readonly dependencies: DelegatedAgentRunDependencies<TTask>;

  constructor(dependencies: DelegatedAgentRunDependencies<TTask>) {
    this.dependencies = dependencies;
  }

  async run(
    input: { workspaceId: string; childThreadId: string },
    execute: (
      task: TTask,
      workspace: WorkspaceCatalogItem,
      childThread: WorkspaceThreadRecord
    ) => Promise<DelegatedExecutionResult>
  ) {
    const task = this.dependencies.listTasks().find((item) => item.childThreadId === input.childThreadId);
    if (!task) throw new Error(`Delegated task was not found for ${input.childThreadId}.`);
    if (task.status !== "queued") {
      throw new Error(`Delegated task cannot start from status ${task.status}.`);
    }
    const catalog = await this.dependencies.readCatalog();
    const workspace = catalog.workspaces.find((item) => item.id === input.workspaceId);
    const childThread = workspace?.threads.find((item) => item.id === input.childThreadId);
    if (!workspace || !childThread) throw new Error("Delegated child thread was not found.");

    this.dependencies.updateSpawnStatus(childThread.id, "running");
    await this.dependencies.updateMetadata({
      workspaceId: workspace.id,
      threadId: childThread.id,
      status: "running",
      statusLabel: "子 Agent 运行中",
      lastEventSummary: task.instruction
    });
    const completed = await this.dependencies.runTask(task.id, (currentTask) =>
      execute(currentTask, workspace, childThread)
    );
    const edgeStatus = completed.status === "completed" ? "completed" : "failed";
    this.dependencies.persistTask(completed);
    this.dependencies.updateSpawnStatus(childThread.id, edgeStatus);
    await this.dependencies.updateMetadata({
      workspaceId: workspace.id,
      threadId: childThread.id,
      status: completed.status === "completed" ? "idle" : "failed",
      statusLabel: completed.status === "completed" ? "" : "子 Agent 失败",
      summary: completed.summary || completed.error,
      lastEventSummary: completed.status === "completed" ? "子 Agent 已完成，等待父线程合并" : completed.error || "子 Agent 失败"
    });
    return completed;
  }
}
