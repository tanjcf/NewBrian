import assert from "node:assert/strict";
import test from "node:test";

const { WorkspaceWorktreeService } = await import(new URL("./workspace-worktree-service.ts", import.meta.url).href);

function fixture(initial: unknown[] = []) {
  let bindings = initial;
  const commands: Array<{ args: string[] }> = [];
  const logs: string[] = [];
  const service = new WorkspaceWorktreeService({
    bindingsPath: "bindings.json",
    readText: async () => JSON.stringify({ bindings }),
    writeTextAtomically: async (_path: string, content: string) => {
      bindings = (JSON.parse(content) as { bindings: unknown[] }).bindings;
    },
    ensureDirectory: async () => undefined,
    runProcess: async (input: { args: string[] }) => {
      commands.push(input);
      const failed = input.args.includes("failed-path");
      return { status: failed ? 1 : 0, stdout: "", stderr: failed ? "busy" : "" };
    },
    nowMs: () => 100,
    nowIso: () => "2026-07-18T00:00:00.000Z",
    appendDebugLog: async (message: string) => { logs.push(message); }
  } as never);
  return { service, commands, logs, read: () => bindings };
}

const workspace = { id: "workspace-1", name: "Code CN", path: "G:/repo" };

test("creates a worktree with a bounded Git command and atomically records its binding", async () => {
  const { service, commands, read } = fixture();
  const result = await service.create({
    enabled: true,
    rootDir: "G:/worktrees",
    branchPrefix: "codex/",
    workspace: workspace as never,
    threadId: "thread-1"
  });
  assert.equal(result.ok, true);
  assert.deepEqual(commands[0].args.slice(0, 3), ["worktree", "add", "-b"]);
  assert.equal((read()[0] as { threadId: string }).threadId, "thread-1");
});

test("keeps a binding when Git cannot remove its worktree", async () => {
  const failed = { workspaceId: "workspace-1", threadId: "thread-1", branchName: "failed", path: "failed-path", createdAt: "now" };
  const { service, logs, read } = fixture([failed]);
  const result = await service.cleanup({ keepArchived: false, workspaceId: "workspace-1", threadId: "thread-1", gitCwd: "G:/repo" });
  assert.equal(read().length, 1);
  assert.deepEqual(result.failedPaths, ["failed-path"]);
  assert.match(logs[0], /busy/);
});

test("removes only bindings whose Git worktree removal succeeded", async () => {
  const good = { workspaceId: "workspace-1", threadId: "thread-1", branchName: "good", path: "good-path", createdAt: "now" };
  const failed = { ...good, branchName: "failed", path: "failed-path" };
  const { service, read } = fixture([good, failed]);
  await service.cleanup({ keepArchived: false, workspaceId: "workspace-1", threadId: "thread-1", gitCwd: "G:/repo" });
  assert.deepEqual(read(), [failed]);
});
