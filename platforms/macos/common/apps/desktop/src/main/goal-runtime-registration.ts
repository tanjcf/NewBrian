import type { CodexStorage } from "./codex-storage.js";
import { isGovernmentResearchWritingSkill } from "./central-skills.js";
import { mergeGoalPlanUpdate, mergeGovernmentGoalPlanProgress } from "./goal-runtime.js";

type GoalRuntime = {
  registerExternalTool(definition: Record<string, unknown>, execute: (input: Record<string, unknown>) => Promise<unknown> | unknown): unknown;
};

export function registerGoalRuntimeTools(
  codexStorage: CodexStorage,
  targetRuntime: GoalRuntime,
  threadId: string,
  selectedSkillNames: string[] = []
) {
  const register = (definition: Record<string, unknown>, execute: (input: Record<string, unknown>) => Promise<unknown> | unknown) =>
    targetRuntime.registerExternalTool({
      namespace: "newbrain-goal",
      requiresApproval: false,
      risk: "low",
      ...definition
    }, execute);
  const snapshotOutput = () => ({
    ok: true,
    output: JSON.stringify(codexStorage.getGoalSnapshot(threadId))
  });
  const bindSelectedSkills = () => {
    const snapshot = codexStorage.getGoalSnapshot(threadId);
    if (!snapshot || !selectedSkillNames.length) return;
    codexStorage.upsertGoalRuntime({
      ...snapshot.runtime,
      selectedSkillNames: [...new Set([...(snapshot.runtime.selectedSkillNames ?? []), ...selectedSkillNames])].slice(0, 4),
      updatedAtMs: Date.now()
    });
  };
  bindSelectedSkills();
  register({
    name: "goal.get",
    title: "Get durable goal",
    description: "Read the active thread goal, runtime phase, plan, and pending user question.",
    kind: "read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  }, snapshotOutput);
  register({
    name: "goal.create",
    title: "Create durable goal",
    description: "Create one measurable durable goal for this thread. Fails if an active goal already exists.",
    kind: "write",
    inputSchema: {
      type: "object",
      properties: { objective: { type: "string", minLength: 1 } },
      required: ["objective"],
      additionalProperties: false
    }
  }, (input) => {
    codexStorage.createGoal(threadId, String(input.objective || ""));
    bindSelectedSkills();
    return snapshotOutput();
  });
  register({
    name: "goal.update_plan",
    title: "Update durable goal plan",
    description: "Replace the durable execution plan with current step statuses and verified step results.",
    kind: "write",
    inputSchema: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              stepId: { type: "string", minLength: 1 },
              title: { type: "string", minLength: 1 },
              description: { type: "string", minLength: 1 },
              status: { type: "string", enum: ["pending", "in_progress", "completed"] },
              result: { type: "string" }
            },
            required: ["stepId", "status"],
            additionalProperties: false
          }
        }
      },
      required: ["steps"],
      additionalProperties: false
    }
  }, (input) => {
    const goal = codexStorage.getGoal(threadId);
    if (!goal || goal.status !== "active") throw new Error("No active goal exists for this thread.");
    const existingPlan = codexStorage.listGoalPlan(threadId, goal.goalId);
    const steps = Array.isArray(input.steps) ? input.steps : [];
    const nextPlan = selectedSkillNames.some((name) => isGovernmentResearchWritingSkill(name))
      ? mergeGovernmentGoalPlanProgress(existingPlan, steps as never)
      : mergeGoalPlanUpdate(existingPlan, steps as never);
    codexStorage.replaceGoalPlan(threadId, goal.goalId, nextPlan);
    return snapshotOutput();
  });
  register({
    name: "goal.request_user_input",
    title: "Request goal decision",
    description: "Persist one blocking user decision with two or three mutually exclusive options.",
    kind: "write",
    inputSchema: {
      type: "object",
      properties: {
        questionId: { type: "string", minLength: 1 },
        prompt: { type: "string", minLength: 1 },
        options: {
          type: "array",
          minItems: 2,
          maxItems: 3,
          items: {
            type: "object",
            properties: {
              label: { type: "string", minLength: 1 },
              description: { type: "string", minLength: 1 },
              recommended: { type: "boolean" }
            },
            required: ["label", "description"],
            additionalProperties: false
          }
        }
      },
      required: ["questionId", "prompt", "options"],
      additionalProperties: false
    }
  }, (input) => {
    const goal = codexStorage.getGoal(threadId);
    if (!goal || goal.status !== "active") throw new Error("No active goal exists for this thread.");
    codexStorage.createGoalQuestion(threadId, goal.goalId, input);
    return snapshotOutput();
  });
  register({
    name: "goal.finish",
    title: "Finish durable goal",
    description: "Mark the active goal complete when fully verified, or blocked only after the same blocker recurs three turns.",
    kind: "write",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["complete", "blocked"] },
        reason: { type: "string" },
        tokensUsed: { type: "integer", minimum: 0 },
        timeUsedSeconds: { type: "integer", minimum: 0 }
      },
      required: ["status"],
      additionalProperties: false
    }
  }, (input) => {
    const goal = codexStorage.getGoal(threadId);
    if (!goal || goal.status !== "active") throw new Error("No active goal exists for this thread.");
    if (input.status === "complete" && selectedSkillNames.some((name) => isGovernmentResearchWritingSkill(name))) {
      return {
        ok: true,
        output: [
          "Government writing completion is owned by the desktop finalization verifier.",
          "Do not call goal.finish again in this turn.",
          "Stop further tool calls now.",
          "If the writing specification is not yet confirmed, present the complete specification and wait.",
          "If the specification is already confirmed, stream the complete Chinese article body in chat.",
          "Do not keep calling web.search_official."
        ].join(" ")
      };
    }
    if (input.status === "blocked") {
      const blocked = codexStorage.attemptBlockGoal(threadId, String(input.reason || ""));
      if (!blocked.accepted) return { ok: false, output: `Blocked threshold not met (${blocked.attempt}/3). Continue safe work or ask the user.` };
      return snapshotOutput();
    }
    codexStorage.updateGoal(threadId, input.status as "complete" | "blocked", {
      tokensUsed: Number(input.tokensUsed ?? 0),
      timeUsedSeconds: Number(input.timeUsedSeconds ?? 0)
    });
    return snapshotOutput();
  });
}
