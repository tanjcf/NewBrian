import { createHash } from "node:crypto";

export function sanitizeRemoteAgentEvent(event) {
  if (!event || typeof event !== "object" || typeof event.type !== "string") return null;
  const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? event.payload
    : {};
  switch (event.type) {
    case "agent_loop_started":
      return { eventType: "work_item.started", payload: {} };
    case "tool_result":
      return sanitizeToolResult(payload);
    case "approval_requested":
      return sanitizeApproval(payload, "approval.requested");
    case "approval_denied":
      return sanitizeApproval(payload, "approval.resolved", false);
    case "approval_resolved":
      return sanitizeApproval(payload, "approval.resolved", Boolean(payload.approved));
    case "agent_loop_completed":
      return { eventType: "work_item.completed", payload: { steps: safeInteger(payload.step) } };
    case "agent_loop_failed":
      return { eventType: "work_item.failed", payload: { reason_code: safeCode(payload.reason, "AGENT_LOOP_FAILED") } };
    case "agent_loop_cancelled":
      return { eventType: "work_item.cancelled", payload: { reason_code: safeCode(payload.reason, "USER_CANCELLED") } };
    default:
      return null;
  }
}

function sanitizeToolResult(payload) {
  const result = payload.result && typeof payload.result === "object" && !Array.isArray(payload.result)
    ? payload.result
    : {};
  const output = typeof result.output === "string" ? result.output : "";
  const ok = result.ok !== false && Number(result.exitCode ?? 0) === 0;
  return {
    eventType: ok ? "tool.completed" : "tool.failed",
    payload: {
      call_id: safeId(payload.callId, "unknown-call"),
      tool_name: safeId(payload.name, "unknown-tool", 128),
      ok,
      duration_ms: safeInteger(result.durationMs),
      exit_code: Number.isSafeInteger(result.exitCode) ? result.exitCode : ok ? 0 : -1,
      output_bytes: Buffer.byteLength(output, "utf8"),
      output_hash: `sha256:${createHash("sha256").update(output, "utf8").digest("hex")}`
    }
  };
}

function sanitizeApproval(payload, eventType, approved) {
  const call = payload.call && typeof payload.call === "object" && !Array.isArray(payload.call)
    ? payload.call
    : {};
  const sanitized = {
    call_id: safeId(call.id ?? payload.callId, "unknown-call"),
    tool_name: safeId(call.name ?? payload.name, "unknown-tool", 128)
  };
  if (eventType === "approval.requested") {
    return { eventType, payload: { ...sanitized, risk: safeCode(payload.risk, "unknown", 32).toLowerCase() } };
  }
  return { eventType, payload: { ...sanitized, approved: Boolean(approved) } };
}

function safeId(value, fallback, maxLength = 80) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().replace(/[^A-Za-z0-9._:-]/g, "_");
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

function safeCode(value, fallback, maxLength = 80) {
  return safeId(value, fallback, maxLength).toUpperCase();
}

function safeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
