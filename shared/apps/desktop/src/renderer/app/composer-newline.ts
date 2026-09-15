/** Insert a hard newline at the current selection; used by Shift/Alt+Enter. */
export function insertNewlineIntoDraft(
  draft: string,
  selectionStart: number,
  selectionEnd: number
) {
  const start = Math.max(0, Math.min(selectionStart, draft.length));
  const end = Math.max(start, Math.min(selectionEnd, draft.length));
  return {
    next: `${draft.slice(0, start)}\n${draft.slice(end)}`,
    cursor: start + 1
  };
}
