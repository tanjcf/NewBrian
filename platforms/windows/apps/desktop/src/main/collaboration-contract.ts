import type {
  ListDelegatedAgentsInput,
  MergeDelegatedAgentResultsInput,
  RespondDelegatedAgentApprovalInput,
  RunDelegatedAgentInput
} from "@codex-forge/protocol";

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function id(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > 256) throw new TypeError(`${label} is invalid.`);
  return normalized;
}

export function parseRunDelegatedAgentInput(value: unknown): RunDelegatedAgentInput {
  const input = record(value, "Run delegated agent input");
  return { workspaceId: id(input.workspaceId, "Workspace ID"), childThreadId: id(input.childThreadId, "Child thread ID") };
}

export function parseListDelegatedAgentsInput(value: unknown): ListDelegatedAgentsInput {
  const input = record(value, "List delegated agents input");
  return { workspaceId: id(input.workspaceId, "Workspace ID"), parentThreadId: id(input.parentThreadId, "Parent thread ID") };
}

export function parseRespondDelegatedAgentApprovalInput(value: unknown): RespondDelegatedAgentApprovalInput {
  const input = record(value, "Delegated approval input");
  if (typeof input.approved !== "boolean") throw new TypeError("Delegated approval decision must be a boolean.");
  return { ...parseRunDelegatedAgentInput(input), approved: input.approved };
}

export function parseMergeDelegatedAgentResultsInput(value: unknown): MergeDelegatedAgentResultsInput {
  const input = record(value, "Merge delegated results input");
  if (!Array.isArray(input.childThreadIds) || input.childThreadIds.length === 0 || input.childThreadIds.length > 50) {
    throw new TypeError("Child thread IDs must contain between 1 and 50 items.");
  }
  const childThreadIds = input.childThreadIds.map((item) => id(item, "Child thread ID"));
  if (new Set(childThreadIds).size !== childThreadIds.length) throw new TypeError("Child thread IDs must be unique.");
  return {
    workspaceId: id(input.workspaceId, "Workspace ID"),
    parentThreadId: id(input.parentThreadId, "Parent thread ID"),
    childThreadIds
  };
}
