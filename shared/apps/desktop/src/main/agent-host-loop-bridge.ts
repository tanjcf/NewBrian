import {
  applyPendingApprovalToSessionSnapshot
} from "./approval-continuation-policy.ts";

interface AgentHostRequester {
  request(method: string, payload: unknown): Promise<unknown>;
}

interface LocalToolDescriptor {
  name: string;
  title?: string;
  description?: string;
  kind?: string;
  risk?: string;
  requiresApproval?: boolean;
  inputSchema?: Record<string, unknown>;
}

interface LocalRuntime {
  sessionMachine: {
    events: unknown[];
    snapshot?: Record<string, unknown>;
  };
  getToolDescriptors(): LocalToolDescriptor[];
  evaluateToolPolicy(
    descriptor: LocalToolDescriptor,
    argumentsValue: Record<string, unknown>,
    permissionMode: "full" | "approval" | "agent"
  ): unknown;
  invokeTool(
    name: string,
    input: Record<string, unknown>,
    options: {
      permissionMode: "full";
      approved: true;
    }
  ): Promise<unknown>;
}

interface AgentHostLoopBridgeOptions {
  client: AgentHostRequester;
  invokeTool?: (input: {
    runtimeId: string;
    projectId: string;
    projectRoot: string;
    workspaceType: string;
    toolName: string;
    arguments: Record<string, unknown>;
    fallback(): Promise<unknown>;
  }) => Promise<unknown>;
}

interface RuntimeCreateInput {
  runtimeId: string;
  workspacePath: string;
  projectId?: string;
  workspaceType?: string;
  platformLabel: string;
  shellLabel: string;
}

interface HostCallbackInput {
  runtimeId: string;
  callbackId: string;
  input: unknown;
  reportProgress?: () => void;
  /** Test/override hook for tool/approval progress heartbeats. */
  progressHeartbeatMs?: number;
}

interface HostedLoopSnapshot {
  status: string;
  messages?: unknown[];
  pending?: unknown;
  steps?: number;
  finalContent?: string;
}

interface BridgeEntry {
  localRuntime: LocalRuntime;
  projectId: string;
  projectRoot: string;
  workspaceType: string;
  modelCallback?: (input: unknown) => Promise<unknown>;
  activeLoopOperation?: Promise<HostedLoopSnapshot>;
  lastSnapshot: HostedLoopSnapshot | null;
  startPromise: Promise<unknown>;
  onEvent?: (event: { type: string; payload: unknown }) => void;
  /** Bumped on cancel so late advance/resume responses cannot revive awaiting-approval. */
  loopGeneration: number;
  cancelledGeneration: number;
}

/** Keep parent agent.loop.advance alive while tool/approval work is in flight. */
export const AGENT_HOST_CALLBACK_PROGRESS_HEARTBEAT_MS = 30_000;

async function withCallbackProgressHeartbeat<T>(
  reportProgress: (() => void) | undefined,
  work: () => Promise<T>,
  heartbeatMs = AGENT_HOST_CALLBACK_PROGRESS_HEARTBEAT_MS
): Promise<T> {
  if (!reportProgress) return work();
  reportProgress();
  const timer = setInterval(() => {
    reportProgress();
  }, Math.max(1, heartbeatMs));
  timer.unref?.();
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}

function toHostedToolDescriptor(descriptor: LocalToolDescriptor) {
  return {
    name: descriptor.name,
    title: descriptor.title ?? descriptor.name,
    description: descriptor.description ?? "",
    kind: descriptor.kind ?? "read",
    risk: descriptor.risk ?? "low",
    requiresApproval: descriptor.requiresApproval,
    inputSchema: descriptor.inputSchema ?? {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  };
}

function loopOptions(runtime: LocalRuntime, options: Record<string, unknown>) {
  return {
    permissionMode: options.permissionMode === "full" ? "full" : "agent",
    maxSteps: options.maxSteps,
    allowedToolNames: options.allowedToolNames,
    toolDescriptors: runtime.getToolDescriptors().map(toHostedToolDescriptor)
  };
}

export class AgentHostLoopBridge {
  private readonly client: AgentHostRequester;
  private readonly invokeTool?: AgentHostLoopBridgeOptions["invokeTool"];
  private readonly entries = new Map<string, BridgeEntry>();
  private readonly runtimeIds = new WeakMap<object, string>();
  private activeModelProgress: (() => void) | null = null;

  constructor(options: AgentHostLoopBridgeOptions) {
    this.client = options.client;
    this.invokeTool = options.invokeTool;
  }

  async createRuntime<T extends LocalRuntime>(
    localRuntime: T,
    input: RuntimeCreateInput
  ): Promise<T> {
    await this.client.request("agent.runtime.create", input);
    const entry: BridgeEntry = {
      localRuntime,
      projectId: input.projectId?.trim() || input.runtimeId,
      projectRoot: input.workspacePath,
      workspaceType: input.workspaceType?.trim() || "software",
      lastSnapshot: null,
      startPromise: Promise.resolve(),
      loopGeneration: 0,
      cancelledGeneration: 0
    };
    this.entries.set(input.runtimeId, entry);
    const overrides = this.createOverrides(input.runtimeId, entry);
    const proxy = new Proxy(localRuntime, {
      get(target, property) {
        if (property in overrides) {
          return overrides[property as keyof typeof overrides];
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    this.runtimeIds.set(proxy, input.runtimeId);
    return proxy;
  }

  async disposeRuntime(runtime: string | object) {
    const runtimeId = typeof runtime === "string"
      ? runtime
      : this.runtimeIds.get(runtime);
    if (!runtimeId) return { disposed: false };
    this.entries.delete(runtimeId);
    return this.client.request("agent.runtime.dispose", { runtimeId });
  }

  /** Cancel both local snapshot and host loop for a known runtime id (child interrupt). */
  cancelByRuntimeId(runtimeId: string, reason?: string) {
    const entry = this.entries.get(runtimeId);
    if (!entry) return false;
    const overrides = this.createOverrides(runtimeId, entry);
    overrides.cancelAgentLoop(reason);
    return true;
  }

  async handleModelRequest(callback: HostCallbackInput) {
    const entry = this.requireEntry(callback.runtimeId);
    if (!entry.modelCallback) {
      throw new Error(`Agent model callback is unavailable: ${callback.runtimeId}`);
    }
    const reportProgress = callback.reportProgress;
    this.activeModelProgress = reportProgress ?? null;
    try {
      // Codex-style: long coding / large-context turns often spend minutes before the
      // first visible token (TTFT, describe-bridge, retries). Heartbeat renews the
      // host model_callback inactivity budget the same way tool/approval callbacks do.
      return await withCallbackProgressHeartbeat(
        reportProgress,
        () => entry.modelCallback!(callback.input),
        callback.progressHeartbeatMs
      );
    } finally {
      if (this.activeModelProgress === reportProgress) {
        this.activeModelProgress = null;
      }
    }
  }

  /** Renew the host-side model inactivity budget while tokens are still streaming. */
  notifyModelStreamProgress() {
    this.activeModelProgress?.();
  }

  async handlePolicyRequest(callback: HostCallbackInput) {
    const entry = this.requireEntry(callback.runtimeId);
    const input = callback.input as {
      descriptor: LocalToolDescriptor;
      call: { arguments: Record<string, unknown> };
      permissionMode: "full" | "approval" | "agent";
    };
    return withCallbackProgressHeartbeat(
      callback.reportProgress,
      async () => {
        const permissionMode = input.permissionMode === "full" ? "full" : "agent";
        const evaluated = await entry.localRuntime.evaluateToolPolicy(
          input.descriptor,
          input.call.arguments,
          permissionMode
        ) as { decision?: string; source?: string; ruleId?: string; reason?: string };
        // "替我审批" is an active auto-review tier: low/medium requests that
        // policy classified as `ask` are approved by the agent. Hard denies
        // and explicitly high-risk operations still stop at the user boundary.
        if (permissionMode === "agent"
          && evaluated?.decision === "ask"
          && String(input.descriptor.risk || "low").toLowerCase() !== "high") {
          return {
            ...evaluated,
            decision: "allow",
            source: "agent-review",
            ruleId: evaluated.ruleId || ":agent-auto-review",
            reason: evaluated.reason || "Agent-managed approval accepted a low/medium-risk operation."
          };
        }
        return evaluated;
      },
      callback.progressHeartbeatMs
    );
  }

  async handleToolRequest(callback: HostCallbackInput) {
    const entry = this.requireEntry(callback.runtimeId);
    const input = callback.input as {
      name: string;
      arguments: Record<string, unknown>;
    };
    const fallback = () => entry.localRuntime.invokeTool(input.name, input.arguments, {
      permissionMode: "full",
      approved: true
    });
    return withCallbackProgressHeartbeat(
      callback.reportProgress,
      () => this.invokeTool
        ? this.invokeTool({
            runtimeId: callback.runtimeId,
            projectId: entry.projectId,
            projectRoot: entry.projectRoot,
            workspaceType: entry.workspaceType,
            toolName: input.name,
            arguments: input.arguments,
            fallback
          })
        : fallback(),
      callback.progressHeartbeatMs
    );
  }

  handleHostEvent(payload: { runtimeId: string; event: unknown }) {
    const entry = this.entries.get(payload.runtimeId);
    if (!entry) return;
    entry.localRuntime.sessionMachine.events.push(payload.event);
    if (typeof entry.onEvent === "function" && payload.event && typeof payload.event === "object") {
      const event = payload.event as { type?: unknown; payload?: unknown };
      if (typeof event.type === "string") {
        entry.onEvent({ type: event.type, payload: event.payload });
      }
    }
  }

  private createOverrides(runtimeId: string, entry: BridgeEntry) {
    const updateSnapshot = (value: unknown, generation: number) => {
      if (generation <= entry.cancelledGeneration) {
        return entry.lastSnapshot;
      }
      entry.lastSnapshot = value as HostedLoopSnapshot;
      const pending = entry.lastSnapshot?.pending as {
        call?: { id?: string; name?: string; arguments?: Record<string, unknown> };
        descriptor?: { kind?: string; description?: string; risk?: string; title?: string };
      } | null | undefined;
      applyPendingApprovalToSessionSnapshot({
        sessionSnapshot: entry.localRuntime.sessionMachine.snapshot ?? null,
        loopStatus: entry.lastSnapshot?.status,
        pending: pending ?? null
      });
      return value;
    };
    const clearLocalApproval = () => {
      const session = (entry.localRuntime as {
        sessionMachine?: {
          snapshot?: {
            approval?: unknown;
            pendingTool?: unknown;
            session?: { status?: string };
          };
        };
      }).sessionMachine?.snapshot;
      if (!session) return;
      session.approval = undefined;
      session.pendingTool = undefined;
      if (session.session) session.session.status = "failed";
    };
    const runWithModel = async (
      method: "agent.loop.advance" | "agent.loop.resume-approval",
      payload: Record<string, unknown>,
      callback: (input: unknown) => Promise<unknown>
    ) => {
      await entry.startPromise;
      if (entry.cancelledGeneration >= entry.loopGeneration && entry.lastSnapshot?.status === "failed") {
        throw new Error("Agent loop was cancelled.");
      }
      // A rapid double click can dispatch the same approval twice. The host
      // operation owns both its pending tool call and model callback, so a
      // second overlapping request must join it instead of consuming/clearing
      // that shared state.
      if (entry.activeLoopOperation) return entry.activeLoopOperation;
      const generation = entry.loopGeneration;
      entry.modelCallback = callback;
      const operation = this.client.request(method, { runtimeId, ...payload })
        .then((value) => updateSnapshot(value, generation)) as Promise<HostedLoopSnapshot>;
      entry.activeLoopOperation = operation;
      try {
        return await operation;
      } finally {
        if (entry.activeLoopOperation === operation) {
          entry.activeLoopOperation = undefined;
          entry.modelCallback = undefined;
        }
      }
    };
    return {
      startAgentLoop: (messages: unknown[], options: Record<string, unknown>) => {
        entry.onEvent = typeof options.onEvent === "function"
          ? options.onEvent as (event: { type: string; payload: unknown }) => void
          : undefined;
        entry.loopGeneration += 1;
        entry.cancelledGeneration = 0;
        const generation = entry.loopGeneration;
        entry.lastSnapshot = {
          status: "running",
          messages,
          pending: null,
          steps: 0,
          finalContent: ""
        };
        entry.startPromise = this.client.request("agent.loop.start", {
          runtimeId,
          messages,
          options: loopOptions(entry.localRuntime, options)
        }).then((value) => updateSnapshot(value, generation));
        return entry.lastSnapshot;
      },
      restoreAgentLoop: (snapshot: HostedLoopSnapshot, options: Record<string, unknown>) => {
        entry.onEvent = typeof options.onEvent === "function"
          ? options.onEvent as (event: { type: string; payload: unknown }) => void
          : undefined;
        entry.loopGeneration += 1;
        entry.cancelledGeneration = 0;
        const generation = entry.loopGeneration;
        entry.lastSnapshot = snapshot;
        entry.startPromise = this.client.request("agent.loop.restore", {
          runtimeId,
          snapshot,
          options: loopOptions(entry.localRuntime, options)
        }).then((value) => updateSnapshot(value, generation));
        return entry.lastSnapshot;
      },
      advanceAgentLoop: (callback: (input: unknown) => Promise<unknown>) =>
        runWithModel("agent.loop.advance", {}, callback),
      resumeAgentApproval: (
        approved: boolean,
        callback: (input: unknown) => Promise<unknown>
      ) => runWithModel("agent.loop.resume-approval", { approved }, callback),
      getAgentLoopSnapshot: () => entry.lastSnapshot,
      steerAgentLoop: (message: string | {
        content?: string;
        message?: string;
        attachments?: Array<{ name?: string; path: string; url?: string }>;
      }) => {
        const generation = entry.loopGeneration;
        const payload = typeof message === "string"
          ? { runtimeId, message }
          : {
              runtimeId,
              message: message.content ?? message.message ?? "",
              attachments: message.attachments
            };
        void this.client.request("agent.loop.steer", payload)
          .then((value) => updateSnapshot(value, generation));
        return entry.lastSnapshot;
      },
      cancelAgentLoop: (reason?: string) => {
        entry.cancelledGeneration = entry.loopGeneration;
        entry.activeLoopOperation = undefined;
        entry.modelCallback = undefined;
        entry.lastSnapshot = {
          ...(entry.lastSnapshot ?? {}),
          status: "failed",
          pending: null,
          finalContent: reason ?? "Agent loop was cancelled."
        };
        clearLocalApproval();
        void this.client.request("agent.loop.cancel", { runtimeId, reason })
          .then((value) => updateSnapshot(value, entry.loopGeneration + 1));
        return entry.lastSnapshot;
      }
    };
  }

  private requireEntry(runtimeId: string) {
    const entry = this.entries.get(runtimeId);
    if (!entry) {
      throw new Error(`Agent host bridge runtime was not found: ${runtimeId}`);
    }
    return entry;
  }
}
