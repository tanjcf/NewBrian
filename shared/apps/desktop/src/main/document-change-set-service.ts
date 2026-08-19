import { createHash } from "node:crypto";
import { realpath, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import type { TextDocumentAnchor } from "@codex-forge/protocol/document-anchor";

export interface TextChangeSet {
  status: "PROPOSED" | "ACCEPTED" | "REJECTED" | "REVERTED";
  baseFileVersion: number;
  resultFileVersion?: number;
  diffJson: string;
}

export interface AppliedTextChangeSet {
  path: string;
  fileVersion: number;
  contentHash: string;
  content: string;
}

export interface TextChangeSetPreview {
  path: string;
  fileVersion: number;
  contentHash: string;
  before: string;
  after: string;
  operations: TextOperation[];
}

export interface TextOperation { start: number; end: number; replacement: string; }

/** Previews bounded text changes and exports accepted changes without overwriting the source. */
export class DocumentChangeSetService {
  async previewText(input: {
    projectRoot: string;
    relativePath: string;
    currentFileVersion: number;
    changeSet: TextChangeSet;
    allowedRange?: { start: number; end: number };
    textAnchor?: TextDocumentAnchor;
    expectedContentHash?: string;
  }): Promise<TextChangeSetPreview> {
    if (input.changeSet.baseFileVersion !== input.currentFileVersion) throw new Error("DOCUMENT_CHANGE_SET_VERSION_CONFLICT");
    if (!Number.isSafeInteger(input.currentFileVersion) || input.currentFileVersion < 1) throw new Error("DOCUMENT_FILE_VERSION_INVALID");
    const root = await realpath(input.projectRoot);
    const target = resolveRelativePath(root, input.relativePath);
    const resolvedTarget = await realpath(target);
    assertInside(root, resolvedTarget);
    if (![".txt", ".md", ".markdown"].includes(extname(resolvedTarget).toLowerCase())) throw new Error("DOCUMENT_CHANGE_SET_FORMAT_UNSUPPORTED");
    const fileStat = await stat(resolvedTarget);
    if (!fileStat.isFile()) throw new Error("DOCUMENT_CHANGE_SET_NOT_FILE");
    const before = await readFile(resolvedTarget, "utf8");
    const beforeHash = hash(before);
    if (input.expectedContentHash && input.expectedContentHash !== beforeHash) throw new Error("DOCUMENT_CHANGE_SET_CONTENT_CONFLICT");
    const operations = parseOperations(input.changeSet.diffJson);
    const allowedRange = input.textAnchor ? textAnchorRange(before, input.textAnchor) : input.allowedRange;
    if (!allowedRange) throw new Error("DOCUMENT_CHANGE_SET_ANNOTATION_RANGE_INVALID");
    assertAllowedRange(allowedRange, before.length, operations);
    const after = applyOperations(before, operations);
    if (after === before) throw new Error("DOCUMENT_CHANGE_SET_EMPTY");
    return { path: resolvedTarget, fileVersion: input.currentFileVersion, contentHash: beforeHash, before, after, operations };
  }

  async exportTextRevision(input: {
    projectRoot: string;
    relativePath: string;
    outputRelativePath: string;
    currentFileVersion: number;
    changeSet: TextChangeSet;
    allowedRange?: { start: number; end: number };
    textAnchor?: TextDocumentAnchor;
    expectedContentHash?: string;
  }): Promise<AppliedTextChangeSet> {
    if (input.changeSet.status !== "ACCEPTED") throw new Error("DOCUMENT_CHANGE_SET_NOT_ACCEPTED");
    const preview = await this.previewText(input);
    const root = await realpath(input.projectRoot);
    const output = resolveRelativePath(root, input.outputRelativePath);
    if (output === preview.path) throw new Error("DOCUMENT_CHANGE_SET_SOURCE_OVERWRITE_FORBIDDEN");
    if (![".txt", ".md", ".markdown"].includes(extname(output).toLowerCase())) throw new Error("DOCUMENT_CHANGE_SET_FORMAT_UNSUPPORTED");
    const resolvedParent = await realpath(dirname(output));
    assertInside(root, resolvedParent);
    try {
      await writeFile(output, preview.after, { encoding: "utf8", mode: 0o600, flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") throw new Error("DOCUMENT_CHANGE_SET_OUTPUT_EXISTS");
      throw error;
    }
    const verified = await readFile(output, "utf8");
    if (verified !== preview.after) {
      await unlink(output).catch(() => undefined);
      throw new Error("DOCUMENT_CHANGE_SET_VERIFY_FAILED");
    }
    return { path: output, fileVersion: input.currentFileVersion + 1, contentHash: hash(verified), content: verified };
  }
}

export function textAnchorRange(content: string, anchor: TextDocumentAnchor) {
  if (anchor.locator.kind !== "text-range") throw new Error("DOCUMENT_CHANGE_SET_ANNOTATION_RANGE_INVALID");
  const lines = content.split(/(?<=\n)/);
  const startLine = lines[anchor.locator.startLine - 1];
  const endLine = lines[anchor.locator.endLine - 1];
  if (startLine === undefined || endLine === undefined) throw new Error("DOCUMENT_CHANGE_SET_ANNOTATION_RANGE_INVALID");
  const visibleLength = (line: string) => line.replace(/\r?\n$/, "").length;
  if (anchor.locator.startCharacter < 0 || anchor.locator.startCharacter > visibleLength(startLine)
    || anchor.locator.endCharacter < 0 || anchor.locator.endCharacter > visibleLength(endLine)) {
    throw new Error("DOCUMENT_CHANGE_SET_ANNOTATION_RANGE_INVALID");
  }
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) { offsets.push(offset); offset += line.length; }
  const start = offsets[anchor.locator.startLine - 1] + anchor.locator.startCharacter;
  const end = offsets[anchor.locator.endLine - 1] + anchor.locator.endCharacter;
  if (end < start) throw new Error("DOCUMENT_CHANGE_SET_ANNOTATION_RANGE_INVALID");
  return { start, end };
}

function parseOperations(value: string): TextOperation[] {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("DOCUMENT_CHANGE_SET_DIFF_INVALID"); }
  const record = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  const raw = Array.isArray(record.operations) ? record.operations : [record];
  const operations = raw.map((item) => {
    if (!item || typeof item !== "object") throw new Error("DOCUMENT_CHANGE_SET_DIFF_INVALID");
    const op = item as Record<string, unknown>;
    const start = Number(op.start);
    const end = Number(op.end ?? start);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || typeof op.replacement !== "string") {
      throw new Error("DOCUMENT_CHANGE_SET_DIFF_INVALID");
    }
    return { start, end, replacement: op.replacement };
  });
  const ascending = operations.sort((a, b) => a.start - b.start);
  for (let index = 1; index < ascending.length; index += 1) {
    if (ascending[index].start < ascending[index - 1].end) throw new Error("DOCUMENT_CHANGE_SET_RANGE_OVERLAP");
  }
  return ascending.reverse();
}

function assertAllowedRange(allowedRange: { start: number; end: number }, contentLength: number, operations: TextOperation[]) {
  if (!Number.isSafeInteger(allowedRange.start) || !Number.isSafeInteger(allowedRange.end)
    || allowedRange.start < 0 || allowedRange.end < allowedRange.start || allowedRange.end > contentLength) {
    throw new Error("DOCUMENT_CHANGE_SET_ANNOTATION_RANGE_INVALID");
  }
  if (operations.some((operation) => operation.start < allowedRange.start || operation.end > allowedRange.end)) {
    throw new Error("DOCUMENT_CHANGE_SET_OUTSIDE_ANNOTATION");
  }
}

function resolveRelativePath(root: string, value: string) {
  const normalized = value.trim();
  if (!normalized || isAbsolute(normalized)) throw new Error("DOCUMENT_CHANGE_SET_PATH_FORBIDDEN");
  const target = resolve(root, normalized);
  assertInside(root, target);
  return target;
}

function assertInside(root: string, target: string) {
  const escaped = relative(root, target);
  if (escaped.startsWith("..") || isAbsolute(escaped)) throw new Error("DOCUMENT_CHANGE_SET_PATH_FORBIDDEN");
}

function applyOperations(content: string, operations: TextOperation[]) {
  for (const operation of operations) {
    if (operation.end > content.length) throw new Error("DOCUMENT_CHANGE_SET_RANGE_INVALID");
    content = content.slice(0, operation.start) + operation.replacement + content.slice(operation.end);
  }
  return content;
}

function hash(content: string) {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}
