import type { DocumentAnchor, DocumentRect, DocumentViewport } from "./document-anchor.js";
import { projectDocumentRect } from "./document-anchor.js";

/** Structural slice metadata shared with vectorization/RAG chunking. */
export interface DocumentChunkMeta {
  chunkIndex: number;
  pageOrSheet?: string | number;
  headingPath?: string[];
  startOffset?: number;
  endOffset?: number;
  endParagraphIndex?: number;
}

export interface MarkdownSectionSlice {
  chunkIndex: number;
  headingPath: string[];
  startLine: number;
  endLine: number;
  text: string;
  startOffset: number;
  endOffset: number;
}

const HEADING_RE = /^(#{1,6})\s+(.+)$/;

export function rectOverlapArea(a: DocumentRect, b: DocumentRect): number {
  const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return overlapX * overlapY;
}

export function sliceMarkdownSections(content: string): MarkdownSectionSlice[] {
  const normalized = content.replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  const slices: MarkdownSectionSlice[] = [];
  let headingStack: Array<{ level: number; title: string }> = [];
  let chunkLines: string[] = [];
  let chunkStartLine = 1;
  let chunkStartOffset = 0;
  let chunkIndex = 0;
  let textOffset = 0;

  const flush = (endLine: number) => {
    if (!chunkLines.length) return;
    const text = chunkLines.join("\n");
    slices.push({
      chunkIndex,
      headingPath: headingStack.map((item) => item.title),
      startLine: chunkStartLine,
      endLine,
      text,
      startOffset: chunkStartOffset,
      endOffset: textOffset
    });
    chunkIndex += 1;
    chunkLines = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const heading = HEADING_RE.exec(line.trim());
    if (heading) {
      flush(index);
      const level = heading[1]!.length;
      const title = heading[2]!.trim();
      headingStack = headingStack.filter((item) => item.level < level);
      headingStack.push({ level, title });
      chunkStartLine = index + 1;
      chunkStartOffset = textOffset;
      chunkLines = [line];
    } else {
      if (!chunkLines.length) {
        chunkStartLine = index + 1;
        chunkStartOffset = textOffset;
      }
      chunkLines.push(line);
    }
    textOffset += line.length + 1;
  }
  flush(lines.length);
  if (!slices.length) {
    slices.push({
      chunkIndex: 0,
      headingPath: [],
      startLine: 1,
      endLine: Math.max(1, lines.length),
      text: normalized,
      startOffset: 0,
      endOffset: normalized.length
    });
  }
  return slices;
}

export function resolveNearestProjectedAnchor(
  rect: DocumentRect,
  viewport: DocumentViewport,
  anchors: DocumentAnchor[],
  filter?: (anchor: DocumentAnchor) => boolean
): DocumentAnchor | null {
  const candidates = filter ? anchors.filter(filter) : anchors;
  let best: { anchor: DocumentAnchor; area: number } | null = null;
  for (const anchor of candidates) {
    if (!anchor.rect || !anchor.transform) continue;
    try {
      const projected = projectDocumentRect(anchor.rect, anchor.transform, viewport);
      const area = rectOverlapArea(rect, projected);
      if (!best || area > best.area) best = { anchor, area };
    } catch {
      continue;
    }
  }
  return best && best.area > 0 ? best.anchor : null;
}

export function resolveNearestChunkAnchor(
  rect: DocumentRect,
  viewport: DocumentViewport,
  anchors: DocumentAnchor[],
  options?: { page?: number; format?: DocumentAnchor["format"]; requireChunk?: boolean }
): DocumentAnchor | null {
  const filtered = anchors.filter((anchor) => {
    if (options?.format && anchor.format !== options.format) return false;
    if (options?.requireChunk && !anchor.chunk) return false;
    if (options?.page != null && "page" in anchor && typeof anchor.page === "number") {
      return anchor.page === options.page;
    }
    return true;
  });
  const chunkHit = resolveNearestProjectedAnchor(rect, viewport, filtered, (anchor) => Boolean(anchor.chunk));
  if (chunkHit) return chunkHit;
  return resolveNearestProjectedAnchor(rect, viewport, filtered);
}
