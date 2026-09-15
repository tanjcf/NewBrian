/** Composer draft write-history: coalesce typing, cap undo depth, support redo. */

export const COMPOSER_DRAFT_HISTORY_MAX = 5;
export const COMPOSER_DRAFT_HISTORY_IDLE_MS = 450;

export type ComposerDraftSnapshot = {
  text: string;
  cursor: number;
};

export type ComposerDraftHistoryState = {
  past: ComposerDraftSnapshot[];
  future: ComposerDraftSnapshot[];
  /** Last value that was committed as a checkpoint baseline. */
  committed: ComposerDraftSnapshot;
};

export type ComposerDraftHistoryCaps = {
  canUndo: boolean;
  canRedo: boolean;
};

export function createComposerDraftHistory(
  text = "",
  cursor = Math.max(0, text.length)
): ComposerDraftHistoryState {
  return {
    past: [],
    future: [],
    committed: { text, cursor: clampCursor(text, cursor) }
  };
}

export function composerDraftHistoryCaps(state: ComposerDraftHistoryState): ComposerDraftHistoryCaps {
  return {
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0
  };
}

/**
 * Record a checkpoint for the transition from `committed` → `next`.
 * No-op when text is unchanged unless `force` is set (still clears redo).
 */
export function commitComposerDraftHistory(
  state: ComposerDraftHistoryState,
  next: ComposerDraftSnapshot,
  options?: { force?: boolean; max?: number }
): ComposerDraftHistoryState {
  const max = options?.max ?? COMPOSER_DRAFT_HISTORY_MAX;
  const snapshot = normalizeSnapshot(next);
  if (!options?.force && snapshot.text === state.committed.text) {
    return state;
  }

  const past = [
    ...state.past,
    { text: state.committed.text, cursor: state.committed.cursor }
  ];
  while (past.length > max) past.shift();

  return {
    past,
    future: [],
    committed: snapshot
  };
}

export function undoComposerDraftHistory(
  state: ComposerDraftHistoryState,
  current: ComposerDraftSnapshot,
  options?: { max?: number }
): { state: ComposerDraftHistoryState; restored: ComposerDraftSnapshot } | null {
  if (state.past.length === 0) return null;
  const max = options?.max ?? COMPOSER_DRAFT_HISTORY_MAX;
  const past = state.past.slice();
  const restored = past.pop()!;
  const future = [normalizeSnapshot(current), ...state.future];
  while (future.length > max) future.pop();
  return {
    restored,
    state: {
      past,
      future,
      committed: restored
    }
  };
}

export function redoComposerDraftHistory(
  state: ComposerDraftHistoryState,
  current: ComposerDraftSnapshot,
  options?: { max?: number }
): { state: ComposerDraftHistoryState; restored: ComposerDraftSnapshot } | null {
  if (state.future.length === 0) return null;
  const max = options?.max ?? COMPOSER_DRAFT_HISTORY_MAX;
  const future = state.future.slice();
  const restored = future.shift()!;
  const past = [...state.past, normalizeSnapshot(current)];
  while (past.length > max) past.shift();
  return {
    restored,
    state: {
      past,
      future,
      committed: restored
    }
  };
}

export function resetComposerDraftHistory(
  text = "",
  cursor = Math.max(0, text.length)
): ComposerDraftHistoryState {
  return createComposerDraftHistory(text, cursor);
}

export function shouldForceComposerDraftCheckpoint(inputType: string | undefined): boolean {
  const type = String(inputType || "");
  if (!type) return false;
  return (
    type === "insertFromPaste"
    || type === "insertFromDrop"
    || type === "deleteByCut"
    || type === "historyUndo"
    || type === "historyRedo"
  );
}

function clampCursor(text: string, cursor: number) {
  if (!Number.isFinite(cursor)) return text.length;
  return Math.max(0, Math.min(Math.trunc(cursor), text.length));
}

function normalizeSnapshot(snapshot: ComposerDraftSnapshot): ComposerDraftSnapshot {
  const text = String(snapshot.text ?? "");
  return { text, cursor: clampCursor(text, snapshot.cursor) };
}
