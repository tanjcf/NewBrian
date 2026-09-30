import {
  brainWorkspaceKeys,
  isBrainWorkspaceKey,
  type BrainWorkspaceKey
} from "@codex-forge/protocol";

export const BRAIN_WORKSPACE_SELECTION_KEY = "brain.workspaceSelection.v2";
export const LEGACY_BRAIN_WORKSPACE_SELECTION_KEY = "brain.selectedWorkspace.v1";

export interface BrainWorkspaceCatalogSelection {
  projectId: string;
  conversationId: string;
}

export interface BrainWorkspaceSelection {
  version: 2;
  selectedWorkspaceKey: BrainWorkspaceKey;
  catalogs: Partial<Record<BrainWorkspaceKey, BrainWorkspaceCatalogSelection>>;
}

export interface RestoredBrainWorkspaceSelection {
  selection: BrainWorkspaceSelection;
  migrated: boolean;
}

const emptyCatalog = (): BrainWorkspaceCatalogSelection => ({ projectId: "", conversationId: "" });

function catalogSelection(value: unknown): BrainWorkspaceCatalogSelection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    projectId: typeof record.projectId === "string" ? record.projectId : "",
    conversationId: typeof record.conversationId === "string" ? record.conversationId : ""
  };
}

export function defaultBrainWorkspaceSelection(): BrainWorkspaceSelection {
  return { version: 2, selectedWorkspaceKey: "explore", catalogs: {} };
}

export function restoreBrainWorkspaceSelection(input: {
  serialized?: string | null;
  legacyWorkspaceKey?: string | null;
  /** Disk-backed preference (e.g. DesktopPreferences.brain); wins over localStorage when set. */
  preferredWorkspaceKey?: string | null;
  availableWorkspaceKeys?: readonly BrainWorkspaceKey[];
}): RestoredBrainWorkspaceSelection {
  const available = input.availableWorkspaceKeys?.length
    ? input.availableWorkspaceKeys
    : brainWorkspaceKeys;
  let parsed: Record<string, unknown> | null = null;
  try {
    const value = input.serialized ? JSON.parse(input.serialized) : null;
    parsed = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    parsed = null;
  }

  const catalogs: BrainWorkspaceSelection["catalogs"] = {};
  const rawCatalogs = parsed?.catalogs;
  if (rawCatalogs && typeof rawCatalogs === "object" && !Array.isArray(rawCatalogs)) {
    for (const [workspaceKey, value] of Object.entries(rawCatalogs)) {
      if (!isBrainWorkspaceKey(workspaceKey)) continue;
      const catalog = catalogSelection(value);
      if (catalog) catalogs[workspaceKey] = catalog;
    }
  }

  const preferredKey = isBrainWorkspaceKey(input.preferredWorkspaceKey)
    ? input.preferredWorkspaceKey
    : null;
  const persistedKey = isBrainWorkspaceKey(parsed?.selectedWorkspaceKey)
    ? parsed.selectedWorkspaceKey
    : null;
  const legacyKey = isBrainWorkspaceKey(input.legacyWorkspaceKey)
    ? input.legacyWorkspaceKey
    : null;
  // Prefer durable desktop preferences over renderer localStorage so the last
  // scene survives packaged ↔ dev origin changes and login remounts.
  const requestedKey = preferredKey ?? persistedKey ?? legacyKey ?? "explore";
  const selectedWorkspaceKey = available.includes(requestedKey)
    ? requestedKey
    : (available.includes("explore") ? "explore" : available[0] ?? "explore");

  return {
    selection: { version: 2, selectedWorkspaceKey, catalogs },
    migrated: parsed?.version !== 2 || (persistedKey === null && preferredKey === null)
  };
}

export function rememberBrainWorkspaceCatalog(
  selection: BrainWorkspaceSelection,
  workspaceKey: BrainWorkspaceKey,
  catalog: Partial<BrainWorkspaceCatalogSelection>
): BrainWorkspaceSelection {
  const current = selection.catalogs[workspaceKey] ?? emptyCatalog();
  const next = { ...current, ...catalog };
  // Same project/conversation must keep the same selection reference. Returning a
  // fresh object on every effect tick forced React into continuous re-renders
  // (context jump + Windows busy cursor) while BRAIN was idle.
  if (
    selection.catalogs[workspaceKey]
    && current.projectId === next.projectId
    && current.conversationId === next.conversationId
  ) {
    return selection;
  }
  return {
    ...selection,
    catalogs: {
      ...selection.catalogs,
      [workspaceKey]: next
    }
  };
}

export function selectBrainWorkspace(
  selection: BrainWorkspaceSelection,
  workspaceKey: BrainWorkspaceKey
): BrainWorkspaceSelection {
  return { ...selection, selectedWorkspaceKey: workspaceKey };
}
