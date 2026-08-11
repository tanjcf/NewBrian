import { randomUUID } from "node:crypto";
import type {
  RecordMessageFeedbackInput,
  WorkspaceCatalogItem,
  WorkspaceThreadInput,
  WorkspaceThreadRecord
} from "@codex-forge/protocol";
import { createThreadEvent, type ThreadEventRecord } from "./thread-event-policy.js";

interface WorkspaceCatalog {
  workspaces: WorkspaceCatalogItem[];
}

export interface WorkspaceThreadServiceDependencies {
  getActiveWorkspaceId: () => string;
  getActiveThreadId: () => string;
  deleteThread: (input: WorkspaceThreadInput) => Promise<WorkspaceCatalog>;
  activateThread: (input: WorkspaceThreadInput) => Promise<unknown>;
  clearActiveThread: (workspaceId: string, workspaceName: string) => void;
  readCatalog: () => Promise<WorkspaceCatalog>;
  appendEvents: (
    workspace: WorkspaceCatalogItem,
    thread: WorkspaceThreadRecord,
    events: ThreadEventRecord[]
  ) => Promise<unknown>;
  updateMetadata: (input: {
    workspaceId: string;
    threadId: string;
    lastEventSummary: string;
  }) => Promise<unknown>;
}

/** Owns thread deletion fallback and user-feedback persistence transactions. */
export class WorkspaceThreadService {
  private readonly dependencies: WorkspaceThreadServiceDependencies;

  constructor(dependencies: WorkspaceThreadServiceDependencies) {
    this.dependencies = dependencies;
  }

  async recordFeedback(input: RecordMessageFeedbackInput) {
    const workspaceId = input.workspaceId?.trim();
    const threadId = input.threadId?.trim();
    if (!workspaceId || !threadId) throw new Error("record-message-feedback requires workspaceId and threadId.");
    const catalog = await this.dependencies.readCatalog();
    const workspace = catalog.workspaces.find((item) => item.id === workspaceId);
    const thread = workspace?.threads.find((item) => item.id === threadId);
    if (!workspace || !thread) throw new Error("Thread not found.");
    const feedbackEvent = createThreadEvent("feedback", {
      messageId: input.messageId,
      rating: input.rating
    }, undefined, {
      makeId: (prefix) => `${prefix}-${randomUUID()}`,
      nowIso: () => new Date().toISOString()
    });
    await this.dependencies.appendEvents(workspace, thread, [feedbackEvent]);
    await this.dependencies.updateMetadata({
      workspaceId,
      threadId,
      lastEventSummary: input.rating === "helpful" ? "User marked response helpful" : "User marked response unhelpful"
    });
    return { ok: true };
  }

  async delete(input: WorkspaceThreadInput) {
    const catalog = await this.dependencies.deleteThread(input);
    if (this.dependencies.getActiveWorkspaceId() === input.workspaceId
      && this.dependencies.getActiveThreadId() === input.threadId) {
      const workspace = catalog.workspaces.find((item) => item.id === input.workspaceId);
      const fallbackThread = workspace?.threads[0];
      if (workspace && fallbackThread) {
        await this.dependencies.activateThread({ workspaceId: workspace.id, threadId: fallbackThread.id });
      } else {
        this.dependencies.clearActiveThread(input.workspaceId, workspace?.name || "workspace");
      }
    }
    return catalog.workspaces;
  }
}
