/**
 * GOAL-COMPLETED-CARD-ANCHOR-SMOKE-001
 * Packaging must run this case and stop when it fails.
 * A completed goal card must stay on its owning turn, not drift under later messages.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  mapGoalTurnIdToUserMessageId,
  resolveGoalOwnerConversationTurnId
} from "./goal-owner-turn.ts";

export const CASE_ID = "GOAL-COMPLETED-CARD-ANCHOR-SMOKE-001";

const turns = [
  { id: "msg-user-1", user: { id: "msg-user-1" } },
  { id: "msg-user-2", user: { id: "msg-user-2" } },
  { id: "msg-user-3", user: { id: "msg-user-3" } }
];

const events = [
  {
    type: "message",
    turnId: "turn-goal-finish",
    payload: { role: "user", messageId: "msg-user-1" }
  },
  {
    type: "message",
    turnId: "turn-later",
    payload: { role: "user", messageId: "msg-user-3" }
  }
];

test(`${CASE_ID} maps model turnId to the user message that owns the goal`, () => {
  assert.equal(mapGoalTurnIdToUserMessageId("turn-goal-finish", events), "msg-user-1");
  assert.equal(mapGoalTurnIdToUserMessageId("missing", events), "");
});

test(`${CASE_ID} keeps a completed goal on the finish turn after later chats`, () => {
  const owner = resolveGoalOwnerConversationTurnId({
    goalTurnId: "turn-goal-finish",
    goalStatus: "complete",
    conversationTurns: turns,
    events
  });
  assert.equal(owner, "msg-user-1");
  assert.notEqual(owner, turns.at(-1)?.id);
});

test(`${CASE_ID} never falls back to the latest turn for completed goals`, () => {
  const owner = resolveGoalOwnerConversationTurnId({
    goalTurnId: "turn-unknown",
    goalStatus: "complete",
    conversationTurns: turns,
    events: [],
    pinnedCompleteTurnId: "msg-user-1"
  });
  assert.equal(owner, "msg-user-1");
});

test(`${CASE_ID} active goals may follow the live turn when unmapped`, () => {
  const owner = resolveGoalOwnerConversationTurnId({
    goalTurnId: "",
    goalStatus: "active",
    conversationTurns: turns,
    events: []
  });
  assert.equal(owner, "msg-user-3");
});

test(`${CASE_ID} WorkspaceModules wires the resolver and drops the floating complete card`, () => {
  const source = readFileSync(fileURLToPath(new URL("./WorkspaceModules.tsx", import.meta.url)), "utf8");
  assert.match(source, /resolveGoalOwnerConversationTurnId/);
  assert.match(source, /pinnedCompleteGoalTurnRef/);
  assert.doesNotMatch(
    source,
    /goalExecution\?\.goal\?\.status === "complete" && goalExecution\?\.plan\?\.length \? \(\s*<section className="goal-context-card completed"/
  );
  assert.doesNotMatch(
    source,
    /goalExecution\?\.goal\?\.turnId \|\| conversationTurns\.at\(-1\)\?\.id/
  );
});
