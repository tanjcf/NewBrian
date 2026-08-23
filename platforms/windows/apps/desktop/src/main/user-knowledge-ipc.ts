import { ipcMain } from "electron";
import { desktopIpcChannels } from "@codex-forge/protocol";

export type UserKnowledgeSyncInput = {
  projectWorkspacePath?: string;
  projectKey?: string;
  forceFullPull?: boolean;
};

export type UserKnowledgeSyncResult = {
  ok: boolean;
  pulled: number;
  pushed: number;
  generation: number;
  conflictRetried: number;
  status: "synced" | "pending" | "conflict-queued" | "skipped" | "error";
  message?: string;
};

interface UserKnowledgeIpcServices {
  sync: (input?: UserKnowledgeSyncInput) => Promise<UserKnowledgeSyncResult>;
}

/** Register manual user-knowledge sync; automatic background sync is intentionally disabled. */
export function registerUserKnowledgeIpcHandlers(services: UserKnowledgeIpcServices) {
  ipcMain.handle(
    desktopIpcChannels.knowledge.sync,
    (_event, input: UserKnowledgeSyncInput | undefined) => services.sync(input ?? {})
  );
}
