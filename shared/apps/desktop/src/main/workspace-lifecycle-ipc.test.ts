import assert from "node:assert/strict";
import test from "node:test";

const { parseCreateWorkspaceWorktreeInput, parseWorkspaceThreadInput } =
  await import(new URL("./workspace-lifecycle-contract.ts", import.meta.url).href);

test("normalizes workspace lifecycle identifiers", () => {
  assert.deepEqual(parseWorkspaceThreadInput({ workspaceId: " ws ", threadId: " thread " }), { workspaceId: "ws", threadId: "thread" });
  assert.deepEqual(parseCreateWorkspaceWorktreeInput({ workspaceId: " ws ", branchName: " codex/refactor " }), { workspaceId: "ws", branchName: "codex/refactor" });
});

test("rejects invalid workspace lifecycle inputs", () => {
  assert.throws(() => parseWorkspaceThreadInput({ workspaceId: "ws", threadId: " " }), /invalid/);
  assert.throws(() => parseCreateWorkspaceWorktreeInput({ workspaceId: "ws", branchName: "bad branch" }), /invalid/);
  assert.throws(() => parseCreateWorkspaceWorktreeInput({ workspaceId: "", branchName: "valid" }), /invalid/);
});
