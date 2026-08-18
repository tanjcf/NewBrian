import type { HolonKnowledgeSnapshot, HolonWorkItem, HolonWorkItemView } from "@codex-forge/protocol";
import type {
  CodexStorage,
  PersistedRemoteWorkItem,
  PersistedRemoteWorkItemStatus
} from "./codex-storage.js";
import type { HolonRuntimeProjector } from "./holon-runtime-projector.js";

type HolonClient = {
  claimNextWorkItem: () => Promise<HolonWorkItem | null>;
  getKnowledgeSnapshot: (snapshotId: string) => Promise<HolonKnowledgeSnapshot>;
  heartbeat: (workItemId: string) => Promise<{ workItemId: string; leaseUntil: string }>;
  getControl: (workItemId: string) => Promise<Record<string, unknown>>;
};

type ExecuteRemoteWork = (input: {
  workItem: HolonWorkItem;
  snapshot: HolonKnowledgeSnapshot | null;
  threadId: string;
  turnId: string;
  signal: AbortSignal;
  onEvent: (event: { type: string; payload?: unknown }) => void;
}) => Promise<void>;

type HolonWorkItemServiceInput = {
  storage: CodexStorage;
  client: HolonClient;
  projector: HolonRuntimeProjector;
  execute: ExecuteRemoteWork;
  getRegisteredToolNames?: () => string[];
  now?: () => number;
  setInterval?: (callback: () => void, delayMs: number) => unknown;
  clearInterval?: (handle: unknown) => void;
};

const REMOTE_EXECUTION_POLICIES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "execution-v1": Object.freeze(["workspace.scan", "shell.exec"])
});

export function resolveRemoteAllowedToolNames(executionPolicyVersion: string): string[] {
  const allowed = REMOTE_EXECUTION_POLICIES[executionPolicyVersion];
  if (!allowed) throw new Error("HOLON_EXECUTION_POLICY_UNSUPPORTED");
  return [...allowed];
}

export class HolonWorkItemService {
  private readonly storage: CodexStorage;
  private readonly client: HolonClient;
  private readonly projector: HolonRuntimeProjector;
  private readonly execute: ExecuteRemoteWork;
  private readonly getRegisteredToolNames: () => string[];
  private readonly now: () => number;
  private readonly scheduleInterval: (callback: () => void, delayMs: number) => unknown;
  private readonly cancelInterval: (handle: unknown) => void;
  private readonly active = new Map<string, AbortController>();

  constructor(input: HolonWorkItemServiceInput) {
    this.storage = input.storage;
    this.client = input.client;
    this.projector = input.projector;
    this.execute = input.execute;
    this.getRegisteredToolNames = input.getRegisteredToolNames
      ?? (() => Object.values(REMOTE_EXECUTION_POLICIES).flatMap((names) => [...names]));
    this.now = input.now ?? Date.now;
    this.scheduleInterval = input.setInterval ?? ((callback, delayMs) => setInterval(callback, delayMs));
    this.cancelInterval = input.clearInterval ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
  }

  async claimNext(): Promise<HolonWorkItemView | null> {
    const local = this.storage.getLatestActionableRemoteWorkItem();
    if (local) return this.toView(local);
    const workItem = await this.client.claimNextWorkItem();
    if (!workItem) return null;
    const snapshot = workItem.knowledgeSnapshotId
      ? await this.client.getKnowledgeSnapshot(workItem.knowledgeSnapshotId)
      : null;
    const claimedAtMs = this.now();
    const effectiveToolNames = this.resolveEffectiveToolNames(workItem.executionPolicyVersion);
    this.storage.upsertRemoteWorkItem({
      id: workItem.id,
      status: "claimed",
      objective: workItem.objective,
      source: workItem.source,
      targetDeviceId: workItem.targetDeviceId,
      knowledgeSnapshotId: workItem.knowledgeSnapshotId,
      payloadJson: JSON.stringify({ workItem, snapshot, effectiveToolNames }),
      claimedAtMs,
      leaseUntilMs: Date.parse(workItem.leaseUntil),
      lastError: ""
    });
    return { workItem, snapshot, effectiveToolNames, status: "claimed", lastError: "" };
  }

  get(workItemId: string): HolonWorkItemView | null {
    const persisted = this.storage.getRemoteWorkItem(workItemId);
    return persisted ? this.toView(persisted) : null;
  }

  async start(workItemId: string, threadId: string, turnId: string): Promise<HolonWorkItemView> {
    if (this.active.has(workItemId)) throw new Error("HOLON_WORK_ALREADY_RUNNING");
    const persisted = this.storage.getRemoteWorkItem(workItemId);
    if (!persisted || !["claimed", "interrupted"].includes(persisted.status)) throw new Error("HOLON_WORK_NOT_STARTABLE");
    if (!this.storage.updateRemoteWorkItemStatus(workItemId, persisted.status, "running", { threadId })) {
      throw new Error("HOLON_WORK_START_CONFLICT");
    }
    const view = this.toView({ ...persisted, status: "running", threadId });
    const controller = new AbortController();
    this.active.set(workItemId, controller);
    const projectedTypes = new Set<string>();
    const terminalAgentEvent: { current: { type: string; payload?: unknown } | null } = { current: null };
    const context = { workItemId, threadId, turnId };
    const onEvent = (event: { type: string; payload?: unknown }) => {
      if (isTerminalAgentEvent(event.type)) {
        terminalAgentEvent.current = event;
        return;
      }
      if (event.type === "agent_loop_started" && projectedTypes.has("work_item.started")) return;
      if (event.type === "agent_loop_completed" && projectedTypes.has("work_item.completed")) return;
      if (event.type === "agent_loop_failed" && projectedTypes.has("work_item.failed")) return;
      if (event.type === "agent_loop_cancelled" && projectedTypes.has("work_item.cancelled")) return;
      const projected = this.projector.project(context, event);
      if (!projected) return;
      projectedTypes.add(projected.eventType);
      if (projected.eventType === "approval.requested") {
        this.storage.updateRemoteWorkItemStatus(workItemId, "running", "waiting_approval");
      } else if (projected.eventType === "approval.resolved") {
        this.storage.updateRemoteWorkItemStatus(workItemId, "waiting_approval", "running");
      }
    };
    const timer = this.scheduleInterval(() => {
      void this.maintainLease(workItemId, controller);
    }, heartbeatInterval(view.workItem.leaseUntil, this.now()));
    let executionError: unknown = null;
    try {
      await this.execute({
        workItem: view.workItem,
        snapshot: view.snapshot,
        threadId,
        turnId,
        signal: controller.signal,
        onEvent
      });
    } catch (error) {
      executionError = error;
    } finally {
      this.cancelInterval(timer);
      this.active.delete(workItemId);
    }
    const cancelled = controller.signal.aborted || terminalAgentEvent.current?.type === "agent_loop_cancelled";
    const failed = !cancelled && (executionError !== null || terminalAgentEvent.current?.type === "agent_loop_failed");
    const status = cancelled ? "cancelled" : failed ? "failed" : "completed";
    const lastError = cancelled ? "REMOTE_CANCEL_REQUESTED" : failed ? stableError(executionError) : "";
    this.finish(workItemId, status, lastError);
    const finalEvent = terminalAgentEvent.current ?? (cancelled
      ? { type: "agent_loop_cancelled", payload: { reason: lastError } }
      : failed
        ? { type: "agent_loop_failed", payload: { reason: lastError } }
        : { type: "agent_loop_completed", payload: {} });
    this.projector.project(context, finalEvent);
    return this.get(workItemId)!;
  }

  cancel(workItemId: string, reason = "USER_CANCELLED"): HolonWorkItemView {
    const active = this.active.get(workItemId);
    if (active) {
      active.abort(new Error(reason));
      const running = this.get(workItemId);
      if (!running) throw new Error("HOLON_WORK_NOT_FOUND");
      return running;
    }
    const persisted = this.storage.getRemoteWorkItem(workItemId);
    if (!persisted) throw new Error("HOLON_WORK_NOT_FOUND");
    if (!["claimed", "interrupted"].includes(persisted.status)) {
      throw new Error("HOLON_WORK_NOT_CANCELLABLE");
    }
    if (!this.storage.updateRemoteWorkItemStatus(workItemId, persisted.status, "cancelled", {
      completedAtMs: this.now(),
      lastError: reason
    })) {
      throw new Error("HOLON_WORK_CANCEL_CONFLICT");
    }
    this.projector.project(
      { workItemId, threadId: persisted.threadId },
      { type: "agent_loop_cancelled", payload: { reason } }
    );
    return this.get(workItemId)!;
  }

  private async maintainLease(workItemId: string, controller: AbortController) {
    if (controller.signal.aborted) return;
    try {
      await this.client.heartbeat(workItemId);
      const control = await this.client.getControl(workItemId);
      if (control.cancel_requested === true || control.cancelRequested === true) {
        controller.abort(new Error("REMOTE_CANCEL_REQUESTED"));
      }
    } catch (error) {
      controller.abort(new Error(`HOLON_LEASE_MAINTENANCE_FAILED:${stableError(error)}`));
    }
  }

  private finish(workItemId: string, status: "completed" | "failed" | "cancelled", lastError: string) {
    const update = { completedAtMs: this.now(), lastError };
    if (!this.storage.updateRemoteWorkItemStatus(workItemId, "running", status, update)
      && !this.storage.updateRemoteWorkItemStatus(workItemId, "waiting_approval", status, update)) {
      throw new Error("HOLON_WORK_TERMINAL_CONFLICT");
    }
  }

  private resolveEffectiveToolNames(executionPolicyVersion: string): string[] {
    const registered = new Set(this.getRegisteredToolNames());
    return resolveRemoteAllowedToolNames(executionPolicyVersion).filter((name) => registered.has(name));
  }

  private toView(persisted: PersistedRemoteWorkItem): HolonWorkItemView {
    return toView(persisted, (version) => this.resolveEffectiveToolNames(version));
  }
}

function toView(
  persisted: PersistedRemoteWorkItem,
  resolveEffectiveTools: (executionPolicyVersion: string) => string[]
): HolonWorkItemView {
  let payload: unknown;
  try {
    payload = JSON.parse(persisted.payloadJson);
  } catch {
    throw new Error("HOLON_WORK_PAYLOAD_INVALID");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("HOLON_WORK_PAYLOAD_INVALID");
  }
  const value = payload as {
    workItem?: HolonWorkItem;
    snapshot?: HolonKnowledgeSnapshot | null;
    effectiveToolNames?: unknown;
  };
  if (!value.workItem) throw new Error("HOLON_WORK_PAYLOAD_INVALID");
  const effectiveToolNames = Array.isArray(value.effectiveToolNames)
    ? value.effectiveToolNames.filter((name): name is string => typeof name === "string")
    : resolveEffectiveTools(value.workItem.executionPolicyVersion);
  return {
    workItem: value.workItem,
    snapshot: value.snapshot ?? null,
    effectiveToolNames,
    status: persisted.status,
    threadId: persisted.threadId,
    lastError: persisted.lastError
  };
}

function heartbeatInterval(leaseUntil: string, nowMs: number): number {
  const remaining = Math.max(2_000, Date.parse(leaseUntil) - nowMs);
  return Math.max(1_000, Math.min(45_000, Math.trunc(remaining / 2)));
}

function stableError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim().slice(0, 240);
  return "HOLON_EXECUTION_FAILED";
}

function isTerminalAgentEvent(type: string): boolean {
  return type === "agent_loop_completed" || type === "agent_loop_failed" || type === "agent_loop_cancelled";
}
