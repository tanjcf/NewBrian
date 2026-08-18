import type { CreateWorkspaceWorktreeInput, WorkspaceThreadInput } from "@codex-forge/protocol";

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} input is invalid.`);
  return value as Record<string, unknown>;
}

function id(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > 256) throw new TypeError(`${label} is invalid.`);
  return normalized;
}

export function parseWorkspaceThreadInput(value: unknown): WorkspaceThreadInput {
  const input = record(value, "Workspace thread");
  return { workspaceId: id(input.workspaceId, "Workspace ID"), threadId: id(input.threadId, "Thread ID") };
}

export function parseCreateWorkspaceWorktreeInput(value: unknown): CreateWorkspaceWorktreeInput {
  const input = record(value, "Create worktree");
  const branchName = input.branchName === undefined ? undefined : id(input.branchName, "Branch name");
  if (branchName !== undefined && !/^[A-Za-z0-9._\/-]+$/.test(branchName)) throw new TypeError("Branch name is invalid.");
  return { workspaceId: id(input.workspaceId, "Workspace ID"), branchName };
}
