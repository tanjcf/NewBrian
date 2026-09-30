import { promises as fs } from "node:fs";
import path from "node:path";
import { decodeChildOutputBuffer } from "./windows-encoding.js";

export const WORKSPACE_IGNORED_NAMES = new Set([
  ".git",
  ".newbrain",
  ".desktop-profile",
  "node_modules",
  "dist",
  "out",
  "build",
  "target",
  "release",
  "tmp",
  "venv",
  ".venv",
  "__pycache__",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  ".next",
  ".nuxt",
  "coverage",
  ".cache"
]);

export const MAX_GLOB_HITS = 200;
export const MAX_GREP_HITS = 100;
export const MAX_SEARCH_HITS = 50;
export const MAX_SEARCH_DEPTH = 8;
export const MAX_SEARCH_FILE_BYTES = 512 * 1024;
export const GREP_MAX_LINE_CHARS = 500;

export const SEARCHABLE_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json", ".md", ".txt", ".py", ".java",
  ".go", ".rs", ".rb", ".php", ".cs", ".cpp", ".c", ".h", ".hpp", ".css", ".scss", ".html",
  ".xml", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".sh", ".ps1", ".bat", ".sql", ".vue",
  ".kt", ".swift", ".gradle", ".properties"
]);

function toRelativeWorkspacePath(workspacePath, targetPath) {
  return path.relative(workspacePath, targetPath).split(path.sep).join("/");
}

export function resolveSearchRoot(workspacePath, searchPath = "") {
  const normalizedPath = String(searchPath ?? "").trim().replace(/\\/g, "/");
  const searchRoot = normalizedPath
    ? path.resolve(workspacePath, normalizedPath.replace(/\//g, path.sep))
    : workspacePath;
  const workspaceRoot = path.resolve(workspacePath);
  if (searchRoot !== workspaceRoot && !searchRoot.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw new Error("path must stay inside the attached workspace.");
  }
  return { searchRoot, workspaceRoot, searchPath: normalizedPath || "." };
}

export function globPatternToRegExp(pattern = "") {
  const normalized = String(pattern ?? "").trim();
  if (!normalized) return null;
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

export function globPathPatternToRegExp(pattern = "") {
  let normalized = String(pattern ?? "").trim().replace(/\\/g, "/");
  if (!normalized) return null;
  if (normalized.includes("/") && !normalized.startsWith("**/") && !normalized.startsWith("/") && normalized !== "**") {
    normalized = `**/${normalized}`;
  }
  let regex = "";
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized.slice(index, index + 2) === "**") {
      regex += ".*";
      index += 1;
      continue;
    }
    const char = normalized[index];
    if (char === "*") regex += "[^/]*";
    else if (char === "?") regex += "[^/]";
    else if (/[.+^${}()|[\]\\]/.test(char)) regex += `\\${char}`;
    else regex += char;
  }
  return new RegExp(`^${regex}$`, "i");
}

export function compileFileGlobMatcher(pattern = "") {
  const normalized = String(pattern ?? "").trim();
  if (!normalized) {
    return { mode: "all", test: () => true };
  }
  if (normalized.includes("/")) {
    const pathRegex = globPathPatternToRegExp(normalized);
    return {
      mode: "path",
      test: (relativePath) => pathRegex.test(String(relativePath ?? "").replace(/\\/g, "/"))
    };
  }
  const basenameRegex = globPatternToRegExp(normalized);
  return {
    mode: "basename",
    test: (_relativePath, entryName) => basenameRegex.test(entryName)
  };
}

function looksLikeFilenameGlob(value = "") {
  const text = String(value ?? "").trim();
  if (!text) return false;
  if (/[*?]/.test(text)) return true;
  return /^[^/\\*?]+\.[A-Za-z0-9]+$/.test(text);
}

function shouldSkipEntry(entryName) {
  return WORKSPACE_IGNORED_NAMES.has(entryName) || entryName.startsWith("tmp-");
}

function clampLimit(value, fallback, max) {
  return Math.min(max, Math.max(1, Number(value) || fallback));
}

function truncateLine(text = "", maxChars = GREP_MAX_LINE_CHARS) {
  const normalized = String(text ?? "").replace(/\r/g, "");
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}…`;
}

function buildContentMatcher(pattern, { literal = false, ignoreCase = false } = {}) {
  const raw = String(pattern ?? "");
  if (!raw) throw new Error("pattern is required.");
  if (literal) {
    const needle = ignoreCase ? raw.toLowerCase() : raw;
    return {
      findNext(content, fromIndex = 0) {
        const haystack = ignoreCase ? content.toLowerCase() : content;
        const found = haystack.indexOf(needle, fromIndex);
        return found < 0 ? null : { index: found, length: raw.length };
      }
    };
  }
  let flags = "g";
  if (ignoreCase) flags += "i";
  let regex;
  try {
    regex = new RegExp(raw, flags);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
  return {
    findNext(content, fromIndex = 0) {
      regex.lastIndex = fromIndex;
      const match = regex.exec(content);
      if (!match || match.index == null) return null;
      return { index: match.index, length: Math.max(1, match[0].length) };
    }
  };
}

async function walkWorkspaceFiles(workspacePath, searchRoot, maxDepth, visitFile) {
  async function walk(currentPath, depth, relativePrefix) {
    let directoryEntries;
    try {
      directoryEntries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of directoryEntries) {
      if (shouldSkipEntry(entry.name)) continue;
      const absolutePath = path.join(currentPath, entry.name);
      const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (depth + 1 > maxDepth) continue;
        const stop = await walk(absolutePath, depth + 1, relativePath);
        if (stop) return true;
        continue;
      }
      if (!entry.isFile()) continue;
      const stop = await visitFile({
        absolutePath,
        entryName: entry.name,
        relativePath: toRelativeWorkspacePath(workspacePath, absolutePath),
        relativeFromRoot: relativePath.replace(/\\/g, "/")
      });
      if (stop) return true;
    }
    return false;
  }
  const relativePrefix = searchRoot === path.resolve(workspacePath)
    ? ""
    : toRelativeWorkspacePath(workspacePath, searchRoot);
  await walk(searchRoot, 0, relativePrefix);
}

export async function globWorkspaceFiles(workspacePath, options = {}) {
  const pattern = String(options.pattern ?? "").trim();
  if (!pattern) throw new Error("pattern is required.");
  const { searchRoot, searchPath } = resolveSearchRoot(workspacePath, options.searchPath);
  const maxHits = clampLimit(options.maxHits, MAX_GLOB_HITS, MAX_GLOB_HITS);
  const maxDepth = clampLimit(options.maxDepth, MAX_SEARCH_DEPTH, MAX_SEARCH_DEPTH);
  const nameRe = options.namePattern ? new RegExp(String(options.namePattern), "i") : null;
  const matchesPattern = compileFileGlobMatcher(pattern);
  const paths = [];
  let truncated = false;

  await walkWorkspaceFiles(workspacePath, searchRoot, maxDepth, async ({ entryName, relativePath, relativeFromRoot }) => {
    if (paths.length >= maxHits) {
      truncated = true;
      return true;
    }
    const patternMatched = matchesPattern.mode === "basename"
      ? matchesPattern.test(relativeFromRoot, entryName)
      : matchesPattern.test(relativeFromRoot);
    if (!patternMatched) return false;
    if (nameRe && !nameRe.test(entryName)) return false;
    paths.push(relativePath);
    if (paths.length >= maxHits) {
      truncated = true;
      return true;
    }
    return false;
  });

  return { paths, truncated, maxHits, maxDepth, searchPath, pattern };
}

export async function grepWorkspaceFiles(workspacePath, options = {}) {
  const pattern = String(options.pattern ?? "").trim();
  if (!pattern) throw new Error("pattern is required.");
  const { searchRoot, searchPath } = resolveSearchRoot(workspacePath, options.searchPath);
  const maxHits = clampLimit(options.maxHits, MAX_GREP_HITS, MAX_GREP_HITS);
  const maxDepth = clampLimit(options.maxDepth, MAX_SEARCH_DEPTH, MAX_SEARCH_DEPTH);
  const context = Math.max(0, Number(options.context) || 0);
  const globMatcher = options.glob ? compileFileGlobMatcher(options.glob) : null;
  const matcher = buildContentMatcher(pattern, {
    literal: Boolean(options.literal),
    ignoreCase: Boolean(options.ignoreCase)
  });
  const matches = [];
  let truncated = false;
  let linesTruncated = false;

  await walkWorkspaceFiles(workspacePath, searchRoot, maxDepth, async ({ absolutePath, entryName, relativePath, relativeFromRoot }) => {
    if (matches.length >= maxHits) {
      truncated = true;
      return true;
    }
    if (globMatcher) {
      const globMatched = globMatcher.mode === "basename"
        ? globMatcher.test(relativeFromRoot, entryName)
        : globMatcher.test(relativeFromRoot);
      if (!globMatched) return false;
    }
    const ext = path.extname(entryName).toLowerCase();
    if (ext && !SEARCHABLE_EXTENSIONS.has(ext)) return false;
    let stat;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      return false;
    }
    if (stat.size > MAX_SEARCH_FILE_BYTES) return false;
    let content;
    try {
      content = decodeChildOutputBuffer(await fs.readFile(absolutePath));
    } catch {
      return false;
    }
    const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = normalized.split("\n");
    let fromIndex = 0;
    while (matches.length < maxHits) {
      const found = matcher.findNext(normalized, fromIndex);
      if (!found) break;
      const lineNumber = normalized.slice(0, found.index).split("\n").length;
      const outputLines = [];
      if (context > 0) {
        const start = Math.max(1, lineNumber - context);
        const end = Math.min(lines.length, lineNumber + context);
        for (let current = start; current <= end; current += 1) {
          const lineText = truncateLine(lines[current - 1] ?? "");
          if (lineText.endsWith("…")) linesTruncated = true;
          if (current === lineNumber) outputLines.push(`${relativePath}:${current}: ${lineText}`);
          else outputLines.push(`${relativePath}-${current}- ${lineText}`);
        }
      } else {
        const lineText = truncateLine(lines[lineNumber - 1] ?? "");
        if (lineText.endsWith("…")) linesTruncated = true;
        outputLines.push(`${relativePath}:${lineNumber}: ${lineText}`);
      }
      matches.push({
        path: relativePath,
        line: lineNumber,
        preview: outputLines.join("\n")
      });
      fromIndex = found.index + found.length;
    }
    if (matches.length >= maxHits) {
      truncated = true;
      return true;
    }
    return false;
  });

  return {
    matches,
    truncated,
    linesTruncated,
    maxHits,
    maxDepth,
    searchPath,
    pattern,
    glob: options.glob || undefined
  };
}

export async function searchWorkspaceFiles(workspacePath, options = {}) {
  const {
    query = "",
    glob = "",
    namePattern = "",
    searchPath = "",
    maxHits,
    maxDepth
  } = options;
  if (glob || (query && looksLikeFilenameGlob(query))) {
    const pattern = glob || query;
    const globResult = await globWorkspaceFiles(workspacePath, {
      pattern,
      searchPath,
      namePattern,
      maxHits: maxHits ?? MAX_SEARCH_HITS,
      maxDepth: maxDepth ?? MAX_SEARCH_DEPTH
    });
    if (!query || looksLikeFilenameGlob(query)) {
      return {
        hits: globResult.paths.map((filePath) => ({
          path: filePath,
          match: "filename",
          preview: path.basename(filePath)
        })),
        truncated: globResult.truncated,
        maxHits: globResult.maxHits,
        maxDepth: globResult.maxDepth,
        searchPath: globResult.searchPath
      };
    }
  }
  if (query) {
    const grepResult = await grepWorkspaceFiles(workspacePath, {
      pattern: query,
      searchPath,
      glob: glob || undefined,
      literal: true,
      ignoreCase: true,
      maxHits: maxHits ?? MAX_SEARCH_HITS,
      maxDepth: maxDepth ?? MAX_SEARCH_DEPTH
    });
    if (namePattern) {
      const nameRe = new RegExp(namePattern, "i");
      grepResult.matches = grepResult.matches.filter((match) => nameRe.test(path.basename(match.path)));
    }
    return {
      hits: grepResult.matches.map((match) => ({
        path: match.path,
        line: match.line,
        match: "content",
        preview: match.preview.split("\n")[0]?.replace(/^[^:]+:\d+:?\s*/, "") ?? match.preview
      })),
      truncated: grepResult.truncated,
      maxHits: grepResult.maxHits,
      maxDepth: grepResult.maxDepth,
      searchPath: grepResult.searchPath
    };
  }
  if (namePattern) {
    const globResult = await globWorkspaceFiles(workspacePath, {
      pattern: "**/*",
      searchPath,
      namePattern,
      maxHits: maxHits ?? MAX_SEARCH_HITS,
      maxDepth: maxDepth ?? MAX_SEARCH_DEPTH
    });
    return {
      hits: globResult.paths.map((filePath) => ({
        path: filePath,
        match: "filename",
        preview: path.basename(filePath)
      })),
      truncated: globResult.truncated,
      maxHits: globResult.maxHits,
      maxDepth: globResult.maxDepth,
      searchPath: globResult.searchPath
    };
  }
  throw new Error("Provide at least one of query, glob, or namePattern.");
}
