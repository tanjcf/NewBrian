import assert from "node:assert/strict";
import test from "node:test";

import {
  parseHolonFeedbackInput,
  parseHolonWorkItemIdInput,
  parseLearningCandidateInput,
  parseLearningListInput,
  parseLearningRollbackInput,
  parseLearningSearchInput,
  parseStartHolonWorkItemInput
} from "./holon-ipc-contract.js";

test("accepts narrow Holon work item inputs", () => {
  assert.deepEqual(parseHolonWorkItemIdInput({ workItemId: "work-1" }), { workItemId: "work-1" });
  assert.deepEqual(parseStartHolonWorkItemInput({ workItemId: "work-1", threadId: "thread-1", turnId: "turn-1" }), {
    workItemId: "work-1",
    threadId: "thread-1",
    turnId: "turn-1"
  });
});

test("rejects identity, URL, unknown, blank, and oversized work item fields", () => {
  for (const value of [
    { workItemId: "work-1", ownerUserId: "user-1" },
    { workItemId: "work-1", owner_user_id: "user-1" },
    { workItemId: "work-1", url: "https://attacker.invalid" },
    { workItemId: "work-1", extra: true },
    { workItemId: " " },
    { workItemId: "x".repeat(81) }
  ]) assert.throws(() => parseHolonWorkItemIdInput(value));
});

test("validates learning list, search, candidate, and rollback inputs", () => {
  assert.deepEqual(parseLearningListInput(undefined), { limit: 50 });
  assert.deepEqual(parseLearningListInput({ limit: 100 }), { limit: 100 });
  assert.deepEqual(parseLearningSearchInput({ query: "政务写作", limit: 10 }), { query: "政务写作", limit: 10 });
  assert.deepEqual(parseLearningCandidateInput({ versionId: "version-1" }), { versionId: "version-1" });
  assert.deepEqual(parseLearningRollbackInput({ skillKey: "writing", targetVersionId: "version-2" }), {
    skillKey: "writing",
    targetVersionId: "version-2"
  });
  assert.throws(() => parseLearningListInput({ limit: 101 }));
  assert.throws(() => parseLearningSearchInput({ query: "", url: "https://attacker.invalid" }));
  assert.throws(() => parseLearningCandidateInput({ versionId: "v", owner_user_id: "u" }));
});

test("validates feedback ratings, metrics, and exact fields", () => {
  const input = {
    idempotencyKey: "feedback-1",
    workItemId: "work-1",
    knowledgeSnapshotId: "snapshot-1",
    skillKey: "writing",
    versionId: "version-1",
    success: true,
    safetyViolation: false,
    userRating: 1,
    metrics: { durationMs: 25 }
  };
  assert.deepEqual(parseHolonFeedbackInput(input), input);
  assert.throws(() => parseHolonFeedbackInput({ ...input, userRating: 2 }));
  assert.throws(() => parseHolonFeedbackInput({ ...input, metrics: { output: "private" } }));
  assert.throws(() => parseHolonFeedbackInput({ ...input, ownerUserId: "user-1" }));
});
