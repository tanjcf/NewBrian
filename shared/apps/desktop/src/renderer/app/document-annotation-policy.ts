import type { BrainAnnotationDto } from "@codex-forge/protocol";
import type { DocumentAnchor, DocumentFormat, DocumentRect, DocumentViewport, DocxDocumentAnchor, PdfDocumentAnchor, PptxDocumentAnchor, TextDocumentAnchor, XlsxDocumentAnchor } from "@codex-forge/protocol/document-anchor";
import { unprojectDocumentRect } from "@codex-forge/protocol/document-anchor";
import { rectOverlapArea, resolveNearestChunkAnchor, resolveNearestProjectedAnchor } from "@codex-forge/protocol/document-chunk";
import { annotationPageNumber, buildMarkingAnchor, linesFromPreviewRect } from "@codex-forge/protocol/document-marking";

const PPTX_SLIDE_BASIS = { width: 12_192_000, height: 6_858_000 };
export const MIN_DOCUMENT_MARK_SIZE = 6;
const CHUNK_ANCHOR_FORMATS = new Set<DocumentFormat>(["pdf", "docx", "pptx", "markdown", "txt", "xlsx"]);

function isPptxSlideChunkAnchor(anchor: DocumentAnchor) {
  if (anchor.format !== "pptx") return false;
  if (anchor.chunk) return true;
  if (anchor.locator.kind !== "pptx-shape") return false;
  return /^slide-chunk-/i.test(String(anchor.locator.shapeId || ""));
}

function isPptxEditableShapeAnchor(anchor: DocumentAnchor): anchor is PptxDocumentAnchor {
  if (anchor.format !== "pptx" || isPptxSlideChunkAnchor(anchor)) return false;
  if (anchor.locator.kind !== "pptx-shape") return false;
  const shapeId = String(anchor.locator.shapeId || "").trim();
  if (!shapeId || /^mark-/i.test(shapeId) || /^slide-chunk-/i.test(shapeId)) return false;
  return Boolean(anchor.rect && anchor.rect.width > 0 && anchor.rect.height > 0 && anchor.transform);
}

export function documentAnchorsNeedChunkRefresh(format: DocumentFormat | string | undefined, anchors: DocumentAnchor[]): boolean {
  if (!format || !CHUNK_ANCHOR_FORMATS.has(format as DocumentFormat)) return false;
  if (!anchors.length) return true;
  return !anchors.some((anchor) => Boolean(anchor.chunk));
}

/** Preserve structural chunk identity while storing the user's drag rect for preview overlays. */
export function attachMarkOverlay(
  anchor: DocumentAnchor,
  input: { rect: DocumentRect; viewport: DocumentViewport; transform: DocumentAnchor["transform"] }
): DocumentAnchor {
  if (!input.transform) return anchor;
  const documentRect = unprojectDocumentRect(input.rect, input.transform, input.viewport);
  return { ...anchor, rect: documentRect, transform: input.transform };
}

export function isValidDocumentMarkRect(rect: DocumentRect, viewport: DocumentViewport) {
  return rect.width >= MIN_DOCUMENT_MARK_SIZE
    && rect.height >= MIN_DOCUMENT_MARK_SIZE
    && viewport.width > 0
    && viewport.height > 0;
}

export type PendingDocumentMark = {
  rect: DocumentRect;
  tool: "highlight" | "select-rect";
  color: string;
};

/** Bind ingested paragraph anchors to rendered DOCX preview nodes (internal, not shown in UI). */
export function bindDocxPreviewParagraphs(host: HTMLElement, anchors: DocumentAnchor[]) {
  const docxAnchors = anchors.filter((anchor) => anchor.format === "docx"
    && anchor.locator.kind === "docx-object"
    && anchor.locator.objectType === "paragraph"
    && !anchor.chunk);
  const paragraphs = host.querySelectorAll("p");
  paragraphs.forEach((element, index) => {
    const anchor = docxAnchors[index];
    if (!anchor) return;
    element.setAttribute("data-object-id", anchor.objectId);
    element.setAttribute("data-anchor-id", anchor.anchorId);
  });
  const chunkAnchors = anchors.filter((anchor) => anchor.format === "docx" && anchor.chunk);
  for (const chunk of chunkAnchors) {
    if (chunk.locator.kind !== "docx-object" || chunk.locator.paragraphIndex === undefined) continue;
    const start = chunk.locator.paragraphIndex;
    const end = chunk.chunk?.endParagraphIndex ?? start;
    for (let index = start; index <= end; index += 1) {
      const element = paragraphs[index];
      if (!element) continue;
      element.setAttribute("data-chunk-id", chunk.objectId);
      element.setAttribute("data-chunk-anchor-id", chunk.anchorId);
    }
  }
}

/** Build a preview-space free-form DOCX mark anchor when structural resolution misses. */
export function buildDocxMarkingAnchor(input: { rect: DocumentRect; viewport: DocumentViewport; markId?: string }): DocxDocumentAnchor & {
  rect: DocumentRect;
  transform: { coordinateSpace: "pixels"; basisWidth: number; basisHeight: number; scale: number };
} {
  const transform = {
    coordinateSpace: "pixels" as const,
    basisWidth: input.viewport.width,
    basisHeight: input.viewport.height,
    scale: 1
  };
  const documentRect = unprojectDocumentRect(input.rect, transform, input.viewport);
  const markId = input.markId?.trim() || `mark-${Date.now()}`;
  return {
    anchorId: `docx:mark:${markId}`,
    objectId: `docx:mark:${markId}`,
    format: "docx",
    locator: { kind: "docx-object", objectType: "image", imageId: `mark-${markId}` },
    rect: documentRect,
    transform
  };
}

function resolveDocxStructuralAnchor(rect: DocumentRect, host: HTMLElement, anchors: DocumentAnchor[]): DocumentAnchor | null {
  const docxAnchors = anchors.filter((anchor) => anchor.format === "docx");
  if (!docxAnchors.length) return null;
  const hostBounds = host.getBoundingClientRect();
  const samplePoints = [
    { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
    { x: rect.x + 4, y: rect.y + 4 },
    { x: rect.x + Math.max(4, rect.width - 4), y: rect.y + Math.max(4, rect.height - 4) }
  ];
  for (const point of samplePoints) {
    const elements = document.elementsFromPoint(hostBounds.left + point.x, hostBounds.top + point.y);
    for (const element of elements) {
      const chunkMarked = element.closest("[data-chunk-id]");
      if (chunkMarked && host.contains(chunkMarked)) {
        const chunkId = chunkMarked.getAttribute("data-chunk-id");
        const chunkAnchor = docxAnchors.find((item) => item.objectId === chunkId && item.chunk);
        if (chunkAnchor) return chunkAnchor;
      }
      const marked = element.closest("[data-object-id]");
      if (!marked || !host.contains(marked)) continue;
      const objectId = marked.getAttribute("data-object-id");
      const anchor = docxAnchors.find((item) => item.objectId === objectId);
      if (anchor) return anchor;
    }
  }
  let best: { anchor: DocumentAnchor; area: number } | null = null;
  for (const anchor of docxAnchors) {
    const element = host.querySelector(`[data-chunk-id="${anchor.objectId}"], [data-object-id="${anchor.objectId}"]`);
    if (!element) continue;
    const bounds = element.getBoundingClientRect();
    const overlapX = Math.max(0, Math.min(hostBounds.left + rect.x + rect.width, bounds.right) - Math.max(hostBounds.left + rect.x, bounds.left));
    const overlapY = Math.max(0, Math.min(hostBounds.top + rect.y + rect.height, bounds.bottom) - Math.max(hostBounds.top + rect.y, bounds.top));
    const area = overlapX * overlapY;
    if (!best || area > best.area) best = { anchor, area };
  }
  return best && best.area > 0 ? best.anchor : null;
}

/** Resolve the nearest DOCX chunk/paragraph anchor, or create a free-form preview mark anchor. */
export function resolveDocxAnchorFromMark(
  rect: DocumentRect,
  host: HTMLElement | null,
  anchors: DocumentAnchor[],
  viewport: DocumentViewport
): DocumentAnchor {
  if (host) {
    const structural = resolveDocxStructuralAnchor(rect, host, anchors);
    if (structural) return structural;
  }
  return buildDocxMarkingAnchor({ rect, viewport });
}

/** Build a slide-space mark anchor for free-form PPTX selections. */
export function buildPptxMarkingAnchor(input: { rect: DocumentRect; viewport: DocumentViewport; slide: number; markId?: string }): PptxDocumentAnchor {
  const transform = {
    coordinateSpace: "slide-emu" as const,
    basisWidth: PPTX_SLIDE_BASIS.width,
    basisHeight: PPTX_SLIDE_BASIS.height,
    scale: 1
  };
  const documentRect = unprojectDocumentRect(input.rect, transform, input.viewport);
  const markId = input.markId?.trim() || `mark-${Date.now()}`;
  const slide = input.slide;
  return {
    anchorId: `pptx:mark:${slide}:${markId}`,
    objectId: `pptx:s:${slide}:mark:${markId}`,
    format: "pptx",
    page: slide,
    locator: { kind: "pptx-shape", slide, shapeId: `mark-${markId}`, zIndex: 9999 },
    rect: documentRect,
    transform
  };
}

/** Resolve the nearest ingested PPTX shape/chunk anchor, or create a free-form mark anchor. */
export function resolvePptxAnchorFromMark(rect: DocumentRect, viewport: DocumentViewport, slide: number, anchors: DocumentAnchor[]): PptxDocumentAnchor {
  const pageAnchors = anchors.filter((anchor) =>
    anchor.format === "pptx"
    && ("page" in anchor ? Number(anchor.page) === slide : true)
  );
  // Prefer real editable shapes over full-slide chunks so revision can rewrite OOXML text.
  const shapeHit = resolveNearestProjectedAnchor(rect, viewport, pageAnchors, isPptxEditableShapeAnchor);
  if (shapeHit && shapeHit.format === "pptx") return shapeHit as PptxDocumentAnchor;
  const chunkHit = resolveNearestProjectedAnchor(rect, viewport, pageAnchors, isPptxSlideChunkAnchor);
  if (chunkHit && chunkHit.format === "pptx") return chunkHit as PptxDocumentAnchor;
  return buildPptxMarkingAnchor({ rect, viewport, slide });
}

/** Resolve the nearest ingested PDF chunk anchor, or create a free-form mark anchor. */
export function resolvePdfAnchorFromMark(
  rect: DocumentRect,
  viewport: DocumentViewport,
  page: number,
  anchors: DocumentAnchor[],
  transform: { coordinateSpace: "pdf-points"; basisWidth: number; basisHeight: number; scale: number }
): PdfDocumentAnchor {
  const structural = resolveNearestChunkAnchor(rect, viewport, anchors, { page, format: "pdf" });
  if (structural && structural.format === "pdf") return structural as PdfDocumentAnchor;
  return buildMarkingAnchor({ format: "pdf", rect, viewport, transform, page }) as PdfDocumentAnchor;
}

/** Resolve the nearest markdown section chunk or line anchor from a preview rect. */
export function resolveMarkdownAnchorFromMark(
  rect: DocumentRect,
  viewport: DocumentViewport,
  anchors: DocumentAnchor[],
  lines: string[]
): TextDocumentAnchor {
  const lineHeight = viewport.height / Math.max(lines.length, 1);
  const lineRange = linesFromPreviewRect({ rect, lineHeight, totalLines: lines.length });
  const chunkAnchors = anchors.filter((anchor) => anchor.format === "markdown" && anchor.chunk);
  let bestChunk: { anchor: DocumentAnchor; area: number } | null = null;
  for (const anchor of chunkAnchors) {
    if (anchor.locator.kind !== "text-range") continue;
    const projected = {
      x: 0,
      y: (anchor.locator.startLine - 1) * lineHeight,
      width: viewport.width,
      height: Math.max(lineHeight, (anchor.locator.endLine - anchor.locator.startLine + 1) * lineHeight)
    };
    const area = rectOverlapArea(rect, projected);
    if (!bestChunk || area > bestChunk.area) bestChunk = { anchor, area };
  }
  if (bestChunk && bestChunk.area > 0 && bestChunk.anchor.format === "markdown") {
    return bestChunk.anchor as TextDocumentAnchor;
  }
  const selectedText = lines.slice(lineRange.startLine - 1, lineRange.endLine).join("\n");
  return buildMarkingAnchor({
    format: "markdown",
    rect,
    viewport,
    transform: { coordinateSpace: "pixels", basisWidth: viewport.width, basisHeight: viewport.height, scale: 1 },
    lineRange: { ...lineRange, selectedText }
  }) as TextDocumentAnchor;
}

/** Resolve the nearest TXT paragraph chunk or line anchor from a preview rect. */
export function resolveTxtAnchorFromMark(
  rect: DocumentRect,
  viewport: DocumentViewport,
  anchors: DocumentAnchor[],
  lines: string[]
): TextDocumentAnchor {
  const lineHeight = viewport.height / Math.max(lines.length, 1);
  const lineRange = linesFromPreviewRect({ rect, lineHeight, totalLines: lines.length });
  const chunkAnchors = anchors.filter((anchor) => anchor.format === "txt" && anchor.chunk);
  let bestChunk: { anchor: DocumentAnchor; area: number } | null = null;
  for (const anchor of chunkAnchors) {
    if (anchor.locator.kind !== "text-range") continue;
    const projected = {
      x: 0,
      y: (anchor.locator.startLine - 1) * lineHeight,
      width: viewport.width,
      height: Math.max(lineHeight, (anchor.locator.endLine - anchor.locator.startLine + 1) * lineHeight)
    };
    const area = rectOverlapArea(rect, projected);
    if (!bestChunk || area > bestChunk.area) bestChunk = { anchor, area };
  }
  if (bestChunk && bestChunk.area > 0 && bestChunk.anchor.format === "txt") {
    return bestChunk.anchor as TextDocumentAnchor;
  }
  const selectedText = lines.slice(lineRange.startLine - 1, lineRange.endLine).join("\n");
  return buildMarkingAnchor({
    format: "txt",
    rect,
    viewport,
    transform: { coordinateSpace: "pixels", basisWidth: viewport.width, basisHeight: viewport.height, scale: 1 },
    lineRange: { ...lineRange, selectedText }
  }) as TextDocumentAnchor;
}

/** Build a sheet-grid mark anchor for free-form spreadsheet selections. */
export function buildXlsxMarkingAnchor(input: {
  rect: DocumentRect;
  viewport: DocumentViewport;
  sheet: string;
  columnCount: number;
  rowCount: number;
  markId?: string;
}): XlsxDocumentAnchor {
  const transform = {
    coordinateSpace: "sheet-grid" as const,
    basisWidth: Math.max(input.columnCount, 26),
    basisHeight: Math.max(input.rowCount, 50),
    scale: 1
  };
  const documentRect = unprojectDocumentRect(input.rect, transform, input.viewport);
  const markId = input.markId?.trim() || `mark-${Date.now()}`;
  const startCol = Math.max(0, Math.floor(documentRect.x));
  const startRow = Math.max(1, Math.floor(documentRect.y) + 1);
  const endCol = Math.max(startCol, Math.ceil(documentRect.x + documentRect.width) - 1);
  const endRow = Math.max(startRow, Math.ceil(documentRect.y + documentRect.height));
  const colLetters = (index: number) => {
    let value = index;
    let letters = "";
    while (value >= 0) {
      letters = String.fromCharCode(65 + (value % 26)) + letters;
      value = Math.floor(value / 26) - 1;
    }
    return letters || "A";
  };
  const range = `${colLetters(startCol)}${startRow}:${colLetters(endCol)}${endRow}`;
  return {
    anchorId: `xlsx:mark:${input.sheet}:${markId}`,
    objectId: `xlsx:${input.sheet}:mark:${markId}`,
    format: "xlsx",
    sheet: input.sheet,
    range,
    locator: { kind: "xlsx-range", sheet: input.sheet, range },
    rect: documentRect,
    transform
  };
}

/** Resolve the nearest ingested spreadsheet chunk anchor, or create a free-form mark anchor. */
export function resolveXlsxAnchorFromMark(
  rect: DocumentRect,
  viewport: DocumentViewport,
  sheet: string,
  anchors: DocumentAnchor[],
  grid: { columnCount: number; rowCount: number }
): XlsxDocumentAnchor {
  const sheetAnchors = anchors.filter((anchor) => anchor.format === "xlsx" && anchor.sheet === sheet && anchor.rect && anchor.transform);
  const structural = resolveNearestChunkAnchor(rect, viewport, sheetAnchors, { format: "xlsx" });
  if (structural && structural.format === "xlsx") return structural as XlsxDocumentAnchor;
  return buildXlsxMarkingAnchor({ rect, viewport, sheet, columnCount: grid.columnCount, rowCount: grid.rowCount });
}

export function createTextLineAnchor(
  format: Extract<DocumentFormat, "txt" | "markdown">,
  lineNumber: number,
  text: string
): TextDocumentAnchor {
  if (!Number.isSafeInteger(lineNumber) || lineNumber < 1) throw new RangeError("lineNumber must be positive");
  const objectId = `${format}:line:${lineNumber}`;
  return {
    anchorId: objectId,
    objectId,
    format,
    locator: {
      kind: "text-range",
      startLine: lineNumber,
      endLine: lineNumber,
      startCharacter: 0,
      endCharacter: text.length
    },
    selectedText: text
  };
}

export function currentDocumentAnnotations(annotations: BrainAnnotationDto[]) {
  const superseded = new Set(annotations.map((item) => item.supersedesAnnotationId).filter(Boolean));
  return annotations.filter((item) => !superseded.has(item.id));
}

export function formatAnnotationLocation(annotation: BrainAnnotationDto): string {
  const markLabel = annotation.geometry?.displayIndex
    ? `标记 ${annotation.geometry.displayIndex}`
    : null;
  const heading = annotation.anchor.chunk?.headingPath?.filter(Boolean).join(" › ");
  const headingLabel = heading ? `章节「${heading}」` : null;
  if (annotation.anchor.format === "xlsx") {
    const sheet = "sheet" in annotation.anchor ? annotation.anchor.sheet : annotation.pageOrSheet;
    return [sheet ? `工作表 ${sheet}` : null, markLabel, headingLabel].filter(Boolean).join(" · ")
      || annotation.anchor.anchorId;
  }
  if (annotation.anchor.format === "pptx") {
    const page = annotationPageNumber(annotation.anchor) ?? 1;
    const shapeId = annotation.anchor.locator.kind === "pptx-shape"
      ? String(annotation.anchor.locator.shapeId || "").trim()
      : "";
    const shapeLabel = shapeId && !/^mark-/i.test(shapeId) && !/^slide-chunk-/i.test(shapeId)
      ? `形状 ${shapeId}`
      : null;
    const selected = annotation.selectedText?.trim() || annotation.anchor.selectedText?.trim() || "";
    const textLabel = selected ? `「${selected.slice(0, 48)}${selected.length > 48 ? "…" : ""}」` : null;
    return [`第 ${page} 页幻灯片`, shapeLabel, markLabel, headingLabel, textLabel].filter(Boolean).join(" · ")
      || annotation.anchor.anchorId;
  }
  const page = annotationPageNumber(annotation.anchor);
  const pageLabel = page ? `第 ${page} 页` : null;
  return [pageLabel, markLabel, headingLabel].filter(Boolean).join(" · ")
    || annotation.anchor.anchorId;
}

export function buildAnnotationChatReference(
  annotation: BrainAnnotationDto,
  options?: { fileName?: string; hasSnapshot?: boolean }
) {
  const location = formatAnnotationLocation(annotation);
  const selectedText = annotation.selectedText?.trim() || annotation.anchor.selectedText?.trim() || "";
  const instruction = annotation.instruction?.trim() || "";
  const hasSnapshot = options?.hasSnapshot
    ?? Boolean(annotation.geometry?.snapshotPath || annotation.geometry?.snapshotUrl);
  const fileLine = options?.fileName?.trim()
    ? `【文件】${options.fileName.trim()} · 版本 ${annotation.fileVersion}`
    : `【文件版本】${annotation.fileVersion}`;
  return [
    hasSnapshot
      ? "请针对以下标记区域（见附图），按修改要求处理对应内容："
      : "请针对以下文档标记位置，按修改要求处理对应内容：",
    "",
    `【标记位置】${location}`,
    fileLine,
    `【锚点】${annotation.anchor.objectId || annotation.anchor.anchorId}`,
    "【选中内容】",
    selectedText || "（标记区域，未提取到文本）",
    "【修改要求】",
    instruction || "（未填写，请先补充修改要求）",
    "",
    `（标注 ID：${annotation.id}）`
  ].join("\n");
}

export { annotationPageNumber, buildMarkingAnchor, linesFromPreviewRect };
