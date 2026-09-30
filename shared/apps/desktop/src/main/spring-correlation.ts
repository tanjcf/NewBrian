/**
 * Best-effort spring correlation helpers.
 * Local TurnScope remains authoritative; mismatches are diagnostic only.
 */

export type SpringCorrelationIds = {
  workspaceId?: string;
  threadId?: string;
  requestId?: string;
};

export type SpringCorrelationMismatch = {
  field: "workspace_id" | "thread_id" | "request_id";
  expected: string;
  actual: string;
};

const FIELD_ALIASES: Record<SpringCorrelationMismatch["field"], string[]> = {
  workspace_id: ["workspace_id", "workspaceId"],
  thread_id: ["thread_id", "threadId", "session_id", "sessionId"],
  request_id: ["request_id", "requestId", "client_message_id", "clientMessageId", "idempotency_key", "idempotencyKey"]
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readEchoed(payload: Record<string, unknown>, aliases: string[]): string {
  for (const key of aliases) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** Compare local TurnScope ids with optional spring response echoes. */
export function collectSpringCorrelationMismatches(
  expected: SpringCorrelationIds,
  payload: unknown
): SpringCorrelationMismatch[] {
  const body = asRecord(payload);
  if (!body) return [];
  const mismatches: SpringCorrelationMismatch[] = [];
  const checks: Array<{ field: SpringCorrelationMismatch["field"]; expected?: string }> = [
    { field: "workspace_id", expected: expected.workspaceId },
    { field: "thread_id", expected: expected.threadId },
    { field: "request_id", expected: expected.requestId }
  ];
  for (const check of checks) {
    const wanted = String(check.expected || "").trim();
    if (!wanted) continue;
    const actual = readEchoed(body, FIELD_ALIASES[check.field]);
    if (!actual) continue; // older gateways omit echo — not a mismatch
    if (actual !== wanted) {
      mismatches.push({ field: check.field, expected: wanted, actual });
    }
  }
  return mismatches;
}

export function formatSpringCorrelationDiagnostics(
  source: string,
  mismatches: readonly SpringCorrelationMismatch[]
): string {
  if (!mismatches.length) return "";
  const detail = mismatches
    .map((item) => `${item.field} expected=${item.expected} actual=${item.actual}`)
    .join("; ");
  return `spring correlation mismatch source=${source} ${detail} (local TurnScope remains authoritative)`;
}

/** Merge correlation ids into a JSON body without overwriting existing keys. */
export function withSpringCorrelationBody(
  body: Record<string, unknown>,
  ids: SpringCorrelationIds
): Record<string, unknown> {
  const next = { ...body };
  const workspaceId = String(ids.workspaceId || "").trim();
  const threadId = String(ids.threadId || "").trim();
  const requestId = String(ids.requestId || "").trim();
  if (workspaceId) {
    next.workspace_id = workspaceId;
    next.workspaceId = workspaceId;
  }
  if (threadId) {
    next.thread_id = threadId;
    next.threadId = threadId;
  }
  if (requestId) {
    next.request_id = requestId;
    next.requestId = requestId;
  }
  return next;
}

export function withSpringCorrelationHeaders(
  headers: Record<string, string>,
  ids: SpringCorrelationIds
): Record<string, string> {
  const next = { ...headers };
  const workspaceId = String(ids.workspaceId || "").trim();
  const threadId = String(ids.threadId || "").trim();
  const requestId = String(ids.requestId || "").trim();
  if (workspaceId) next["X-NewBrain-Workspace-Id"] = workspaceId;
  if (threadId) next["X-NewBrain-Thread-Id"] = threadId;
  if (requestId) next["X-NewBrain-Request-Id"] = requestId;
  return next;
}
