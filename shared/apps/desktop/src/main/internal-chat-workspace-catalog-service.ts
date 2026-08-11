import { isDeepStrictEqual } from "node:util";
import type { WorkspaceCatalogItem } from "@codex-forge/protocol";

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
  if (isDeepStrictEqual(workspaces, input.workspaces)) {
    return { catalog: { workspaces: input.workspaces }, changed: false };
  }
  return { catalog: await input.writeCatalog(workspaces), changed: true };
}
