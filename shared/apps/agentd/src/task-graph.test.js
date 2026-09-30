import assert from "node:assert/strict";
import test from "node:test";
import { TaskGraph } from "./task-graph.js";

test("unblocks dependent tasks only after every dependency completes", () => {
  const graph = new TaskGraph();
  graph.add({ id: "research" });
  graph.add({ id: "design" });
  graph.add({ id: "implement", dependsOn: ["research", "design"] });
  graph.mark("research", "completed");
  assert.equal(graph.get("implement").status, "blocked");
  graph.mark("design", "completed");
  assert.equal(graph.get("implement").status, "ready");
});

test("cancels a dependent task when a required task fails", () => {
  const graph = new TaskGraph();
  graph.add({ id: "research" });
  graph.add({ id: "write", dependsOn: ["research"] });
  graph.mark("research", "failed");
  assert.equal(graph.get("write").status, "cancelled");
});

test("rejects unknown and self dependencies", () => {
  const graph = new TaskGraph();
  assert.throws(() => graph.add({ id: "a", dependsOn: ["a"] }), /itself/);
  assert.throws(() => graph.add({ id: "b", dependsOn: ["missing"] }), /Unknown task dependency/);
});

test("adds a ready task when its dependency already completed", () => {
  const graph = new TaskGraph();
  graph.add({ id: "research" });
  graph.mark("research", "completed");
  assert.equal(graph.add({ id: "write", dependsOn: ["research"] }).status, "ready");
});
