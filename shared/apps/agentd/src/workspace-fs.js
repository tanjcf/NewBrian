/**
 * OpenClaw-parity workspace file primitives: read / edit / apply_patch.
 * Paths are workspace-bounded (relative preferred; absolute allowed when inside workspace).
 * Limitations for apply_patch: Move-to is supported; binary patches are not;
 * hunk matching is exact then trim/punctuation-tolerant (not full fuzzy edit).
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export const DEFAULT_READ_MAX_LINES = 2000;
export const DEFAULT_READ_MAX_BYTES = 512 * 1024;
export const MAX_WRITE_BYTES = 2 * 1024 * 1024;

const BEGIN_PATCH_MARKER = "*** Begin Patch";
const END_PATCH_MARKER = "*** End Patch";
const ADD_FILE_MARKER = "*** Add File: ";
const DELETE_FILE_MARKER = "*** Delete File: ";
const UPDATE_FILE_MARKER = "*** Update File: ";
const MOVE_TO_MARKER = "*** Move to: ";
const EOF_MARKER = "*** End of File";
const CHANGE_CONTEXT_MARKER = "@@ ";
const EMPTY_CHANGE_CONTEXT_MARKER = "@@";

const DASH_PUNCTUATION = /[\u2010-\u2015\u2212]/g;
const SINGLE_QUOTE_PUNCTUATION = /[\u2018-\u201B]/g;
const DOUBLE_QUOTE_PUNCTUATION = /[\u201C-\u201F]/g;
const SPACE_PUNCTUATION = /[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g;

function toRelativeWorkspacePath(workspacePath, targetPath) {
  return path.relative(workspacePath, targetPath).split(path.sep).join("/");
}

/**
 * Resolve a tool path that must stay inside the attached workspace.
 * Absolute paths are allowed only when they resolve under the workspace root.
 */
export async function resolveSafeWorkspacePath(workspacePath, targetPath, options = {}) {
  const fieldName = options.fieldName || "path";
  const requested = String(targetPath ?? "").trim();
  if (!requested) throw new Error(`${fieldName} is required.`);
  const workspace = await fs.realpath(path.resolve(workspacePath));
  let target = path.isAbsolute(requested)
    ? path.resolve(requested)
    : path.resolve(workspace, requested);
  try {
    target = await fs.realpath(target);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (target !== workspace && !target.startsWith(`${workspace}${path.sep}`)) {
    throw new Error("Tool target must stay inside the attached workspace.");
  }
  try {
    const targetStat = await fs.lstat(target);
    if (targetStat.isSymbolicLink() && !options.allowFinalSymlink) {
      throw new Error("Tool target cannot be a symbolic link.");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  let ancestor = path.dirname(target);
  while (ancestor !== workspace) {
    try {
      const realAncestor = await fs.realpath(ancestor);
      if (realAncestor !== workspace && !realAncestor.startsWith(`${workspace}${path.sep}`)) {
        throw new Error("Tool target resolves outside the attached workspace.");
      }
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      ancestor = path.dirname(ancestor);
    }
  }
  return {
    workspace,
    target,
    relativePath: toRelativeWorkspacePath(workspace, target)
  };
}

const fileMutationQueues = new Map();

function withFileMutationQueue(filePath, work) {
  const key = path.resolve(filePath);
  const previous = fileMutationQueues.get(key) || Promise.resolve();
  const run = previous.catch(() => {}).then(() => work());
  // Keep the queue alive without detaching the caller's rejection handling.
  fileMutationQueues.set(key, run.then(() => {}, () => {}));
  return run;
}

export function detectLineEnding(content) {
  const crlfIdx = content.indexOf("\r\n");
  const lfIdx = content.indexOf("\n");
  if (lfIdx === -1) return "\n";
  if (crlfIdx === -1) return "\n";
  return crlfIdx < lfIdx ? "\r\n" : "\n";
}

export function normalizeToLF(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function restoreLineEndings(text, ending) {
  return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

function stripBom(content) {
  return content.startsWith("\uFEFF")
    ? { bom: "\uFEFF", text: content.slice(1) }
    : { bom: "", text: content };
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while (true) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) break;
    count += 1;
    index = found + needle.length;
  }
  return count;
}

function formatNumberedLines(lines, startLine) {
  const width = String(startLine + lines.length - 1).length;
  return lines.map((line, index) => {
    const lineNo = String(startLine + index).padStart(width, " ");
    return `${lineNo}|${line}`;
  }).join("\n");
}

function truncateByLinesAndBytes(lines, maxLines, maxBytes) {
  const limited = lines.slice(0, maxLines);
  let outputLines = [];
  let outputBytes = 0;
  let truncatedBy = null;
  let lastLinePartial = false;
  let firstLineExceedsLimit = false;

  for (let i = 0; i < limited.length; i += 1) {
    const line = limited[i];
    const withNewline = i === 0 ? line : `\n${line}`;
    const bytes = Buffer.byteLength(withNewline, "utf8");
    if (outputBytes + bytes <= maxBytes) {
      outputLines.push(line);
      outputBytes += bytes;
      continue;
    }
    truncatedBy = "bytes";
    const remaining = Math.max(0, maxBytes - outputBytes - (i === 0 ? 0 : 1));
    if (remaining > 0) {
      let partial = "";
      for (const ch of line) {
        const next = partial + ch;
        if (Buffer.byteLength(next, "utf8") > remaining) break;
        partial = next;
      }
      if (partial) {
        outputLines.push(partial);
        lastLinePartial = true;
        outputBytes += Buffer.byteLength((i === 0 ? "" : "\n") + partial, "utf8");
      } else if (i === 0) {
        firstLineExceedsLimit = true;
      }
    } else if (i === 0) {
      firstLineExceedsLimit = true;
    }
    break;
  }

  if (!truncatedBy && lines.length > maxLines) truncatedBy = "lines";

  return {
    lines: outputLines,
    truncated: Boolean(truncatedBy),
    truncatedBy,
    outputLines: outputLines.length,
    outputBytes,
    lastLinePartial,
    firstLineExceedsLimit
  };
}

/** Read a workspace file with optional 1-based offset/limit line window. */
export async function readWorkspaceFile(workspacePath, input = {}) {
  const resolved = await resolveSafeWorkspacePath(workspacePath, input.path, { fieldName: "path" });
  let buffer;
  try {
    buffer = await fs.readFile(resolved.target);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        ok: false,
        exitCode: 1,
        kind: "not_found",
        path: resolved.relativePath,
        output: `File not found: ${resolved.relativePath}`
      };
    }
    throw error;
  }

  const totalBytes = buffer.length;
  const text = buffer.toString("utf8");
  const allLines = normalizeToLF(text).split("\n");
  // Drop trailing empty line from final newline so line count matches editor UX.
  if (allLines.length > 0 && allLines[allLines.length - 1] === "" && text.endsWith("\n")) {
    allLines.pop();
  }
  const totalLines = allLines.length;
  const offset = Math.max(1, Number(input.offset) || 1);
  const requestedLimit = Number(input.limit);
  const maxLines = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(DEFAULT_READ_MAX_LINES, Math.floor(requestedLimit))
    : DEFAULT_READ_MAX_LINES;
  const maxBytes = DEFAULT_READ_MAX_BYTES;
  const sliceStart = Math.min(offset - 1, totalLines);
  const window = allLines.slice(sliceStart);
  const truncated = truncateByLinesAndBytes(window, maxLines, maxBytes);
  const startLine = sliceStart + 1;
  const numbered = formatNumberedLines(truncated.lines, startLine || 1);
  const lineNumbers = input.lineNumbers !== false;

  let content = lineNumbers ? numbered : truncated.lines.join("\n");
  let note = "";
  if (truncated.truncated) {
    note = `\n\n[truncated by ${truncated.truncatedBy}: showing ${truncated.outputLines} lines / ${truncated.outputBytes} bytes of ${totalLines} lines / ${totalBytes} bytes. Use offset/limit or workspace.grep for a smaller window.]`;
    content += note;
  } else if (offset > 1 || (Number.isFinite(requestedLimit) && requestedLimit > 0 && window.length > truncated.lines.length)) {
    // no-op
  }

  const kind = truncated.truncated ? "truncated" : "text";
  return {
    ok: true,
    exitCode: 0,
    kind,
    path: resolved.relativePath,
    content,
    output: content,
    offset: startLine,
    limit: truncated.outputLines,
    totalLines,
    totalBytes,
    truncation: truncated.truncated
      ? {
        truncated: true,
        truncatedBy: truncated.truncatedBy,
        totalLines,
        totalBytes,
        outputLines: truncated.outputLines,
        outputBytes: truncated.outputBytes,
        lastLinePartial: truncated.lastLinePartial,
        firstLineExceedsLimit: truncated.firstLineExceedsLimit,
        maxLines,
        maxBytes
      }
      : undefined,
    command: `read ${resolved.relativePath}`
  };
}

function normalizeEditInput(input) {
  const args = input && typeof input === "object" ? { ...input } : {};
  if (typeof args.edits === "string") {
    try {
      const parsed = JSON.parse(args.edits);
      if (Array.isArray(parsed)) args.edits = parsed;
    } catch {
      // keep as-is; validate will fail clearly
    }
  }
  if (typeof args.oldText === "string" && typeof args.newText === "string") {
    const edits = Array.isArray(args.edits) ? [...args.edits] : [];
    edits.push({ oldText: args.oldText, newText: args.newText });
    args.edits = edits;
  }
  // Also accept OpenClaw-style old_string/new_string single edit aliases.
  if (typeof args.old_string === "string" && typeof args.new_string === "string") {
    const edits = Array.isArray(args.edits) ? [...args.edits] : [];
    edits.push({ oldText: args.old_string, newText: args.new_string });
    args.edits = edits;
  }
  return args;
}

function buildUnifiedDiff(relativePath, before, after) {
  const beforeLines = normalizeToLF(before).split("\n");
  const afterLines = normalizeToLF(after).split("\n");
  if (beforeLines.at(-1) === "") beforeLines.pop();
  if (afterLines.at(-1) === "") afterLines.pop();
  const lines = [`--- a/${relativePath}`, `+++ b/${relativePath}`, `@@`];
  const max = Math.max(beforeLines.length, afterLines.length);
  let firstChangedLine;
  for (let i = 0; i < max; i += 1) {
    const left = beforeLines[i];
    const right = afterLines[i];
    if (left === right) {
      if (left !== undefined) lines.push(` ${left}`);
      continue;
    }
    if (firstChangedLine === undefined) firstChangedLine = i + 1;
    if (left !== undefined) lines.push(`-${left}`);
    if (right !== undefined) lines.push(`+${right}`);
  }
  return { diff: lines.join("\n"), firstChangedLine };
}

/** Exact unique oldText→newText replacements (OpenClaw edit spirit). */
export async function editWorkspaceFile(workspacePath, rawInput = {}) {
  const input = normalizeEditInput(rawInput);
  const resolved = await resolveSafeWorkspacePath(workspacePath, input.path, { fieldName: "path" });
  const edits = Array.isArray(input.edits) ? input.edits : [];
  if (edits.length === 0) {
    throw new Error("edits must contain at least one { oldText, newText } replacement.");
  }

  return withFileMutationQueue(resolved.target, async () => {
    const originalRaw = await fs.readFile(resolved.target, "utf8").catch((error) => {
      if (error?.code === "ENOENT") throw new Error(`File not found: ${resolved.relativePath}`);
      throw error;
    });
    const { bom, text: withoutBom } = stripBom(originalRaw);
    const ending = detectLineEnding(withoutBom);
    const original = normalizeToLF(withoutBom);
    const normalizedEdits = edits.map((edit, index) => {
      if (!edit || typeof edit !== "object") {
        throw new Error(`edits[${index}] must be an object with oldText and newText.`);
      }
      const oldText = normalizeToLF(edit.oldText ?? edit.old_string ?? "");
      const newText = normalizeToLF(edit.newText ?? edit.new_string ?? "");
      if (!oldText) throw new Error(`edits[${index}].oldText must not be empty in ${resolved.relativePath}.`);
      return { oldText, newText };
    });

    // Match all edits against the original content, then apply reverse so offsets stay stable.
    const matches = [];
    for (let i = 0; i < normalizedEdits.length; i += 1) {
      const { oldText, newText } = normalizedEdits[i];
      const occurrences = countOccurrences(original, oldText);
      if (occurrences === 0) {
        const snippet = original.length > 800 ? `${original.slice(0, 800)}\n...` : original;
        throw new Error(
          `Could not find the exact text in ${resolved.relativePath} (edits[${i}]). ` +
          `oldText must match exactly including whitespace and newlines. ` +
          `Do not retry the same oldText. Call workspace.read on this path, then edit with exact text or use workspace.write_file to replace the whole file.\n` +
          `File snippet:\n${snippet}`
        );
      }
      if (occurrences > 1) {
        throw new Error(
          `Found ${occurrences} occurrences of edits[${i}] in ${resolved.relativePath}. ` +
          "Each oldText must be unique. Provide more surrounding context."
        );
      }
      const index = original.indexOf(oldText);
      for (const prior of matches) {
        const priorEnd = prior.index + prior.oldText.length;
        const thisEnd = index + oldText.length;
        const overlaps = !(thisEnd <= prior.index || index >= priorEnd);
        if (overlaps) {
          throw new Error(`edits[${i}] overlaps another edit in ${resolved.relativePath}.`);
        }
      }
      matches.push({ index, oldText, newText });
    }

    matches.sort((a, b) => b.index - a.index);
    let next = original;
    for (const match of matches) {
      next = next.slice(0, match.index) + match.newText + next.slice(match.index + match.oldText.length);
    }
    if (next === original) {
      throw new Error(
        `No changes made to ${resolved.relativePath}. Replacement produced identical content.`
      );
    }

    const restored = bom + restoreLineEndings(next, ending);
    const bytes = Buffer.byteLength(restored, "utf8");
    if (bytes > MAX_WRITE_BYTES) throw new Error(`Edited content exceeds ${MAX_WRITE_BYTES} bytes.`);
    await fs.writeFile(resolved.target, restored, "utf8");
    const { diff, firstChangedLine } = buildUnifiedDiff(resolved.relativePath, original, next);
    const stat = await fs.stat(resolved.target);
    return {
      ok: true,
      exitCode: 0,
      changed: true,
      diff,
      patch: diff,
      firstChangedLine,
      path: resolved.relativePath,
      output: `Edited ${resolved.relativePath} (first changed line ${firstChangedLine ?? "?"}).`,
      command: `edit ${resolved.relativePath}`,
      artifact: {
        path: resolved.relativePath,
        size: stat.size,
        changeType: "modified"
      }
    };
  });
}

function normalizePunctuation(value) {
  return value
    .replace(DASH_PUNCTUATION, "-")
    .replace(SINGLE_QUOTE_PUNCTUATION, "'")
    .replace(DOUBLE_QUOTE_PUNCTUATION, '"')
    .replace(SPACE_PUNCTUATION, " ");
}

function linesMatch(lines, pattern, start, normalize) {
  for (let idx = 0; idx < pattern.length; idx += 1) {
    const line = lines[start + idx];
    const expected = pattern[idx];
    if (line === undefined || expected === undefined || normalize(line) !== normalize(expected)) {
      return false;
    }
  }
  return true;
}

function seekSequence(lines, pattern, start, eof) {
  if (pattern.length === 0) return start;
  if (pattern.length > lines.length) return null;
  const maxStart = lines.length - pattern.length;
  const searchStart = eof && lines.length >= pattern.length ? maxStart : start;
  if (searchStart > maxStart) return null;
  const normalizers = [
    (value) => value,
    (value) => value.trimEnd(),
    (value) => value.trim(),
    (value) => normalizePunctuation(value.trim())
  ];
  for (const normalize of normalizers) {
    for (let i = searchStart; i <= maxStart; i += 1) {
      if (linesMatch(lines, pattern, i, normalize)) return i;
    }
  }
  return null;
}

function applyUpdateChunks(originalContents, chunks, displayPath) {
  const originalLines = originalContents.split("\n");
  if (originalLines.length > 0 && originalLines[originalLines.length - 1] === "") {
    originalLines.pop();
  }
  const replacements = [];
  let lineIndex = 0;
  for (const chunk of chunks) {
    if (chunk.changeContext) {
      const ctxIndex = seekSequence(originalLines, [chunk.changeContext], lineIndex, false);
      if (ctxIndex === null) {
        throw new Error(`Failed to find context '${chunk.changeContext}' in ${displayPath}`);
      }
      lineIndex = ctxIndex + 1;
    }
    if (chunk.oldLines.length === 0) {
      const insertionIndex = chunk.changeContext && !chunk.isEndOfFile
        ? lineIndex
        : originalLines.length;
      replacements.push([insertionIndex, 0, chunk.newLines]);
      lineIndex = insertionIndex;
      continue;
    }
    let pattern = chunk.oldLines;
    let newSlice = chunk.newLines;
    let found = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);
    if (found === null && pattern[pattern.length - 1] === "") {
      pattern = pattern.slice(0, -1);
      if (newSlice.length > 0 && newSlice[newSlice.length - 1] === "") {
        newSlice = newSlice.slice(0, -1);
      }
      found = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);
    }
    if (found === null) {
      throw new Error(`Failed to find expected lines in ${displayPath}:\n${chunk.oldLines.join("\n")}`);
    }
    replacements.push([found, pattern.length, newSlice]);
    lineIndex = found + pattern.length;
  }
  replacements.sort((a, b) => a[0] - b[0]);
  const result = [...originalLines];
  for (const [startIndex, oldLen, newLines] of [...replacements].reverse()) {
    result.splice(startIndex, oldLen, ...newLines);
  }
  if (result.length === 0 || result[result.length - 1] !== "") result.push("");
  return result.join("\n");
}

function checkPatchBoundaries(lines) {
  const first = lines[0]?.trim();
  const last = lines[lines.length - 1]?.trim();
  if (first === BEGIN_PATCH_MARKER && last === END_PATCH_MARKER) return lines;
  if (
    lines.length >= 4 &&
    (first === "<<EOF" || first === "<<'EOF'" || first === '<<"EOF"') &&
    String(lines.at(-1)).endsWith("EOF")
  ) {
    const inner = lines.slice(1, -1);
    const innerFirst = inner[0]?.trim();
    const innerLast = inner[inner.length - 1]?.trim();
    if (innerFirst === BEGIN_PATCH_MARKER && innerLast === END_PATCH_MARKER) return inner;
  }
  if (first !== BEGIN_PATCH_MARKER) {
    throw new Error("The first line of the patch must be '*** Begin Patch'");
  }
  throw new Error("The last line of the patch must be '*** End Patch'");
}

function parseUpdateFileChunk(lines, lineNumber, allowMissingContext) {
  if (lines.length === 0) {
    throw new Error(`Invalid patch hunk at line ${lineNumber}: Update hunk does not contain any lines`);
  }
  let changeContext;
  let startIndex = 0;
  const firstLine = lines[0];
  if (firstLine === EMPTY_CHANGE_CONTEXT_MARKER) {
    startIndex = 1;
  } else if (firstLine?.startsWith(CHANGE_CONTEXT_MARKER)) {
    changeContext = firstLine.slice(CHANGE_CONTEXT_MARKER.length);
    startIndex = 1;
  } else if (!allowMissingContext) {
    throw new Error(
      `Invalid patch hunk at line ${lineNumber}: Expected update hunk to start with a @@ context marker, got: '${firstLine}'`
    );
  }
  if (startIndex >= lines.length) {
    throw new Error(`Invalid patch hunk at line ${lineNumber + 1}: Update hunk does not contain any lines`);
  }
  const chunk = { changeContext, oldLines: [], newLines: [], isEndOfFile: false };
  let parsedLines = 0;
  for (const line of lines.slice(startIndex)) {
    if (line === EOF_MARKER) {
      if (parsedLines === 0) {
        throw new Error(`Invalid patch hunk at line ${lineNumber + 1}: Update hunk does not contain any lines`);
      }
      chunk.isEndOfFile = true;
      parsedLines += 1;
      break;
    }
    const marker = line[0];
    if (!marker) {
      chunk.oldLines.push("");
      chunk.newLines.push("");
      parsedLines += 1;
      continue;
    }
    if (marker === " ") {
      const content = line.slice(1);
      chunk.oldLines.push(content);
      chunk.newLines.push(content);
      parsedLines += 1;
      continue;
    }
    if (marker === "+") {
      chunk.newLines.push(line.slice(1));
      parsedLines += 1;
      continue;
    }
    if (marker === "-") {
      chunk.oldLines.push(line.slice(1));
      parsedLines += 1;
      continue;
    }
    if (line.startsWith("***")) break;
    throw new Error(
      `Invalid patch hunk at line ${lineNumber + startIndex + parsedLines}: Unexpected line '${line}'`
    );
  }
  if (parsedLines === 0) {
    throw new Error(`Invalid patch hunk at line ${lineNumber}: Update hunk does not contain any lines`);
  }
  return { chunk, consumed: startIndex + parsedLines };
}

function parseOneHunk(lines, lineNumber) {
  if (lines.length === 0) throw new Error(`Invalid patch hunk at line ${lineNumber}: empty hunk`);
  const firstLine = lines[0]?.trim();
  if (firstLine?.startsWith(ADD_FILE_MARKER)) {
    const targetPath = firstLine.slice(ADD_FILE_MARKER.length);
    let contents = "";
    let consumed = 1;
    for (const addLine of lines.slice(1)) {
      if (addLine.startsWith("+")) {
        contents += `${addLine.slice(1)}\n`;
        consumed += 1;
      } else {
        break;
      }
    }
    return { hunk: { kind: "add", path: targetPath, contents }, consumed };
  }
  if (firstLine?.startsWith(DELETE_FILE_MARKER)) {
    return {
      hunk: { kind: "delete", path: firstLine.slice(DELETE_FILE_MARKER.length) },
      consumed: 1
    };
  }
  if (firstLine?.startsWith(UPDATE_FILE_MARKER)) {
    const targetPath = firstLine.slice(UPDATE_FILE_MARKER.length);
    let remaining = lines.slice(1);
    let consumed = 1;
    let movePath;
    const moveCandidate = remaining[0]?.trim();
    if (moveCandidate?.startsWith(MOVE_TO_MARKER)) {
      movePath = moveCandidate.slice(MOVE_TO_MARKER.length);
      remaining = remaining.slice(1);
      consumed += 1;
    }
    const chunks = [];
    while (remaining.length > 0) {
      if (remaining[0]?.trim() === "") {
        remaining = remaining.slice(1);
        consumed += 1;
        continue;
      }
      if (remaining[0]?.startsWith("***")) break;
      const { chunk, consumed: chunkLines } = parseUpdateFileChunk(
        remaining,
        lineNumber + consumed,
        chunks.length === 0
      );
      chunks.push(chunk);
      remaining = remaining.slice(chunkLines);
      consumed += chunkLines;
    }
    if (chunks.length === 0) {
      throw new Error(
        `Invalid patch hunk at line ${lineNumber}: Update file hunk for path '${targetPath}' is empty`
      );
    }
    return { hunk: { kind: "update", path: targetPath, movePath, chunks }, consumed };
  }
  throw new Error(
    `Invalid patch hunk at line ${lineNumber}: '${lines[0]}' is not a valid hunk header. ` +
    "Valid: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'"
  );
}

export function parsePatchText(input) {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) throw new Error("Invalid patch: input is empty.");
  const validated = checkPatchBoundaries(trimmed.split(/\r?\n/));
  const hunks = [];
  let remaining = validated.slice(1, validated.length - 1);
  let lineNumber = 2;
  while (remaining.length > 0) {
    if (remaining[0]?.trim() === "") {
      remaining = remaining.slice(1);
      lineNumber += 1;
      continue;
    }
    const { hunk, consumed } = parseOneHunk(remaining, lineNumber);
    hunks.push(hunk);
    lineNumber += consumed;
    remaining = remaining.slice(consumed);
  }
  return { hunks, patch: validated.join("\n") };
}

function formatPatchSummary(summary) {
  const lines = ["Success. Updated the following files:"];
  for (const file of summary.added) lines.push(`A ${file}`);
  for (const file of summary.modified) lines.push(`M ${file}`);
  for (const file of summary.deleted) lines.push(`D ${file}`);
  return lines.join("\n");
}

/**
 * Apply OpenAI-style *** Begin Patch *** envelope.
 * Supports Add / Update (+ optional Move to) / Delete.
 */
export async function applyWorkspacePatch(workspacePath, inputText) {
  const parsed = parsePatchText(inputText);
  if (parsed.hunks.length === 0) throw new Error("No files were modified.");

  const summary = { added: [], modified: [], deleted: [] };
  const seen = { added: new Set(), modified: new Set(), deleted: new Set() };
  const record = (bucket, value) => {
    if (seen[bucket].has(value)) return;
    seen[bucket].add(value);
    summary[bucket].push(value);
  };

  for (const hunk of parsed.hunks) {
    if (hunk.kind === "add") {
      const resolved = await resolveSafeWorkspacePath(workspacePath, hunk.path, { fieldName: "path" });
      await fs.mkdir(path.dirname(resolved.target), { recursive: true });
      const bytes = Buffer.byteLength(hunk.contents, "utf8");
      if (bytes > MAX_WRITE_BYTES) throw new Error(`Add File content exceeds ${MAX_WRITE_BYTES} bytes: ${resolved.relativePath}`);
      await fs.writeFile(resolved.target, hunk.contents, "utf8");
      record("added", resolved.relativePath);
      continue;
    }
    if (hunk.kind === "delete") {
      const resolved = await resolveSafeWorkspacePath(workspacePath, hunk.path, {
        fieldName: "path",
        allowFinalSymlink: true
      });
      await fs.rm(resolved.target, { force: false });
      record("deleted", resolved.relativePath);
      continue;
    }
    const resolved = await resolveSafeWorkspacePath(workspacePath, hunk.path, { fieldName: "path" });
    const existing = await fs.readFile(resolved.target, "utf8");
    const applied = applyUpdateChunks(existing, hunk.chunks, resolved.relativePath);
    if (hunk.movePath) {
      const moveTarget = await resolveSafeWorkspacePath(workspacePath, hunk.movePath, { fieldName: "path" });
      await fs.mkdir(path.dirname(moveTarget.target), { recursive: true });
      await fs.writeFile(moveTarget.target, applied, "utf8");
      if (path.resolve(moveTarget.target) !== path.resolve(resolved.target)) {
        await fs.rm(resolved.target, { force: false });
      }
      record("modified", moveTarget.relativePath);
    } else {
      await fs.writeFile(resolved.target, applied, "utf8");
      record("modified", resolved.relativePath);
    }
  }

  const text = formatPatchSummary(summary);
  return {
    ok: true,
    exitCode: 0,
    summary,
    output: text,
    command: "apply_patch",
    artifacts: [
      ...summary.added.map((p) => ({ path: p, changeType: "created" })),
      ...summary.modified.map((p) => ({ path: p, changeType: "modified" })),
      ...summary.deleted.map((p) => ({ path: p, changeType: "deleted" }))
    ]
  };
}
