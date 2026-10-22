/**
 * Decide whether selecting a sidebar project home row should clear the unsent
 * composer draft. Chat/thread drafts must not leak onto a fresh project home.
 *
 * Same-project re-clicks (expand/collapse only) keep the draft.
 */
export function shouldClearComposerOnProjectSelect(input: {
  previousRow?: string | null;
  nextRow?: string | null;
}): boolean {
  const previous = String(input.previousRow || "");
  const next = String(input.nextRow || "");
  if (!next.startsWith("project:")) return false;
  if (previous === next) return false;
  return true;
}
