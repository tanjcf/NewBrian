import { isAutomationCreationRequest } from "../renderer/app/parseAutomationIntent.ts";

/**
 * Creating an automation saves the schedule locally. The model only confirms
 * that plan, so this turn does not receive tools that can stall outside the workspace.
 */
export function agentLoopAllowedToolNames<T>(input: {
  latestUserRequest: string;
  governmentRevisionPreview: boolean;
  remoteAllowedToolNames: T;
}): T | [] {
  if (input.governmentRevisionPreview || isAutomationCreationRequest(input.latestUserRequest)) return [];
  return input.remoteAllowedToolNames;
}
