import type { PhaseOneSnapshot } from "@codex-forge/protocol";

interface StartupThreadRestoreInput {
  api: {
    activateWorkspaceThread(input: {
      workspaceId: string;
      threadId: string;
    }): Promise<PhaseOneSnapshot>;
  };
  workspaceId: string;
  threadId: string;
  syncSnapshot: (snapshot: PhaseOneSnapshot, threadId: string) => void;
}

export async function restoreStartupThreadSnapshot(input: StartupThreadRestoreInput) {
  const snapshot = await input.api.activateWorkspaceThread({
    workspaceId: input.workspaceId,
    threadId: input.threadId
  });
  input.syncSnapshot(snapshot, input.threadId);
  return snapshot;
}
