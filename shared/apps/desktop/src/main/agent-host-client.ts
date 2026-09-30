import { fork, type ChildProcess } from "node:child_process";
import {
  agentHostProtocolVersion,
  parseAgentHostMessage,
  type AgentHostData,
  type AgentHostEvent,
  type AgentHostMethod,
  type AgentHostResponse
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
} from "./agent-host-protocol.ts";

type HostChild = Pick<ChildProcess, "pid" | "exitCode" | "killed" | "send" | "kill" | "on" | "once" | "removeListener" | "removeAllListeners">;
type ForkHost = (modulePath: string, args: string[], options: Parameters<typeof fork>[2]) => HostChild;

interface HostProcessManager {
  track<T extends HostChild>(child: T): T;
  stop(child: HostChild): Promise<void>;
}

interface AgentHostClientOptions {
  entryPath: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  forkProcess?: ForkHost;
  processManager?: HostProcessManager;
  onEvent?: (event: AgentHostEvent) => void;
  onModelRequest?: (input: {
    runtimeId: string;
    callbackId: string;
    input: AgentHostData;
    reportProgress: () => void;
  }) => Promise<AgentHostData>;
  onPolicyRequest?: (input: {
    runtimeId: string;
    callbackId: string;
    input: AgentHostData;
    reportProgress: () => void;
  }) => Promise<AgentHostData>;
  onToolRequest?: (input: {
    runtimeId: string;
    callbackId: string;
    input: AgentHostData;
    reportProgress: () => void;
  }) => Promise<AgentHostData>;
}

interface PendingRequest {
  resolve(value: AgentHostData): void;
  reject(error: Error): void;
}

const directHostProcessManager: HostProcessManager = {
  track: (child) => child,
  stop: async (child) => { if (!child.killed) child.kill("SIGTERM"); }
};

export class AgentHostClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AgentHostClientError";
    this.code = code;
  }
}

export class AgentHostClient {
  private readonly options: AgentHostClientOptions;
  private readonly forkProcess: ForkHost;
  private readonly processManager: HostProcessManager;
  private readonly pending = new Map<string, PendingRequest>();
  private child: HostChild | null = null;
  private nextRequestId = 1;
  private shutdownPromise: Promise<void> | null = null;

  constructor(options: AgentHostClientOptions) {
    this.options = options;
    this.forkProcess = options.forkProcess ?? ((modulePath, args, forkOptions) => fork(modulePath, args, forkOptions));
    this.processManager = options.processManager ?? directHostProcessManager;
  }

  get pendingCount() {
    return this.pending.size;
  }

  request(method: AgentHostMethod, payload: AgentHostData): Promise<AgentHostData> {
    if (this.shutdownPromise) return Promise.reject(new AgentHostClientError("host_shutting_down", "Agent host is shutting down."));
    return this.sendRequest(method, payload);
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = this.shutdownOnce();
    return this.shutdownPromise;
  }

  private ensureHost() {
    if (this.child) return this.child;
    const child = this.processManager.track(this.forkProcess(this.options.entryPath, [], {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ["ignore", "pipe", "pipe", "ipc"]
    }));
    this.child = child;
    child.on("message", (message) => this.handleMessage(message));
    child.once("exit", (code, signal) => this.handleExit(child, code, signal));
    child.once("error", (error) => this.handleExit(child, null, null, error));
    return child;
  }

  private sendRequest(method: AgentHostMethod, payload: AgentHostData) {
    const child = this.ensureHost();
    const id = `host_${this.nextRequestId++}`;
    return new Promise<AgentHostData>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.send?.({ version: agentHostProtocolVersion, kind: "request", id, method, payload }, (error) => {
        if (!error) return;
        const current = this.pending.get(id);
        if (!current) return;
        this.pending.delete(id);
        current.reject(new AgentHostClientError("host_send_failed", error.message));
      });
    });
  }

  private handleMessage(value: unknown) {
    let message;
    try { message = parseAgentHostMessage(value); } catch { return; }
    if (message.kind === "event") {
      if (message.event === "agent.model.request") {
        void this.handleAgentCallback(
          message,
          this.options.onModelRequest,
          "agent.model.resolve",
          "model_callback_failed"
        );
        return;
      }
      if (message.event === "agent.policy.request") {
        void this.handleAgentCallback(
          message,
          this.options.onPolicyRequest,
          "agent.policy.resolve",
          "policy_callback_failed"
        );
        return;
      }
      if (message.event === "agent.tool.request") {
        void this.handleAgentCallback(
          message,
          this.options.onToolRequest,
          "agent.tool.resolve",
          "tool_callback_failed"
        );
        return;
      }
      this.options.onEvent?.(message);
      return;
    }
    if (message.kind !== "response") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new AgentHostClientError(message.error.code, message.error.message));
  }

  private async handleAgentCallback(
    event: AgentHostEvent,
    handler: AgentHostClientOptions["onModelRequest"],
    resolveMethod:
      | "agent.model.resolve"
      | "agent.policy.resolve"
      | "agent.tool.resolve",
    failureCode: string
  ) {
    if (!handler) return;
    const payload = event.payload;
    if (
      typeof payload !== "object"
      || payload === null
      || Array.isArray(payload)
      || typeof payload.runtimeId !== "string"
      || typeof payload.callbackId !== "string"
      || !("input" in payload)
    ) {
      return;
    }
    const reportProgress = resolveMethod === "agent.model.resolve"
      ? this.createModelProgressReporter(payload.callbackId)
      : () => undefined;
    try {
      const result = await handler({
        runtimeId: payload.runtimeId,
        callbackId: payload.callbackId,
        input: payload.input,
        reportProgress
      });
      await this.request(resolveMethod, {
        callbackId: payload.callbackId,
        result
      });
    } catch (error) {
      await this.request(resolveMethod, {
        callbackId: payload.callbackId,
        result: null,
        error: {
          code: error instanceof AgentHostClientError ? error.code : failureCode,
          message: error instanceof Error ? error.message : String(error)
        }
      }).catch(() => undefined);
    }
  }

  /** Throttled inactivity renewals while the provider is still streaming. */
  private createModelProgressReporter(callbackId: string) {
    let lastSentAt = 0;
    let inFlight: Promise<unknown> | null = null;
    let queued = false;
    const send = () => {
      lastSentAt = Date.now();
      queued = false;
      inFlight = this.request("agent.model.progress", { callbackId })
        .catch(() => undefined)
        .finally(() => {
          inFlight = null;
          if (queued) send();
        });
    };
    return () => {
      const now = Date.now();
      if (inFlight) {
        queued = true;
        return;
      }
      if (now - lastSentAt < 750) {
        queued = true;
        setTimeout(() => {
          if (!queued || inFlight) return;
          send();
        }, Math.max(0, 750 - (now - lastSentAt))).unref?.();
        return;
      }
      send();
    };
  }

  private handleExit(child: HostChild, code: number | null, signal: NodeJS.Signals | null, cause?: Error) {
    if (this.child !== child) return;
    this.child = null;
    const detail = cause?.message ?? `Agent host exited (code=${String(code)}, signal=${String(signal)}).`;
    this.rejectPending(new AgentHostClientError("host_exited", detail));
  }

  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private async shutdownOnce() {
    const child = this.child;
    if (!child) return;
    try { await this.sendRequest("host.shutdown", {}); } catch { /* process manager still enforces cleanup */ }
    await this.processManager.stop(child);
    if (this.child === child) this.child = null;
    this.rejectPending(new AgentHostClientError("host_shutting_down", "Agent host has stopped."));
  }
}
