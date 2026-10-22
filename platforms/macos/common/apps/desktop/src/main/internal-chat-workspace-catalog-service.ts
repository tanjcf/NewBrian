import type { WorkspaceCatalogItem } from "@codex-forge/protocol";
import { INTERNAL_CHAT_WORKSPACE_ID } from "@codex-forge/protocol";

interface WorkspaceCatalog {
  workspaces: WorkspaceCatalogItem[];
}

export interface EnsureInternalChatWorkspaceCatalogInput {
  workspaces: WorkspaceCatalogItem[];
  internalChatPath: string;
  ensureDirectory: (path: string) => Promise<unknown>;
  ensureWorkspace: (workspaces: WorkspaceCatalogItem[], path: string) => WorkspaceCatalogItem[];
  writeCatalog: (workspaces: WorkspaceCatalogItem[]) => Promise<WorkspaceCatalog>;
}

function internalChatRecordChanged(
  before: WorkspaceCatalogItem[] ,
  after: WorkspaceCatalogItem[]
) {
  if (before.length !== after.length) return true;
  const previous = before.find((item) => item.id === INTERNAL_CHAT_WORKSPACE_ID);
  const next = after.find((item) => item.id === INTERNAL_CHAT_WORKSPACE_ID);
  if (!previous || !next) return true;
  // Threads live in state_5.sqlite; JSON catalog only stores workspace identity.
  // Comparing in-memory thread lists here caused a rewrite on every read and
  // raced with add/activate ("Workspace thread was not found").
  return (
    previous.path !== next.path ||
    previous.name !== next.name ||
    previous.brainWorkspaceKey !== next.brainWorkspaceKey ||
    JSON.stringify(previous.conda ?? null) !== JSON.stringify(next.conda ?? null)
  );
}

/** Ensures the hidden chat workspace has a durable catalog record and working directory. */
export async function ensureInternalChatWorkspaceCatalog(
  input: EnsureInternalChatWorkspaceCatalogInput
): Promise<{ catalog: WorkspaceCatalog; changed: boolean }> {
  try {
    await input.ensureDirectory(input.internalChatPath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to create standalone chat directory at ${input.internalChatPath}: ${reason}`);
  }

  const workspaces = input.ensureWorkspace(input.workspaces, input.internalChatPath);
  if (!internalChatRecordChanged(input.workspaces, workspaces)) {
    return { catalog: { workspaces: input.workspaces }, changed: false };
  }
  return { catalog: await input.writeCatalog(workspaces), changed: true };
}
