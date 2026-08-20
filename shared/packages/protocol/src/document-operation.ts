export type DocumentOperation =
  | { format: "txt" | "markdown"; kind: "replace-text"; start: number; end: number; replacement: string }
  | { format: "docx"; kind: "replace-paragraph-text"; paragraphIndex: number; start: number; end: number; replacement: string }
  | { format: "xlsx"; kind: "replace-cell"; sheet: string; cell: string; value: string | number | boolean | null }
  | { format: "pptx"; kind: "replace-shape-text"; slide: number; shapeId: string; start: number; end: number; replacement: string }
  | { format: "pdf"; kind: "add-annotation"; page: number; rect: { x: number; y: number; width: number; height: number }; text: string };
export function validateDocumentOperation(value: unknown): asserts value is DocumentOperation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("document operation must be an object");
  const input = value as Record<string, unknown>; if (!["txt", "markdown", "docx", "xlsx", "pptx", "pdf"].includes(String(input.format))) throw new TypeError("document operation format is invalid");
  if (typeof input.kind !== "string" || !input.kind.trim()) throw new TypeError("document operation kind is invalid");
  if (input.format === "docx" && (input.kind !== "replace-paragraph-text" || !Number.isInteger(input.paragraphIndex) || Number(input.paragraphIndex) < 0)) throw new TypeError("docx operation is invalid");
  if (input.format === "xlsx" && (input.kind !== "replace-cell" || typeof input.sheet !== "string" || typeof input.cell !== "string")) throw new TypeError("xlsx operation is invalid");
  if (input.format === "pptx" && (input.kind !== "replace-shape-text" || !Number.isInteger(input.slide) || typeof input.shapeId !== "string")) throw new TypeError("pptx operation is invalid");
  if (input.format === "pdf" && (input.kind !== "add-annotation" || !Number.isInteger(input.page) || Number(input.page) < 1)) throw new TypeError("pdf operation is invalid");
}
