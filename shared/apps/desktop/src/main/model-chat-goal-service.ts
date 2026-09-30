import type { ModelChatInput } from "@codex-forge/protocol";
import type { CodexStorage, PersistedGoalSnapshot } from "./codex-storage.js";
import type {
  ModelChatSkillSelection,
  ModelChatSkillSelectionInput
} from "./model-chat-skill-policy.js";
import type { SkillDescriptor } from "./skill-selection.js";
import {
  isGovernmentConfirmedRevisionDeliveryRequest,
  isGovernmentRevisionPreviewRequest
} from "./government-skill-routing.js";
import {
  GOVERNMENT_INTAKE_QUESTION_ID,
  completeGovernmentIntakeInPlan
} from "./government-intake.js";

/** Specialty skills that must not be revived from durable goal persistence alone. */
function isSpecialtyComposerSkillName(name: string) {
  return name === "government-research-writing";
}

type GoalStorage = Pick<
  CodexStorage,
  "answerGoalQuestion" | "createGoal" | "createGoalQuestion" | "getGoalSnapshot" | "recordGoalTurn" | "replaceGoalPlan" | "setGoalPaused" | "upsertGoal" | "upsertGoalRuntime"
>;

function resolvePendingQuestionAnswer(
  question: NonNullable<PersistedGoalSnapshot["pendingQuestion"]>,
  request: string
) {
  const text = request.trim();
  const options = question.options ?? [];
  const numeric = text.match(/^(?:选择|选项)?\s*([1-9])(?:\s*[。.、])?$/u);
  if (numeric) return options[Number(numeric[1]) - 1]?.label ?? "";
  if (/(?:确认|同意|采用|按).{0,8}(?:提纲|大纲)|(?:提纲|大纲).{0,8}(?:确认|没问题|可以)/u.test(text)) {
    return options.find((option) => option.recommended)?.label ?? options[0]?.label ?? "";
  }
  const matched = options.find((option) =>
    text === option.label || text.includes(`用户选择：${option.label}`)
  )?.label ?? "";
  if (matched) return matched;
  // Bare「确认」on an outline gate should accept the recommended option. Without this,
  // users click the footer prompt and get routed into writing-specification confirm.
  if (
    /outline|\u63d0\u7eb2|\u5927\u7eb2/i.test(question.questionId)
    && /^(?:确认|同意|可以|没问题)$/u.test(
      text
        .replace(/^[“"‘'「『]+|[”"'’」』]+$/gu, "")
        .replace(/[。．.！!？?\s、，,；;：:]+$/gu, "")
    )
  ) {
    return options.find((option) => option.recommended)?.label
      ?? options.find((option) => /确认/u.test(option.label))?.label
      ?? options[0]?.label
      ?? "";
  }
  // The clarification question accepts free-form supplements: any substantive
  // reply is treated as the user's supplied information rather than left pending.
  if (question.questionId === GOVERNMENT_INTAKE_QUESTION_ID && text) return text;
  return "";
}

export interface ModelChatGoalRuntime {
  getSkillDescriptors(): SkillDescriptor[];
  matchSkills(prompt: string): SkillDescriptor[];
}

export interface ModelChatGoalDependencies {
  storage: GoalStorage;
  selectSkills: (input: ModelChatSkillSelectionInput) => ModelChatSkillSelection;
  buildGovernmentWritingInitialPlan: () => Parameters<GoalStorage["replaceGoalPlan"]>[2];
  registerGoalRuntimeTools: (
    runtime: ModelChatGoalRuntime,
    threadId: string,
    explicitSkillNames: string[]
  ) => void;
  nowMs?: () => number;
  advancePlanAfterQuestionAnswer?: (
    snapshot: PersistedGoalSnapshot,
    questionId: string,
    answer: string
  ) => PersistedGoalSnapshot["plan"];
}

export interface ModelChatGoalSession extends ModelChatSkillSelection {
  goalSnapshot: PersistedGoalSnapshot | null;
  accounting: {
    threadId: string;
    startedAt: number;
    tokens: number;
    fallbackTokens: number;
    lastError: string;
  } | null;
}

/** Owns goal creation, skill persistence, runtime binding, and per-turn budget accounting. */
export class ModelChatGoalService {
  private readonly dependencies: ModelChatGoalDependencies;
  private readonly nowMs: () => number;

  constructor(dependencies: ModelChatGoalDependencies) {
    this.dependencies = dependencies;
    this.nowMs = dependencies.nowMs ?? Date.now;
  }

  start(input: {
    modelInput: ModelChatInput;
    runtime: ModelChatGoalRuntime;
    threadId: string;
    turnId: string;
    latestUserRequest: string;
    /** Settings personalization.autoSkillEnabled — default false. */
    autoSkillEnabled?: boolean;
  }): ModelChatGoalSession {
    const autoSkillEnabled = input.autoSkillEnabled === true;
    let goalSnapshot = this.dependencies.storage.getGoalSnapshot(input.threadId);
    if (goalSnapshot?.goal.status === "paused") {
      this.dependencies.storage.setGoalPaused(input.threadId, false);
      goalSnapshot = this.dependencies.storage.getGoalSnapshot(input.threadId);
    }
    if (goalSnapshot?.goal.status === "active" && goalSnapshot.goal.turnId !== input.turnId) {
      this.dependencies.storage.upsertGoal({ ...goalSnapshot.goal, turnId: input.turnId });
      goalSnapshot = this.dependencies.storage.getGoalSnapshot(input.threadId);
    }
    if (goalSnapshot?.goal.status === "active" && goalSnapshot.pendingQuestion) {
      const answer = resolvePendingQuestionAnswer(goalSnapshot.pendingQuestion, input.latestUserRequest);
      if (answer) {
        const questionId = goalSnapshot.pendingQuestion.questionId;
        let nextPlan = this.dependencies.advancePlanAfterQuestionAnswer?.(goalSnapshot, questionId, answer);
        if (questionId === GOVERNMENT_INTAKE_QUESTION_ID) {
          nextPlan = completeGovernmentIntakeInPlan(nextPlan ?? goalSnapshot.plan, answer);
        }
        if (nextPlan) {
          this.dependencies.storage.replaceGoalPlan(input.threadId, goalSnapshot.goal.goalId, nextPlan);
        }
        this.dependencies.storage.answerGoalQuestion(input.threadId, goalSnapshot.goal.goalId, questionId, answer);
        goalSnapshot = this.dependencies.storage.getGoalSnapshot(input.threadId);
      }
    }
    // Specialty skills: composer selection always wins. Auto-awaken (persisted goal,
    // keywords, heuristic match) only when Settings autoSkillEnabled is ON.
    const selection = this.dependencies.selectSkills({
      requestedSkillNames: input.modelInput.selectedSkillNames,
      persistedSkillNames: goalSnapshot?.runtime.selectedSkillNames,
      composerModes: input.modelInput.composerModes,
      localSkillDescriptors: input.runtime.getSkillDescriptors(),
      heuristicSkills: input.runtime.matchSkills(input.latestUserRequest),
      hasActiveGoal: goalSnapshot?.goal.status === "active",
      autoSkillEnabled,
      latestUserRequest: input.latestUserRequest
    });

    if (
      selection.governmentSkillEnabled
      && !goalSnapshot
      && !isGovernmentRevisionPreviewRequest(input.latestUserRequest)
    ) {
      const goal = this.dependencies.storage.createGoal(input.threadId, input.latestUserRequest, undefined, input.turnId);
      const initialPlan = this.dependencies.buildGovernmentWritingInitialPlan();
      const confirmedRevision = isGovernmentConfirmedRevisionDeliveryRequest(input.latestUserRequest);
      const plan = confirmedRevision
        ? initialPlan.map((step) => {
            const identity = `${step.stepId} ${step.title}`;
            if (!/(?:material|材料|requirement|需求|evidence|证据|specification|规格|outline|提纲|大纲|confirm|确认)/iu.test(identity)) return step;
            const result = /(?:specification|规格|outline|提纲|大纲)/iu.test(identity) && !/(?:confirm|确认)/iu.test(identity)
              ? "沿用上一版结构，并应用用户已确认的修改说明。"
              : /(?:confirm|确认)/iu.test(identity)
                ? "用户已明确确认修改并请求第二版文件交付。"
                : "已继承当前线程中的材料与已确认修改要求。";
            return { ...step, status: "completed" as const, result };
          })
        : initialPlan;
      this.dependencies.storage.replaceGoalPlan(
        input.threadId,
        goal.goalId,
        plan
      );
      goalSnapshot = this.dependencies.storage.getGoalSnapshot(input.threadId);
    }

    if (selection.goalRuntimeEnabled) {
      this.dependencies.registerGoalRuntimeTools(input.runtime, input.threadId, [...new Set([
        ...selection.explicitSkillNames,
        ...selection.centralSkillNames
      ])]);
      if (goalSnapshot?.goal.status === "active") {
        this.dependencies.storage.upsertGoalRuntime({
          ...goalSnapshot.runtime,
          phase: "running",
          lastError: "",
          updatedAtMs: this.nowMs()
        });
        goalSnapshot = this.dependencies.storage.getGoalSnapshot(input.threadId);
      }
    }

    // Keep durable specialty skills aligned with enablement for this turn.
    // When auto-skill is OFF and the picker is empty, clear specialty from the goal
    // so 「本轮使用 Skill」and later turns cannot revive it from persistence alone.
    const activeForSkills = this.dependencies.storage.getGoalSnapshot(input.threadId);
    if (activeForSkills?.goal.status === "active") {
      const previous = activeForSkills.runtime.selectedSkillNames ?? [];
      const retained = previous.filter((name) =>
        !isSpecialtyComposerSkillName(name) || selection.centralSkillNames.includes(name)
      );
      const nextSelected = [...new Set([
        ...retained,
        ...selection.centralSkillNames
      ])].slice(0, 4);
      if (
        nextSelected.length !== previous.length
        || nextSelected.some((name, index) => name !== previous[index])
      ) {
        this.dependencies.storage.upsertGoalRuntime({
          ...activeForSkills.runtime,
          selectedSkillNames: nextSelected,
          updatedAtMs: this.nowMs()
        });
        goalSnapshot = this.dependencies.storage.getGoalSnapshot(input.threadId);
      }
    }

    return {
      ...selection,
      goalSnapshot,
      accounting: selection.goalRuntimeEnabled
        ? {
            threadId: input.threadId,
            startedAt: this.nowMs(),
            tokens: 0,
            fallbackTokens: 0,
            lastError: ""
          }
        : null
    };
  }

  finish(session: ModelChatGoalSession, fallbackTokens: number) {
    if (!session.accounting) return;
    this.dependencies.storage.recordGoalTurn(session.accounting.threadId, {
      tokensUsed: session.accounting.tokens || fallbackTokens,
      timeUsedSeconds: Math.max(1, Math.ceil((this.nowMs() - session.accounting.startedAt) / 1000)),
      lastError: session.accounting.lastError
    });
  }
}
