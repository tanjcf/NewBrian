import type { BrainAnnotationDto } from "@codex-forge/protocol";
import type { DocumentFormat, TextDocumentAnchor } from "@codex-forge/protocol/document-anchor";

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

export function buildAnnotationChatReference(annotation: BrainAnnotationDto) {
  return [
    `[文档标注 ${annotation.id}]`,
    `文件版本：${annotation.fileVersion}`,
    `位置：${annotation.anchor.anchorId}`,
    annotation.selectedText ? `选中内容：${annotation.selectedText}` : "",
    `修改要求：${annotation.instruction}`
  ].filter(Boolean).join("\n");
}
