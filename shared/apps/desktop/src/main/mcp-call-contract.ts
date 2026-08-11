import type { McpToolCallInput } from "@codex-forge/protocol";

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new TypeError(`${label} is invalid.`);
  return normalized;
}

function validateJson(value: unknown, depth: number, budget: { nodes: number }): void {
  budget.nodes += 1;
  if (budget.nodes > 10_000 || depth > 20) throw new TypeError("MCP tool arguments are too complex.");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value === "string" && value.length <= 200_000) return;
  if (Array.isArray(value)) {
    if (value.length > 1_000) throw new TypeError("MCP tool argument array is too large.");
    value.forEach((item) => validateJson(item, depth + 1, budget));
    return;
  }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.entries(value);
    if (entries.length > 1_000) throw new TypeError("MCP tool argument object is too large.");
    entries.forEach(([key, item]) => {
      if (key.length > 512) throw new TypeError("MCP tool argument key is too long.");
      validateJson(item, depth + 1, budget);
    });
    return;
  }
  throw new TypeError("MCP tool arguments must contain JSON-compatible values.");
}

export function parseMcpToolCallInput(value: unknown): McpToolCallInput {
  const input = record(value, "MCP tool call input");
  const args = input.args === undefined ? undefined : record(input.args, "MCP tool arguments");
  if (args) validateJson(args, 0, { nodes: 0 });
  return { toolId: text(input.toolId, "MCP tool ID", 512), query: text(input.query, "MCP tool query", 200_000), args };
}
