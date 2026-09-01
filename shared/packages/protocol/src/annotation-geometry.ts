export type AnnotationMarkingTool = "highlight" | "select-rect";

export const ANNOTATION_MARKING_COLORS = [
  "#FFEB3B",
  "#FF9800",
  "#4CAF50",
  "#2196F3",
  "#E91E63",
  "#9C27B0"
] as const;

export type AnnotationMarkingColor = (typeof ANNOTATION_MARKING_COLORS)[number];

export interface AnnotationGeometryStyle {
  tool: AnnotationMarkingTool;
  color: string;
}

export interface AnnotationGeometry {
  style: AnnotationGeometryStyle;
  displayIndex: number;
  /** Workspace-relative or managed attachment path for the marked-region PNG. */
  snapshotPath?: string;
  /** Preview URL (data URL or managed attachment URL) for UI thumbnails. */
  snapshotUrl?: string;
}

export const DEFAULT_ANNOTATION_GEOMETRY: AnnotationGeometry = {
  style: { tool: "select-rect", color: ANNOTATION_MARKING_COLORS[0] },
  displayIndex: 0
};

export function normalizeAnnotationGeometry(value: unknown): AnnotationGeometry {
  if (!value || typeof value !== "object") return { ...DEFAULT_ANNOTATION_GEOMETRY };
  const record = value as Record<string, unknown>;
  const styleRecord = record.style && typeof record.style === "object"
    ? record.style as Record<string, unknown>
    : {};
  const tool = styleRecord.tool === "highlight" ? "highlight" : "select-rect";
  const color = typeof styleRecord.color === "string" && styleRecord.color.trim()
    ? styleRecord.color.trim()
    : DEFAULT_ANNOTATION_GEOMETRY.style.color;
  const displayIndex = Number.isInteger(record.displayIndex) && Number(record.displayIndex) > 0
    ? Number(record.displayIndex)
    : DEFAULT_ANNOTATION_GEOMETRY.displayIndex;
  const snapshotPath = typeof record.snapshotPath === "string" && record.snapshotPath.trim()
    ? record.snapshotPath.trim()
    : undefined;
  const snapshotUrl = typeof record.snapshotUrl === "string" && record.snapshotUrl.trim()
    ? record.snapshotUrl.trim()
    : undefined;
  return {
    style: { tool, color },
    displayIndex,
    ...(snapshotPath ? { snapshotPath } : {}),
    ...(snapshotUrl ? { snapshotUrl } : {})
  };
}

export function linesFromPreviewRect(input: {
  rect: { x: number; y: number; width: number; height: number };
  lineHeight: number;
  totalLines: number;
}) {
  if (!(input.lineHeight > 0) || input.totalLines < 1) return { startLine: 1, endLine: 1 };
  const startLine = Math.min(input.totalLines, Math.max(1, Math.floor(input.rect.y / input.lineHeight) + 1));
  const endLine = Math.min(input.totalLines, Math.max(startLine, Math.ceil((input.rect.y + input.rect.height) / input.lineHeight)));
  return { startLine, endLine };
}

export function validateAnnotationGeometry(geometry: AnnotationGeometry): void {
  if (geometry.style.tool !== "highlight" && geometry.style.tool !== "select-rect") {
    throw new TypeError("annotation geometry tool is invalid");
  }
  if (!geometry.style.color.trim()) throw new TypeError("annotation geometry color is required");
  if (!Number.isInteger(geometry.displayIndex) || geometry.displayIndex < 1) {
    throw new RangeError("annotation geometry displayIndex must be positive");
  }
}
