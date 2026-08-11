/** OpenClaw-style boundary durability helpers for agent-loop tool events. */

export const AGENT_LOOP_BOUNDARY_EVENT_TYPES = new Set([
  "tool_call",
  "tool_result",
  "approval_requested",
  "agent_loop_failed"
]);

export interface ToolReplayDescriptor {
  name?: string;
  kind?: string;
  risk?: string;
  requiresApproval?: boolean;
  replaySafe?: boolean;
}

export interface AgentRuntimeBoundaryEvent {
  type: string;
  timestamp?: string;
  payload?: unknown;
  id?: string;
}

export interface TurnReplayMetadata {
  hadPotentialSideEffects: boolean;
  replaySafe: boolean;
}

const REPLAY_SAFE_READ_TOOLS = new Set([
  "workspace.read",
  "workspace.read_file",
  "read",
  "workspace.list_files",
  "workspace.stat",
  "workspace.glob",
  "workspace.grep",
  "workspace.search",
  "workspace.scan",
  "artifact.inspect",
  "web.search_official",
  "web.read_official",
  "goal.get",
  "memory.search",
  "memory.get"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Fail closed: only low-risk read tools (or an explicit declaration) are replay-safe. */
export function isReplaySafeToolDescriptor(
  descriptor: ToolReplayDescriptor | undefined,
  toolName?: string
): boolean {
  if (descriptor?.replaySafe === true) return true;
  if (descriptor?.replaySafe === false) return false;
  const name = String(descriptor?.name ?? toolName ?? "").trim();
  if (!name) return false;
  if (descriptor) {
    const kind = String(descriptor.kind ?? "").toLowerCase();
    const risk = String(descriptor.risk ?? "").toLowerCase();
    if (kind === "read" && risk === "low" && descriptor.requiresApproval !== true) {
      return true;
    }
    if (risk === "high" || kind === "shell" || kind === "write" || kind === "git") {
      return false;
    }
  }
  return REPLAY_SAFE_READ_TOOLS.has(name);
}

/** Annotate tool_call payloads with replaySafe before durable append. */
export function enrichBoundaryEventsForPersistence(
  events: AgentRuntimeBoundaryEvent[],
  descriptors: ToolReplayDescriptor[] = []
): AgentRuntimeBoundaryEvent[] {
  const byName = new Map(
    descriptors
      .filter((descriptor) => typeof descriptor.name === "string" && descriptor.name.trim())
      .map((descriptor) => [String(descriptor.name), descriptor])
  );
  return events.map((event) => {
    if (event.type !== "tool_call" || !isRecord(event.payload)) return event;
    const name = String(event.payload.name ?? "");
    const descriptor = byName.get(name);
    return {
      ...event,
      payload: {
        ...event.payload,
        replaySafe: isReplaySafeToolDescriptor(descriptor, name)
      }
    };
  });
}

export function isAgentLoopBoundaryEvent(event: { type?: unknown } | null | undefined): boolean {
  return typeof event?.type === "string" && AGENT_LOOP_BOUNDARY_EVENT_TYPES.has(event.type);
}

/** Build OpenClaw-compatible attempt replay metadata from persisted tool_call payloads. */
export function buildTurnReplayMetadata(
  toolCallPayloads: Array<{ replaySafe?: unknown }>
): TurnReplayMetadata {
  const hadPotentialSideEffects = toolCallPayloads.some((payload) => payload.replaySafe !== true);
  return {
    hadPotentialSideEffects,
    replaySafe: !hadPotentialSideEffects
  };
}

export interface OrphanToolResultPayload {
  callId: string;
  name: string;
  result: {
    ok: false;
    orphan: true;
    interrupted: true;
    output: string;
    replaySafe: boolean;
  };
}

/** Pair orphan tool_call events with synthetic interrupted tool_result payloads. */
export function buildOrphanToolResultPayloads(
  events: Array<{ type: string; payload?: unknown }>
): OrphanToolResultPayload[] {
  const openCalls = new Map<string, { name: string; replaySafe: boolean }>();
  for (const event of events) {
    if (!isRecord(event.payload)) continue;
    if (event.type === "tool_call" && event.payload.id) {
      const callId = String(event.payload.id);
      openCalls.set(callId, {
        name: String(event.payload.name ?? "unknown"),
        replaySafe: event.payload.replaySafe === true
      });
      continue;
    }
    if (event.type === "tool_result" && event.payload.callId) {
      openCalls.delete(String(event.payload.callId));
    }
  }
  return [...openCalls.entries()].map(([callId, info]) => ({
    callId,
    name: info.name,
    result: {
      ok: false as const,
      orphan: true as const,
      interrupted: true as const,
      output: "Tool call interrupted before a result was persisted.",
      replaySafe: info.replaySafe
    }
  }));
}

/**
 * Returns true when an incomplete turn must not be blindly auto-replayed.
 * Missing replaySafe metadata fails closed (unsafe).
 */
export function shouldSuppressUnsafeAutoReplay(metadata: TurnReplayMetadata | null | undefined): boolean {
  if (!metadata) return true;
  return metadata.replaySafe !== true || metadata.hadPotentialSideEffects === true;
}
