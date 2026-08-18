import assert from "node:assert/strict";
import test from "node:test";
import { MultiAgentOrchestrator } from "./multi-agent-orchestrator.js";

test("runs delegated agents with a concurrency limit and merges completed results", async () => {
  let active = 0;
  let peak = 0;
  const orchestrator = new MultiAgentOrchestrator({ maxConcurrency: 2 });
  const tasks = ["research", "verify", "edit"].map((title, index) => orchestrator.delegate({
    id: `task-${index}`,
    parentThreadId: "parent",
    childThreadId: `child-${index}`,
    title,
    instruction: `${title} the change`,
    owner: title === "verify" ? "verifier" : "researcher"
  }));
  const results = await orchestrator.runAll("parent", async (task) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return { summary: `${task.title} complete` };
  });
  assert.equal(results.every((task) => task.status === "completed"), true);
  assert.equal(peak, 2);
  const merged = await orchestrator.merge("parent", tasks.map((task) => task.id), async (completed) => ({
    content: completed.map((task) => task.summary).join("; ")
  }));
  assert.match(merged.content, /research complete/);
  assert.match(merged.content, /verify complete/);
});

test("isolates a failed child without failing sibling tasks", async () => {
  const orchestrator = new MultiAgentOrchestrator({ maxConcurrency: 2 });
  orchestrator.delegate({ id: "good", parentThreadId: "p", childThreadId: "c1", instruction: "good" });
  orchestrator.delegate({ id: "bad", parentThreadId: "p", childThreadId: "c2", instruction: "bad" });
  const results = await orchestrator.runAll("p", async (task) => {
    if (task.id === "bad") throw new Error("child failed");
    return { summary: "ok" };
  });
  assert.equal(results.find((task) => task.id === "good").status, "completed");
  assert.equal(results.find((task) => task.id === "bad").status, "failed");
});

test("does not automatically replay interrupted running agents", () => {
  const orchestrator = new MultiAgentOrchestrator();
  const restored = orchestrator.restore({
    id: "task", parentThreadId: "p", childThreadId: "c", title: "Resume",
    instruction: "resume", owner: "researcher", status: "running", summary: "",
    result: null, error: "", createdAt: new Date(0).toISOString(), startedAt: new Date(0).toISOString(), completedAt: null
  });
  assert.equal(restored.status, "failed");
  assert.match(restored.error, /explicitly requested/);
  assert.equal(orchestrator.list("p").length, 1);
});

test("runs dependent tasks only after prerequisites complete", async () => {
  const order = [];
  const orchestrator = new MultiAgentOrchestrator({ maxConcurrency: 3 });
  orchestrator.delegate({ id: "research", parentThreadId: "p", childThreadId: "c1", instruction: "research" });
  orchestrator.delegate({ id: "implement", parentThreadId: "p", childThreadId: "c2", instruction: "implement", dependsOn: ["research"] });
  orchestrator.delegate({ id: "verify", parentThreadId: "p", childThreadId: "c3", instruction: "verify", dependsOn: ["implement"] });
  const results = await orchestrator.runAll("p", async (task) => {
    order.push(task.id);
    return { summary: task.id };
  });
  assert.deepEqual(order, ["research", "implement", "verify"]);
  assert.equal(results.every((task) => task.status === "completed"), true);
});

test("propagates dependency failure without running downstream work", async () => {
  const executed = [];
  const orchestrator = new MultiAgentOrchestrator();
  orchestrator.delegate({ id: "first", parentThreadId: "p", childThreadId: "c1", instruction: "first" });
  orchestrator.delegate({ id: "second", parentThreadId: "p", childThreadId: "c2", instruction: "second", dependsOn: ["first"] });
  const results = await orchestrator.runAll("p", async (task) => {
    executed.push(task.id);
    throw new Error("failed prerequisite");
  });
  assert.deepEqual(executed, ["first"]);
  assert.equal(results.find((task) => task.id === "second").status, "failed");
});

test("completes a 200-task pressure run without exceeding the concurrency limit", async () => {
  let active = 0;
  let peak = 0;
  const orchestrator = new MultiAgentOrchestrator({ maxConcurrency: 8 });
  for (let index = 0; index < 200; index += 1) {
    orchestrator.delegate({
      id: `pressure-${index}`,
      parentThreadId: "pressure-parent",
      childThreadId: `pressure-child-${index}`,
      instruction: `verify item ${index}`
    });
  }
  const results = await orchestrator.runAll("pressure-parent", async (task) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    return { summary: task.id };
  });

  assert.equal(results.length, 200);
  assert.equal(results.every((task) => task.status === "completed"), true);
  assert.equal(new Set(results.map((task) => task.summary)).size, 200);
  assert.ok(peak <= 8, `peak concurrency ${peak} exceeded 8`);
});

test("fails a queued task when a dependency cannot complete", () => {
  const orchestrator = new MultiAgentOrchestrator();
  orchestrator.delegate({ id: "blocked", parentThreadId: "p", childThreadId: "c", instruction: "wait" });
  const failed = orchestrator.fail("blocked", "dependency failed");
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "dependency failed");
});

test("can fail a running task by childThreadId and is idempotent for terminal tasks", async () => {
  const orchestrator = new MultiAgentOrchestrator();
  orchestrator.delegate({ id: "running-task", parentThreadId: "p", childThreadId: "child-1", instruction: "work" });
  const hang = new Promise(() => undefined);
  void orchestrator.run("running-task", async () => hang);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(orchestrator.get("running-task")?.status, "running");
  const failed = orchestrator.fail("child-1", "abandoned");
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "abandoned");
  assert.equal(orchestrator.fail("running-task", "again").status, "failed");
});
