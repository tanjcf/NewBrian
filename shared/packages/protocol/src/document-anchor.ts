export type DocumentFormat = "image" | "pdf" | "docx" | "pptx" | "xlsx" | "txt" | "markdown";

export interface DocumentAnchor {
  format: DocumentFormat;
  locator: Record<string, string | number>;
  selectedText?: string;
  rect?: { x: number; y: number; width: number; height: number };
  page?: number;
  sheet?: string;
  range?: string;
}

export interface DocumentAnnotation {
  id: string;
  fileId: string;
  anchor: DocumentAnchor;
  instruction: string;
  status: "OPEN" | "APPLIED" | "DISMISSED";
  createdAt: string;
}

export function validateDocumentAnchor(anchor: DocumentAnchor): void {
  if (!anchor || typeof anchor !== "object") throw new TypeError("anchor is required");
  if (!anchor.format) throw new TypeError("anchor.format is required");
  if (!anchor.locator || typeof anchor.locator !== "object") throw new TypeError("anchor.locator is required");
  if (anchor.rect && (anchor.rect.width < 0 || anchor.rect.height < 0)) throw new RangeError("anchor rect cannot be negative");
  if (anchor.page !== undefined && (!Number.isInteger(anchor.page) || anchor.page < 1)) throw new RangeError("page must be a positive integer");
}
