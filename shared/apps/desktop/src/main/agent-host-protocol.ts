export const agentHostProtocolVersion = 1 as const;

export const agentHostMethods = [
  "terminal.snapshot",
  "terminal.ensure",
  "terminal.write",
  "terminal.restart",
  "terminal.stop",
  "mcp.start",
  "mcp.stop",
  "mcp.logs.get",
  "mcp.logs.clear",
  "mcp.logs.append",
  "mcp.status",
  "agent.runtime.create",
  "agent.runtime.dispose",
  "agent.loop.start",
  "agent.loop.restore",
  "agent.loop.advance",
  "agent.loop.resume-approval",
  "agent.loop.set-permission-mode",
  "agent.loop.steer",
  "agent.loop.cancel",
  "agent.loop.snapshot",
  "agent.model.resolve",
  "agent.model.progress",
  "agent.policy.resolve",
  "agent.tool.resolve",
  "host.shutdown"
] as const;

export const agentHostEvents = [
  "terminal.update",
  "mcp.status",
  "agent.event",
  "agent.model.request",
  "agent.policy.request",
  "agent.tool.request"
] as const;

export type AgentHostMethod = typeof agentHostMethods[number];
export type AgentHostEventName = typeof agentHostEvents[number];
export type AgentHostProtocolErrorCode =
  | "unsupported_version"
  | "unknown_method"
  | "invalid_message"
  | "invalid_payload";

export type AgentHostData = null | boolean | number | string | AgentHostData[] | { [key: string]: AgentHostData };

export interface AgentHostRequest {
  version: typeof agentHostProtocolVersion;
  kind: "request";
  id: string;
  method: AgentHostMethod;
  payload: AgentHostData;
}

export type AgentHostResponse =
  | { version: typeof agentHostProtocolVersion; kind: "response"; id: string; ok: true; result: AgentHostData }
  | { version: typeof agentHostProtocolVersion; kind: "response"; id: string; ok: false; error: { code: string; message: string } };

export interface AgentHostEvent {
  version: typeof agentHostProtocolVersion;
  kind: "event";
  event: AgentHostEventName;
  payload: AgentHostData;
}

export type AgentHostMessage = AgentHostRequest | AgentHostResponse | AgentHostEvent;

export class AgentHostProtocolError extends Error {
  readonly code: AgentHostProtocolErrorCode;

  constructor(code: AgentHostProtocolErrorCode, message: string) {
    super(message);
    this.name = "AgentHostProtocolError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAgentHostData(value: unknown, seen = new Set<object>()): value is AgentHostData {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((item) => isAgentHostData(item, seen));
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  return Object.values(value).every((item) => isAgentHostData(item, seen));
}

function requireVersion(value: Record<string, unknown>) {
  if (value.version !== agentHostProtocolVersion) {
    throw new AgentHostProtocolError("unsupported_version", `Unsupported agent host protocol version: ${String(value.version)}`);
  }
}

function requireId(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 256) {
    throw new AgentHostProtocolError("invalid_message", "Agent host message ID is invalid.");
  }
  return value;
}

function requireData(value: unknown) {
  if (!isAgentHostData(value)) throw new AgentHostProtocolError("invalid_payload", "Agent host payload must contain data only.");
  return value;
}

export function parseAgentHostRequest(value: unknown): AgentHostRequest {
  if (!isRecord(value) || value.kind !== "request") {
    throw new AgentHostProtocolError("invalid_message", "Expected an agent host request.");
  }
  requireVersion(value);
  const id = requireId(value.id);
  if (typeof value.method !== "string" || !agentHostMethods.includes(value.method as AgentHostMethod)) {
    throw new AgentHostProtocolError("unknown_method", `Unknown agent host method: ${String(value.method)}`);
  }
  return {
    version: agentHostProtocolVersion,
    kind: "request",
    id,
    method: value.method as AgentHostMethod,
    payload: requireData(value.payload)
  };
}

export function parseAgentHostMessage(value: unknown): AgentHostMessage {
  if (!isRecord(value)) throw new AgentHostProtocolError("invalid_message", "Agent host message must be an object.");
  if (value.kind === "request") return parseAgentHostRequest(value);
  requireVersion(value);

  if (value.kind === "response") {
    const id = requireId(value.id);
    if (value.ok === true) {
      return { version: agentHostProtocolVersion, kind: "response", id, ok: true, result: requireData(value.result) };
    }
    if (value.ok === false && isRecord(value.error) && typeof value.error.code === "string" && typeof value.error.message === "string") {
      return {
        version: agentHostProtocolVersion,
        kind: "response",
        id,
        ok: false,
        error: { code: value.error.code, message: value.error.message }
      };
    }
    throw new AgentHostProtocolError("invalid_message", "Agent host response is invalid.");
  }

  if (value.kind === "event" && typeof value.event === "string" && agentHostEvents.includes(value.event as AgentHostEventName)) {
    return {
      version: agentHostProtocolVersion,
      kind: "event",
      event: value.event as AgentHostEventName,
      payload: requireData(value.payload)
    };
  }

  throw new AgentHostProtocolError("invalid_message", "Agent host message kind or event is invalid.");
}
