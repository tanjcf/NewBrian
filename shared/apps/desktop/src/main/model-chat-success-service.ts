import type {
  MemoryRecord,
  WorkspaceCatalogItem,
  WorkspaceThreadRecord
} from "@codex-forge/protocol";
import { appendRolloutRecords } from "./rollout-store.js";
import { toRolloutThreadEvent, type ThreadEventRecord } from "./thread-event-policy.js";
import type { ThreadStateFile } from "./thread-state-factory.js";
import type { NativeWebSearchProjection } from "./model-chat-step-service.js";
import { ensureTurnAssistantMessage } from "./model-chat-success-policy.js";

const MAX_REPLAYABLE_THREAD_EVENTS = 5_000;

interface RememberedExchange {
  memory?: MemoryRecord | null;
  shadow: {
    changed: string[];
    skillName: string;
    threadDeliveryPreferences?: ThreadStateFile["deliveryPreferences"];
  };
}

export interface ModelChatSuccessDependencies {
  readThreadState: (workspace: WorkspaceCatalogItem, thread: WorkspaceThreadRecord) => Promise<ThreadStateFile>;
  writeThreadState: (
    workspace: WorkspaceCatalogItem,
    thread: WorkspaceThreadRecord,
    state: ThreadStateFile
  ) => Promise<unknown>;
  createEvent: (type: "message" | "tool_result" | "memory_created", payload: Record<string, unknown>, turnId?: string) => ThreadEventRecord;
  createTimelineEvent: (type: "message", title: string, detail: string) => ThreadStateFile["timeline"][number];
  getEventLogPath: (workspaceId: string, threadId: string) => string;
  appendEvents: (
    workspace: WorkspaceCatalogItem,
    thread: WorkspaceThreadRecord,
    events: ThreadEventRecord[]
  ) => Promise<unknown>;
  appendDiagnostics: (entry: string) => Promise<unknown>;
  /** Optional hook after local shadow learning writes; knowledge sync is manual-only. */
  onShadowLearned?: (input: {
    workspace: WorkspaceCatalogItem;
    changed: string[];
    skillName: string;
  }) => Promise<unknown> | unknown;
  updateMetadata: (input: {
    workspaceId: string;
    threadId: string;
    status: "idle";
    statusLabel: string;
    lastEventSummary: string;
    summary: string;
  }) => Promise<unknown>;
}

/** Commits one successful or approval-paused model turn to durable thread state. */
export class ModelChatSuccessService {
  private readonly dependencies: ModelChatSuccessDependencies;

  constructor(dependencies: ModelChatSuccessDependencies) {
    this.dependencies = dependencies;
  }

  async persist(input: {
    workspace: WorkspaceCatalogItem;
    thread: WorkspaceThreadRecord;
    turnId: string;
    latestUserRequest: string;
    result: { content: string; reasoningSummary: string };
    reasoningSummary: string;
    nativeWebSearches: NativeWebSearchProjection[];
    waitingForApproval: boolean;
    saveRuntimeState: (summary: string) => Promise<unknown>;
    rememberExchange: (exchange: { user: string; assistant: string; scope: "session" }) => Promise<RememberedExchange>;
    getMemories: () => MemoryRecord[];
  }) {
    const searchEvents = input.nativeWebSearches.map((search) => this.dependencies.createEvent("tool_result", {
      kind: "web_search",
      callId: search.id,
      status: search.status,
      action: search.action,
      citations: search.citations
    }, input.turnId));
    await input.saveRuntimeState(input.waitingForApproval ? "原生工具调用等待批准" : "模型回复已完成");
    const state = await this.dependencies.readThreadState(input.workspace, input.thread);
    state.events = [...(state.events ?? []), ...searchEvents].slice(-MAX_REPLAYABLE_THREAD_EVENTS);
    const persistedAssistant = ensureTurnAssistantMessage<ThreadStateFile["messages"][number]>({
      messages: state.messages,
      turnId: input.turnId,
      waitingForApproval: input.waitingForApproval,
      create: (id) => ({
        id,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
        reasoningSummary: ""
      })
    });
    if (persistedAssistant) persistedAssistant.reasoningSummary = input.reasoningSummary.trim();
    // Drop renderer streaming stubs (local-assistant-*) once the durable assistant-turn exists.
    // Keeping both causes the conversation UI to render the same answer twice.
    // Do this for approval waits too — otherwise syncSnapshot can wipe the stub and leave a blank turn.
    state.messages = state.messages.filter((message) => {
      if (!String(message.id || "").startsWith("local-assistant-")) return true;
      if (message.excludeFromModelContext) return true;
      return false;
    });

    if (input.waitingForApproval) {
      if (persistedAssistant) {
        persistedAssistant.content = input.result.content;
        persistedAssistant.reasoningSummary = input.result.reasoningSummary;
      }
    } else {
      if (persistedAssistant) {
        persistedAssistant.content = input.result.content;
        persistedAssistant.reasoningSummary = input.result.reasoningSummary;
        const assistantEvent = this.dependencies.createEvent("message", {
          role: "assistant",
          messageId: persistedAssistant.id,
          content: input.result.content,
          reasoningSummary: input.result.reasoningSummary
        }, input.turnId);
        state.events = [...(state.events ?? []), assistantEvent].slice(-MAX_REPLAYABLE_THREAD_EVENTS);
        state.timeline = [
          this.dependencies.createTimelineEvent("message", "模型回复", input.result.content.slice(0, 120)),
          ...(state.timeline ?? [])
        ].slice(0, 80);
        await appendRolloutRecords(
          this.dependencies.getEventLogPath(input.workspace.id, input.thread.id),
          [toRolloutThreadEvent(input.thread.id, assistantEvent)]
        );
      }
      const { memory, shadow } = await input.rememberExchange({
        user: input.latestUserRequest,
        assistant: input.result.content,
        scope: "session"
      });
      if (shadow.changed.length) {
        await this.dependencies.appendDiagnostics(`user shadow updated (${shadow.skillName}): ${shadow.changed.join(", ")}`);
        await this.dependencies.onShadowLearned?.({
          workspace: input.workspace,
          changed: shadow.changed,
          skillName: shadow.skillName
        });
      }
      if (memory) {
        state.memories = input.getMemories();
        await this.dependencies.appendEvents(input.workspace, input.thread, [this.dependencies.createEvent("memory_created", {
          memoryId: memory.id,
          scope: memory.scope,
          summary: memory.summary
        }, input.turnId)]);
      }
      if (shadow.threadDeliveryPreferences) {
        state.deliveryPreferences = shadow.threadDeliveryPreferences;
      }
      await this.dependencies.updateMetadata({
        workspaceId: input.workspace.id,
        threadId: input.thread.id,
        status: "idle",
        statusLabel: "",
        lastEventSummary: "模型回复已完成",
        summary: `${input.latestUserRequest.slice(0, 80)}${input.result.content.trim() ? ` · ${input.result.content.replace(/\s+/g, " ").slice(0, 120)}` : ""}`
      });
    }
    await this.dependencies.writeThreadState(input.workspace, input.thread, state);
  }
}
