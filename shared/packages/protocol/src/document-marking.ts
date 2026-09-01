import type { AnnotationGeometry } from "./annotation-geometry.js";
import type {
  DocumentAnchor,
  DocumentCoordinateTransform,
  DocumentFormat,
  DocumentRect,
  DocumentViewport,
  ImageDocumentAnchor,
  PdfDocumentAnchor,
  TextDocumentAnchor
} from "./document-anchor.js";
import { unprojectDocumentRect } from "./document-anchor.js";

export { linesFromPreviewRect } from "./annotation-geometry.js";

export type MarkingRectInput = {
  rect: DocumentRect;
  viewport: DocumentViewport;
  transform: DocumentCoordinateTransform;
  page?: number;
  format: Extract<DocumentFormat, "pdf" | "image" | "txt" | "markdown">;
  lineRange?: { startLine: number; endLine: number; selectedText?: string };
  markId?: string;
};

export function annotationPageNumber(anchor: DocumentAnchor): number | null {
  if ("page" in anchor && Number.isInteger(anchor.page) && anchor.page > 0) return anchor.page;
  if (anchor.format === "txt" || anchor.format === "markdown") return 1;
  return null;
}

export function buildMarkingAnchor(input: MarkingRectInput): DocumentAnchor {
  const documentRect = unprojectDocumentRect(input.rect, input.transform, input.viewport);
  const markId = input.markId?.trim() || `mark-${Date.now()}`;
  if (input.format === "pdf") {
    const page = input.page;
    if (typeof page !== "number" || !Number.isInteger(page) || page < 1) throw new RangeError("pdf marking requires a positive page");
    const anchor: PdfDocumentAnchor = {
      anchorId: `pdf:mark:${page}:${markId}`,
      objectId: `pdf:page:${page}:mark:${markId}`,
      format: "pdf",
      page,
      locator: { kind: "pdf-ocr", page, ocrBlockId: `mark-${markId}` },
      rect: documentRect,
      transform: {
        coordinateSpace: "pdf-points",
        basisWidth: input.transform.basisWidth,
        basisHeight: input.transform.basisHeight,
        scale: input.transform.scale
      }
    };
    return anchor;
  }
  if (input.format === "image") {
    const anchor: ImageDocumentAnchor = {
      anchorId: `image:mark:${markId}`,
      objectId: `image:region:mark:${markId}`,
      format: "image",
      locator: { kind: "image-region", regionIndex: 1 },
      rect: documentRect,
      transform: {
        coordinateSpace: "pixels",
        basisWidth: input.transform.basisWidth,
        basisHeight: input.transform.basisHeight,
        scale: input.transform.scale
      }
    };
    return anchor;
  }
  if (!input.lineRange) throw new RangeError("text marking requires a line range");
  const { startLine, endLine, selectedText = "" } = input.lineRange;
  const format = input.format;
  const anchor: TextDocumentAnchor = {
    anchorId: `${format}:mark:${startLine}-${endLine}:${markId}`,
    objectId: `${format}:line:${startLine}`,
    format,
    locator: {
      kind: "text-range",
      startLine,
      endLine,
      startCharacter: 0,
      endCharacter: selectedText.length
    },
    selectedText
  };
  return anchor;
}

export function resolveNearestStructuralAnchor(
  anchor: DocumentAnchor,
  ingestedAnchors: DocumentAnchor[]
): DocumentAnchor | null {
  if (!ingestedAnchors.length) return null;
  const sameFormat = ingestedAnchors.filter((item) => item.format === anchor.format);
  if (!sameFormat.length) return null;
  const chunkCandidates = sameFormat.filter((item) => item.chunk);
  if (anchor.format === "txt" || anchor.format === "markdown") {
    const startLine = anchor.locator.kind === "text-range" ? anchor.locator.startLine : 1;
    const chunkHit = chunkCandidates.find((item) => item.locator.kind === "text-range"
      && item.locator.startLine <= startLine
      && item.locator.endLine >= startLine);
    if (chunkHit) return chunkHit;
    return sameFormat.find((item) => item.locator.kind === "text-range" && item.locator.startLine === startLine)
      || sameFormat.find((item) => item.locator.kind === "text-range" && item.locator.startLine <= startLine && item.locator.endLine >= startLine)
      || sameFormat[0]
      || null;
  }
  if ("page" in anchor && typeof anchor.page === "number") {
    const pageChunks = chunkCandidates.filter((item) => "page" in item && item.page === anchor.page);
    if (pageChunks.length === 1) return pageChunks[0]!;
    return pageChunks[0] || sameFormat.find((item) => "page" in item && item.page === anchor.page) || sameFormat[0] || null;
  }
  return chunkCandidates[0] || sameFormat[0] || null;
}

export function annotationHumanReference(input: {
  anchor: DocumentAnchor;
  geometry?: AnnotationGeometry;
  fallbackIndex?: number;
}) {
  const page = annotationPageNumber(input.anchor) ?? 1;
  const markIndex = input.geometry?.displayIndex || input.fallbackIndex || 1;
  return `�?${page} �?· 标记 ${markIndex}`;
}
