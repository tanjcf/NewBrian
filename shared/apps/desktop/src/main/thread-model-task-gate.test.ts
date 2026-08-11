import assert from "node:assert/strict";
import test from "node:test";

const {
  displaceThreadModelTasks,
  isThreadModelTaskStale,
  matchesThreadAlreadyRunningError,
  pruneStaleThreadModelTasks,
  THREAD_ALREADY_RUNNING_ERROR,
  THREAD_ALREADY_RUNNING_ERROR_ZH
} = await import(new URL("./thread-model-task-gate.ts", import.meta.url).href);

function makeTask(overrides: Partial<{
  workspaceId: string;
  threadId: string;
  aborted: boolean;
  status: string;
}> = {}) {
  const abortController = new AbortController();
  if (overrides.aborted) abortController.abort();
  const status = overrides.status;
  return {
    workspaceId: overrides.workspaceId ?? "ws",
    threadId: overrides.threadId ?? "th",
    abortController,
    runtime: status
      ? {
          getAgentLoopSnapshot: () => ({ status }),
          cancelAgentLoop: () => undefined
        }
      : {
          cancelAgentLoop: () => undefined
        }
  };
}

test("aborted and terminal tasks are stale", () => {
  assert.equal(isThreadModelTaskStale(makeTask({ aborted: true })), true);
  assert.equal(isThreadModelTaskStale(makeTask({ status: "completed" })), true);
  assert.equal(isThreadModelTaskStale(makeTask({ status: "failed" })), true);
  assert.equal(isThreadModelTaskStale(makeTask({})), false);
  assert.equal(isThreadModelTaskStale(makeTask({ status: "awaiting-approval" })), false);
});

test("displace aborts and force-removes thread tasks", () => {
  const tasks = new Map([
    ["r1", makeTask()],
    ["r2", makeTask({ threadId: "other" })]
  ]);
  const canceled: string[] = [];
  const removed = displaceThreadModelTasks({
    tasks,
    workspaceId: "ws",
    threadId: "th",
    markCanceled: (id) => canceled.push(id)
  });
  assert.equal(removed, 1);
  assert.equal(tasks.has("r1"), false);
  assert.equal(tasks.has("r2"), true);
  assert.deepEqual(canceled, ["r1"]);
});

test("prune removes only stale entries for the thread", () => {
  const tasks = new Map([
    ["live", makeTask()],
    ["dead", makeTask({ aborted: true })],
    ["done", makeTask({ status: "completed" })]
  ]);
  assert.equal(pruneStaleThreadModelTasks(tasks, "ws", "th"), 2);
  assert.equal(tasks.has("live"), true);
  assert.equal(tasks.has("dead"), false);
  assert.equal(tasks.has("done"), false);
});

test("matches English and Chinese busy-thread errors", () => {
  assert.equal(matchesThreadAlreadyRunningError(THREAD_ALREADY_RUNNING_ERROR), true);
  assert.equal(matchesThreadAlreadyRunningError(THREAD_ALREADY_RUNNING_ERROR_ZH), true);
  assert.equal(
    matchesThreadAlreadyRunningError(`本轮在完成前发生异常：${THREAD_ALREADY_RUNNING_ERROR}`),
    true
  );
  assert.equal(matchesThreadAlreadyRunningError("gateway unavailable"), false);
});
