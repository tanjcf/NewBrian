import type { DocumentRect, DocumentViewport } from "@codex-forge/protocol/document-anchor";

/** Keep the instruction bar outside the dashed mark. Prefer below the region; move above when the bar would leave the page. */
export function placeDocumentMarkPrompt(rect: DocumentRect, viewport: DocumentViewport) {
  const promptHeight = 40;
  const gap = 10;
  const promptWidth = Math.max(rect.width, 240);
  const maxLeft = Math.max(0, viewport.width - promptWidth);
  const left = Math.min(Math.max(0, rect.x), maxLeft);
  const below = rect.y + rect.height + gap;
  const top = below + promptHeight <= viewport.height
    ? below
    : Math.max(0, rect.y - promptHeight - gap);
  return { left, top, width: promptWidth };
}
