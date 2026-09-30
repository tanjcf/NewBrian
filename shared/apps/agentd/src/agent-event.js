import { randomUUID } from "node:crypto";

const EVENT_SOURCES = new Set(["model", "runtime", "tool", "orchestrator", "user"]);
const EVENT_KINDS = new Set([
  "reasoning_summary", "decision", "progress", "tool_activity", "evidence",
  "quality_gate", "cost", "lifecycle", "message"
]);

function optionalText(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}
/** Creates the stable user-observable envelope shared by every agent runtime. */
export function createAgentActivityEvent(input) {
  if (!input?.type || !String(input.type).trim()) {
    throw new Error("Agent activity events require a type.");
  }
  return {
    schemaVersion: 1,
    id: optionalText(input.id) || `agent-event-${randomUUID()}`,
    type: String(input.type).trim(),
    source: EVENT_SOURCES.has(input.source) ? input.source : "runtime",
    kind: EVENT_KINDS.has(input.kind) ? input.kind : "lifecycle",
    timestamp: optionalText(input.timestamp) || new Date().toISOString(),
    runtimeId: optionalText(input.runtimeId),
    missionId: optionalText(input.missionId),
    taskId: optionalText(input.taskId),
    agentId: optionalText(input.agentId),
    threadId: optionalText(input.threadId),
    parentThreadId: optionalText(input.parentThreadId),
    summary: optionalText(input.summary),
    evidenceRefs: Array.isArray(input.evidenceRefs)
      ? [...new Set(input.evidenceRefs.map(optionalText).filter(Boolean))]
      : [],
    payload: structuredClone(input.payload ?? {})
  };
}

export function classifyAgentEvent(type) {
  const normalized = String(type || "").toLowerCase();
  if (normalized.includes("reasoning")) return { source: "model", kind: "reasoning_summary" };
  if (normalized.startsWith("tool_") || normalized.includes("approval")) {
    return { source: "tool", kind: "tool_activity" };
  }
  if (normalized.startsWith("agent_task_") || normalized === "agent_results_merged") {
    return { source: "orchestrator", kind: "lifecycle" };
  }
  if (normalized.includes("quality") || normalized.includes("verification")) {
    return { source: "runtime", kind: "quality_gate" };
  }
  return { source: "runtime", kind: "lifecycle" };
}
