import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner loads this source file directly.
import { buildGoalRuntimeInstruction, GOAL_TOOL_NAMES, mergeGoalPlanUpdate } from "./goal-runtime.ts";

test("goal mode requires native goal creation instead of prose simulation", () => {
  const instruction = buildGoalRuntimeInstruction(null, true);
  assert.match(instruction, /Call goal\.create/);
  assert.match(instruction, /never simulate goal or plan state in prose/);
  assert.match(instruction, /Do not invent a token or time budget/);
  assert.equal(GOAL_TOOL_NAMES.includes("goal.request_user_input"), true);
});

test("an active goal continues without creating a duplicate", () => {
  const instruction = buildGoalRuntimeInstruction({
    goal: { threadId: "t", goalId: "g", objective: "verify behavior", status: "active", tokensUsed: 1, timeUsedSeconds: 2, createdAtMs: 1, updatedAtMs: 2 },
    runtime: { threadId: "t", goalId: "g", phase: "running", consecutiveBlockedTurns: 0, lastError: "", updatedAtMs: 2 },
    plan: [],
    pendingQuestion: null
  }, false);
  assert.match(instruction, /Continue the existing active goal/);
  assert.match(instruction, /verify behavior/);
  assert.doesNotMatch(instruction, /Call goal\.create before/);
});

test("ordinary chat receives no goal runtime instruction", () => {
  assert.equal(buildGoalRuntimeInstruction(null, false), "");
});

test("incremental plan updates preserve unchanged descriptions and results", () => {
  const merged = mergeGoalPlanUpdate([{
    threadId: "t", goalId: "g", stepId: "draft", position: 0,
    title: "起草", description: "完成正文", status: "in_progress", result: "", updatedAtMs: 1
  }], [{ stepId: "draft", status: "completed", result: "正文已完成" }]);
  assert.deepEqual(merged, [{
    stepId: "draft", title: "起草", description: "完成正文", status: "completed", result: "正文已完成"
  }]);
});

test("duplicate step updates are coalesced idempotently with stable first-seen order", () => {
  const merged = mergeGoalPlanUpdate([], [
    { stepId: "draft", title: "Draft", description: "Write", status: "in_progress" },
    { stepId: "verify", title: "Verify", description: "Review", status: "pending" },
    { stepId: "draft", status: "completed", result: "Written" }
  ]);

  assert.deepEqual(merged, [
    { stepId: "draft", title: "Draft", description: "Write", status: "completed", result: "Written" },
    { stepId: "verify", title: "Verify", description: "Review", status: "pending", result: "" }
  ]);
});
