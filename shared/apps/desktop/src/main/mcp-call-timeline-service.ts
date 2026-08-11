import { randomUUID } from "node:crypto";
import type {
  McpToolCallInput,
  McpToolCallResult,
  WorkspaceCatalogItem,
  WorkspaceThreadRecord
} from "@codex-forge/protocol";
import { createThreadEvent, type ThreadEventRecord } from "./thread-event-policy.js";

interface WorkspaceCatalog {
  workspaces: WorkspaceCatalogItem[];
}

export interface McpCallTimelineServiceDependencies {
  getActiveWorkspaceId: () => string;
  getActiveThreadId: () => string;
  readCatalog: () => Promise<WorkspaceCatalog>;
  appendEvents: (
    workspace: WorkspaceCatalogItem,
    thread: WorkspaceThreadRecord,
    events: ThreadEventRecord[]
  ) => Promise<unknown>;
  callTool: (toolId: string, query: string, args?: Record<string, unknown>) => Promise<McpToolCallResult>;
}

/** Records externally visible MCP calls and outcomes against the active thread. */
export class McpCallTimelineService {
  private readonly dependencies: McpCallTimelineServiceDependencies;

  constructor(dependencies: McpCallTimelineServiceDependencies) {
    this.dependencies = dependencies;
  }

  private createEvent(type: Parameters<typeof createThreadEvent>[0], payload: Record<string, unknown>, turnId: string) {
    return createThreadEvent(type, payload, turnId, {
      makeId: (prefix) => `${prefix}-${randomUUID()}`,
      nowIso: () => new Date().toISOString()
    });
  }

  async call(input: McpToolCallInput) {
    const turnId = `tool-turn-${randomUUID()}`;
    const workspaceId = this.dependencies.getActiveWorkspaceId();
    const threadId = this.dependencies.getActiveThreadId();
    let activePair: { workspace: WorkspaceCatalogItem; thread: WorkspaceThreadRecord } | null = null;
    if (workspaceId && threadId) {
      const catalog = await this.dependencies.readCatalog();
      const workspace = catalog.workspaces.find((item) => item.id === workspaceId);
      const thread = workspace?.threads.find((item) => item.id === threadId);
      if (workspace && thread) {
        activePair = { workspace, thread };
        await this.dependencies.appendEvents(workspace, thread, [
          this.createEvent("tool_call", { toolId: input.toolId, query: input.query }, turnId)
        ]);
      }
    }

    try {
      const result = await this.dependencies.callTool(input.toolId, input.query, input.args);
      if (activePair) {
        await this.dependencies.appendEvents(activePair.workspace, activePair.thread, [
          this.createEvent("tool_result", {
            toolId: input.toolId,
            ok: result.ok,
            detail: result.detail,
            content: result.content
          }, turnId)
        ]);
      }
      return result;
    } catch (error) {
      if (activePair) {
        await this.dependencies.appendEvents(activePair.workspace, activePair.thread, [
          this.createEvent("error", {
            stage: "tool_call",
            toolId: input.toolId,
            message: error instanceof Error ? error.message : String(error)
          }, turnId)
        ]);
      }
      throw error;
    }
  }
}
