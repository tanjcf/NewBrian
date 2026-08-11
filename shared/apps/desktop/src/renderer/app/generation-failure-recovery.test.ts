import assert from "node:assert/strict";
import test from "node:test";

const { recoverActiveThreadRetry } = await import(
  new URL("./generation-failure-recovery.ts", import.meta.url).href
);

test("restores the authoritative thread snapshot instead of starting a competing retry", async () => {
  const calls: string[] = [];
  const snapshot = { approval: { id: "approval-1" } };

  const result = await recoverActiveThreadRetry({
    message: "The selected thread already has a running task.",
    workspaceId: "workspace-1",
    threadId: "thread-1",
    releaseThreadTasks: async (input) => {
      calls.push(`release:${input.workspaceId}:${input.threadId}`);
    },
    activateThread: async (input: { workspaceId: string; threadId: string }) => {
      calls.push(`${input.workspaceId}:${input.threadId}`);
      return snapshot;
    }
  });

  assert.deepEqual(result, { recovered: true, snapshot });
  assert.deepEqual(calls, ["release:workspace-1:thread-1", "workspace-1:thread-1"]);
});

test("recovers Chinese busy-thread failures the same way", async () => {
  let released = false;
  const result = await recoverActiveThreadRetry({
    message: "本轮在完成前发生异常：当前线程仍有未结束的任务。请先点击停止，或等待完成后再发送。",
    workspaceId: "workspace-1",
    threadId: "thread-1",
    releaseThreadTasks: () => {
      released = true;
    },
    activateThread: async () => ({ ok: true })
  });
  assert.equal(result.recovered, true);
  assert.equal(released, true);
});

test("leaves ordinary generation failures on the normal retry path", async () => {
  let activated = false;
  const result = await recoverActiveThreadRetry({
    message: "gateway unavailable",
    workspaceId: "workspace-1",
    threadId: "thread-1",
    activateThread: async () => {
      activated = true;
      return {};
    }
  });

  assert.deepEqual(result, { recovered: false });
  assert.equal(activated, false);
});
