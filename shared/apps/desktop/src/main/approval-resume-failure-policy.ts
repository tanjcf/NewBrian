/** Classifies post-approval agent-loop failures that must end the busy turn. */



export function isTerminalAgentLoopFailure(error: unknown): boolean {

  const message = error instanceof Error ? error.message : String(error ?? "");

  return /Agent loop stalled|no tool progress|Agent loop exceeded \d+ model steps|Agent loop was cancelled/i

    .test(message);

}



/** User-visible summary for a terminal approval-resume failure. */

export function formatApprovalResumeFailureMessage(error: unknown): string {

  const message = error instanceof Error ? error.message : String(error ?? "");

  return message.trim() || "本轮执行失败。请发新消息继续。";

}


