export type ThreadEventType =
  | "message"
  | "tool_call"
  | "tool_result"
  | "file_change"
  | "run_status"
  | "approval"
  | "feedback"
  | "context_changed"
  | "context_compacted"
  | "skill_loaded"
  | "memory_recalled"
  | "memory_created"
  | "auto_decision"
  | "error";

export interface ThreadEventRecord {
  id: string;
  type: ThreadEventType;
  createdAt: string;
  turnId?: string;
  payload: Record<string, unknown>;
}

interface ThreadEventPolicyContext {
  makeId: (prefix: string) => string;
  nowIso: () => string;
}

export function createThreadEvent(
  type: ThreadEventType,
  payload: Record<string, unknown>,
  turnId: string | undefined,
  context: ThreadEventPolicyContext
): ThreadEventRecord {
  return { id: context.makeId("thread-event"), type, createdAt: context.nowIso(), turnId, payload };
}

export function toRolloutThreadEvent(threadId: string, event: ThreadEventRecord) {
  return {
    schema_version: 1 as const,
    record_type: event.type,
    timestamp: event.createdAt,
    thread_id: threadId,
    ...(event.turnId ? { turn_id: event.turnId } : {}),
    payload: { eventId: event.id, ...event.payload }
  };
}
