import type { PersistedGoalPlanStep, PersistedGoalSnapshot } from "./codex-storage.js";

export const GOAL_TOOL_NAMES = [
  "goal.get",
  "goal.create",
  "goal.update_plan",
  "goal.request_user_input",
  "goal.finish"
] as const;

export function mergeGoalPlanUpdate(
  existing: PersistedGoalPlanStep[],
  incoming: Array<Partial<PersistedGoalPlanStep> & { stepId: string; status: PersistedGoalPlanStep["status"] }>
) {
  const currentById = new Map(existing.map((step) => [step.stepId, step]));
  const orderedIds: string[] = [];
  const updatesById = new Map<string, (typeof incoming)[number]>();
  for (const step of incoming) {
    if (!updatesById.has(step.stepId)) orderedIds.push(step.stepId);
    const previous = updatesById.get(step.stepId);
    updatesById.set(step.stepId, {
      ...previous,
      ...Object.fromEntries(Object.entries(step).filter(([, value]) => value !== undefined))
    } as (typeof incoming)[number]);
  }
  return orderedIds.map((stepId) => {
    const step = updatesById.get(stepId)!;
    const current = currentById.get(step.stepId);
    const title = String(step.title || current?.title || step.stepId).trim();
    return {
      stepId: step.stepId,
      title,
      description: String(step.description || current?.description || title).trim(),
      status: step.status,
      result: String(step.result ?? current?.result ?? "").trim()
    };
  });
}

export function mergeFixedGoalPlanProgress(
  existing: PersistedGoalPlanStep[],
  incoming: Array<Partial<PersistedGoalPlanStep> & { stepId: string; status: PersistedGoalPlanStep["status"] }>
) {
  const incomingById = new Map<string, (typeof incoming)[number]>();
  for (const step of incoming) {
    const previous = incomingById.get(step.stepId);
    incomingById.set(step.stepId, {
      ...previous,
      ...Object.fromEntries(Object.entries(step).filter(([, value]) => value !== undefined))
    } as (typeof incoming)[number]);
  }
  return existing.map((current) => {
    const update = incomingById.get(current.stepId);
    if (!update) return current;
    return {
      ...current,
      status: update.status,
      result: String(update.result ?? current.result ?? "").trim()
    };
  });
}

function isGovernmentUserConfirmationStep(stepId: string) {
  return stepId === "specification-confirmation" || stepId === "outline-confirmation";
}

export function mergeGovernmentGoalPlanProgress(
  existing: PersistedGoalPlanStep[],
  incoming: Array<Partial<PersistedGoalPlanStep> & { stepId: string; status: PersistedGoalPlanStep["status"] }>
) {
  const confirmation = existing.find((step) => isGovernmentUserConfirmationStep(step.stepId));
  const confirmationCompleted = confirmation?.status === "completed";
  const currentById = new Map(existing.map((step) => [step.stepId, step]));
  const sanitized = incoming.flatMap((update) => {
    const current = currentById.get(update.stepId);
    if (!current) return [];
    if (isGovernmentUserConfirmationStep(update.stepId)) {
      if (confirmationCompleted || current.status === "completed") {
        // Native confirm owns this gate. Models must not reopen a completed confirmation,
        // or the chat「确认」path will loop on the waiting prompt forever.
        return [{
          ...update,
          status: "completed" as const,
          result: String(current.result || update.result || "用户已确认").trim()
        }];
      }
      // Only the native confirmation path may complete this gate after the user confirms.
      return [{ ...update, status: current.status, result: current.result }];
    }
    if (!confirmationCompleted && /^(?:draft|draft-section-|style-unification|fact-check|delivery)/.test(update.stepId)) {
      return [];
    }
    if (update.stepId === "delivery" && update.status === "completed") {
      return [{ ...update, status: "in_progress" as const }];
    }
    return [update];
  });
  return mergeFixedGoalPlanProgress(existing, sanitized);
}

export function buildGoalRuntimeInstruction(snapshot: PersistedGoalSnapshot | null, goalModeSelected: boolean) {
  if (!goalModeSelected && snapshot?.goal.status !== "active") return "";
  const state = snapshot ? JSON.stringify({
    objective: snapshot.goal.objective,
    status: snapshot.goal.status,
    runtime: snapshot.runtime,
    plan: snapshot.plan,
    pendingQuestion: snapshot.pendingQuestion
  }) : "none";
  return [
    "You are operating with the durable NewBrain goal runtime.",
    "For Chinese user requests, every user-visible objective, plan-step title, description, result, progress summary, and decision option must be written in Simplified Chinese.",
    "Goal state is thread-scoped and persisted by native tools; never simulate goal or plan state in prose.",
    snapshot ? "Continue the existing active goal. Do not create a duplicate goal." : "The user selected goal mode. Call goal.create before substantive execution, using a concrete objective with verification evidence.",
    "Do not invent a token or time budget. Runtime accounting is managed by NewBrain unless the product supplies an explicit user-defined budget.",
    "Call goal.update_plan when the execution plan is first known and whenever real progress changes step status or results.",
    "Call goal.request_user_input only when a missing user decision materially changes the outcome. After calling it, stop substantive work and briefly tell the user a decision is required.",
    "Continue autonomously while safe in-scope work remains. Do not finish merely because one response is ending.",
    "Call goal.finish(status=complete) only after every requirement is verified. Use blocked only after the same blocking condition has recurred for at least three consecutive goal turns.",
    `Current durable goal state: ${state}`
  ].join("\n");
}
