import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("goal UI restores durable state and resumes a persisted user decision", async () => {
  const source = await readFile(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(source, /api\.getGoalExecution\(\{ threadId: selectedThread\.id \}\)/);
  assert.match(source, /answerGoalQuestion\(\{ threadId: selectedThread\?\.id/);
  assert.match(source, /execution\?\.goal\?\.status === "active"/);
  assert.match(source, /current\.filter\(\(mode\) => mode !== "goal"\)/);
  assert.match(source, /api\.setGoalPaused\(\{ threadId: selectedThread\?\.id, paused: true \}\)/);
  assert.match(source, /api\.setGoalPaused\(\{ threadId: selectedThread\?\.id, paused: false \}\)/);
  assert.match(source, /api\.answerGoalQuestion/);
  assert.match(source, /void askModel\(/);
  assert.match(source, /goalExecution\.pendingQuestion\.options\.map/);
  assert.match(source, /!isAskingModel[\s\S]*goalExecution\?\.goal\?\.status === "active"[\s\S]*goalExecution\?\.pendingQuestion/);
  assert.doesNotMatch(source, /goalExecution\.plan\?\.some\(\(step: any\) =>[\s\S]*\/outline\|提纲\|大纲\//);
  assert.match(source, /goalExecution\?\.plan\?\.length/);
  assert.match(source, /className="goal-context-card"/);
  assert.match(source, /step\.result \|\| step\.description/);
  assert.match(source, /const goalOwnerTurnId = goalExecution\?\.goal\?\.turnId/);
  assert.match(source, /goalOwnerTurnId === turn\.id && \["active", "paused", "complete"\]/);
  assert.ok(source.indexOf("conversationTurns.map") < source.indexOf("goalOwnerTurnId === turn.id"));
  assert.ok(source.indexOf("goalOwnerTurnId === turn.id") < source.indexOf("{delegatedAgentDetailsOpen &&"));
  assert.match(source, /previousActiveReasoningRequestIdRef/);
  assert.match(source, /activeReasoningRequestId !== previousActiveReasoningRequestIdRef\.current/);
  assert.match(source, /async function answerGoalDecision[\s\S]*?catch \(error\)[\s\S]*?setChatStatus/);
});
