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

test("restores interrupted running agents as queued work", () => {
  const orchestrator = new MultiAgentOrchestrator();
  const restored = orchestrator.restore({
    id: "task", parentThreadId: "p", childThreadId: "c", title: "Resume",
    instruction: "resume", owner: "researcher", status: "running", summary: "",
    result: null, error: "", createdAt: new Date(0).toISOString(), startedAt: new Date(0).toISOString(), completedAt: null
  });
  assert.equal(restored.status, "queued");
  assert.equal(orchestrator.list("p").length, 1);
});
