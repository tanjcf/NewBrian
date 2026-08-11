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
  requestTimeoutMs?: number;
  agentLoopRequestTimeoutMs?: number;
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
  timer: NodeJS.Timeout | null;
  /** Guards against a stale timer firing after renew/clear races. */
  timerGeneration: number;
  method: AgentHostMethod;
  timeoutMs: number;
  /** Loop ops span model + tools; renew on stream/callback activity instead of a hard wall clock. */
  renewOnActivity: boolean;
}

/** Absolute inactivity budget for agent.loop.advance / resume-approval IPC waits. */
export const DEFAULT_AGENT_LOOP_REQUEST_TIMEOUT_MS = 10 * 60_000;

const directHostProcessManager: HostProcessManager = {
  track: (child) => child,
  stop: async (child) => { if (!child.killed) child.kill("SIGTERM"); }
};

function isLoopRequestMethod(method: AgentHostMethod) {
  return method === "agent.loop.advance" || method === "agent.loop.resume-approval";
}

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
    const renewOnActivity = isLoopRequestMethod(method);
    const timeoutMs = renewOnActivity
      ? this.options.agentLoopRequestTimeoutMs ?? DEFAULT_AGENT_LOOP_REQUEST_TIMEOUT_MS
      : this.options.requestTimeoutMs ?? 5_000;
    return new Promise<AgentHostData>((resolve, reject) => {
      const pending: PendingRequest = {
        resolve,
        reject,
        timer: null,
        timerGeneration: 0,
        method,
        timeoutMs,
        renewOnActivity
      };
      this.armPendingTimer(id, pending);
      this.pending.set(id, pending);
      child.send?.({ version: agentHostProtocolVersion, kind: "request", id, method, payload }, (error) => {
        if (!error) return;
        const current = this.pending.get(id);
        if (!current) return;
        clearTimeout(current.timer);
        current.timerGeneration += 1;
        this.pending.delete(id);
        current.reject(new AgentHostClientError("host_send_failed", error.message));
      });
    });
  }

  private armPendingTimer(id: string, pending: PendingRequest) {
    if (pending.timer) clearTimeout(pending.timer);
    const generation = pending.timerGeneration + 1;
    pending.timerGeneration = generation;
    pending.timer = setTimeout(() => {
      // Ignore timers that were superseded by renew/clear while already queued.
      if (this.pending.get(id) !== pending || pending.timerGeneration !== generation) return;
      this.pending.delete(id);
      pending.reject(new AgentHostClientError("host_request_timeout", `Agent host request timed out: ${pending.method}`));
    }, pending.timeoutMs);
    pending.timer.unref?.();
  }

  /** Renew advance/resume inactivity budgets while the loop is visibly making progress. */
  private renewLoopRequestTimeouts() {
    for (const [id, pending] of this.pending) {
      if (!pending.renewOnActivity) continue;
      this.armPendingTimer(id, pending);
    }
  }

  private handleMessage(value: unknown) {
    let message;
    try { message = parseAgentHostMessage(value); } catch { return; }
    if (message.kind === "event") {
      if (
        message.event === "agent.model.request"
        || message.event === "agent.policy.request"
        || message.event === "agent.tool.request"
        || message.event === "agent.event"
      ) {
        this.renewLoopRequestTimeouts();
      }
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
    clearTimeout(pending.timer);
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
    this.renewLoopRequestTimeouts();
    const reportProgress = resolveMethod === "agent.model.resolve"
      ? this.createModelProgressReporter(payload.callbackId)
      : () => {
          // Tool/policy work proves the loop is alive; renew the parent advance budget.
          this.renewLoopRequestTimeouts();
        };
    try {
      const result = await handler({
        runtimeId: payload.runtimeId,
        callbackId: payload.callbackId,
        input: payload.input,
        reportProgress
      });
      this.renewLoopRequestTimeouts();
      await this.request(resolveMethod, {
        callbackId: payload.callbackId,
        result
      });
    } catch (error) {
      this.renewLoopRequestTimeouts();
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
      // Renew parent advance/resume wait even if the host progress RPC is coalesced.
      this.renewLoopRequestTimeouts();
      inFlight = this.request("agent.model.progress", { callbackId })
        .catch(() => undefined)
        .finally(() => {
          inFlight = null;
          if (queued) send();
        });
    };
    return () => {
      // Local stream deltas must extend the IPC advance wait immediately.
      this.renewLoopRequestTimeouts();
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
      clearTimeout(pending.timer);
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
