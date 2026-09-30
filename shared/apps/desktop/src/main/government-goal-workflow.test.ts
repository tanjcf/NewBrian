import assert from "node:assert/strict";
import test from "node:test";
const { buildGovernmentWritingInitialPlan } = await import(new URL("./government-goal-workflow.ts", import.meta.url).href) as typeof import("./government-goal-workflow.js");
const { mergeFixedGoalPlanProgress, mergeGovernmentGoalPlanProgress } = await import(new URL("./goal-runtime.ts", import.meta.url).href) as typeof import("./goal-runtime.js");

test("government writing starts with a specification-first durable plan", () => {
  const plan = buildGovernmentWritingInitialPlan();
  assert.equal(plan.length, 9);
  assert.deepEqual(plan.filter((step) => step.status === "in_progress").map((step) => step.stepId), ["material-assessment"]);
  assert.deepEqual(plan.slice(2, 6).map((step) => step.stepId), [
    "official-evidence-research",
    "writing-specification",
    "specification-confirmation",
    "draft"
  ]);
  assert.equal(plan.some((step) => /outline/i.test(step.stepId)), false);
  assert.equal(plan.at(-1)?.stepId, "delivery");
});

test("government plan cannot forge specification confirmation or delivery completion", () => {
  const existing = buildGovernmentWritingInitialPlan().map((step, position) => ({
    ...step,
    threadId: "thread",
    goalId: "goal",
    position,
    updatedAtMs: 1
  }));
  const next = mergeGovernmentGoalPlanProgress(existing, [
    { stepId: "specification-confirmation", status: "completed", result: "user confirmed" },
    { stepId: "draft", status: "completed", result: "drafted" },
    { stepId: "delivery", status: "completed", result: "delivered" }
  ]);
  assert.equal(next.find((step) => step.stepId === "specification-confirmation")?.status, "pending");
  assert.equal(next.find((step) => step.stepId === "specification-confirmation")?.result, "");
  assert.equal(next.find((step) => step.stepId === "draft")?.status, "pending");
  assert.equal(next.find((step) => step.stepId === "delivery")?.status, "pending");
});

test("government plan cannot reopen a completed specification confirmation", () => {
  const existing = buildGovernmentWritingInitialPlan().map((step, position) => ({
    ...step,
    threadId: "thread",
    goalId: "goal",
    position,
    updatedAtMs: 1,
    status: (
      step.stepId === "specification-confirmation" || step.stepId === "writing-specification"
        || step.stepId === "material-assessment" || step.stepId === "requirement-clarification"
        || step.stepId === "official-evidence-research"
        ? "completed"
        : step.stepId === "draft" ? "in_progress" : "pending"
    ) as "pending" | "in_progress" | "completed",
    result: step.stepId === "specification-confirmation" ? "用户已确认当前写作规格。" : step.result
  }));
  const next = mergeGovernmentGoalPlanProgress(existing, [
    { stepId: "specification-confirmation", status: "in_progress", result: "" },
    { stepId: "draft", status: "pending", result: "" }
  ]);
  assert.equal(next.find((step) => step.stepId === "specification-confirmation")?.status, "completed");
  assert.equal(next.find((step) => step.stepId === "specification-confirmation")?.result, "用户已确认当前写作规格。");
  assert.equal(next.find((step) => step.stepId === "draft")?.status, "pending");
});

test("government material progress can enter specification generation without starting confirmation concurrently", () => {
  const existing = buildGovernmentWritingInitialPlan().map((step, position) => ({
    ...step,
    threadId: "thread",
    goalId: "goal",
    position,
    updatedAtMs: 1
  }));
  const next = mergeGovernmentGoalPlanProgress(existing, [
    { stepId: "material-assessment", status: "completed", result: "云南高原特色农业；江苏制造业；庆阳算力集群" },
    { stepId: "writing-specification", status: "in_progress", result: "" },
    { stepId: "specification-confirmation", status: "pending", result: "" }
  ]);
  assert.deepEqual(next.filter((step) => step.status === "in_progress").map((step) => step.stepId), ["writing-specification"]);
  assert.equal(next.find((step) => step.stepId === "material-assessment")?.status, "completed");
  assert.equal(next.find((step) => step.stepId === "specification-confirmation")?.status, "pending");
});

test("government plan progress cannot replace the native workflow structure", () => {
  const existing = buildGovernmentWritingInitialPlan().map((step, position) => ({
    ...step,
    threadId: "thread",
    goalId: "goal",
    position,
    updatedAtMs: 1
  }));
  const next = mergeFixedGoalPlanProgress(existing, [
    { stepId: "draft", status: "in_progress", result: "drafting" },
    { stepId: "invented-stage", status: "completed", result: "ignored" }
  ]);
  assert.deepEqual(next.map((step) => step.stepId), existing.map((step) => step.stepId));
  assert.equal(next.find((step) => step.stepId === "draft")?.status, "in_progress");
  assert.equal(next.some((step) => step.stepId === "invented-stage"), false);
});
