import assert from "node:assert/strict";
import test from "node:test";
const { projectPersistedActivities } = await import(
  new URL("./persisted-activity-policy.ts", import.meta.url).href
);

test("replays one completed activity from a durable call and result pair", () => {
  const activities = projectPersistedActivities([
    { id: "event-1", type: "tool_call", createdAt: "1", payload: { id: "call-1", name: "shell.exec", arguments: { command: "git status" } } },
    { id: "event-2", type: "tool_result", createdAt: "2", payload: { callId: "call-1", name: "shell.exec", result: { ok: true, exitCode: 0, stdout: "clean" } } }
  ]);
  assert.equal(activities.length, 1);
  assert.equal(activities[0].command, "git status");
  assert.equal(activities[0].exitCode, 0);
  assert.equal(activities[0].stdout, "clean");
  assert.equal(activities[0].status, "completed");
  assert.equal(activities[0].turnId, undefined);
});

test("preserves the owning turn on projected activities", () => {
  const activities = projectPersistedActivities([
    { id: "event-1", type: "tool_call", createdAt: "1", turnId: "turn-1", payload: { id: "call-1", name: "shell.exec", arguments: { command: "git status" } } },
    { id: "event-2", type: "tool_result", createdAt: "2", turnId: "turn-1", payload: { callId: "call-1", name: "shell.exec", result: { ok: true } } }
  ]);

  assert.equal(activities[0].turnId, "turn-1");
});

test("replays loaded skills without treating them as shell processes", () => {
  const activities = projectPersistedActivities([
    { id: "skill-1", type: "skill_loaded", createdAt: "1", payload: { name: "government-research-writing" } }
  ]);
  assert.equal(activities[0].title, "已应用 Skill");
  assert.equal(activities[0].exitCode, undefined);
  assert.equal(activities[0].command, undefined);
});

test("replays durable context compaction details", () => {
  const activities = projectPersistedActivities([
    { id: "context-1", type: "context_compacted", createdAt: "1", payload: { compactedMessageIds: ["1", "2"], estimatedTokens: 8000, modelContextWindow: 128000 } }
  ]);
  assert.equal(activities[0].title, "上下文已压缩");
  assert.match(activities[0].detail, /2 条较早消息/);
  assert.match(activities[0].detail, /8000 \/ 128000 Token/);
});

test("replays plans as semantic progress rather than commands", () => {
  const activities = projectPersistedActivities([
    { id: "plan-call", type: "tool_call", createdAt: "1", payload: { id: "plan-1", name: "goal.update_plan", arguments: {} } },
    { id: "plan-result", type: "tool_result", createdAt: "2", payload: { callId: "plan-1", name: "goal.update_plan", result: { ok: true, detail: "步骤已更新" } } }
  ]);
  assert.equal(activities.length, 1);
  assert.equal(activities[0].type, "complete");
  assert.equal(activities[0].title, "已更新计划");
  assert.equal(activities[0].command, undefined);
  assert.equal(activities[0].exitCode, undefined);
});
