import { dirname } from "node:path";
import type { WorkspaceCatalogItem, WorkspaceThreadRecord } from "@codex-forge/protocol";

interface WorkspaceCatalog {
  workspaces: WorkspaceCatalogItem[];
}

export interface ThreadRolloutLifecycleDependencies {
  getActivePath: (workspaceId: string, threadId: string) => string;
  getArchivedPath: (workspaceId: string, threadId: string) => string;
  fileExists: (path: string) => Promise<boolean>;
  ensureDirectory: (path: string) => Promise<unknown>;
  unlink: (path: string) => Promise<unknown>;
  rename: (source: string, target: string) => Promise<unknown>;
  setStorageArchived: (threadId: string, archived: boolean, rolloutPath: string) => unknown;
  updateMetadata: (input: {
    workspaceId: string;
    threadId: string;
    archived: boolean;
    scope?: "project" | "chat";
    lastEventSummary: string;
  }) => Promise<WorkspaceCatalog>;
  ensureCatalogState: (catalog: WorkspaceCatalog) => Promise<unknown>;
}

/** Owns reversible rollout movement and its catalog/SQLite archive transition. */
export class ThreadRolloutLifecycleService {
  private readonly dependencies: ThreadRolloutLifecycleDependencies;

  constructor(dependencies: ThreadRolloutLifecycleDependencies) {
    this.dependencies = dependencies;
  }

  private paths(workspaceId: string, threadId: string, archived: boolean) {
    const active = this.dependencies.getActivePath(workspaceId, threadId);
    const stored = this.dependencies.getArchivedPath(workspaceId, threadId);
    return archived ? { source: active, target: stored } : { source: stored, target: active };
  }

  private async moveIfPresent(source: string, target: string) {
    if (!(await this.dependencies.fileExists(source))) return false;
    await this.dependencies.ensureDirectory(dirname(target));
    await this.dependencies.unlink(target);
    await this.dependencies.rename(source, target);
    return true;
  }

  async setArchived(input: {
    workspaceId: string;
    threadId: string;
    archived: boolean;
    scope?: "project" | "chat";
  }) {
    const { source, target } = this.paths(input.workspaceId, input.threadId, input.archived);
    const moved = await this.moveIfPresent(source, target);
    try {
      const catalog = await this.dependencies.updateMetadata({
        ...input,
        lastEventSummary: input.archived ? "Thread archived" : "Thread restored"
      });
      this.dependencies.setStorageArchived(input.threadId, input.archived, target);
      await this.dependencies.ensureCatalogState(catalog);
      return catalog;
    } catch (error) {
      if (moved) await this.moveIfPresent(target, source).catch(() => undefined);
      await this.dependencies.updateMetadata({
        workspaceId: input.workspaceId,
        threadId: input.threadId,
        archived: !input.archived,
        scope: input.scope,
        lastEventSummary: "Thread archive transition rolled back"
      }).catch(() => undefined);
      this.dependencies.setStorageArchived(input.threadId, !input.archived, source);
      throw error;
    }
  }

  async reconcileArchived(workspace: WorkspaceCatalogItem, threads: Array<Pick<WorkspaceThreadRecord, "id" | "archived">>) {
    for (const thread of threads) {
      if (!thread.archived) continue;
      const { source, target } = this.paths(workspace.id, thread.id, true);
      if (!(await this.dependencies.fileExists(target))) {
        await this.moveIfPresent(source, target);
      }
      if (await this.dependencies.fileExists(target)) {
        this.dependencies.setStorageArchived(thread.id, true, target);
      }
    }
  }
}
