import type { WorkspaceCatalogItem } from "@codex-forge/protocol";
import type { ThreadStateFile } from "./thread-state-factory.js";

interface WorkspaceCatalog {
  workspaces: WorkspaceCatalogItem[];
}

interface DelegatedTaskRecord {
  id?: string;
  childThreadId: string;
  parentThreadId: string;
  status: string;
}

export interface DelegatedAgentIpcDependencies {
  readCatalog: () => Promise<WorkspaceCatalog>;
  listTasks: (parentThreadId?: string) => DelegatedTaskRecord[];
  readState: (
    workspace: WorkspaceCatalogItem,
    thread: WorkspaceCatalogItem["threads"][number]
  ) => Promise<ThreadStateFile>;
  respondApproval: <T>(input: {
    childThreadId: string;
    approved: boolean;
    canResume: boolean;
    resume: () => Promise<T>;
  }) => Promise<T> | undefined;
  run: (input: { workspaceId: string; childThreadId: string }) => Promise<DelegatedTaskRecord>;
  observeRunFailure: (run: Promise<unknown>) => void;
  /** True while a volatile child run promise is still tracked. */
  hasActiveRun?: (childThreadId: string) => boolean;
  /** Mark a queued/running task failed and persist it. */
  failTask?: (task: DelegatedTaskRecord, reason: string) => DelegatedTaskRecord | undefined;
}

/** Owns collaboration IPC projections and guarded approval-resume decisions. */
export class DelegatedAgentIpcService {
  private readonly dependencies: DelegatedAgentIpcDependencies;

  constructor(dependencies: DelegatedAgentIpcDependencies) {
    this.dependencies = dependencies;
  }

  async list(input: { workspaceId: string; parentThreadId: string }) {
    const catalog = await this.dependencies.readCatalog();
    const workspace = catalog.workspaces.find((item) => item.id === input.workspaceId);
    if (!workspace?.threads.some((thread) => thread.id === input.parentThreadId)) {
      throw new Error("Parent thread does not belong to the selected workspace.");
    }
    return Promise.all(this.dependencies.listTasks(input.parentThreadId).map(async (task) => {
      let current = task;
      const status = String(current.status || "").toLowerCase();
      const terminal = status === "completed" || status === "failed" || status === "cancelled" || status === "canceled";
      const childThread = workspace.threads.find((thread) => thread.id === current.childThreadId);
      const childState = childThread ? await this.dependencies.readState(workspace, childThread) : undefined;
      const checkpointAwaiting = childState?.agentCheckpoint?.status === "awaiting-approval";
      if (
        !terminal
        && !checkpointAwaiting
        && this.dependencies.hasActiveRun
        && !this.dependencies.hasActiveRun(current.childThreadId)
      ) {
        const failed = this.dependencies.failTask?.(
          current,
          "Child agent run is no longer active; marked failed so the parent can finish."
        );
        if (failed) current = failed;
      }
      return {
        ...current,
        checkpointStatus: childState?.agentCheckpoint?.status,
        pendingTool: childState?.agentCheckpoint?.pending?.call
          ? {
              name: childState.agentCheckpoint.pending.call.name,
              arguments: childState.agentCheckpoint.pending.call.arguments
            }
          : undefined
      };
    }));
  }

  async respondApproval(input: { workspaceId: string; childThreadId: string; approved: boolean }) {
    const catalog = await this.dependencies.readCatalog();
    const workspace = catalog.workspaces.find((item) => item.id === input.workspaceId);
    const childThread = workspace?.threads.find((thread) => thread.id === input.childThreadId);
    const task = this.dependencies.listTasks().find((item) => item.childThreadId === input.childThreadId);
    if (!workspace || !childThread || !task) {
      throw new Error("Delegated child thread does not belong to the selected workspace.");
    }
    const childState = await this.dependencies.readState(workspace, childThread);
    const checkpointAwaiting = childState.agentCheckpoint?.status === "awaiting-approval";
    const canResume = checkpointAwaiting && (
      task.status === "running"
      || task.status === "queued"
      || Boolean(this.dependencies.hasActiveRun?.(input.childThreadId))
    );
    if (!canResume) {
      return {
        ok: false,
        childThreadId: input.childThreadId,
        approved: input.approved,
        stale: true
      };
    }
    const resumedRun = this.dependencies.respondApproval({
      childThreadId: input.childThreadId,
      approved: input.approved,
      canResume,
      resume: () => this.dependencies.run({ workspaceId: workspace.id, childThreadId: childThread.id })
    });
    if (resumedRun) this.dependencies.observeRunFailure(resumedRun);
    return { ok: true, childThreadId: input.childThreadId, approved: input.approved };
  }
}
