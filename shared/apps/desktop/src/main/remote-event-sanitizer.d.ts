import type { HolonRuntimeEventType } from "@codex-forge/protocol";

export interface SanitizedRemoteAgentEvent {
  eventType: HolonRuntimeEventType;
  payload: Record<string, unknown>;
}

export function sanitizeRemoteAgentEvent(event: {
  type: string;
  payload?: unknown;
}): SanitizedRemoteAgentEvent | null;
