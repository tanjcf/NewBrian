/**
 * Cursor-style attachment tokens for the composer draft.
 * Tokens are inserted at the caret so placement carries user intent;
 * binary payloads remain in the separate attachment list.
 */

export function formatComposerAttachmentToken(name: string): string {
  const safe = String(name || "附件")
    .replace(/[\r\n\u0000]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "附件";
  return `@${safe}`;
}

export function insertComposerAttachmentToken(
  text: string,
  cursor: number,
  name: string
): { next: string; cursor: number; token: string } {
  const source = String(text || "");
  const token = formatComposerAttachmentToken(name);
  const safeCursor = Math.max(0, Math.min(cursor, source.length));
  const before = source.slice(0, safeCursor);
  const after = source.slice(safeCursor);
  const lead = before.length > 0 && !/\s$/u.test(before) ? " " : "";
  // Always leave a trailing space so an incomplete @-mention picker does not stay open.
  const trail = after.length > 0 && !/^\s/u.test(after) ? " " : " ";
  const insertion = `${lead}${token}${trail}`;
  const next = `${before}${insertion}${after}`;
  return {
    next,
    cursor: before.length + insertion.length,
    token
  };
}

/** Removes the first matching attachment token (and one adjacent space when safe). */
export function removeComposerAttachmentToken(text: string, name: string): string {
  const source = String(text || "");
  const token = formatComposerAttachmentToken(name);
  const index = source.indexOf(token);
  if (index < 0) return source;
  let start = index;
  let end = index + token.length;
  if (start > 0 && /\s/u.test(source[start - 1] || "") && (end >= source.length || /^\s/u.test(source.slice(end)))) {
    start -= 1;
  } else if (end < source.length && /\s/u.test(source[end] || "")) {
    end += 1;
  }
  return `${source.slice(0, start)}${source.slice(end)}`;
}

export function insertComposerAttachmentTokens(
  text: string,
  cursor: number,
  names: string[]
): { next: string; cursor: number } {
  let next = String(text || "");
  let nextCursor = Math.max(0, Math.min(cursor, next.length));
  for (const name of names) {
    const inserted = insertComposerAttachmentToken(next, nextCursor, name);
    next = inserted.next;
    nextCursor = inserted.cursor;
  }
  return { next, cursor: nextCursor };
}
