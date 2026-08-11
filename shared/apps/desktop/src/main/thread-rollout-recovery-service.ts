import type { WorkspaceCatalogItem } from "@codex-forge/protocol";
import type { ThreadStateFile } from "./thread-state-factory.js";

interface RolloutRecord {
  record_type?: string;
  state?: Partial<ThreadStateFile>;
  payload?: Partial<ThreadStateFile>;
}

interface FileEntry {
  name: string;
  isFile: () => boolean;
}

export interface ThreadRolloutRecoveryDependencies {
  getThreadsDirectory: (workspaceId: string) => string;
  getRolloutPath: (workspaceId: string, threadId: string) => string;
  listFiles: (path: string) => Promise<FileEntry[]>;
  readRecords: (path: string) => Promise<unknown[]>;
  stat: (path: string) => Promise<{ mtimeMs: number; birthtimeMs: number }>;
  listKnownThreadIds: (cwd: string) => string[];
  upsertThread: (input: {
    id: string;
    rolloutPath: string;
    createdAt: number;
    updatedAt: number;
    cwd: string;
    title: string;
    scope: "project";
    status: "idle";
    approvalMode: "on-request";
    archived: false;
    gitBranch: string;
    preview: string;
    summary: string;
    lastEventSummary: string;
    statusLabel: string;
    memoryMode: "enabled";
    model: string;
  }) => unknown;
  appendDebugLog: (message: string) => Promise<unknown>;
  nowMs: () => number;
}

function snapshotScore(state: Partial<ThreadStateFile>) {
  const messages = state.messages ?? [];
  return messages.filter((message) => message.role === "user" || message.role === "assistant").length * 10
    + messages.length;
}

/** Rebuilds missing SQLite thread indexes from canonical rollout snapshots. */
export class ThreadRolloutRecoveryService {
  private readonly dependencies: ThreadRolloutRecoveryDependencies;

  constructor(dependencies: ThreadRolloutRecoveryDependencies) {
    this.dependencies = dependencies;
  }

  async recover(workspace: WorkspaceCatalogItem) {
    let entries: FileEntry[];
    try {
      entries = await this.dependencies.listFiles(this.dependencies.getThreadsDirectory(workspace.id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const known = new Set(this.dependencies.listKnownThreadIds(workspace.path));
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".rollout.jsonl")) continue;
      const threadId = entry.name.slice(0, -".rollout.jsonl".length);
      if (!threadId || known.has(threadId)) continue;
      const rolloutPath = this.dependencies.getRolloutPath(workspace.id, threadId);
      let snapshot: Partial<ThreadStateFile> | null = null;
      try {
        snapshot = (await this.dependencies.readRecords(rolloutPath) as RolloutRecord[])
          .filter((record) => record?.record_type === "state_snapshot")
          .map((record) => record.state ?? record.payload)
          .filter((state): state is Partial<ThreadStateFile> => Boolean(state))
          .reduce<Partial<ThreadStateFile> | null>((best, state) =>
            !best || snapshotScore(state) >= snapshotScore(best) ? state : best, null);
      } catch (error) {
        await this.dependencies.appendDebugLog(
          `recover rollout thread failed: ${threadId}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : [];
      const last = [...messages].reverse().find((message) => message.role === "user" || message.role === "assistant");
      if (!last) continue;
      const firstUser = messages.find((message) => message.role === "user") ?? last;
      const title = String(firstUser.content ?? "").trim().slice(0, 40) || "新对话";
      const preview = String(last.content ?? "").trim().slice(0, 160);
      const stat = await this.dependencies.stat(rolloutPath);
      const updatedAt = stat.mtimeMs || this.dependencies.nowMs();
      this.dependencies.upsertThread({
        id: threadId,
        rolloutPath,
        createdAt: stat.birthtimeMs || updatedAt,
        updatedAt,
        cwd: workspace.path,
        title,
        scope: "project",
        status: "idle",
        approvalMode: "on-request",
        archived: false,
        gitBranch: "",
        preview,
        summary: preview,
        lastEventSummary: preview,
        statusLabel: "",
        memoryMode: "enabled",
        model: ""
      });
      known.add(threadId);
    }
  }
}
