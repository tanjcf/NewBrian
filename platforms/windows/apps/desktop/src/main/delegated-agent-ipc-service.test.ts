import assert from "node:assert/strict";
import test from "node:test";

const { DelegatedAgentIpcService } = await import(new URL("./delegated-agent-ipc-service.ts", import.meta.url).href);

function fixture(status = "running", checkpointStatus = "awaiting-approval") {
  let resumed = 0;
  let canResume: boolean | undefined;
  const thread = { id: "child" };
  const workspace = { id: "workspace", threads: [{ id: "parent" }, thread] };
  const task = { childThreadId: "child", parentThreadId: "parent", status };
  const service = new DelegatedAgentIpcService({
    readCatalog: async () => ({ workspaces: [workspace] }),
    listTasks: (parentThreadId?: string) => parentThreadId ? [task] : [task],
    readState: async () => ({ agentCheckpoint: { status: checkpointStatus } }),
    respondApproval: (input: { canResume: boolean; resume: () => Promise<unknown> }) => {
      canResume = input.canResume;
      if (!canResume) throw new Error("cannot resume");
      return input.resume();
    },
    run: async () => { resumed += 1; return task; },
    observeRunFailure: () => undefined
  } as never);
  return { service, readResumed: () => resumed, readCanResume: () => canResume };
}

test("projects checkpoint approval details only for owned child tasks", async () => {
  const { service } = fixture();
  const tasks = await service.list({ workspaceId: "workspace", parentThreadId: "parent" });
  assert.equal(tasks[0].checkpointStatus, "awaiting-approval");
});

test("approves a running task with an awaiting-approval checkpoint", async () => {
  const { service, readResumed, readCanResume } = fixture();
  await service.respondApproval({ workspaceId: "workspace", childThreadId: "child", approved: true });
  await Promise.resolve();
  assert.equal(readCanResume(), true);
  assert.equal(readResumed(), 1);
});

test("rejects a running task by resuming its awaiting-approval checkpoint", async () => {
  const { service, readResumed, readCanResume } = fixture();
  await service.respondApproval({ workspaceId: "workspace", childThreadId: "child", approved: false });
  await Promise.resolve();
  assert.equal(readCanResume(), true);
  assert.equal(readResumed(), 1);
});

test("resumes a queued awaiting-approval task after restart", async () => {
  const { service, readResumed, readCanResume } = fixture("queued");
  await service.respondApproval({ workspaceId: "workspace", childThreadId: "child", approved: true });
  await Promise.resolve();
  assert.equal(readCanResume(), true);
  assert.equal(readResumed(), 1);
});

test("treats a stale approval for a completed task as an idempotent no-op", async () => {
  const { service, readResumed, readCanResume } = fixture("completed", "completed");
  const result = await service.respondApproval({
    workspaceId: "workspace",
    childThreadId: "child",
    approved: true
  });
  assert.deepEqual(result, {
    ok: false,
    childThreadId: "child",
    approved: true,
    stale: true
  });
  assert.equal(readCanResume(), undefined);
  assert.equal(readResumed(), 0);
});

test("does not reconcile awaiting-approval checkpoints as abandoned runs", async () => {
  let failedReason = "";
  const task = { id: "task-1", childThreadId: "child", parentThreadId: "parent", status: "running" };
  const thread = { id: "child" };
  const workspace = { id: "workspace", threads: [{ id: "parent" }, thread] };
  const service = new DelegatedAgentIpcService({
    readCatalog: async () => ({ workspaces: [workspace] }),
    listTasks: () => [task],
    readState: async () => ({ agentCheckpoint: { status: "awaiting-approval" } }),
    respondApproval: () => undefined,
    run: async () => task,
    observeRunFailure: () => undefined,
    hasActiveRun: () => false,
    failTask: (current, reason) => {
      failedReason = reason;
      current.status = "failed";
      current.error = reason;
      return { ...current };
    }
  } as never);
  const tasks = await service.list({ workspaceId: "workspace", parentThreadId: "parent" });
  assert.equal(tasks[0].status, "running");
  assert.equal(failedReason, "");
});

test("reconciles abandoned running children to failed when no active run remains", async () => {
  let failedReason = "";
  const task = { id: "task-1", childThreadId: "child", parentThreadId: "parent", status: "running" };
  const thread = { id: "child" };
  const workspace = { id: "workspace", threads: [{ id: "parent" }, thread] };
  const service = new DelegatedAgentIpcService({
    readCatalog: async () => ({ workspaces: [workspace] }),
    listTasks: () => [task],
    readState: async () => ({ agentCheckpoint: { status: "running" } }),
    respondApproval: () => undefined,
    run: async () => task,
    observeRunFailure: () => undefined,
    hasActiveRun: () => false,
    failTask: (current, reason) => {
      failedReason = reason;
      current.status = "failed";
      current.error = reason;
      return { ...current };
    }
  } as never);
  const tasks = await service.list({ workspaceId: "workspace", parentThreadId: "parent" });
  assert.equal(tasks[0].status, "failed");
  assert.match(failedReason, /no longer active/i);
});
