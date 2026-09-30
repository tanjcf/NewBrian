import type {
  WorkspaceCatalogItem,
  WorkspaceThreadRecord,
  WorkspaceTimelineEvent
} from "@codex-forge/protocol";
import type { ThreadEventRecord } from "./thread-event-policy.js";
import type { ThreadStateFile } from "./thread-state-factory.js";

const MAX_REPLAYABLE_THREAD_EVENTS = 5_000;
/** Cap deep string fields in persisted projections so snapshots stay IPC-safe. */
export const MAX_PERSISTED_STRING_CHARS = 64_000;

interface RolloutRecord {
  record_type?: string;
  state?: Partial<ThreadStateFile>;
  payload?: Partial<ThreadStateFile>;
}

export interface ThreadStateServiceDependencies {
  ensureWorkspaceThreads: (workspace: WorkspaceCatalogItem) => Promise<unknown>;
  getStatePath: (workspaceId: string, threadId: string) => string;
  getLegacyStatePath: (workspaceId: string, threadId: string) => string;
  getEventLogPath: (workspaceId: string, threadId: string) => string;
  readRolloutRecords: (path: string) => Promise<unknown[]>;
  readLatestStateSnapshot: <T>(path: string) => Promise<T | null>;
  readLegacyText: (path: string) => Promise<string>;
  parseJson: <T>(raw: string) => T;
  createDefaultState: (workspaceName: string, threadTitle: string) => ThreadStateFile;
  appendRolloutRecords: (path: string, records: unknown[]) => Promise<unknown>;
  /** Preferred write path: append snapshot and compact oversized rollouts. */
  appendStateSnapshotCompacting?: (path: string, record: unknown) => Promise<unknown>;
  createStateSnapshot: (input: { threadId: string; state: ThreadStateFile }) => unknown;
  toRolloutThreadEvent: (threadId: string, event: ThreadEventRecord) => unknown;
  upsertMemory: (input: {
    threadId: string;
    sourceUpdatedAt: number;
    rawMemory: string;
    rolloutSummary: string;
    rolloutSlug: string;
    generatedAt: number;
    usageCount: number;
    lastUsage: number;
  }) => unknown;
  createTimelineEvent: (type: "thread", title: string, detail: string) => WorkspaceTimelineEvent;
  createThreadEvent: (type: "message", payload: Record<string, unknown>) => ThreadEventRecord;
  nowMs?: () => number;
}

function boundDeepStrings(value: unknown, maxChars: number): unknown {
  if (typeof value === "string") {
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars)}\n\n[truncated ${value.length - maxChars} chars for durable thread state]`;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => boundDeepStrings(entry, maxChars));
  }
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      next[key] = boundDeepStrings(entry, maxChars);
    }
    return next;
  }
  return value;
}

export function boundThreadStateForPersistence(
  state: ThreadStateFile,
  maxChars = MAX_PERSISTED_STRING_CHARS
): ThreadStateFile {
  return {
    ...state,
    version: 2,
    messages: boundDeepStrings(state.messages ?? [], maxChars) as ThreadStateFile["messages"],
    memories: boundDeepStrings(state.memories ?? [], maxChars) as ThreadStateFile["memories"],
    runs: boundDeepStrings(state.runs ?? [], maxChars) as ThreadStateFile["runs"],
    timeline: boundDeepStrings(state.timeline ?? [], maxChars) as ThreadStateFile["timeline"],
    events: (boundDeepStrings(state.events ?? [], maxChars) as ThreadEventRecord[])
      .slice(-MAX_REPLAYABLE_THREAD_EVENTS),
    agentCheckpoint: state.agentCheckpoint
      ? boundDeepStrings(state.agentCheckpoint, maxChars) as ThreadStateFile["agentCheckpoint"]
      : undefined,
    context: state.context
  };
}

function normalizeState(
  state: Partial<ThreadStateFile>,
  fallback: ThreadStateFile
): ThreadStateFile {
  return boundThreadStateForPersistence({
    version: 2,
    messages: Array.isArray(state.messages) ? state.messages : fallback.messages,
    memories: Array.isArray(state.memories) ? state.memories : [],
    runs: Array.isArray(state.runs) ? state.runs : [],
    timeline: Array.isArray(state.timeline) ? state.timeline : [],
    events: Array.isArray(state.events) ? state.events : [],
    agentCheckpoint: state.agentCheckpoint?.status ? state.agentCheckpoint : undefined,
    context: state.context?.version === 1
      ? state.context
      : { version: 1, summary: "", compactedMessageIds: [], estimatedTokens: 0, modelContextWindow: 128_000 }
  });
}

/** Owns canonical thread snapshots, legacy recovery, event mirroring, and fork cloning. */
export class ThreadStateService {
  private readonly dependencies: ThreadStateServiceDependencies;
  private readonly nowMs: () => number;

  constructor(dependencies: ThreadStateServiceDependencies) {
    this.dependencies = dependencies;
    this.nowMs = dependencies.nowMs ?? Date.now;
  }

  async read(workspace: WorkspaceCatalogItem, thread: WorkspaceThreadRecord): Promise<ThreadStateFile> {
    await this.dependencies.ensureWorkspaceThreads(workspace);
    const path = this.dependencies.getStatePath(workspace.id, thread.id);
    const fallback = this.dependencies.createDefaultState(workspace.name, thread.title);
    try {
      // Prefer reverse EOF scan so multi-hundred-MB rollouts do not blow UTF-8 string limits.
      const latest = await this.dependencies.readLatestStateSnapshot<Partial<ThreadStateFile>>(path);
      if (latest) return normalizeState(latest, fallback);

      const records = await this.dependencies.readRolloutRecords(path) as RolloutRecord[];
      const snapshots = records
        .filter((record) => record?.record_type === "state_snapshot")
        .map((record) => record.state ?? record.payload)
        .filter((state): state is Partial<ThreadStateFile> => Boolean(state));
      const snapshot = snapshots.at(-1);
      if (!snapshot) throw new Error(`Thread rollout has no state snapshot: ${path}`);
      return normalizeState(snapshot, fallback);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        try {
          const legacy = this.dependencies.parseJson<Partial<ThreadStateFile>>(
            await this.dependencies.readLegacyText(this.dependencies.getLegacyStatePath(workspace.id, thread.id))
          );
          if (Array.isArray(legacy.messages)) return normalizeState(legacy, fallback);
        } catch {
          // Preserve the original rollout error when legacy recovery is unavailable.
        }
      }
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        await this.write(workspace, thread, fallback);
        return fallback;
      }
      throw error;
    }
  }

  async write(workspace: WorkspaceCatalogItem, thread: WorkspaceThreadRecord, state: ThreadStateFile) {
    await this.dependencies.ensureWorkspaceThreads(workspace);
    const normalized = boundThreadStateForPersistence({
      ...state,
      version: 2 as const,
      events: state.events ?? []
    });
    const snapshotRecord = this.dependencies.createStateSnapshot({
      threadId: thread.id,
      state: normalized
    });
    const path = this.dependencies.getStatePath(workspace.id, thread.id);
    if (this.dependencies.appendStateSnapshotCompacting) {
      await this.dependencies.appendStateSnapshotCompacting(path, snapshotRecord);
    } else {
      await this.dependencies.appendRolloutRecords(path, [snapshotRecord]);
    }
    const sourceUpdatedAt = Date.parse(thread.updatedAt) || this.nowMs();
    for (const memory of normalized.memories) {
      const record = memory as unknown as Record<string, unknown>;
      this.dependencies.upsertMemory({
        threadId: thread.id,
        sourceUpdatedAt,
        rawMemory: JSON.stringify(memory),
        rolloutSummary: String(record.summary ?? record.content ?? ""),
        rolloutSlug: thread.id,
        generatedAt: sourceUpdatedAt,
        usageCount: 0,
        lastUsage: sourceUpdatedAt
      });
    }
  }

  async appendEvents(
    workspace: WorkspaceCatalogItem,
    thread: WorkspaceThreadRecord,
    events: ThreadEventRecord[]
  ) {
    if (!events.length) return;
    const state = await this.read(workspace, thread);
    state.events = [...(state.events ?? []), ...events].slice(-MAX_REPLAYABLE_THREAD_EVENTS);
    await this.write(workspace, thread, state);
    await this.dependencies.appendRolloutRecords(
      this.dependencies.getEventLogPath(workspace.id, thread.id),
      events.map((event) => this.dependencies.toRolloutThreadEvent(thread.id, event))
    );
  }

  /** Updates the replayable thread projection when raw events already exist in the audit rollout. */
  async projectEvents(
    workspace: WorkspaceCatalogItem,
    thread: WorkspaceThreadRecord,
    events: ThreadEventRecord[]
  ) {
    if (!events.length) return;
    const state = await this.read(workspace, thread);
    state.events = [...(state.events ?? []), ...events].slice(-MAX_REPLAYABLE_THREAD_EVENTS);
    await this.write(workspace, thread, state);
  }

  async appendTimeline(
    workspace: WorkspaceCatalogItem,
    thread: WorkspaceThreadRecord,
    event: WorkspaceTimelineEvent
  ) {
    const state = await this.read(workspace, thread);
    state.timeline = [event, ...(state.timeline ?? [])].slice(0, 80);
    await this.write(workspace, thread, state);
  }

  async clone(
    workspace: WorkspaceCatalogItem,
    sourceThread: WorkspaceThreadRecord,
    nextThread: WorkspaceThreadRecord
  ) {
    const source = await this.read(workspace, sourceThread);
    await this.write(workspace, nextThread, {
      version: 2,
      messages: [...source.messages],
      memories: [...source.memories],
      runs: [...source.runs],
      timeline: [
        this.dependencies.createTimelineEvent("thread", "线程已分叉", `从线程 ${sourceThread.title} 分叉而来`),
        ...(source.timeline ?? [])
      ].slice(0, 80),
      events: [
        ...(source.events ?? []),
        this.dependencies.createThreadEvent("message", { kind: "thread_fork", sourceThreadId: sourceThread.id })
      ].slice(-MAX_REPLAYABLE_THREAD_EVENTS),
      context: source.context ? {
        ...source.context,
        compactedMessageIds: [...source.context.compactedMessageIds],
        retainedMessageIds: source.context.retainedMessageIds ? [...source.context.retainedMessageIds] : undefined
      } : undefined
    });
  }
}
