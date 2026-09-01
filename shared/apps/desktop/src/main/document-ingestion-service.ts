import type { DocumentAnchor, DocumentFormat } from "../../../packages/protocol/src/document-anchor.ts";
import { sliceMarkdownSections } from "../../../packages/protocol/src/document-chunk.ts";
import type { DocumentWorkerClient, DocumentWorkerIngestInput } from "./document-worker-client.ts";

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

function textLineAnchors(format: Extract<DocumentFormat, "txt" | "markdown">, lines: string[]): DocumentAnchor[] {
  return lines.map((line, index) => ({
    anchorId: `${format}:line:${index + 1}`,
    objectId: `${format}:line:${index + 1}`,
    format,
    locator: {
      kind: "text-range" as const,
      startLine: index + 1,
      endLine: index + 1,
      startCharacter: 0,
      endCharacter: line.length
    },
    selectedText: line
  }));
}

function markdownChunkAnchors(content: string): DocumentAnchor[] {
  return sliceMarkdownSections(content).map((slice) => ({
    anchorId: `markdown:chunk:${slice.chunkIndex}`,
    objectId: `markdown:chunk:${slice.chunkIndex}`,
    format: "markdown" as const,
    locator: {
      kind: "text-range" as const,
      startLine: slice.startLine,
      endLine: slice.endLine,
      startCharacter: 0,
      endCharacter: slice.text.length
    },
    selectedText: slice.text,
    chunk: {
      chunkIndex: slice.chunkIndex,
      headingPath: slice.headingPath,
      startOffset: slice.startOffset,
      endOffset: slice.endOffset
    }
  }));
}

function txtChunkAnchors(content: string): DocumentAnchor[] {
  const lines = content.split("\n");
  const slices: Array<{
    chunkIndex: number;
    headingPath: string[];
    startLine: number;
    endLine: number;
    text: string;
    startOffset: number;
    endOffset: number;
  }> = [];
  let chunkLines: string[] = [];
  let chunkStartLine = 1;
  let chunkStartOffset = 0;
  let chunkIndex = 0;
  let textOffset = 0;
  const flush = (endLine: number) => {
    if (!chunkLines.length) return;
    const text = chunkLines.join("\n");
    const firstLine = chunkLines.map((line) => line.trim()).find(Boolean) || "";
    slices.push({
      chunkIndex,
      headingPath: firstLine ? [firstLine.slice(0, 80)] : [],
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
    if (!line.trim()) {
      flush(index);
      chunkStartLine = index + 2;
      chunkStartOffset = textOffset + line.length + 1;
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
      text: content,
      startOffset: 0,
      endOffset: content.length
    });
  }
  return slices.map((slice) => ({
    anchorId: `txt:chunk:${slice.chunkIndex}`,
    objectId: `txt:chunk:${slice.chunkIndex}`,
    format: "txt" as const,
    locator: {
      kind: "text-range" as const,
      startLine: slice.startLine,
      endLine: slice.endLine,
      startCharacter: 0,
      endCharacter: slice.text.length
    },
    selectedText: slice.text,
    chunk: {
      chunkIndex: slice.chunkIndex,
      headingPath: slice.headingPath,
      startOffset: slice.startOffset,
      endOffset: slice.endOffset
    }
  }));
}

export class DocumentIngestionService {
  ingestText(name: string, content: string): DocumentIngestionResult {
    const format = formatByName(name);
    if (!format) throw new TypeError("only TXT and Markdown are supported by the local text reader");
    const normalized = content.replaceAll("\r\n", "\n");
    const lines = normalized.split("\n");
    const anchors = textLineAnchors(format, lines);
    if (format === "markdown") anchors.push(...markdownChunkAnchors(normalized));
    if (format === "txt") anchors.push(...txtChunkAnchors(normalized));
    return { format, text: lines.join("\n"), anchors, warnings: [] };
  }

  async ingestFile(client: Pick<DocumentWorkerClient, "ingest">, input: DocumentWorkerIngestInput): Promise<DocumentIngestionResult> {
    const result = await client.ingest(input);
    if (result.status !== "completed" || !result.format || result.text === undefined || !result.anchors || !result.warnings) {
      throw new Error("DOCUMENT_INGESTION_INCOMPLETE");
    }
    return { format: result.format, text: result.text, anchors: result.anchors, warnings: result.warnings };
  }
}
