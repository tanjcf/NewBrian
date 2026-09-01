import type { WorkspaceCatalogItem, WorkspaceThreadRecord } from "@codex-forge/protocol";
import type { ThreadStateFile } from "./thread-state-factory.js";

interface WorkspaceCatalog {
  workspaces: WorkspaceCatalogItem[];
}

export interface AddWorkspaceThreadInput {
  workspaceId: string;
  title: string;
  summary: string;
  scope?: "project" | "chat";
  brainWorkspaceKey?: import("@codex-forge/protocol").BrainWorkspaceKey;
}

export interface ForkWorkspaceThreadInput {
  workspaceId: string;
  sourceThreadId: string;
  title: string;
  owner?: "planner" | "researcher" | "verifier" | "editor";
  instruction?: string;
  dependsOn?: string[];
  kind?: "user" | "subagent";
}

export interface RenameWorkspaceThreadInput {
  workspaceId: string;
  threadId: string;
  title: string;
  summary: string;
}

export interface WorkspaceThreadLifecycleDependencies {
  readCatalog: () => Promise<WorkspaceCatalog>;
  writeCatalog: (workspaces: WorkspaceCatalogItem[]) => Promise<WorkspaceCatalog>;
  normalizeThread: (input: Partial<WorkspaceThreadRecord>) => WorkspaceThreadRecord;
  sortThreads: (threads: WorkspaceThreadRecord[]) => WorkspaceThreadRecord[];
  createDefaultState: (workspaceName: string, threadTitle: string) => ThreadStateFile;
  writeState: (
    workspace: WorkspaceCatalogItem,
    thread: WorkspaceThreadRecord,
    state: ThreadStateFile
  ) => Promise<unknown>;
  cloneState: (
    workspace: WorkspaceCatalogItem,
    sourceThread: WorkspaceThreadRecord,
    nextThread: WorkspaceThreadRecord
  ) => Promise<unknown>;
  ensureCatalogState: (catalog: WorkspaceCatalog) => Promise<unknown>;
  registerDelegation: (input: {
    workspace: WorkspaceCatalogItem;
    sourceThread: WorkspaceThreadRecord;
    nextThread: WorkspaceThreadRecord;
    owner: "planner" | "researcher" | "verifier" | "editor";
    instruction: string;
    dependsOn: string[];
  }) => Promise<unknown>;
  updateMetadata: (input: {
    workspaceId: string;
    threadId: string;
    title: string;
    summary: string;
    lastEventSummary: string;
  }) => Promise<WorkspaceCatalog>;
}

/** Owns catalog-first thread creation, fork, and metadata lifecycle transactions. */
export class WorkspaceThreadLifecycleService {
  private readonly dependencies: WorkspaceThreadLifecycleDependencies;

  constructor(dependencies: WorkspaceThreadLifecycleDependencies) {
    this.dependencies = dependencies;
  }

  async add(input: AddWorkspaceThreadInput) {
    const catalog = await this.dependencies.readCatalog();
    const workspace = catalog.workspaces.find((item) => item.id === input.workspaceId);
    if (!workspace) throw new Error("Workspace was not found.");

    const nextThread = this.dependencies.normalizeThread({
      title: input.title,
      summary: input.summary,
      scope: input.scope,
      ...(input.brainWorkspaceKey ? { brainWorkspaceKey: input.brainWorkspaceKey } : {}),
      lastEventSummary: "线程已创建"
    });
    const nextCatalog = await this.dependencies.writeCatalog(catalog.workspaces.map((item) =>
      item.id === workspace.id
        ? { ...item, threads: this.dependencies.sortThreads([nextThread, ...item.threads]) }
        : item
    ));
    const persistedWorkspace = nextCatalog.workspaces.find((item) => item.id === workspace.id);
    if (!persistedWorkspace) throw new Error("Workspace disappeared while creating the thread.");
    await this.dependencies.writeState(
      persistedWorkspace,
      nextThread,
      this.dependencies.createDefaultState(persistedWorkspace.name, nextThread.title)
    );
    await this.dependencies.ensureCatalogState(nextCatalog);
    return nextCatalog;
  }

  async fork(input: ForkWorkspaceThreadInput) {
    const catalog = await this.dependencies.readCatalog();
    const workspace = catalog.workspaces.find((item) => item.id === input.workspaceId);
    const sourceThread = workspace?.threads.find((item) => item.id === input.sourceThreadId);
    if (!workspace || !sourceThread) throw new Error("Source thread was not found.");

    const kind = input.kind === "subagent" ? "subagent" : "user";
    const nextThread = this.dependencies.normalizeThread({
      title: input.title.trim(),
      summary: sourceThread.summary,
      lastEventSummary: kind === "subagent"
        ? `子 Agent：${input.title.trim() || sourceThread.title}`
        : `从 ${sourceThread.title} 分叉`,
      kind,
      ...(kind === "subagent" ? { parentThreadId: sourceThread.id } : {})
    });
    const nextCatalog = await this.dependencies.writeCatalog(catalog.workspaces.map((item) =>
      item.id === workspace.id
        ? { ...item, threads: this.dependencies.sortThreads([nextThread, ...item.threads]) }
        : item
    ));
    const nextWorkspace = nextCatalog.workspaces.find((item) => item.id === workspace.id);
    if (!nextWorkspace) throw new Error("Workspace disappeared while forking the thread.");
    await this.dependencies.cloneState(nextWorkspace, sourceThread, nextThread);
    const owner = input.owner ?? "researcher";
    await this.dependencies.registerDelegation({
      workspace: nextWorkspace,
      sourceThread,
      nextThread,
      owner,
      instruction: input.instruction?.trim() || `Continue from ${sourceThread.title} in an isolated child thread.`,
      dependsOn: input.dependsOn ?? []
    });
    return nextCatalog;
  }

  async rename(input: RenameWorkspaceThreadInput) {
    const nextCatalog = await this.dependencies.updateMetadata({
      workspaceId: input.workspaceId,
      threadId: input.threadId,
      title: input.title.trim(),
      summary: input.summary.trim(),
      lastEventSummary: "线程信息已更新"
    });
    await this.dependencies.ensureCatalogState(nextCatalog);
    return nextCatalog;
  }
}
