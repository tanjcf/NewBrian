import { ipcMain } from "electron";
import {
  desktopIpcChannels,
  type AnswerGoalQuestionInput,
  type CreateGoalInput,
  type CreateGoalQuestionInput,
  type GoalThreadInput,
  type GovernmentWritingSpecificationGoalInput,
  type SaveGovernmentWritingSpecificationInput,
  type ConfirmGovernmentWritingSpecificationInput,
  type SaveGovernmentWritingSuggestionsInput,
  type ApplyGovernmentWritingSuggestionsInput,
  type ReplaceGoalPlanInput,
  type SetGoalPausedInput,
  type UpdateGoalInput,
  type UpdateGoalObjectiveInput
} from "@codex-forge/protocol";
import { type CodexStorage } from "./codex-storage.js";
import { advanceGovernmentPlanAfterOutlineAnswer } from "./government-outline-decision.js";
import {
  advanceGovernmentPlanAfterSpecificationConfirm,
  advanceGovernmentPlanAfterSpecificationSaved
} from "./government-writing-specification.js";
import { GovernmentWritingSpecificationService } from "./government-writing-specification-service.js";

interface GoalIpcServices {
  storage: CodexStorage;
  getActiveThreadId: () => string;
  processUuid: string;
}

export function registerGoalIpcHandlers({ storage, getActiveThreadId, processUuid }: GoalIpcServices) {
  const specificationService = new GovernmentWritingSpecificationService(storage);
  const requiredThreadId = (requested?: string, allowActiveFallback = false) => {
    const threadId = requested?.trim() || (allowActiveFallback ? getActiveThreadId() : "");
    if (!threadId) throw new Error("Goal IPC 需要 threadId。");
    return threadId;
  };

  ipcMain.handle(desktopIpcChannels.goal.get, (_event, input?: GoalThreadInput) => {
    const threadId = requiredThreadId(input?.threadId, true);
    return storage.getGoal(threadId);
  });
  ipcMain.handle(desktopIpcChannels.goal.getExecution, (_event, input?: GoalThreadInput) => {
    const threadId = requiredThreadId(input?.threadId, true);
    return storage.getGoalSnapshot(threadId);
  });
  ipcMain.handle(desktopIpcChannels.goal.create, (_event, input: CreateGoalInput) => {
    const threadId = requiredThreadId(input.threadId);
    const goal = storage.createGoal(threadId, input.objective, input.tokenBudget);
    storage.appendLog({ level: "info", target: "goal.create", body: goal.objective, threadId, processUuid });
    return goal;
  });
  ipcMain.handle(desktopIpcChannels.goal.update, (_event, input: UpdateGoalInput) => {
    const threadId = requiredThreadId(input.threadId);
    const goal = storage.updateGoal(threadId, input.status, input);
    storage.appendLog({ level: "info", target: "goal.update", body: input.status, threadId, processUuid });
    return goal;
  });
  ipcMain.handle(desktopIpcChannels.goal.setPaused, (_event, input: SetGoalPausedInput) => {
    const threadId = requiredThreadId(input.threadId);
    const goal = storage.setGoalPaused(threadId, input.paused === true);
    storage.appendLog({ level: "info", target: input.paused ? "goal.pause" : "goal.resume", body: goal.objective, threadId, processUuid });
    return storage.getGoalSnapshot(threadId);
  });
  ipcMain.handle(desktopIpcChannels.goal.updateObjective, (_event, input: UpdateGoalObjectiveInput) => {
    const threadId = requiredThreadId(input.threadId);
    storage.updateGoalObjective(threadId, input.objective);
    return storage.getGoalSnapshot(threadId);
  });
  ipcMain.handle(desktopIpcChannels.goal.delete, (_event, input?: GoalThreadInput) => {
    storage.deleteGoal(requiredThreadId(input?.threadId));
    return null;
  });
  ipcMain.handle(desktopIpcChannels.goal.replacePlan, (_event, input: ReplaceGoalPlanInput & GoalThreadInput) => {
    const threadId = requiredThreadId(input.threadId);
    const goal = storage.getGoal(threadId);
    if (!goal || goal.status !== "active") throw new Error("No active goal exists for this thread.");
    const plan = storage.replaceGoalPlan(threadId, goal.goalId, input.steps);
    storage.appendLog({ level: "info", target: "goal.plan", body: `${plan.length} steps`, threadId, processUuid });
    return storage.getGoalSnapshot(threadId);
  });
  ipcMain.handle(desktopIpcChannels.goal.createQuestion, (_event, input: CreateGoalQuestionInput & GoalThreadInput) => {
    const threadId = requiredThreadId(input.threadId);
    const goal = storage.getGoal(threadId);
    if (!goal || goal.status !== "active") throw new Error("No active goal exists for this thread.");
    storage.createGoalQuestion(threadId, goal.goalId, input);
    return storage.getGoalSnapshot(threadId);
  });
  ipcMain.handle(desktopIpcChannels.goal.answerQuestion, (_event, input: AnswerGoalQuestionInput) => {
    const threadId = requiredThreadId(input.threadId);
    const goal = storage.getGoal(threadId);
    if (!goal || goal.status !== "active") throw new Error("No active goal exists for this thread.");
    const snapshot = storage.getGoalSnapshot(threadId);
    if (
      snapshot &&
      /outline|\u63d0\u7eb2|\u5927\u7eb2/i.test(input.questionId) &&
      snapshot.plan.some((step) => /outline|\u63d0\u7eb2|\u5927\u7eb2/i.test(`${step.stepId} ${step.title}`))
    ) {
      storage.replaceGoalPlan(
        threadId,
        goal.goalId,
        advanceGovernmentPlanAfterOutlineAnswer(snapshot, input.questionId, input.answer)
      );
    }
    storage.answerGoalQuestion(threadId, goal.goalId, input.questionId, input.answer);
    return storage.getGoalSnapshot(threadId);
  });
  ipcMain.handle(desktopIpcChannels.governmentWritingSpecification.get, (_event, input: GovernmentWritingSpecificationGoalInput) => {
    const threadId = requiredThreadId(input.threadId);
    const goal = storage.getGoal(threadId);
    if (!goal || goal.goalId !== input.goalId) throw new Error("写作规格目标与当前线程不匹配。");
    return specificationService.getSnapshot(threadId, goal.goalId);
  });
  ipcMain.handle(desktopIpcChannels.governmentWritingSpecification.save, (_event, input: SaveGovernmentWritingSpecificationInput) => {
    const threadId = requiredThreadId(input.threadId);
    const goal = storage.getGoal(threadId);
    if (!goal || goal.goalId !== input.goalId) throw new Error("写作规格目标与当前线程不匹配。");
    specificationService.createVersion({
      threadId,
      goalId: goal.goalId,
      source: input.source,
      changeSummary: input.changeSummary,
      content: input.content,
      replacesVersionId: input.currentVersionId
    });
    const snapshot = storage.getGoalSnapshot(threadId);
    if (snapshot?.goal.status === "active" && snapshot.plan.some((step) => step.stepId === "specification-confirmation")) {
      storage.replaceGoalPlan(
        threadId,
        goal.goalId,
        advanceGovernmentPlanAfterSpecificationSaved(snapshot.plan)
      );
    }
    return specificationService.getSnapshot(threadId, goal.goalId);
  });
  ipcMain.handle(desktopIpcChannels.governmentWritingSpecification.confirm, (_event, input: ConfirmGovernmentWritingSpecificationInput) => {
    const threadId = requiredThreadId(input.threadId);
    const goal = storage.getGoal(threadId);
    if (!goal || goal.goalId !== input.goalId) throw new Error("写作规格目标与当前线程不匹配。");
    const confirmed = specificationService.confirmVersion(threadId, goal.goalId, input.versionId);
    const snapshot = storage.getGoalSnapshot(threadId);
    if (snapshot?.goal.status === "active" && snapshot.plan.some((step) => step.stepId === "specification-confirmation")) {
      storage.replaceGoalPlan(
        threadId,
        goal.goalId,
        advanceGovernmentPlanAfterSpecificationConfirm(
          snapshot.plan,
          confirmed.currentVersion.content.structure
        )
      );
    }
    return confirmed;
  });
  ipcMain.handle(desktopIpcChannels.governmentWritingSpecification.saveSuggestions, (_event, input: SaveGovernmentWritingSuggestionsInput) => {
    const threadId = requiredThreadId(input.threadId);
    const goal = storage.getGoal(threadId);
    if (!goal || goal.goalId !== input.goalId) throw new Error("写作规格目标与当前任务不匹配。");
    return specificationService.saveSuggestions(threadId, goal.goalId, input.baseVersionId, input.suggestions);
  });
  ipcMain.handle(desktopIpcChannels.governmentWritingSpecification.applySuggestions, (_event, input: ApplyGovernmentWritingSuggestionsInput) => {
    const threadId = requiredThreadId(input.threadId);
    const goal = storage.getGoal(threadId);
    if (!goal || goal.goalId !== input.goalId) throw new Error("写作规格目标与当前任务不匹配。");
    return specificationService.applySuggestions(threadId, goal.goalId, input.baseVersionId, input.suggestionIds);
  });
}
