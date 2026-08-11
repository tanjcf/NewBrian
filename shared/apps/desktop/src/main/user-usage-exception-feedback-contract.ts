import type {
  ConfirmUsageExceptionFeedbackInput,
  CreateUsageExceptionFeedbackPreviewInput
} from "@codex-forge/protocol";

function exactRecord(value: unknown, keys: readonly string[], message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(message);
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(message);
  }
  return record;
}

function requiredString(record: Record<string, unknown>, key: string, limit: number): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${key} is required.`);
  const normalized = value.trim();
  if (normalized.length > limit) throw new TypeError(`${key} exceeds ${limit.toLocaleString("en-US")} characters.`);
  return normalized;
}

export function parseCreateUsageExceptionFeedbackPreviewInput(
  input: unknown
): CreateUsageExceptionFeedbackPreviewInput {
  const record = exactRecord(
    input,
    ["workspaceId", "threadId", "description"],
    "Usage exception feedback preview input must contain exactly workspaceId, threadId, and description."
  );
  return {
    workspaceId: requiredString(record, "workspaceId", 160),
    threadId: requiredString(record, "threadId", 160),
    description: requiredString(record, "description", 4_000)
  };
}

export function parseConfirmUsageExceptionFeedbackInput(input: unknown): ConfirmUsageExceptionFeedbackInput {
  const record = exactRecord(
    input,
    ["previewId"],
    "Usage exception feedback confirmation input must contain exactly previewId."
  );
  return { previewId: requiredString(record, "previewId", 200) };
}
