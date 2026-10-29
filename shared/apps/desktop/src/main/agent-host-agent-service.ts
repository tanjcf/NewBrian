export interface AgentHostRuntimeCreateInput {
  runtimeId: string;
  workspacePath: string;
  platformLabel: string;
  shellLabel: string;
  /** Publish each sessionMachine event immediately for OpenClaw-style durability. */
  onSessionEvent?(event: unknown): void;
}

interface AgentRuntime {
  sessionMachine: { events: unknown[] };
  startAgentLoop(messages: unknown[], options?: Record<string, unknown>): unknown;
  restoreAgentLoop(snapshot: unknown, options?: Record<string, unknown>): unknown;
  advanceAgentLoop(callModel: (input: unknown) => Promise<unknown>): Promise<unknown>;
  resumeAgentApproval(
    approved: boolean,
    callModel: (input: unknown) => Promise<unknown>
  ): Promise<unknown>;
  getAgentLoopSnapshot(): unknown;
  steerAgentLoop(message: string | {
    content?: string;
    message?: string;
    attachments?: Array<{ name?: string; path: string; url?: string }>;
  }): unknown;
  cancelAgentLoop(reason?: string): unknown;
  setPermissionMode?(mode: "full" | "approval" | "agent"): unknown;
  shutdown?(): unknown | Promise<unknown>;
}

interface AgentHostAgentServiceOptions {
  createRuntime(input: AgentHostRuntimeCreateInput): Promise<AgentRuntime>;
  requestModel(runtimeId: string, input: unknown): Promise<unknown>;
  publishEvent?(runtimeId: string, event: unknown): void;
  resolveModel?(
    callbackId: string,
    result: unknown,
    error?: { code: string; message: string }
  ): unknown;
  progressModel?(callbackId: string): unknown;
  resolvePolicy?(
    callbackId: string,
    result: unknown,
    error?: { code: string; message: string }
  ): unknown;
  resolveTool?(
    callbackId: string,
    result: unknown,
    error?: { code: string; message: string }
  ): unknown;
  shutdownModelCallbacks?(): void;
}

export class AgentHostAgentServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AgentHostAgentServiceError";
    this.code = code;
  }
}

export class AgentHostAgentService {
  private readonly options: AgentHostAgentServiceOptions;
  private readonly runtimes = new Map<string, AgentRuntime>();
  private readonly eventOffsets = new Map<string, number>();

  constructor(options: AgentHostAgentServiceOptions) {
    this.options = options;
  }

  async create(input: AgentHostRuntimeCreateInput) {
    if (this.runtimes.has(input.runtimeId)) {
      throw new AgentHostAgentServiceError(
        "runtime_exists",
        `Agent runtime already exists: ${input.runtimeId}`
      );
    }
    const runtime = await this.options.createRuntime({
      ...input,
      onSessionEvent: (event) => {
        const live = this.runtimes.get(input.runtimeId);
        if (live) {
          this.eventOffsets.set(input.runtimeId, live.sessionMachine.events.length);
        }
        this.options.publishEvent?.(input.runtimeId, event);
        input.onSessionEvent?.(event);
      }
    });
    this.runtimes.set(input.runtimeId, runtime);
    this.eventOffsets.set(input.runtimeId, runtime.sessionMachine.events.length);
    return { runtimeId: input.runtimeId, created: true };
  }

  start(runtimeId: string, messages: unknown[], options: Record<string, unknown>) {
    const result = this.requireRuntime(runtimeId).startAgentLoop(messages, options);
    this.publishNewEvents(runtimeId);
    return result;
  }

  restore(runtimeId: string, snapshot: unknown, options: Record<string, unknown>) {
    const result = this.requireRuntime(runtimeId).restoreAgentLoop(snapshot, options);
    this.publishNewEvents(runtimeId);
    return result;
  }

  async advance(runtimeId: string) {
    const result = await this.requireRuntime(runtimeId).advanceAgentLoop((input) =>
      this.options.requestModel(runtimeId, input)
    );
    this.publishNewEvents(runtimeId);
    return result;
  }

  async resumeApproval(runtimeId: string, approved: boolean) {
    const result = await this.requireRuntime(runtimeId).resumeAgentApproval(
      approved,
      (input) => this.options.requestModel(runtimeId, input)
    );
    this.publishNewEvents(runtimeId);
    return result;
  }

  snapshot(runtimeId: string) {
    return this.requireRuntime(runtimeId).getAgentLoopSnapshot();
  }

  steer(runtimeId: string, message: string | {
    content?: string;
    message?: string;
    attachments?: Array<{ name?: string; path: string; url?: string }>;
  }) {
    const result = this.requireRuntime(runtimeId).steerAgentLoop(message);
    this.publishNewEvents(runtimeId);
    return result;
  }

  cancel(runtimeId: string, reason?: string) {
    const result = this.requireRuntime(runtimeId).cancelAgentLoop(reason);
    this.publishNewEvents(runtimeId);
    return result;
  }

  setPermissionMode(runtimeId: string, mode: "full" | "approval" | "agent") {
    const runtime = this.requireRuntime(runtimeId);
    runtime.setPermissionMode?.(mode);
    return { permissionMode: mode };
  }

  resolveModel(
    callbackId: string,
    result: unknown,
    error?: { code: string; message: string }
  ) {
    if (!this.options.resolveModel) {
      throw new AgentHostAgentServiceError(
        "model_callback_unavailable",
        "Agent model callback resolution is unavailable."
      );
    }
    return this.options.resolveModel(callbackId, result, error);
  }

  progressModel(callbackId: string) {
    if (!this.options.progressModel) {
      throw new AgentHostAgentServiceError(
        "model_callback_unavailable",
        "Agent model callback progress is unavailable."
      );
    }
    return this.options.progressModel(callbackId);
  }

  resolvePolicy(
    callbackId: string,
    result: unknown,
    error?: { code: string; message: string }
  ) {
    if (!this.options.resolvePolicy) {
      throw new AgentHostAgentServiceError(
        "policy_callback_unavailable",
        "Agent policy callback resolution is unavailable."
      );
    }
    return this.options.resolvePolicy(callbackId, result, error);
  }

  resolveTool(
    callbackId: string,
    result: unknown,
    error?: { code: string; message: string }
  ) {
    if (!this.options.resolveTool) {
      throw new AgentHostAgentServiceError(
        "tool_callback_unavailable",
        "Agent tool callback resolution is unavailable."
      );
    }
    return this.options.resolveTool(callbackId, result, error);
  }

  async dispose(runtimeId: string) {
    const runtime = this.requireRuntime(runtimeId);
    this.runtimes.delete(runtimeId);
    this.eventOffsets.delete(runtimeId);
    await runtime.shutdown?.();
    return { runtimeId, disposed: true };
  }

  async shutdown() {
    this.options.shutdownModelCallbacks?.();
    const runtimeIds = [...this.runtimes.keys()];
    await Promise.all(runtimeIds.map((runtimeId) => this.dispose(runtimeId)));
  }

  private requireRuntime(runtimeId: string) {
    const runtime = this.runtimes.get(runtimeId);
    if (!runtime) {
      throw new AgentHostAgentServiceError(
        "runtime_not_found",
        `Agent runtime was not found: ${runtimeId}`
      );
    }
    return runtime;
  }

  private publishNewEvents(runtimeId: string) {
    const runtime = this.requireRuntime(runtimeId);
    const offset = this.eventOffsets.get(runtimeId) ?? 0;
    const events = runtime.sessionMachine.events.slice(offset);
    this.eventOffsets.set(runtimeId, runtime.sessionMachine.events.length);
    for (const event of events) {
      this.options.publishEvent?.(runtimeId, event);
    }
  }
}
