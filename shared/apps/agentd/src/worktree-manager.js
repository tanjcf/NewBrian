import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function safeSegment(value) {
  const segment = String(value || "agent")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return segment || "agent";
}

async function runGit(cwd, args) {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
    });
    return { ok: true, output: String(result.stdout || "").trim(), error: String(result.stderr || "").trim() };
  } catch (error) {
    return {
      ok: false,
      output: String(error?.stdout || "").trim(),
      error: String(error?.stderr || error?.message || error).trim()
    };
  }
}

export class WorktreeManager {
  constructor(input) {
    this.workspacePath = path.resolve(input.workspacePath);
    this.storageRoot = input.storageRoot ? path.resolve(input.storageRoot) : null;
  }

  async repositoryRoot() {
    const result = await runGit(this.workspacePath, ["rev-parse", "--show-toplevel"]);
    if (!result.ok || !result.output) {
      throw new Error(`The workspace is not a Git repository.${result.error ? ` ${result.error}` : ""}`);
    }
    return path.resolve(result.output);
  }

  async create(input) {
    const repositoryRoot = await this.repositoryRoot();
    const taskId = safeSegment(input.taskId);
    const baseRoot = this.storageRoot ?? path.join(path.dirname(repositoryRoot), ".newbrain-worktrees", path.basename(repositoryRoot));
    const worktreePath = path.resolve(baseRoot, taskId);
    if (worktreePath !== baseRoot && !worktreePath.startsWith(`${path.resolve(baseRoot)}${path.sep}`)) {
      throw new Error("Worktree path escaped its managed root.");
    }
    await fs.mkdir(baseRoot, { recursive: true });
    const existing = await fs.stat(worktreePath).catch(() => null);
    if (existing) throw new Error(`Managed worktree already exists: ${worktreePath}`);

    const branch = `codex/agent-${taskId}`;
    const baseRef = String(input.baseRef || "HEAD").trim() || "HEAD";
    const result = await runGit(repositoryRoot, ["worktree", "add", "-b", branch, worktreePath, baseRef]);
    if (!result.ok) throw new Error(result.error || result.output || "Failed to create the managed worktree.");
    return { repositoryRoot, worktreePath, branch, baseRef };
  }

  async status(worktreePath) {
    const resolved = path.resolve(worktreePath);
    const result = await runGit(resolved, ["-c", "core.quotepath=false", "status", "--short", "--branch"]);
    if (!result.ok) throw new Error(result.error || "Failed to inspect the managed worktree.");
    return result.output;
  }
}
