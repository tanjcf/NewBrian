export type DocumentFormat = "image" | "pdf" | "docx" | "pptx" | "xlsx" | "txt" | "markdown";

export interface DocumentRect { x: number; y: number; width: number; height: number; }
export interface DocumentTextRange { start: number; end: number; }
export interface DocumentCoordinateTransform {
  coordinateSpace: "pixels" | "pdf-points" | "slide-emu" | "sheet-grid";
  basisWidth: number;
  basisHeight: number;
  scale: number;
}

interface DocumentAnchorBase<TFormat extends DocumentFormat, TLocator> {
  anchorId: string;
  objectId: string;
  format: TFormat;
  locator: TLocator;
  selectedText?: string;
  rect?: DocumentRect;
  transform?: DocumentCoordinateTransform;
}

export type ImageDocumentAnchor = DocumentAnchorBase<"image", { kind: "image-region"; regionIndex: number; }> & {
  rect: DocumentRect;
  transform: DocumentCoordinateTransform & { coordinateSpace: "pixels" };
};
export type PdfDocumentAnchor = DocumentAnchorBase<"pdf", { kind: "pdf-text" | "pdf-ocr"; page: number; textRange?: DocumentTextRange; ocrBlockId?: string; }> & {
  page: number;
  rect: DocumentRect;
  transform: DocumentCoordinateTransform & { coordinateSpace: "pdf-points" };
};
export type DocxDocumentAnchor = DocumentAnchorBase<"docx", {
  kind: "docx-object";
  objectType: "paragraph" | "table-cell" | "image";
  paragraphIndex?: number;
  tableIndex?: number;
  rowIndex?: number;
  cellIndex?: number;
  imageId?: string;
  textRange?: DocumentTextRange;
}>;
export type PptxDocumentAnchor = DocumentAnchorBase<"pptx", { kind: "pptx-shape"; slide: number; shapeId: string; zIndex: number; textRange?: DocumentTextRange; }> & {
  page: number;
  rect: DocumentRect;
  transform: DocumentCoordinateTransform & { coordinateSpace: "slide-emu" };
};
export type XlsxDocumentAnchor = DocumentAnchorBase<"xlsx", { kind: "xlsx-range" | "xlsx-chart"; sheet: string; range: string; formula?: string; chartId?: string; }> & {
  sheet: string;
  range: string;
};
export type TextDocumentAnchor = DocumentAnchorBase<"txt" | "markdown", { kind: "text-range"; startLine: number; endLine: number; startCharacter: number; endCharacter: number; }>;

export type DocumentAnchor = ImageDocumentAnchor | PdfDocumentAnchor | DocxDocumentAnchor | PptxDocumentAnchor | XlsxDocumentAnchor | TextDocumentAnchor;

export interface DocumentAnnotation {
  id: string;
  fileId: string;
  fileVersion: number;
  anchor: DocumentAnchor;
  instruction: string;
  status: "OPEN" | "APPLIED" | "DISMISSED";
  createdAt: string;
}

export function validateDocumentAnchor(anchor: DocumentAnchor): void {
  if (!anchor || typeof anchor !== "object") throw new TypeError("anchor is required");
  if (!anchor.anchorId?.trim()) throw new TypeError("anchor.anchorId is required");
  if (!anchor.objectId?.trim()) throw new TypeError("anchor.objectId is required");
  if (!anchor.locator || typeof anchor.locator !== "object") throw new TypeError("anchor.locator is required");
  validateRect(anchor.rect);
  validateTransform(anchor.transform);
  switch (anchor.format) {
    case "image":
      if (anchor.locator.kind !== "image-region" || !anchor.rect || anchor.transform?.coordinateSpace !== "pixels") invalid();
      break;
    case "pdf":
      if (!Number.isInteger(anchor.page) || anchor.page < 1 || anchor.locator.page !== anchor.page || !anchor.rect || anchor.transform?.coordinateSpace !== "pdf-points") invalid();
      validateTextRange(anchor.locator.textRange);
      break;
    case "docx":
      if (anchor.locator.kind !== "docx-object") invalid();
      validateTextRange(anchor.locator.textRange);
      break;
    case "pptx":
      if (!Number.isInteger(anchor.page) || anchor.page < 1 || anchor.locator.slide !== anchor.page || !anchor.locator.shapeId || !anchor.rect || anchor.transform?.coordinateSpace !== "slide-emu") invalid();
      validateTextRange(anchor.locator.textRange);
      break;
    case "xlsx":
      if (!anchor.sheet?.trim() || !anchor.range?.trim() || anchor.locator.sheet !== anchor.sheet || anchor.locator.range !== anchor.range) invalid();
      break;
    case "txt":
    case "markdown":
      if (anchor.locator.kind !== "text-range" || anchor.locator.startLine < 1 || anchor.locator.endLine < anchor.locator.startLine) invalid();
      break;
    default:
      invalid();
  }
}

function validateRect(rect: DocumentRect | undefined) {
  if (!rect) return;
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) throw new RangeError("anchor rect must be finite");
  if (rect.x < 0 || rect.y < 0 || rect.width < 0 || rect.height < 0) throw new RangeError("anchor rect cannot be negative");
}
function validateTransform(transform: DocumentCoordinateTransform | undefined) {
  if (transform && (!(transform.basisWidth > 0) || !(transform.basisHeight > 0) || !(transform.scale > 0))) throw new RangeError("anchor transform basis and scale must be positive");
}
function validateTextRange(range: DocumentTextRange | undefined) {
  if (range && (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end < range.start)) throw new RangeError("anchor text range is invalid");
}
function invalid(): never { throw new TypeError("anchor locator does not match its document format"); }
