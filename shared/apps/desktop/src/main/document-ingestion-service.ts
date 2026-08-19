import type { DocumentAnchor, DocumentFormat } from "../../../packages/protocol/src/document-anchor.ts";

export interface DocumentIngestionResult {
  format: DocumentFormat;
  text: string;
  anchors: DocumentAnchor[];
  warnings: string[];
}

const formatByName = (name: string): DocumentFormat | undefined => {
  const extension = name.toLowerCase().split(".").pop();
  return extension === "md" || extension === "markdown" ? "markdown" : extension === "txt" ? "txt" : undefined;
};

export class DocumentIngestionService {
  ingestText(name: string, content: string): DocumentIngestionResult {
    const format = formatByName(name);
    if (!format) throw new TypeError("only TXT and Markdown are supported by the local text reader");
    const lines = content.replaceAll("\r\n", "\n").split("\n");
    const anchors = lines.map((line, index) => ({ format, locator: { line: index + 1 }, selectedText: line }));
    return { format, text: lines.join("\n"), anchors, warnings: [] };
  }
}
