import assert from "node:assert/strict";
import test from "node:test";
import {
  formatApprovalResumeFailureMessage,
  isTerminalAgentLoopFailure
} from "./approval-resume-failure-policy.ts";

test("classifies stalled and max-steps loop failures as terminal", () => {
  assert.equal(
    isTerminalAgentLoopFailure(new Error("Agent loop stalled: no tool progress across 4 consecutive steps.")),
    true
  );
  assert.equal(isTerminalAgentLoopFailure(new Error("Agent loop exceeded 24 model steps.")), true);
  assert.equal(isTerminalAgentLoopFailure(new Error("Agent loop was cancelled.")), true);
  assert.equal(isTerminalAgentLoopFailure(new Error("gateway unavailable")), false);
});

test("formats terminal failures with the original message", () => {
  assert.match(
    formatApprovalResumeFailureMessage(new Error("Agent loop stalled: no tool progress across 4 consecutive steps.")),
    /no tool progress/
  );
  assert.match(
    formatApprovalResumeFailureMessage(new Error("Agent loop exceeded 24 model steps.")),
    /24 model steps/
  );
});
