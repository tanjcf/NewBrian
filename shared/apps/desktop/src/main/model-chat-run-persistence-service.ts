import type { WorkspaceCatalogItem, WorkspaceThreadRecord } from "@codex-forge/protocol";
import {
  buildOrphanToolResultPayloads,
  enrichBoundaryEventsForPersistence,
  extractRecoveredToolResultPayloads,
  mergeToolBoundaryEventsForOrphanRepair,
  type ToolBoundaryEventRecord,
  type ToolReplayDescriptor,
  type TurnReplayMetadata
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
} from "./agent-loop-boundary-persistence.ts";
import type { NativeWebSearchProjection } from "./model-chat-step-service.js";
import type { ThreadEventRecord, ThreadEventType } from "./thread-event-policy.js";

interface AgentRuntimeEvent {
  type: string;
  timestamp?: string;
  payload?: unknown;
}

export interface ModelChatRunPersistenceDependencies {
  makeId: (prefix: string) => string;
  nowIso: () => string;
  getEventLogPath: (workspaceId: string, threadId: string) => string;
  appendAuditRecords: (path: string, records: unknown[]) => Promise<unknown>;
  createAuditRecord: (input: {
    recordType: string;
    threadId: string;
    turnId: string;
    timestamp?: string;
    payload: unknown;
  }) => unknown;
  createThreadEvent: (type: ThreadEventType, payload: Record<string, unknown>, turnId?: string) => ThreadEventRecord;
  toRolloutThreadEvent: (threadId: string, event: ThreadEventRecord) => unknown;
  projectEvents: (
    workspace: WorkspaceCatalogItem,
    thread: WorkspaceThreadRecord,
    events: ThreadEventRecord[]
  ) => Promise<unknown>;
  updateMetadata: (input: {
    workspaceId: string;
    threadId: string;
    status: "awaiting-approval";
    statusLabel: string;
    lastEventSummary: string;
  }) => Promise<unknown>;
  readThreadEvents?: (
    workspace: WorkspaceCatalogItem,
    thread: WorkspaceThreadRecord
  ) => Promise<Array<{ type: string; payload?: unknown; turnId?: string }>>;
}

/** Persists runtime and web-search projections before exposing approval state. */
export class ModelChatRunPersistenceService {
  private readonly dependencies: ModelChatRunPersistenceDependencies;

  constructor(dependencies: ModelChatRunPersistenceDependencies) {
    this.dependencies = dependencies;
  }

  /** Persist a boundary batch (tool_call / tool_result / approval / failure) mid-loop. */
  async persistEvents(input: {
    workspace: WorkspaceCatalogItem;
    thread: WorkspaceThreadRecord;
    turnId: string;
    agentEvents: AgentRuntimeEvent[];
    awaitingApproval?: boolean;
    pendingToolName?: string;
    toolDescriptors?: ToolReplayDescriptor[];
    replayMetadata?: TurnReplayMetadata | null;
  }) {
    if (!input.agentEvents.length && !input.awaitingApproval && !input.replayMetadata) return;
    const enrichedEvents = enrichBoundaryEventsForPersistence(
      input.agentEvents,
      input.toolDescriptors ?? []
    );
    const visibleEventTypes: Partial<Record<string, ThreadEventType>> = {
      tool_call: "tool_call",
      tool_result: "tool_result",
      approval_requested: "approval",
      agent_loop_failed: "error"
    };
    const projectedEvents = enrichedEvents.flatMap((event) => {
      const type = visibleEventTypes[event.type];
      if (!type || typeof event.payload !== "object" || event.payload === null || Array.isArray(event.payload)) {
        return [];
      }
      const projected = this.dependencies.createThreadEvent(
        type,
        event.payload as Record<string, unknown>,
        input.turnId
      );
      if (event.timestamp) projected.createdAt = event.timestamp;
      return [projected];
    });
    const auditRecords = [
      ...enrichedEvents.map((event) => this.dependencies.createAuditRecord({
        recordType: event.type,
        threadId: input.thread.id,
        turnId: input.turnId,
        timestamp: event.timestamp,
        payload: event.payload
      })),
      ...(input.replayMetadata ? [this.dependencies.createAuditRecord({
        recordType: "turn_replay_metadata",
        threadId: input.thread.id,
        turnId: input.turnId,
        payload: input.replayMetadata
      })] : [])
    ];
    if (auditRecords.length) {
      await this.dependencies.appendAuditRecords(
        this.dependencies.getEventLogPath(input.workspace.id, input.thread.id),
        auditRecords
      );
    }
    if (projectedEvents.length) {
      await this.dependencies.projectEvents(input.workspace, input.thread, projectedEvents);
    }
    if (input.awaitingApproval) {
      await this.dependencies.updateMetadata({
        workspaceId: input.workspace.id,
        threadId: input.thread.id,
        status: "awaiting-approval",
        statusLabel: "等待批准",
        lastEventSummary: `工具 ${input.pendingToolName ?? ""} 等待用户批准`
      });
    }
  }

  async persist(input: {
    workspace: WorkspaceCatalogItem;
    thread: WorkspaceThreadRecord;
    turnId: string;
    agentEvents: AgentRuntimeEvent[];
    nativeWebSearches: NativeWebSearchProjection[];
    awaitingApproval: boolean;
    pendingToolName?: string;
    toolDescriptors?: ToolReplayDescriptor[];
    replayMetadata?: TurnReplayMetadata | null;
  }) {
    await this.persistEvents({
      workspace: input.workspace,
      thread: input.thread,
      turnId: input.turnId,
      agentEvents: input.agentEvents,
      awaitingApproval: input.awaitingApproval,
      pendingToolName: input.pendingToolName,
      toolDescriptors: input.toolDescriptors,
      replayMetadata: input.replayMetadata
    });
    const searchEvents = input.nativeWebSearches.map((search) => this.dependencies.createThreadEvent("tool_result", {
      kind: "web_search",
      callId: search.id,
      status: search.status,
      action: search.action,
      citations: search.citations
    }, input.turnId));
    if (!searchEvents.length) return;
    await this.dependencies.appendAuditRecords(
      this.dependencies.getEventLogPath(input.workspace.id, input.thread.id),
      searchEvents.map((event) => this.dependencies.toRolloutThreadEvent(input.thread.id, event))
    );
    await this.dependencies.projectEvents(input.workspace, input.thread, searchEvents);
  }

  /** Close unpaired tool_call projections after crash/cancel so UI does not stay "running". */
  async repairOrphanToolCalls(input: {
    workspace: WorkspaceCatalogItem;
    thread: WorkspaceThreadRecord;
    turnId: string;
    failureReason?: string;
    supplementalEvents?: ToolBoundaryEventRecord[];
  }) {
    if (!this.dependencies.readThreadEvents) return [];
    const existing = await this.dependencies.readThreadEvents(input.workspace, input.thread);
    const recovered = extractRecoveredToolResultPayloads(
      existing,
      input.supplementalEvents ?? [],
      input.turnId
    );
    const merged = mergeToolBoundaryEventsForOrphanRepair(
      existing,
      input.supplementalEvents ?? [],
      input.turnId
    );
    const orphans = buildOrphanToolResultPayloads(merged, { failureReason: input.failureReason });
    const payloads = [
      ...recovered.map((payload) => ({
        callId: payload.callId,
        name: payload.name,
        result: payload.result
      })),
      ...orphans
    ];
    if (!payloads.length) return [];
    const projected = payloads.map((payload) =>
      this.dependencies.createThreadEvent("tool_result", payload as unknown as Record<string, unknown>, input.turnId)
    );
    await this.dependencies.appendAuditRecords(
      this.dependencies.getEventLogPath(input.workspace.id, input.thread.id),
      payloads.map((payload) => this.dependencies.createAuditRecord({
        recordType: "tool_result",
        threadId: input.thread.id,
        turnId: input.turnId,
        payload
      }))
    );
    await this.dependencies.projectEvents(input.workspace, input.thread, projected);
    return projected;
  }
}
