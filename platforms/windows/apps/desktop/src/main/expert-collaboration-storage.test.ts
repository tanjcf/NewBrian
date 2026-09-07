import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexStorage } from "./codex-storage.ts";
import { ExpertCollaboration, EXPERT_ACCEPT } from "./expert-collaboration.ts";

test("expert consent survives SQLite reopen and cannot authorize another goal or thread", async () => {
  const root = mkdtempSync(join(tmpdir(), "brain-expert-consent-"));
  let storage = new CodexStorage(root);
  const service = () => new ExpertCollaboration({
    scope: "project", scene: "software",
    goal: () => storage.getGoal("thread"), createGoal: objective => storage.createGoal("thread", objective),
    questions: goalId => storage.listExpertQuestions("thread", goalId),
    ask: (goalId, question) => { storage.createGoalQuestion("thread", goalId, question); },
    applied: (goalId, id) => storage.markExpertPreferenceApplied("thread", goalId, id),
    catalog: async () => [{ id: "review", displayName: "review", installed: true, enabled: true }],
    preferences: async () => [], savePreference: async () => ({})
  });
  try {
    await service().propose("Review API authorization", [{ expertId: "review", reason: "Authorization changed", responsibility: "Check access control" }]);
    const snapshot = storage.getGoalSnapshot("thread")!;
    storage.close(); storage = new CodexStorage(root);
    assert.equal(storage.getGoalSnapshot("thread")?.pendingQuestion?.questionId, snapshot.pendingQuestion?.questionId);
    await assert.rejects(service().authorize("review"), /CONFIRMATION_REQUIRED/);
    storage.answerGoalQuestion("thread", snapshot.goal.goalId, snapshot.pendingQuestion!.questionId, EXPERT_ACCEPT);
    storage.close(); storage = new CodexStorage(root);
    await service().authorize("review");
    assert.deepEqual(storage.listExpertQuestions("other-thread", snapshot.goal.goalId), []);
    storage.upsertGoal({ ...storage.getGoal("thread")!, status: "complete" });
    storage.createGoal("thread", "A new task");
    await assert.rejects(service().authorize("review"), /CONFIRMATION_REQUIRED/);
  } finally { storage.close(); rmSync(root, { recursive: true, force: true }); }
});
