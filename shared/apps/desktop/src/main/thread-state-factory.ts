import type { ChatMessage, CommandRun, MemoryRecord, WorkspaceTimelineEvent } from "@codex-forge/protocol";
import type { ThreadContextState } from "./thread-context-policy.js";
import type { ThreadEventRecord } from "./thread-event-policy.js";
import type { AgentLoopSnapshot } from "./agent-runtime-adapter.js";

export interface ThreadStateFile {
  version?: 2;
  messages: ChatMessage[];
  memories: MemoryRecord[];
  runs: CommandRun[];
  timeline: WorkspaceTimelineEvent[];
  events?: ThreadEventRecord[];
  context?: ThreadContextState;
  agentCheckpoint?: AgentLoopSnapshot & { savedAt: string };
  /** Thread-scoped Delivery Preference OS profile (document.style, etc.). */
  deliveryPreferences?: {
    version: number;
    domains: Record<string, unknown>;
  };
}

export type ThreadAgentCheckpoint = NonNullable<ThreadStateFile["agentCheckpoint"]>;

export function createThreadAgentCheckpoint(
  snapshot: AgentLoopSnapshot,
  savedAt: string
): ThreadAgentCheckpoint {
  return {
    status: snapshot.status,
    steps: snapshot.steps,
    messages: snapshot.messages,
    pending: snapshot.pending,
    finalContent: snapshot.finalContent,
    savedAt
  };
}

interface ThreadStateFactoryContext {
  makeId: (prefix: string) => string;
  nowIso: () => string;
}

export function createTimelineEvent(
  type: WorkspaceTimelineEvent["type"],
  title: string,
  detail: string,
  context: ThreadStateFactoryContext
): WorkspaceTimelineEvent {
  return { id: context.makeId("event"), type, title, detail, createdAt: context.nowIso() };
}

export function createDefaultThreadState(
  workspaceName: string,
  threadTitle: string,
  context: ThreadStateFactoryContext
): ThreadStateFile {
  return {
    version: 2,
    messages: [{
      id: context.makeId("msg"),
      role: "system",
      content: `已进入项目空间 ${workspaceName} 的线程“${threadTitle}”。`,
      createdAt: context.nowIso()
    }],
    memories: [{
      id: context.makeId("memory"),
      scope: "workspace",
      summary: `线程 ${threadTitle} 已创建，可在这里积累该项目空间下的上下文记忆。`,
      createdAt: context.nowIso()
    }],
    runs: [],
    timeline: [createTimelineEvent("thread", "线程已创建", `已创建线程 ${threadTitle}`, context)],
    events: [],
    context: { version: 1, summary: "", compactedMessageIds: [], estimatedTokens: 0, modelContextWindow: 128_000 }
  };
}

export function mergeThreadStateForPersistence(
  exportedState: ThreadStateFile,
  persistedState: ThreadStateFile
): ThreadStateFile {
  const mergeById = <T extends { id?: string }>(persisted: T[] = [], exported: T[] = []) => {
    const merged = [...persisted];
    const indexesById = new Map(
      merged.flatMap((item, index) => item.id ? [[item.id, index] as const] : [])
    );
    for (const item of exported) {
      const existingIndex = item.id ? indexesById.get(item.id) : undefined;
      if (existingIndex !== undefined) {
        merged[existingIndex] = { ...merged[existingIndex], ...item };
        continue;
      }
      merged.push(item);
      if (item.id) indexesById.set(item.id, merged.length - 1);
    }
    return merged;
  };

  const exportedMessages = Array.isArray(exportedState.messages) ? exportedState.messages : [];
  const persistedMessages = Array.isArray(persistedState.messages) ? persistedState.messages : [];
  const persistedConversationIsEmpty = !persistedMessages.some((message) =>
    message.role === "user" || message.role === "assistant"
  );
  const persistedSystemIds = new Set(
    persistedMessages.filter((message) => message.role === "system").map((message) => message.id)
  );
  const exportedBelongsToPersistedThread = exportedMessages.some((message) =>
    message.role === "system" && persistedSystemIds.has(message.id)
  );
  const exportedHasForeignSystemMessage =
    persistedSystemIds.size > 0 &&
    exportedMessages.some((message) => message.role === "system") &&
    !exportedBelongsToPersistedThread;
  // A non-empty thread must never absorb another thread's conversation when the
  // active runtime briefly points at the wrong thread during navigation races.
  const exportedCrossesFreshThreadBoundary =
    persistedConversationIsEmpty && exportedHasForeignSystemMessage;
  const exportedCrossesOccupiedThreadBoundary =
    !persistedConversationIsEmpty && exportedHasForeignSystemMessage;
  const exportedLooksTruncated =
    persistedMessages.length > 1 &&
    exportedMessages.length < persistedMessages.length &&
    !exportedMessages.some((message) => message.role === "user" || message.role === "assistant");

  if (exportedCrossesOccupiedThreadBoundary) {
    return {
      ...persistedState,
      version: 2
    };
  }

  return {
    ...exportedState,
    version: 2,
    messages: exportedLooksTruncated || exportedCrossesFreshThreadBoundary
      ? persistedMessages
      : mergeById(persistedMessages, exportedMessages),
    memories: mergeById(persistedState.memories ?? [], exportedState.memories ?? []),
    runs: mergeById(persistedState.runs ?? [], exportedState.runs ?? []),
    timeline: mergeById(persistedState.timeline ?? [], exportedState.timeline ?? []),
    events: persistedState.events ?? [],
    context: persistedState.context ?? exportedState.context,
    deliveryPreferences: exportedState.deliveryPreferences ?? persistedState.deliveryPreferences
  };
}
