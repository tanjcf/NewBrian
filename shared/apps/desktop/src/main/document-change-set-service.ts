import { createHash } from "node:crypto";
import { realpath, readFile, rename, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

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

interface TextOperation { start: number; end: number; replacement: string; }

/** Applies only reviewed text changes, with optimistic version and content checks. */
export class DocumentChangeSetService {
  async applyText(input: {
    projectRoot: string;
    relativePath: string;
    currentFileVersion: number;
    changeSet: TextChangeSet;
    expectedContentHash?: string;
  }): Promise<AppliedTextChangeSet> {
    if (input.changeSet.status !== "ACCEPTED") throw new Error("DOCUMENT_CHANGE_SET_NOT_ACCEPTED");
    if (input.changeSet.baseFileVersion !== input.currentFileVersion) throw new Error("DOCUMENT_CHANGE_SET_VERSION_CONFLICT");
    if (!Number.isSafeInteger(input.currentFileVersion) || input.currentFileVersion < 1) throw new Error("DOCUMENT_FILE_VERSION_INVALID");
    const root = await realpath(input.projectRoot);
    const relativePath = input.relativePath.trim();
    if (!relativePath || isAbsolute(relativePath)) throw new Error("DOCUMENT_CHANGE_SET_PATH_FORBIDDEN");
    const target = resolve(root, relativePath);
    const resolvedTarget = await realpath(target);
    const escaped = relative(root, resolvedTarget);
    if (escaped.startsWith("..") || isAbsolute(escaped)) throw new Error("DOCUMENT_CHANGE_SET_PATH_FORBIDDEN");
    if (![".txt", ".md", ".markdown"].includes(extname(resolvedTarget).toLowerCase())) throw new Error("DOCUMENT_CHANGE_SET_FORMAT_UNSUPPORTED");
    const fileStat = await stat(resolvedTarget);
    if (!fileStat.isFile()) throw new Error("DOCUMENT_CHANGE_SET_NOT_FILE");
    const before = await readFile(resolvedTarget, "utf8");
    const beforeHash = hash(before);
    if (input.expectedContentHash && input.expectedContentHash !== beforeHash) throw new Error("DOCUMENT_CHANGE_SET_CONTENT_CONFLICT");
    const after = applyOperations(before, parseOperations(input.changeSet.diffJson));
    if (after === before) throw new Error("DOCUMENT_CHANGE_SET_EMPTY");
    const temporary = `${resolvedTarget}.brain-${process.pid}-${Date.now()}.tmp`;
    await writeFile(temporary, after, { encoding: "utf8", mode: 0o600 });
    try {
      await rename(temporary, resolvedTarget);
    } catch (error) {
      await writeFile(temporary, "", { encoding: "utf8" }).catch(() => undefined);
      throw error;
    }
    const verified = await readFile(resolvedTarget, "utf8");
    if (verified !== after) throw new Error("DOCUMENT_CHANGE_SET_VERIFY_FAILED");
    return { path: resolvedTarget, fileVersion: input.currentFileVersion + 1, contentHash: hash(verified), content: verified };
  }
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
  return operations.sort((a, b) => b.start - a.start);
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
