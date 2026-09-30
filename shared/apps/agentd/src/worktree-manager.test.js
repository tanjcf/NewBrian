import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WorktreeManager } from "./worktree-manager.js";

test("creates an isolated managed worktree and agent branch", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "newbrain-worktree-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const repository = path.join(root, "repository");
  await fs.mkdir(repository);
  execFileSync("git", ["init"], { cwd: repository, windowsHide: true });
  execFileSync("git", ["config", "user.email", "test@newbrain.local"], { cwd: repository, windowsHide: true });
  execFileSync("git", ["config", "user.name", "NewBrain Test"], { cwd: repository, windowsHide: true });
  await fs.writeFile(path.join(repository, "README.md"), "root\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repository, windowsHide: true });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: repository, windowsHide: true });

  const manager = new WorktreeManager({ workspacePath: repository, storageRoot: path.join(root, "worktrees") });
  const created = await manager.create({ taskId: "Editor Task" });
  assert.equal(created.branch, "codex/agent-editor-task");
  assert.equal((await fs.readFile(path.join(created.worktreePath, "README.md"), "utf8")).replace(/\r\n/g, "\n"), "root\n");
  assert.match(await manager.status(created.worktreePath), /codex\/agent-editor-task/);
});

test("rejects non-Git workspaces", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "newbrain-worktree-no-git-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const manager = new WorktreeManager({ workspacePath: root });
  await assert.rejects(() => manager.create({ taskId: "task" }), /not a Git repository/);
});
