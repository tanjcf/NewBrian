import type { CancelModelRequestInput, RespondApprovalInput } from "@codex-forge/protocol";

function requestId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new TypeError("Request ID must be a string.");
  const normalized = value.trim();
  if (!normalized || normalized.length > 256) throw new TypeError("Request ID is invalid.");
  return normalized;
}

export function parseCancelModelRequestInput(value: unknown): CancelModelRequestInput {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Cancel model request input is invalid.");
  return { requestId: requestId((value as Record<string, unknown>).requestId) };
}

export function parseShellCommand(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 65_536) throw new TypeError("Shell command is invalid.");
  return value;
}

export function parseRespondApprovalInput(value: unknown): RespondApprovalInput {
  if (typeof value === "boolean") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Approval response input is invalid.");
  const input = value as Record<string, unknown>;
  if (typeof input.approved !== "boolean") throw new TypeError("Approval decision must be a boolean.");
  return {
    approved: input.approved,
    requestId: requestId(input.requestId),
    approvalId: requestId(input.approvalId)
  };
}
