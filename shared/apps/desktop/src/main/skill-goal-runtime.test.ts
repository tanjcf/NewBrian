import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner loads this source file directly.
import { buildSkillGoalRuntimeInstruction, shouldUseGoalRuntimeForSkills } from "./skill-goal-runtime.ts";

test("an explicitly selected skill uses the durable goal runtime", () => {
  assert.equal(shouldUseGoalRuntimeForSkills(["government-research-writing"]), true);
  const instruction = buildSkillGoalRuntimeInstruction(["government-research-writing"], null);
  assert.match(instruction, /先创建一个具体目标和执行计划/);
  assert.match(instruction, /标题、描述、结果和用户可见进度必须使用中文/);
  assert.match(instruction, /不得塞入用户选择卡片/);
});

test("automatic skill routing does not force a goal lifecycle", () => {
  assert.equal(shouldUseGoalRuntimeForSkills([]), false);
  assert.equal(buildSkillGoalRuntimeInstruction([], null), "");
});
