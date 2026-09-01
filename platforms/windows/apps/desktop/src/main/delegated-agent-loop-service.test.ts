import assert from "node:assert/strict";
import test from "node:test";

const { runDelegatedAgentLoop } = await import(
  new URL("./delegated-agent-loop-service.ts", import.meta.url).href
);

test("restores approval, persists checkpoints, and resumes exactly once", async () => {
  const order: string[] = [];
  let snapshot: any = {
    status: "awaiting-approval",
    messages: [],
    pending: { call: { name: "shell.exec" } },
    steps: 1,
    finalContent: ""
  };
  const runtime = {
    startAgentLoop: () => { throw new Error("must restore"); },
    restoreAgentLoop: () => { order.push("restore"); },
    advanceAgentLoop: async () => { throw new Error("must not advance before approval"); },
    resumeAgentApproval: async (approved: boolean) => {
      order.push(`resume:${approved}`);
      snapshot = { status: "completed", messages: [], pending: null, steps: 2, finalContent: "done" };
      return snapshot;
    },
    getAgentLoopSnapshot: () => snapshot
  };

  const result = await runDelegatedAgentLoop({
    runtime,
    initialCheckpoint: snapshot,
    messages: [],
    loopOptions: {},
    modelCallback: async () => ({ content: "done" }),
    persistCheckpoint: async (value: any) => { order.push(`persist:${value.status}`); },
    onAwaitingApproval: async () => { order.push("awaiting"); },
    waitForApproval: async () => {
      order.push("approved");
      return true;
    }
  });

  assert.equal(result.status, "completed");
  assert.equal(order.filter((item) => item === "resume:true").length, 1);
  assert.deepEqual(order.slice(0, 5), [
    "restore",
    "persist:awaiting-approval",
    "persist:awaiting-approval",
    "persist:awaiting-approval",
    "awaiting"
  ]);
  assert.equal(order.at(-1), "persist:completed");
});

test("auto-approves delegated checkpoints without waiting for UI approval", async () => {
  let waited = false;
  let snapshot: any = {
    status: "awaiting-approval",
    messages: [],
    pending: { call: { name: "shell.exec" } },
    steps: 1,
    finalContent: ""
  };
  const runtime = {
    startAgentLoop: () => { throw new Error("must restore"); },
    restoreAgentLoop: () => undefined,
    advanceAgentLoop: async () => { throw new Error("must not advance before approval"); },
    resumeAgentApproval: async () => {
      snapshot = { status: "completed", messages: [], pending: null, steps: 2, finalContent: "done" };
      return snapshot;
    },
    getAgentLoopSnapshot: () => snapshot
  };

  const result = await runDelegatedAgentLoop({
    runtime,
    initialCheckpoint: snapshot,
    messages: [],
    loopOptions: {},
    modelCallback: async () => ({ content: "done" }),
    persistCheckpoint: async () => undefined,
    onAwaitingApproval: async () => undefined,
    waitForApproval: async () => {
      waited = true;
      return true;
    },
    autoApprove: true
  });

  assert.equal(result.status, "completed");
  assert.equal(waited, false);
});

test("starts a new loop and returns cancellation without entering approval", async () => {
  const order: string[] = [];
  let snapshot: any = null;
  const runtime = {
    startAgentLoop: () => {
      order.push("start");
      snapshot = { status: "running", messages: [], pending: null, steps: 0, finalContent: "" };
    },
    restoreAgentLoop: () => { throw new Error("must start"); },
    advanceAgentLoop: async () => {
      snapshot = { status: "failed", messages: [], pending: null, steps: 1, finalContent: "cancelled" };
      return snapshot;
    },
    resumeAgentApproval: async () => { throw new Error("must not resume"); },
    getAgentLoopSnapshot: () => snapshot
  };

  const result = await runDelegatedAgentLoop({
    runtime,
    messages: [{ role: "user", content: "work" }],
    loopOptions: {},
    modelCallback: async () => ({ content: "unused" }),
    persistCheckpoint: async (value: any) => { order.push(`persist:${value.status}`); },
    onAwaitingApproval: async () => { throw new Error("must not await approval"); },
    waitForApproval: async () => false
  });

  assert.equal(result.status, "failed");
  assert.equal(order[0], "start");
  assert.equal(order.at(-1), "persist:failed");
});
