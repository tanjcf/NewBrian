import type { GeneratePatchInput } from "@codex-forge/protocol";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Generate patch input must be an object.");
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > maxLength || (!allowEmpty && value.length === 0)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

export function parseGeneratePatchInput(value: unknown): GeneratePatchInput {
  const input = record(value);
  return {
    filePath: text(input.filePath, "Patch file path", 4_096),
    searchText: text(input.searchText, "Patch search text", 1_048_576),
    replaceText: text(input.replaceText, "Patch replacement text", 1_048_576, true)
  };
}
