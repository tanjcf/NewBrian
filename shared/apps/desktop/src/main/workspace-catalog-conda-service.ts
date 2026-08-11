import type { WorkspaceCatalogItem } from "@codex-forge/protocol";

interface WorkspaceCatalog {
  workspaces: WorkspaceCatalogItem[];
}

export interface EnsureWorkspaceCatalogCondaInput {
  catalog: WorkspaceCatalog;
  isInternalWorkspace: (workspace: WorkspaceCatalogItem) => boolean;
  provisionWorkspace: (
    workspace: WorkspaceCatalogItem
  ) => Promise<{ config: WorkspaceCatalogItem["conda"] }>;
  normalizeWorkspace: (workspace: WorkspaceCatalogItem) => WorkspaceCatalogItem;
  writeCatalog: (workspaces: WorkspaceCatalogItem[]) => Promise<WorkspaceCatalog>;
  onProvisionError: (workspace: WorkspaceCatalogItem, error: unknown) => void;
}

/** Applies project Conda setup while preserving non-project internal workspaces verbatim. */
export async function ensureWorkspaceCatalogConda(
  input: EnsureWorkspaceCatalogCondaInput
): Promise<WorkspaceCatalog> {
  let changed = false;
  const nextWorkspaces: WorkspaceCatalogItem[] = [];
  for (const workspace of input.catalog.workspaces) {
    if (input.isInternalWorkspace(workspace)) {
      nextWorkspaces.push(workspace);
      continue;
    }
    try {
      const discovery = await input.provisionWorkspace(workspace);
      const nextWorkspace = input.normalizeWorkspace({
        ...workspace,
        conda: discovery.config
      });
      nextWorkspaces.push(nextWorkspace);
      if (JSON.stringify(workspace.conda ?? null) !== JSON.stringify(nextWorkspace.conda ?? null)) {
        changed = true;
      }
    } catch (error) {
      input.onProvisionError(workspace, error);
      nextWorkspaces.push(input.normalizeWorkspace(workspace));
    }
  }
  if (changed) {
    return input.writeCatalog(nextWorkspaces);
  }
  return { workspaces: nextWorkspaces };
}
