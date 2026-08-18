import assert from "node:assert/strict";
import test from "node:test";

const { DelegatedAgentControlService } = await import(
  new URL("./delegated-agent-control-service.ts", import.meta.url).href
);

test("deduplicates an active child run and removes it after completion", async () => {
  const service = new DelegatedAgentControlService();
  let starts = 0;
  let release!: () => void;
  const first = service.trackRun("child", async () => {
    starts += 1;
    await new Promise<void>((resolve) => { release = resolve; });
    return "done";
  });
  const second = service.trackRun("child", async () => "duplicate");
  assert.equal(first, second);
  await Promise.resolve();
  release();
  assert.equal(await first, "done");
  assert.equal(service.getRun("child"), undefined);
  assert.equal(starts, 1);
});

test("interrupt aborts the child and releases an approval waiter", async () => {
  const service = new DelegatedAgentControlService();
  const controller = new AbortController();
  service.bindAbortController("child", controller);
  const approval = service.waitForApproval("child", controller.signal);
  service.interrupt("child");
  assert.equal(controller.signal.aborted, true);
  assert.equal(await approval, false);
});

test("rejects approval for a terminal child instead of restarting it", async () => {
  const service = new DelegatedAgentControlService();
  let resumed = false;
  assert.throws(() => service.respondApproval({
      childThreadId: "child",
      approved: true,
      canResume: false,
      resume: async () => { resumed = true; }
    }), /cannot be resumed/);
  assert.equal(resumed, false);
});

test("queues one early approval and starts at most one recovery run", async () => {
  const service = new DelegatedAgentControlService();
  let starts = 0;
  const run = () => service.respondApproval({
    childThreadId: "child",
    approved: true,
    canResume: true,
    resume: async () => { starts += 1; return "resumed"; }
  });
  const [first, second] = await Promise.all([run(), run()]);
  assert.equal(await first, "resumed");
  assert.equal(await second, "resumed");
  assert.equal(starts, 1);
});

test("bounds follow-up steering and drains it exactly once", () => {
  const service = new DelegatedAgentControlService();
  for (let index = 0; index < 10; index += 1) service.queueFollowup("child", `${index}`);
  assert.deepEqual(service.drainFollowups("child"), ["2", "3", "4", "5", "6", "7", "8", "9"]);
  assert.deepEqual(service.drainFollowups("child"), []);
});

test("does not run a dependent child after a dependency fails", async () => {
  const service = new DelegatedAgentControlService();
  let ran = false;
  const result = await service.scheduleAfterDependencies({
    childThreadId: "child",
    dependencyIds: ["dependency"],
    getDependencyStatus: () => "failed",
    onDependencyFailure: () => "blocked",
    run: async () => { ran = true; return "ran"; }
  });
  assert.equal(result, "blocked");
  assert.equal(ran, false);
});
