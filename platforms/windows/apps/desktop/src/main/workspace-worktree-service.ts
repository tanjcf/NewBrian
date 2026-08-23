import { join } from "node:path";
import type { WorkspaceCatalogItem } from "@codex-forge/protocol";

interface BoundedProcessInput {
  executable: string;
  args: string[];
  cwd: string;
  signal?: AbortSignal;
}

interface BoundedProcessResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface WorktreeBindingRecord {
  workspaceId: string;
  threadId?: string;
  branchName: string;
  path: string;
  createdAt: string;
}

interface WorktreeBindingsFile {
  bindings: WorktreeBindingRecord[];
}

export interface WorkspaceWorktreeServiceDependencies {
  bindingsPath: string;
  readText: (path: string) => Promise<string>;
  writeTextAtomically: (path: string, content: string) => Promise<unknown>;
  ensureDirectory: (path: string) => Promise<unknown>;
  runProcess: (input: BoundedProcessInput) => Promise<BoundedProcessResult>;
  nowMs: () => number;
  nowIso: () => string;
  appendDebugLog: (message: string) => Promise<unknown>;
}

/** Owns cancellable Git worktree commands and serialized, atomic binding persistence. */
export class WorkspaceWorktreeService {
  private readonly dependencies: WorkspaceWorktreeServiceDependencies;
  private bindingMutation = Promise.resolve();

  constructor(dependencies: WorkspaceWorktreeServiceDependencies) {
    this.dependencies = dependencies;
  }

  async readBindings(): Promise<WorktreeBindingsFile> {
    try {
      const parsed = JSON.parse(await this.dependencies.readText(this.dependencies.bindingsPath)) as Partial<WorktreeBindingsFile>;
      return {
        bindings: Array.isArray(parsed.bindings)
          ? parsed.bindings.filter((item) => Boolean(item.workspaceId && item.path && item.branchName))
          : []
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { bindings: [] };
      throw error;
    }
  }

  private mutateBindings(mutator: (bindings: WorktreeBindingRecord[]) => WorktreeBindingRecord[]) {
    const mutation = this.bindingMutation.then(async () => {
      const current = await this.readBindings();
      const bindings = mutator(current.bindings);
      await this.dependencies.writeTextAtomically(
        this.dependencies.bindingsPath,
        `${JSON.stringify({ bindings }, null, 2)}\n`
      );
      return bindings;
    });
    this.bindingMutation = mutation.then(() => undefined, () => undefined);
    return mutation;
  }

  async create(input: {
    enabled: boolean;
    rootDir: string;
    branchPrefix: string;
    workspace: WorkspaceCatalogItem;
    threadId?: string;
    branchName?: string;
    signal?: AbortSignal;
  }) {
    if (!input.enabled) return { ok: false, detail: "工作树隔离未启用。", path: "" };
    await this.dependencies.ensureDirectory(input.rootDir);
    const branchName = input.branchName?.trim()
      || `${input.branchPrefix}${input.workspace.name.replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase()}-${this.dependencies.nowMs()}`;
    const worktreePath = join(input.rootDir, branchName.replace(/[\\/]/g, "-"));
    const result = await this.dependencies.runProcess({
      executable: "git",
      args: ["worktree", "add", "-b", branchName, worktreePath],
      cwd: input.workspace.path,
      signal: input.signal
    });
    if (result.status !== 0) {
      return {
        ok: false,
        detail: (result.stderr || result.stdout || "git worktree add failed").trim(),
        path: worktreePath
      };
    }
    await this.mutateBindings((bindings) => [
      ...bindings.filter((item) => item.path !== worktreePath),
      {
        workspaceId: input.workspace.id,
        threadId: input.threadId || undefined,
        branchName,
        path: worktreePath,
        createdAt: this.dependencies.nowIso()
      }
    ]);
    return { ok: true, detail: `已创建 ${branchName}`, path: worktreePath };
  }

  async cleanup(input: {
    keepArchived: boolean;
    workspaceId: string;
    threadId: string;
    gitCwd: string;
    signal?: AbortSignal;
  }) {
    if (input.keepArchived) return { failedPaths: [] as string[] };
    const current = await this.readBindings();
    const targets = current.bindings.filter((item) =>
      item.workspaceId === input.workspaceId && item.threadId === input.threadId
    );
    const removed = new Set<string>();
    const failedPaths: string[] = [];
    for (const binding of targets) {
      const result = await this.dependencies.runProcess({
        executable: "git",
        args: ["worktree", "remove", "--force", binding.path],
        cwd: input.gitCwd,
        signal: input.signal
      });
      if (result.status === 0) {
        removed.add(binding.path);
      } else {
        failedPaths.push(binding.path);
        await this.dependencies.appendDebugLog(
          `git worktree remove failed ${binding.path}: ${result.stderr || result.stdout}`
        );
      }
    }
    if (removed.size) {
      await this.mutateBindings((bindings) => bindings.filter((item) => !removed.has(item.path)));
    }
    return { failedPaths };
  }
}
