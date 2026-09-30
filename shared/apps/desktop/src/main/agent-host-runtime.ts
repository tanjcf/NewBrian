import type { McpServerConfig } from "@codex-forge/protocol";
import {
  AgentHostProtocolError,
  agentHostProtocolVersion,
  isAgentHostData,
  parseAgentHostRequest,
  type AgentHostData,
  type AgentHostRequest,
  type AgentHostResponse
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
} from "./agent-host-protocol.ts";

interface HostTerminalService {
  cwd?: string;
  shell?: string;
  prompt?: string;
  process?: { stdin: { write(input: string, encoding: string): unknown } } | null;
  snapshot(): unknown;
  ensure(env: Record<string, string>): { stdin: { write(input: string, encoding: string): unknown } };
  restart(env: Record<string, string>): unknown | Promise<unknown>;
  stop(): unknown;
}

interface HostMcpService {
  start(server: McpServerConfig): Promise<unknown>;
  stop(server: McpServerConfig): Promise<unknown>;
  getLogs(serverId: string): unknown;
  clearLogs(serverId: string): unknown;
  isRunning?(serverId: string): boolean;
  appendLog?(serverId: string, line: string): void;
  shutdown(): unknown;
}

interface HostProcessManager {
  shutdown(): Promise<void>;
}

interface HostAgentService {
  create(input: {
    runtimeId: string;
    workspacePath: string;
    platformLabel: string;
    shellLabel: string;
  }): Promise<unknown>;
  dispose(runtimeId: string): Promise<unknown>;
  start(runtimeId: string, messages: unknown[], options: Record<string, unknown>): unknown;
  restore(runtimeId: string, snapshot: unknown, options: Record<string, unknown>): unknown;
  advance(runtimeId: string): Promise<unknown>;
  resumeApproval(runtimeId: string, approved: boolean): Promise<unknown>;
  steer(runtimeId: string, message: string): unknown;
  cancel(runtimeId: string, reason?: string): unknown;
  snapshot(runtimeId: string): unknown;
  resolveModel?(callbackId: string, result: unknown, error?: { code: string; message: string }): unknown;
  progressModel?(callbackId: string): unknown;
  resolvePolicy?(callbackId: string, result: unknown, error?: { code: string; message: string }): unknown;
  resolveTool?(callbackId: string, result: unknown, error?: { code: string; message: string }): unknown;
  shutdown(): Promise<void>;
}

interface AgentHostRuntimeOptions {
  terminal: HostTerminalService;
  mcp: HostMcpService;
  agent?: HostAgentService;
  processManager: HostProcessManager;
}

class AgentHostRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AgentHostRequestError";
    this.code = code;
  }
}

function recordPayload(request: AgentHostRequest) {
  if (typeof request.payload !== "object" || request.payload === null || Array.isArray(request.payload)) {
    throw new AgentHostRequestError("invalid_request_payload", `${request.method} payload must be an object.`);
  }
  return request.payload;
}

function stringField(payload: Record<string, AgentHostData>, field: string, allowEmpty = false) {
  const value = payload[field];
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new AgentHostRequestError("invalid_request_payload", `${field} must be a string.`);
  }
  return value;
}

function environmentField(payload: Record<string, AgentHostData>) {
  const value = payload.env ?? {};
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.values(value).some((item) => typeof item !== "string")) {
    throw new AgentHostRequestError("invalid_request_payload", "env must contain string values.");
  }
  return value as Record<string, string>;
}

function arrayField(payload: Record<string, AgentHostData>, field: string) {
  const value = payload[field];
  if (!Array.isArray(value)) {
    throw new AgentHostRequestError("invalid_request_payload", `${field} must be an array.`);
  }
  return value;
}

function objectField(payload: Record<string, AgentHostData>, field: string) {
  const value = payload[field];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AgentHostRequestError("invalid_request_payload", `${field} must be an object.`);
  }
  return value as Record<string, AgentHostData>;
}

function booleanField(payload: Record<string, AgentHostData>, field: string) {
  const value = payload[field];
  if (typeof value !== "boolean") {
    throw new AgentHostRequestError("invalid_request_payload", `${field} must be a boolean.`);
  }
  return value;
}

function callbackErrorField(payload: Record<string, AgentHostData>) {
  const value = payload.error;
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== "object"
    || Array.isArray(value)
    || typeof value.code !== "string"
    || typeof value.message !== "string"
  ) {
    throw new AgentHostRequestError(
      "invalid_request_payload",
      "error must contain string code and message fields."
    );
  }
  return { code: value.code, message: value.message };
}

function serverField(payload: Record<string, AgentHostData>) {
  const value = payload.server;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AgentHostRequestError("invalid_request_payload", "server must be an object.");
  }
  const server = value as Record<string, AgentHostData>;
  if (typeof server.id !== "string" || typeof server.command !== "string" || server.transport !== "stdio" || !Array.isArray(server.args)) {
    throw new AgentHostRequestError("invalid_request_payload", "server configuration is invalid.");
  }
  return value as unknown as McpServerConfig;
}

function toData(value: unknown): AgentHostData {
  const serialized = value === undefined ? null : JSON.parse(JSON.stringify(value)) as unknown;
  if (!isAgentHostData(serialized)) throw new AgentHostRequestError("invalid_result", "Host result is not serializable data.");
  return serialized;
}

function success(id: string, result: unknown): AgentHostResponse {
  return { version: agentHostProtocolVersion, kind: "response", id, ok: true, result: toData(result) };
}

function failure(id: string, error: unknown): AgentHostResponse {
  const code = error instanceof AgentHostProtocolError || error instanceof AgentHostRequestError ? error.code : "host_request_failed";
  const message = error instanceof Error ? error.message : String(error);
  return { version: agentHostProtocolVersion, kind: "response", id, ok: false, error: { code, message } };
}

export class AgentHostRuntime {
  private readonly terminal: HostTerminalService;
  private readonly mcp: HostMcpService;
  private readonly agent?: HostAgentService;
  private readonly processManager: HostProcessManager;
  private shutdownPromise: Promise<void> | null = null;

  constructor(options: AgentHostRuntimeOptions) {
    this.terminal = options.terminal;
    this.mcp = options.mcp;
    this.agent = options.agent;
    this.processManager = options.processManager;
  }

  async handle(value: unknown): Promise<AgentHostResponse> {
    const fallbackId = typeof value === "object" && value !== null && "id" in value && typeof value.id === "string" && value.id ? value.id : "unknown";
    try {
      const request = parseAgentHostRequest(value);
      if (this.shutdownPromise && request.method !== "host.shutdown") {
        throw new AgentHostRequestError("host_shutting_down", "Agent host is shutting down.");
      }
      return success(request.id, await this.dispatch(request));
    } catch (error) {
      return failure(fallbackId, error);
    }
  }

  private async dispatch(request: AgentHostRequest): Promise<unknown> {
    const payload = recordPayload(request);
    switch (request.method) {
      case "terminal.snapshot":
        return this.terminal.snapshot();
      case "terminal.ensure":
        this.terminal.cwd = stringField(payload, "cwd");
        this.terminal.shell = stringField(payload, "shell");
        this.terminal.prompt = stringField(payload, "prompt", true);
        this.terminal.ensure(environmentField(payload));
        return this.terminal.snapshot();
      case "terminal.write": {
        const input = stringField(payload, "input", true);
        if (!this.terminal.process) throw new AgentHostRequestError("terminal_not_running", "Terminal session is not running.");
        this.terminal.process.stdin.write(input, "utf8");
        return this.terminal.snapshot();
      }
      case "terminal.restart":
        if (typeof payload.cwd === "string") this.terminal.cwd = stringField(payload, "cwd");
        if (typeof payload.shell === "string") this.terminal.shell = stringField(payload, "shell");
        if (typeof payload.prompt === "string") this.terminal.prompt = stringField(payload, "prompt", true);
        await this.terminal.restart(environmentField(payload));
        return this.terminal.snapshot();
      case "terminal.stop":
        await this.terminal.stop();
        return this.terminal.snapshot();
      case "mcp.start":
        return this.mcp.start(serverField(payload));
      case "mcp.stop":
        return this.mcp.stop(serverField(payload));
      case "mcp.logs.get":
        return this.mcp.getLogs(stringField(payload, "serverId"));
      case "mcp.logs.clear":
        return this.mcp.clearLogs(stringField(payload, "serverId"));
      case "mcp.logs.append":
        this.mcp.appendLog?.(stringField(payload, "serverId"), stringField(payload, "line", true));
        return { appended: true };
      case "mcp.status":
        return this.mcp.isRunning?.(stringField(payload, "serverId")) ?? false;
      case "agent.runtime.create":
        return this.requireAgent().create({
          runtimeId: stringField(payload, "runtimeId"),
          workspacePath: stringField(payload, "workspacePath"),
          platformLabel: stringField(payload, "platformLabel"),
          shellLabel: stringField(payload, "shellLabel")
        });
      case "agent.runtime.dispose":
        return this.requireAgent().dispose(stringField(payload, "runtimeId"));
      case "agent.loop.start":
        return this.requireAgent().start(
          stringField(payload, "runtimeId"),
          arrayField(payload, "messages"),
          objectField(payload, "options")
        );
      case "agent.loop.restore":
        return this.requireAgent().restore(
          stringField(payload, "runtimeId"),
          payload.snapshot,
          objectField(payload, "options")
        );
      case "agent.loop.advance":
        return this.requireAgent().advance(stringField(payload, "runtimeId"));
      case "agent.loop.resume-approval":
        return this.requireAgent().resumeApproval(
          stringField(payload, "runtimeId"),
          booleanField(payload, "approved")
        );
      case "agent.loop.steer": {
        const runtimeId = stringField(payload, "runtimeId");
        if (Array.isArray(payload.attachments)) {
          const content = typeof payload.message === "string"
            ? payload.message
            : typeof payload.content === "string"
              ? payload.content
              : "";
          return this.requireAgent().steer(runtimeId, {
            content,
            attachments: payload.attachments as Array<{ name?: string; path: string; url?: string }>
          });
        }
        return this.requireAgent().steer(runtimeId, stringField(payload, "message"));
      }
      case "agent.loop.cancel":
        return this.requireAgent().cancel(
          stringField(payload, "runtimeId"),
          typeof payload.reason === "string" ? payload.reason : undefined
        );
      case "agent.loop.snapshot":
        return this.requireAgent().snapshot(stringField(payload, "runtimeId"));
      case "agent.model.resolve":
        if (!this.requireAgent().resolveModel) {
          throw new AgentHostRequestError(
            "model_callback_unavailable",
            "Agent model callback resolution is unavailable."
          );
        }
        return this.requireAgent().resolveModel?.(
          stringField(payload, "callbackId"),
          payload.result,
          callbackErrorField(payload)
        );
      case "agent.model.progress":
        if (!this.requireAgent().progressModel) {
          throw new AgentHostRequestError(
            "model_callback_unavailable",
            "Agent model callback progress is unavailable."
          );
        }
        return this.requireAgent().progressModel?.(stringField(payload, "callbackId"));
      case "agent.policy.resolve":
        if (!this.requireAgent().resolvePolicy) {
          throw new AgentHostRequestError(
            "policy_callback_unavailable",
            "Agent policy callback resolution is unavailable."
          );
        }
        return this.requireAgent().resolvePolicy?.(
          stringField(payload, "callbackId"),
          payload.result,
          callbackErrorField(payload)
        );
      case "agent.tool.resolve":
        if (!this.requireAgent().resolveTool) {
          throw new AgentHostRequestError(
            "tool_callback_unavailable",
            "Agent tool callback resolution is unavailable."
          );
        }
        return this.requireAgent().resolveTool?.(
          stringField(payload, "callbackId"),
          payload.result,
          callbackErrorField(payload)
        );
      case "host.shutdown":
        return this.shutdown();
    }
  }

  private requireAgent() {
    if (!this.agent) {
      throw new AgentHostRequestError(
        "agent_service_unavailable",
        "Agent runtime service is unavailable."
      );
    }
    return this.agent;
  }

  private async shutdown() {
    if (!this.shutdownPromise) {
      this.shutdownPromise = (async () => {
        await this.agent?.shutdown();
        await this.terminal.stop();
        await this.mcp.shutdown();
        await this.processManager.shutdown();
      })();
    }
    await this.shutdownPromise;
    return { stopped: true };
  }
}
