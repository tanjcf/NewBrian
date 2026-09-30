import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { generateArtifact, validateArtifactCreateInput, validateDocumentCreateInput } from "./artifact-generator.js";
import {
  attachResolvedStyleToInput,
  resolveDocumentStyle
} from "./delivery-preferences.js";
import { analyzeSpreadsheet, inspectSpreadsheet, updateSpreadsheet, verifySpreadsheetArtifact } from "./spreadsheet-workbook.js";
import {
  COMMAND_OUTPUT_LIMITS,
  createBoundedStreamCollector,
  truncateHeadTail
} from "./command-output.js";
import {
  enrichShellEnvForTools,
  formatMissingHostToolGuidance,
  guardShellWholeFileWrite,
  guardUnboundedRecursiveSearch
} from "./shell-env.js";
import { decodeChildOutputBuffer } from "./windows-encoding.js";
import {
  MAX_GLOB_HITS,
  MAX_GREP_HITS,
  MAX_SEARCH_DEPTH,
  MAX_SEARCH_HITS,
  WORKSPACE_IGNORED_NAMES,
  globWorkspaceFiles,
  grepWorkspaceFiles,
  searchWorkspaceFiles
} from "./workspace-search.js";
import {
  MAX_WRITE_BYTES,
  applyWorkspacePatch,
  editWorkspaceFile,
  readWorkspaceFile,
  resolveSafeWorkspacePath
} from "./workspace-fs.js";
import {
  handleShellProcessAction,
  startShellProcess
} from "./shell-process-registry.js";
import { CapabilityRegistry } from "./capability-registry.js";
import { CapabilityRuntime } from "./capability-runtime.js";
import { verifyBuiltinArtifactResult, verifyBuiltinResult, verifySpreadsheetResult } from "./capability-verifier.js";
import { createBuiltinCapabilityCatalog as createBuiltinCatalogFromDescriptors } from "./builtin-capability-catalog.js";

export { COMMAND_OUTPUT_LIMITS, truncateHeadTail };

const IGNORED_NAMES = WORKSPACE_IGNORED_NAMES;
const MAX_TREE_ENTRIES = 400;
const TOOL_ALIASES = Object.freeze({
  read: "workspace.read",
  glob: "workspace.glob",
  grep: "workspace.grep",
  edit: "workspace.edit",
  write: "workspace.write_file",
  apply_patch: "workspace.apply_patch",
  exec: "shell.exec",
  process: "shell.process"
});

function formatCommandOutput(stdout, stderr) {
  return [String(stdout || "").trim(), String(stderr || "").trim()].filter(Boolean).join("\n");
}

function decodeStreamBuffer(buffer) {
  return decodeChildOutputBuffer(buffer);
}

/**
 * PowerShell rejects bash `&&` chaining. Rewrite operators outside quotes so
 * models that emit POSIX habits still run on Windows.
 */
export function rewriteBashOperatorsForPowerShell(command) {
  const text = String(command ?? "");
  let out = "";
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (quote) {
      out += ch;
      if (ch === "`" && quote === '"' && index + 1 < text.length) {
        out += text[index + 1];
        index += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "&" && text[index + 1] === "&") {
      out += ";";
      index += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

export function normalizeWindowsShellCommand(command) {
  const requested = String(command ?? "").trim();
  const nested = requested.match(/^&?\s*(?:powershell|powershell\.exe|pwsh|pwsh\.exe)\s+(?:(?:-NoLogo|-NoProfile|-NonInteractive)\s+)*-Command\s+([\s\S]+)$/i);
  let body = requested;
  if (nested) {
    body = nested[1].trim();
    const quote = body[0];
    if ((quote === '"' || quote === "'") && body.at(-1) === quote) {
      body = body.slice(1, -1);
      if (quote === '"') body = body.replace(/\\"/g, '"');
    }
    body = body.trim();
  }
  return rewriteBashOperatorsForPowerShell(body).trim();
}

/**
 * Run a child process with bounded head+tail stream capture.
 * Caps match COMMAND_OUTPUT_LIMITS (maxCaptureBytes ≈ former maxBuffer).
 */
async function execShellCommand(command, args, options = {}) {
  const maxCaptureBytes = options.maxBuffer ?? COMMAND_OUTPUT_LIMITS.maxCaptureBytes;
  const stdoutCollector = createBoundedStreamCollector({
    ...COMMAND_OUTPUT_LIMITS,
    maxCaptureBytes
  });
  const stderrCollector = createBoundedStreamCollector({
    ...COMMAND_OUTPUT_LIMITS,
    maxCaptureBytes
  });

  return await new Promise((resolve) => {
    let settled = false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      resolve(payload);
    };

    const killTree = () => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore"
        });
        killer.unref();
      } else {
        try { child.kill("SIGKILL"); } catch { /* already exited */ }
      }
    };

    const onAbort = () => {
      killTree();
      const stdout = stdoutCollector.finish(decodeStreamBuffer);
      const stderr = stderrCollector.finish(decodeStreamBuffer);
      finish({
        ok: false,
        exitCode: 1,
        stdout: stdout.text,
        stderr: stderr.text,
        outputTruncated: stdout.truncated || stderr.truncated,
        originalOutputBytes: stdout.originalBytes + stderr.originalBytes,
        failureMessage: "Aborted",
        output: formatCommandOutput(stdout.text, stderr.text) || "Aborted"
      });
    };

    child.stdout.on("data", (chunk) => stdoutCollector.write(chunk));
    child.stderr.on("data", (chunk) => stderrCollector.write(chunk));
    child.on("error", (error) => {
      const stdout = stdoutCollector.finish(decodeStreamBuffer);
      const stderr = stderrCollector.finish(decodeStreamBuffer);
      finish({
        ok: false,
        exitCode: 1,
        stdout: stdout.text,
        stderr: stderr.text,
        outputTruncated: stdout.truncated || stderr.truncated,
        originalOutputBytes: stdout.originalBytes + stderr.originalBytes,
        failureMessage: error instanceof Error ? error.message : String(error),
        output: formatCommandOutput(stdout.text, stderr.text) || (error instanceof Error ? error.message : String(error))
      });
    });
    child.on("close", (code, signal) => {
      const stdout = stdoutCollector.finish(decodeStreamBuffer);
      const stderr = stderrCollector.finish(decodeStreamBuffer);
      const exitCode = typeof code === "number" ? code : (signal ? 1 : 0);
      const ok = exitCode === 0;
      const failureMessage = ok ? undefined : (signal ? `Killed by ${signal}` : `Exit code ${exitCode}`);
      finish({
        ok,
        exitCode,
        stdout: stdout.text,
        stderr: stderr.text,
        outputTruncated: stdout.truncated || stderr.truncated,
        originalOutputBytes: stdout.originalBytes + stderr.originalBytes,
        failureMessage,
        output: formatCommandOutput(stdout.text, stderr.text) || failureMessage || ""
      });
    });

    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function toRelativeWorkspacePath(workspacePath, targetPath) {
  return path.relative(workspacePath, targetPath).split(path.sep).join("/");
}

/** Prefer relative paths; in-workspace absolute paths are coerced (OpenClaw-style). */
async function resolveSafeWorkspaceTarget(workspacePath, targetPath) {
  const requested = String(targetPath ?? "").trim();
  if (!requested) {
    const error = new Error("targetPath is required.");
    error.nextAction = "Pass a workspace-relative path such as outputs/report.html or src/app.ts.";
    throw error;
  }
  try {
    return await resolveSafeWorkspacePath(workspacePath, requested, { fieldName: "targetPath" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof Error && !error.nextAction) {
      error.nextAction = [
        "Use a path relative to the attached workspace (example: outputs/foo.html).",
        "Absolute paths are accepted only when they resolve inside that workspace; outside paths are rejected.",
        "Do not fall back to shell.exec / Set-Content / heredoc to write the file—call workspace.write_file again with a relative path."
      ].join(" ");
    }
    if (error instanceof Error) throw error;
    const wrapped = new Error(message);
    wrapped.nextAction = "Retry with a workspace-relative targetPath via workspace.write_file.";
    throw wrapped;
  }
}

function enrichFailedToolResult(toolName, error, durationMs) {
  const message = error instanceof Error ? error.message : String(error);
  const nextAction = error instanceof Error && typeof error.nextAction === "string" && error.nextAction.trim()
    ? error.nextAction.trim()
    : inferToolFailureNextAction(toolName, message);
  return {
    ok: false,
    toolName,
    exitCode: 1,
    output: nextAction ? `${message}\n\nnext_action: ${nextAction}` : message,
    durationMs,
    ...(nextAction ? { next_action: nextAction } : {})
  };
}

function inferToolFailureNextAction(toolName, message) {
  const text = String(message || "");
  const name = String(toolName || "");
  if (/must stay inside|resolves outside|must be relative|targetPath is required/i.test(text)) {
    return "Retry with a workspace-relative path (e.g. outputs/file.html). Prefer workspace.write_file; do not write via shell.exec.";
  }
  if (name === "workspace.write_file" || name === "write") {
    return "Fix targetPath/content and retry workspace.write_file. Do not switch to shell.exec to create the file.";
  }
  if (name === "shell.exec" || name === "exec") {
    return "Prefer workspace.read/edit/apply_patch/write_file for file IO. On Windows use PowerShell syntax only—never Bash $(...) / heredoc for writing files.";
  }
  return "";
}

function requireWorkspaceWrite(input) {
  const targetPath = typeof input?.targetPath === "string" ? input.targetPath.trim() : "";
  const content = typeof input?.content === "string" ? input.content : "";
  if (!targetPath) throw new Error("targetPath is required.");
  const encoding = input?.encoding === "base64" ? "base64" : "utf8";
  const bytes = Buffer.byteLength(content, encoding);
  if (bytes > MAX_WRITE_BYTES) throw new Error(`File content exceeds ${MAX_WRITE_BYTES} bytes.`);
  return { targetPath, content, encoding };
}

function requireArtifactPath(input) {
  const targetPath = typeof input?.targetPath === "string" ? input.targetPath.trim() : "";
  if (!targetPath) throw new Error("targetPath is required.");
  return { targetPath };
}

function projectArtifactPath(targetPath) {
  const filename = path.basename(String(targetPath ?? "").replaceAll("\\", "/"));
  if (!filename || filename === "." || filename === "..") throw new Error("Artifact filename is required.");
  return path.join("outputs", filename);
}

function inspectArtifactBytes(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { type: "image/png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") {
    const text = bytes.toString("latin1");
    return { type: "application/pdf", pages: (text.match(/\/Type\s*\/Page\b/g) ?? []).length };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { type: "image/jpeg" };
  }
  const prefix = bytes.subarray(0, 512).toString("utf8").trimStart();
  if (prefix.startsWith("<svg") || /<svg[\s>]/i.test(prefix)) return { type: "image/svg+xml" };
  return { type: "application/octet-stream" };
}

async function scanWorkspaceEntries(workspacePath) {
  const entries = [];
  let truncated = false;
  async function walk(currentPath, depth) {
    if (entries.length >= MAX_TREE_ENTRIES) {
      truncated = true;
      return;
    }
    const directoryEntries = await fs.readdir(currentPath, { withFileTypes: true });
    directoryEntries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
    for (const entry of directoryEntries) {
      if (IGNORED_NAMES.has(entry.name) || entry.name.startsWith("tmp-")) continue;
      const absolutePath = path.join(currentPath, entry.name);
      entries.push({
        path: toRelativeWorkspacePath(workspacePath, absolutePath),
        name: entry.name,
        kind: entry.isDirectory() ? "directory" : "file",
        depth
      });
      if (entries.length >= MAX_TREE_ENTRIES) {
        truncated = true;
        return;
      }
      if (entry.isDirectory()) await walk(absolutePath, depth + 1);
    }
  }
  await walk(workspacePath, 0);
  return { entries, truncated, maxEntries: MAX_TREE_ENTRIES };
}

function requireGlobInput(input) {
  const pattern = typeof input?.pattern === "string" ? input.pattern.trim() : "";
  if (!pattern) throw new Error("pattern is required.");
  const searchPath = typeof input?.path === "string" ? input.path.trim().replace(/\\/g, "/") : "";
  const namePattern = typeof input?.namePattern === "string" ? input.namePattern.trim() : "";
  return {
    pattern,
    searchPath,
    namePattern,
    maxHits: Math.min(MAX_GLOB_HITS, Math.max(1, Number(input?.maxHits) || MAX_GLOB_HITS)),
    maxDepth: Math.min(MAX_SEARCH_DEPTH, Math.max(1, Number(input?.maxDepth) || MAX_SEARCH_DEPTH))
  };
}

function requireGrepInput(input) {
  const pattern = typeof input?.pattern === "string" ? input.pattern.trim() : "";
  if (!pattern) throw new Error("pattern is required.");
  const searchPath = typeof input?.path === "string" ? input.path.trim().replace(/\\/g, "/") : "";
  const glob = typeof input?.glob === "string" ? input.glob.trim() : "";
  return {
    pattern,
    searchPath,
    glob,
    ignoreCase: Boolean(input?.ignoreCase),
    literal: Boolean(input?.literal),
    context: Math.max(0, Number(input?.context) || 0),
    maxHits: Math.min(MAX_GREP_HITS, Math.max(1, Number(input?.maxHits) || MAX_GREP_HITS)),
    maxDepth: Math.min(MAX_SEARCH_DEPTH, Math.max(1, Number(input?.maxDepth) || MAX_SEARCH_DEPTH))
  };
}

function requireSearchQuery(input) {
  const query = typeof input?.query === "string" ? input.query.trim() : "";
  const glob = typeof input?.glob === "string" ? input.glob.trim() : "";
  const namePattern = typeof input?.namePattern === "string" ? input.namePattern.trim() : "";
  const searchPath = typeof input?.path === "string" ? input.path.trim().replace(/\\/g, "/") : "";
  if (!query && !glob && !namePattern) {
    throw new Error("Provide at least one of query, glob, or namePattern.");
  }
  return {
    query,
    glob,
    namePattern,
    searchPath,
    maxHits: Math.min(MAX_SEARCH_HITS, Math.max(1, Number(input?.maxHits) || MAX_SEARCH_HITS)),
    maxDepth: Math.min(MAX_SEARCH_DEPTH, Math.max(1, Number(input?.maxDepth) || MAX_SEARCH_DEPTH))
  };
}

export class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(definition, options = {}) {
    if (!definition?.name || typeof definition.execute !== "function") {
      throw new Error("Tool definitions require a name and execute handler.");
    }
    if (this.tools.has(definition.name) && !options.replace) throw new Error(`Tool already registered: ${definition.name}`);
    this.tools.set(definition.name, Object.freeze({ ...definition }));
    return this;
  }

  /** Register an OpenClaw-compatible alias that shares the canonical tool implementation. */
  registerAlias(aliasName, canonicalName) {
    const canonical = this.tools.get(canonicalName);
    if (!canonical) throw new Error(`Cannot alias unknown tool: ${canonicalName}`);
    if (this.tools.has(aliasName)) throw new Error(`Tool already registered: ${aliasName}`);
    this.tools.set(aliasName, Object.freeze({
      ...canonical,
      name: aliasName,
      title: `${canonical.title || canonicalName} (alias)`,
      description: `Alias for ${canonicalName}. ${canonical.description || ""}`.trim(),
      canonicalName
    }));
    return this;
  }

  unregister(name) {
    return this.tools.delete(name);
  }

  unregisterWhere(predicate) {
    const removed = [];
    for (const [name, tool] of this.tools) {
      if (predicate(tool)) {
        this.tools.delete(name);
        removed.push(name);
      }
    }
    return removed;
  }

  resolveName(name) {
    const requested = String(name ?? "").trim();
    if (this.tools.has(requested)) return requested;
    const mapped = TOOL_ALIASES[requested];
    if (mapped && this.tools.has(mapped)) return mapped;
    return requested;
  }

  get(name) {
    return this.tools.get(this.resolveName(name));
  }

  list() {
    return [...this.tools.values()].map(({ execute: _execute, validate: _validate, ...descriptor }) => ({ ...descriptor }));
  }

  async invoke(name, input, context) {
    const resolvedName = this.resolveName(name);
    const tool = this.tools.get(resolvedName);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    const startedAt = Date.now();
    try {
      const normalizedInput = tool.validate ? tool.validate(input ?? {}) : (input ?? {});
      const result = await tool.execute(normalizedInput, context);
      return { ...result, toolName: tool.name || resolvedName, durationMs: Date.now() - startedAt };
    } catch (error) {
      return enrichFailedToolResult(tool.name || resolvedName, error, Date.now() - startedAt);
    }
  }
}

function requireCommand(input) {
  const command = typeof input?.command === "string" ? input.command.trim() : "";
  if (!command) throw new Error("Shell command cannot be empty.");
  const workdir = typeof input?.workdir === "string" ? input.workdir.trim() : "";
  const background = Boolean(input?.background);
  const yieldMs = input?.yieldMs === undefined || input?.yieldMs === null
    ? undefined
    : Number(input.yieldMs);
  return { command, workdir, background, yieldMs };
}

function requireReadInput(input) {
  const filePath = typeof input?.path === "string" ? input.path.trim() : "";
  if (!filePath) throw new Error("path is required.");
  const offset = input?.offset === undefined || input?.offset === null ? undefined : Number(input.offset);
  const limit = input?.limit === undefined || input?.limit === null ? undefined : Number(input.limit);
  if (offset !== undefined && (!Number.isFinite(offset) || offset < 1)) {
    throw new Error("offset must be an integer >= 1.");
  }
  if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
    throw new Error("limit must be an integer >= 1.");
  }
  return {
    path: filePath,
    offset: offset === undefined ? undefined : Math.floor(offset),
    limit: limit === undefined ? undefined : Math.floor(limit),
    lineNumbers: input?.lineNumbers !== false
  };
}

function requireEditInput(input) {
  const normalized = input && typeof input === "object" ? { ...input } : {};
  const filePath = typeof normalized.path === "string" ? normalized.path.trim() : "";
  if (!filePath) throw new Error("path is required.");
  return { ...normalized, path: filePath };
}

function requireApplyPatchInput(input) {
  const patchInput = typeof input?.input === "string" ? input.input : "";
  if (!patchInput.trim()) throw new Error("input is required (*** Begin Patch ... *** End Patch).");
  return { input: patchInput };
}

function requireProcessInput(input) {
  const action = typeof input?.action === "string" ? input.action.trim() : "";
  if (!action) throw new Error("action is required.");
  return {
    action,
    sessionId: typeof input?.sessionId === "string" ? input.sessionId.trim() : undefined,
    data: typeof input?.data === "string" ? input.data : undefined,
    offset: input?.offset === undefined || input?.offset === null ? undefined : Number(input.offset),
    limit: input?.limit === undefined || input?.limit === null ? undefined : Number(input.limit),
    timeout: input?.timeout === undefined || input?.timeout === null ? undefined : Number(input.timeout)
  };
}

export function createBuiltinToolRegistry() {
  return new ToolRegistry()
    .register({
      name: "workspace.scan",
      title: "Workspace scan",
      description: "Scan files under the attached workspace (ignores node_modules/.git/venv/dist/out/target/__pycache__). Prefer workspace.glob / workspace.grep for finding files or code.",
      kind: "read",
      risk: "low",
      requiresApproval: false,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async execute(_input, context) {
        const scanned = await scanWorkspaceEntries(context.workspacePath);
        const note = scanned.truncated
          ? ` Indexed ${scanned.entries.length}/${scanned.maxEntries} entries (truncated). Prefer workspace.glob or workspace.grep.`
          : "";
        return {
          ok: true,
          exitCode: 0,
          output: `Indexed ${scanned.entries.length} workspace entries.${note}`,
          workspace: scanned.entries,
          truncated: scanned.truncated,
          command: "workspace.scan"
        };
      }
    })
    .register({
      name: "workspace.glob",
      title: "Workspace glob",
      description:
        `Find files by glob pattern under the attached workspace (ignores node_modules/.git/venv/dist/out/target/__pycache__). Like OpenClaw find. Caps ${MAX_GLOB_HITS} paths, depth ${MAX_SEARCH_DEPTH}. Example: { pattern: "**/*.py", path: "python-platform/src", namePattern: "auth|user|security" }.`,
      kind: "read",
      risk: "low",
      requiresApproval: false,
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", minLength: 1 },
          path: { type: "string", minLength: 1 },
          namePattern: { type: "string", minLength: 1 },
          maxHits: { type: "number", minimum: 1, maximum: MAX_GLOB_HITS },
          maxDepth: { type: "number", minimum: 1, maximum: MAX_SEARCH_DEPTH }
        },
        required: ["pattern"],
        additionalProperties: false
      },
      validate: requireGlobInput,
      async execute(input, context) {
        const result = await globWorkspaceFiles(context.workspacePath, input);
        const scope = result.searchPath && result.searchPath !== "." ? ` under ${result.searchPath}` : "";
        const summary = result.truncated
          ? `Found ${result.paths.length} paths${scope} (truncated at maxHits=${result.maxHits}). Refine pattern or path.`
          : result.paths.length === 0
            ? `No files found matching ${result.pattern}${scope}.`
            : `Found ${result.paths.length} paths${scope}.`;
        return {
          ok: true,
          exitCode: 0,
          output: summary,
          paths: result.paths,
          truncated: result.truncated,
          pattern: result.pattern,
          path: result.searchPath,
          command: `workspace.glob ${result.pattern}`
        };
      }
    })
    .register({
      name: "workspace.grep",
      title: "Workspace grep",
      description:
        `Search file contents by regex or literal pattern (ignores node_modules/.git/venv/dist/out/target/__pycache__). Like OpenClaw grep. Caps ${MAX_GREP_HITS} matches, depth ${MAX_SEARCH_DEPTH}. Example: { pattern: "def authenticate", path: "python-platform/src", glob: "*.py" }.`,
      kind: "read",
      risk: "low",
      requiresApproval: false,
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", minLength: 1 },
          path: { type: "string", minLength: 1 },
          glob: { type: "string", minLength: 1 },
          ignoreCase: { type: "boolean" },
          literal: { type: "boolean" },
          context: { type: "number", minimum: 0, maximum: 5 },
          maxHits: { type: "number", minimum: 1, maximum: MAX_GREP_HITS },
          maxDepth: { type: "number", minimum: 1, maximum: MAX_SEARCH_DEPTH }
        },
        required: ["pattern"],
        additionalProperties: false
      },
      validate: requireGrepInput,
      async execute(input, context) {
        const result = await grepWorkspaceFiles(context.workspacePath, input);
        const scope = result.searchPath && result.searchPath !== "." ? ` under ${result.searchPath}` : "";
        const summary = result.truncated
          ? `Found ${result.matches.length} matches${scope} (truncated at maxHits=${result.maxHits}). Refine pattern or raise limit.`
          : result.matches.length === 0
            ? `No matches for /${result.pattern}/${scope}.`
            : `Found ${result.matches.length} matches${scope}.`;
        const outputText = result.matches.length
          ? `${summary}\n${result.matches.map((match) => match.preview).join("\n")}`
          : summary;
        return {
          ok: true,
          exitCode: 0,
          output: outputText,
          matches: result.matches,
          truncated: result.truncated,
          linesTruncated: result.linesTruncated,
          pattern: result.pattern,
          glob: result.glob,
          path: result.searchPath,
          command: `workspace.grep ${result.pattern}`
        };
      }
    })
    .register({
      name: "workspace.search",
      title: "Workspace search",
      description:
        "Compatibility wrapper. Prefer workspace.glob for filenames and workspace.grep for content. Accepts query/glob/namePattern/path like earlier releases.",
      kind: "read",
      risk: "low",
      requiresApproval: false,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 1 },
          glob: { type: "string", minLength: 1 },
          namePattern: { type: "string", minLength: 1 },
          path: { type: "string", minLength: 1 },
          maxHits: { type: "number", minimum: 1, maximum: MAX_SEARCH_HITS },
          maxDepth: { type: "number", minimum: 1, maximum: MAX_SEARCH_DEPTH }
        },
        additionalProperties: false
      },
      validate: requireSearchQuery,
      async execute(input, context) {
        const result = await searchWorkspaceFiles(context.workspacePath, input);
        const scope = result.searchPath && result.searchPath !== "." ? ` under ${result.searchPath}` : "";
        const summary = result.truncated
          ? `Found ${result.hits.length} hits${scope} (truncated at maxHits=${result.maxHits}). Refine glob/query or raise specificity.`
          : `Found ${result.hits.length} hits${scope}.`;
        return {
          ok: true,
          exitCode: 0,
          output: summary,
          hits: result.hits,
          truncated: result.truncated,
          query: input.query,
          glob: input.glob,
          namePattern: input.namePattern,
          path: input.searchPath,
          command: `workspace.search ${input.query || input.glob || input.namePattern || ""}`.trim()
        };
      }
    })
    .register({
      name: "workspace.read",
      title: "Read workspace file",
      description:
        "Read a text file inside the attached workspace with optional 1-based offset/limit line window and numbered lines. Prefer this over shell Get-Content/cat for source files. Caps large reads and returns truncation metadata. Alias: read.",
      kind: "read",
      risk: "low",
      requiresApproval: false,
      replaySafe: true,
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", minLength: 1 },
          offset: { type: "integer", minimum: 1 },
          limit: { type: "integer", minimum: 1 },
          lineNumbers: { type: "boolean" }
        },
        required: ["path"],
        additionalProperties: false
      },
      validate: requireReadInput,
      async execute(input, context) {
        return readWorkspaceFile(context.workspacePath, input);
      }
    })
    .register({
      name: "workspace.edit",
      title: "Edit workspace file",
      description:
        "Exact string replace inside a workspace file. Provide edits:[{oldText,newText}] where each oldText must match uniquely. Prefer this over shell sed/PowerShell replace for code edits. Alias: edit.",
      kind: "write",
      risk: "medium",
      // Phase 3 MVP: default never-ask for coding friction; PolicyEngine may still ask when tools.write.ask=always|on-create.
      requiresApproval: false,
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", minLength: 1 },
          edits: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                oldText: { type: "string" },
                newText: { type: "string" }
              },
              required: ["oldText", "newText"],
              additionalProperties: false
            }
          },
          oldText: { type: "string" },
          newText: { type: "string" }
        },
        required: ["path"],
        additionalProperties: false
      },
      validate: requireEditInput,
      async execute(input, context) {
        return editWorkspaceFile(context.workspacePath, input);
      }
    })
    .register({
      name: "workspace.apply_patch",
      title: "Apply workspace patch",
      description:
        "Apply an OpenAI-style multi-file patch envelope (*** Begin Patch / *** End Patch) with Add File, Update File (+ optional Move to), and Delete File hunks. Prefer for multi-file refactors. Alias: apply_patch. Limitations: text-only; binary unsupported.",
      kind: "write",
      risk: "medium",
      requiresApproval: false,
      inputSchema: {
        type: "object",
        properties: {
          input: { type: "string", minLength: 1 }
        },
        required: ["input"],
        additionalProperties: false
      },
      validate: requireApplyPatchInput,
      async execute(input, context) {
        return applyWorkspacePatch(context.workspacePath, input.input);
      }
    })
    .register({
      name: "workspace.write_file",
      title: "Write workspace file",
      description: "Write UTF-8 or base64 content inside the attached workspace. Prefer a relative targetPath (e.g. outputs/a.html); absolute paths are accepted only when they resolve under the workspace. Prefer workspace.edit for localized changes. Never use shell.exec to write source. Alias: write.",
      kind: "write",
      risk: "medium",
      requiresApproval: false,
      inputSchema: {
        type: "object",
        properties: {
          targetPath: {
            type: "string",
            minLength: 1,
            description: "Workspace-relative path preferred (outputs/report.html). In-workspace absolute paths are coerced."
          },
          content: { type: "string" },
          encoding: { type: "string", enum: ["utf8", "base64"] }
        },
        required: ["targetPath", "content"],
        additionalProperties: false
      },
      validate: requireWorkspaceWrite,
      async execute(input, context) {
        const resolved = await resolveSafeWorkspaceTarget(context.workspacePath, input.targetPath);
        const previousStat = await fs.stat(resolved.target).catch(() => null);
        await fs.mkdir(path.dirname(resolved.target), { recursive: true });
        await fs.writeFile(resolved.target, input.content, { encoding: input.encoding });
        const stat = await fs.stat(resolved.target);
        return {
          ok: true,
          exitCode: 0,
          output: `Wrote ${resolved.relativePath} (${stat.size} bytes).`,
          command: `write ${resolved.relativePath}`,
          artifact: {
            path: resolved.relativePath,
            size: stat.size,
            changeType: previousStat?.isFile() ? "modified" : "created"
          }
        };
      }
    })
    .register({
      name: "artifact.create",
      title: "Create office artifact",
      description: "Create a real PDF, PowerPoint, HTML slides, Excel, or Word file inside the workspace. For government writing PDF/DOCX prefer document.create_pdf or document.create_docx with structured sections. Required: targetPath under outputs/. format must be pdf|pptx|html|xlsx|docx (never page size a4). For presentations include chart (统计图), timeline/process (阶段图), and image (展示图) slides—not text-only decks. chart uses categories+values; phases for stage diagrams; imagePath from image_generate or imagePlaceholder. Pass plain text/Markdown only—never HTML/XML document dumps.",
      kind: "write",
      risk: "medium",
      requiresApproval: false,
      inputSchema: {
        type: "object",
        properties: {
          targetPath: {
            type: "string",
            minLength: 1,
            description: "Workspace-relative path such as outputs/宣讲稿-第一版.pdf"
          },
          format: {
            type: "string",
            enum: ["pdf", "pptx", "html", "xlsx", "docx"],
            description: "File format only. Never pass page size values such as a4 or letter. Use html for web-first slide decks; pptx also writes a companion .slides.html."
          },
          title: { type: "string" },
          subtitle: { type: "string" },
          content: { type: "string" },
          sections: { type: "array", items: { type: "object", properties: { heading: { type: "string" }, body: { type: "string" }, bullets: { type: "array", items: { type: "string" } } }, additionalProperties: false } },
          slides: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                subtitle: { type: "string" },
                body: { type: "string" },
                bullets: { type: "array", items: { type: "string" } },
                layout: { type: "string", enum: ["title", "section", "bullets", "columns", "cards", "closing", "stat", "chart", "timeline", "process", "image"] },
                chart: {
                  type: "object",
                  properties: {
                    type: { type: "string", enum: ["bar", "line", "pie", "doughnut", "area"] },
                    categories: { type: "array", items: { type: "string" } },
                    labels: { type: "array", items: { type: "string" } },
                    seriesName: { type: "string" },
                    values: { type: "array", items: { type: "number" } },
                    series: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          name: { type: "string" },
                          values: { type: "array", items: { type: "number" } }
                        },
                        additionalProperties: false
                      }
                    }
                  },
                  additionalProperties: false
                },
                phases: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string" },
                      title: { type: "string" },
                      body: { type: "string" }
                    },
                    additionalProperties: false
                  }
                },
                imagePath: { type: "string", description: "Workspace-relative PNG/JPG path (outputs/ or .newbrain/generated-media/image/)" },
                imagePlaceholder: { type: "string", description: "Placeholder text when imagePath is not yet available" },
                caption: { type: "string" },
                columns: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      bullets: { type: "array", items: { type: "string" } }
                    },
                    additionalProperties: false
                  }
                },
                cards: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      body: { type: "string" }
                    },
                    additionalProperties: false
                  }
                }
              },
              additionalProperties: false
            }
          },
          sheets: { type: "array", items: { type: "object", properties: { name: { type: "string" }, rows: { type: "array", items: { type: "array", items: {} } } }, additionalProperties: false } },
          rows: { type: "array", items: { type: "array", items: {} } }
        },
        required: ["targetPath"],
        additionalProperties: false
      },
      validate: validateArtifactCreateInput,
      async execute(input, context) {
        return executeArtifactCreate(input, context);
      }
    })
    .register(createStructuredDocumentTool("pdf"))
    .register(createStructuredDocumentTool("docx"))
    .register({
      name: "artifact.inspect",
      title: "Inspect output artifact",
      description: "Verify that a generated file exists inside the workspace and inspect its real file signature, byte size, and basic image/PDF metadata.",
      kind: "read",
      risk: "low",
      requiresApproval: false,
      inputSchema: {
        type: "object",
        properties: { targetPath: { type: "string", minLength: 1 } },
        required: ["targetPath"],
        additionalProperties: false
      },
      validate: requireArtifactPath,
      async execute(input, context) {
        const resolved = await resolveSafeWorkspaceTarget(context.workspacePath, input.targetPath);
        const stat = await fs.stat(resolved.target);
        if (!stat.isFile()) throw new Error(`${resolved.relativePath} is not a file.`);
        const bytes = await fs.readFile(resolved.target);
        const metadata = inspectArtifactBytes(bytes);
        return {
          ok: true,
          exitCode: 0,
          output: JSON.stringify({ path: resolved.relativePath, size: stat.size, ...metadata }),
          command: `inspect ${resolved.relativePath}`,
          artifact: { path: resolved.relativePath, size: stat.size, ...metadata }
        };
      }
    })
    .register(spreadsheetTool("inspect", "read", async (input, context) => {
      const source = await resolveSafeWorkspaceTarget(context.workspacePath, input.targetPath);
      return { ok: true, output: JSON.stringify(await inspectSpreadsheet(source.target, input)) };
    }))
    .register(spreadsheetTool("analyze", "read", async (input, context) => {
      const source = await resolveSafeWorkspaceTarget(context.workspacePath, input.targetPath);
      return { ok: true, output: JSON.stringify(await analyzeSpreadsheet(source.target, input)) };
    }))
    .register(spreadsheetTool("update", "write", async (input, context) => {
      const source = await resolveSafeWorkspaceTarget(context.workspacePath, input.targetPath);
      const target = await resolveSafeWorkspaceTarget(context.workspacePath, input.outputPath || input.targetPath);
      const result = await updateSpreadsheet(source.target, target.target, input.operations || []);
      const stat = await fs.stat(target.target);
      const verification = await verifySpreadsheetArtifact(target.target);
      return { ok: true, output: JSON.stringify(result), artifact: { path: target.relativePath, size: stat.size, format: "xlsx", verified: true, verification } };
    }))
    .register({
      name: "git.status",
      title: "Git status",
      description: "Inspect the current repository status.",
      kind: "git",
      risk: "low",
      requiresApproval: false,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async execute(_input, context) {
        const result = await execShellCommand("git", ["-c", "core.quotepath=false", "status", "--short", "--branch"], {
          cwd: context.workspacePath,
          env: context.shellEnv,
          signal: context.abortSignal
        });
        return { ...result, command: "git -c core.quotepath=false status --short --branch" };
      }
    })
    .register({
      name: "shell.exec",
      title: "Shell command",
      description:
        "Run a shell command inside the attached workspace. Prefer workspace.read/edit/apply_patch/glob/grep for file IO and search; avoid unbounded Get-ChildItem -Recurse. Optional background/yieldMs moves long tasks into shell.process sessions. Alias: exec.",
      kind: "shell",
      risk: "high",
      requiresApproval: true,
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", minLength: 1 },
          workdir: { type: "string", minLength: 1 },
          background: { type: "boolean" },
          yieldMs: { type: "number", minimum: 0 }
        },
        required: ["command"],
        additionalProperties: false
      },
      validate: requireCommand,
      async execute(input, context) {
        const shellCommand = process.platform === "win32" ? "powershell.exe" : "/bin/zsh";
        const normalizedCommand = process.platform === "win32"
          ? normalizeWindowsShellCommand(input.command)
          : input.command;
        const blockedWrite = guardShellWholeFileWrite(normalizedCommand);
        if (blockedWrite) {
          return { ...blockedWrite, command: normalizedCommand, requestedCommand: input.command };
        }
        const blocked = guardUnboundedRecursiveSearch(normalizedCommand);
        if (blocked) {
          return { ...blocked, command: normalizedCommand, requestedCommand: input.command };
        }
        const shellArgs = process.platform === "win32"
          ? ["-NoLogo", "-NoProfile", "-Command", `[Console]::InputEncoding=[Console]::OutputEncoding=$OutputEncoding=[Text.UTF8Encoding]::new(); ${normalizedCommand}`]
          : ["-lc", normalizedCommand];
        const shellEnv = enrichShellEnvForTools(context.shellEnv ?? {});
        let cwd = context.workspacePath;
        if (input.workdir) {
          const resolved = await resolveSafeWorkspacePath(context.workspacePath, input.workdir, { fieldName: "workdir" });
          cwd = resolved.target;
        }
        const useSession = Boolean(input.background) || input.yieldMs !== undefined;
        if (useSession) {
          const result = await startShellProcess({
            command: shellCommand,
            args: shellArgs,
            cwd,
            env: shellEnv,
            displayCommand: normalizedCommand,
            background: Boolean(input.background),
            yieldMs: input.yieldMs,
            signal: context.abortSignal
          });
          if (!result.ok) {
            const guidance = formatMissingHostToolGuidance(normalizedCommand, result.output || result.failureMessage || "");
            if (guidance) {
              return {
                ...result,
                command: normalizedCommand,
                requestedCommand: input.command,
                output: [String(result.output || "").trim(), guidance].filter(Boolean).join("\n\n")
              };
            }
          }
          return { ...result, command: normalizedCommand, requestedCommand: input.command };
        }
        const result = await execShellCommand(shellCommand, shellArgs, {
          cwd,
          env: shellEnv,
          signal: context.abortSignal
        });
        if (!result.ok) {
          const guidance = formatMissingHostToolGuidance(normalizedCommand, result.output || result.failureMessage || "");
          if (guidance) {
            return {
              ...result,
              command: normalizedCommand,
              requestedCommand: input.command,
              output: [String(result.output || "").trim(), guidance].filter(Boolean).join("\n\n")
            };
          }
        }
        return { ...result, command: normalizedCommand, requestedCommand: input.command };
      }
    })
    .register({
      name: "shell.process",
      title: "Background shell process",
      description:
        "Manage background shell.exec sessions: list|poll|log|write|kill|remove. Use after shell.exec with background=true or yieldMs. Alias: process.",
      kind: "shell",
      risk: "high",
      // Managing an already-approved/spawned session does not re-prompt by default.
      requiresApproval: false,
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["list", "poll", "log", "write", "kill", "remove"]
          },
          sessionId: { type: "string" },
          data: { type: "string" },
          offset: { type: "number" },
          limit: { type: "number" },
          timeout: { type: "number", minimum: 0, maximum: 30000 }
        },
        required: ["action"],
        additionalProperties: false
      },
      validate: requireProcessInput,
      async execute(input) {
        return handleShellProcessAction(input);
      }
    })
    .registerAlias("read", "workspace.read")
    .registerAlias("glob", "workspace.glob")
    .registerAlias("grep", "workspace.grep")
    .registerAlias("edit", "workspace.edit")
    .registerAlias("write", "workspace.write_file")
    .registerAlias("apply_patch", "workspace.apply_patch")
    .registerAlias("exec", "shell.exec")
    .registerAlias("process", "shell.process");
}

export function createRuntimeCapabilityRegistry(toolRegistry = createBuiltinToolRegistry()) {
  const registry = new CapabilityRegistry();
  registry.registerProvider({
    id: "builtin.core",
    type: "builtin",
    version: "1.0.0",
    status: "active",
    capabilities: toolRegistry.list().map((tool) => tool.name)
  });
  for (const tool of toolRegistry.list()) {
    registry.registerCapability({
      id: tool.name,
      version: "1.0.0",
      providerId: "builtin.core",
      providerType: "builtin",
      inputSchema: tool.inputSchema || { type: "object" },
      outputSchema: { type: "object" },
      risk: tool.kind === "write" ? "local-write" : "read",
      permissions: tool.kind === "write" ? ["workspace.write"] : ["workspace.read"],
      approval: tool.requiresApproval ? "conditional" : "never",
      idempotency: tool.kind === "write" ? "request-and-tool-call" : "safe",
      verification: tool.name.startsWith("spreadsheet.") ? "spreadsheet.v1" : (tool.name.startsWith("artifact.") || tool.name.startsWith("document.create_") ? "builtin.artifact.v1" : "builtin.basic.v1")
    });
  }
  return registry;
}

export function createBuiltinCapabilityRuntime(toolRegistry = createBuiltinToolRegistry(), options = {}) {
  const registry = createRuntimeCapabilityRegistry(toolRegistry);
  const providerHandler = options.providerHandler || ((capabilityId, input, context) => toolRegistry.invoke(capabilityId, input, context));
  const providers = new Map([["builtin.core", (input, context) => providerHandler(context.capabilityId, input, context)]]);
  const verifiers = new Map([["spreadsheet.v1", verifySpreadsheetResult], ["builtin.artifact.v1", verifyBuiltinArtifactResult], ["builtin.basic.v1", verifyBuiltinResult]]);
  return new CapabilityRuntime({ registry, providers, verifiers, policy: options.policy });
}

export function createBuiltinCapabilityCatalog(toolRegistry = createBuiltinToolRegistry()) {
  return createBuiltinCatalogFromDescriptors(toolRegistry.list());
}

function spreadsheetTool(action, kind, execute) {
  return {
    name: `spreadsheet.${action}`,
    title: `${action} Excel workbook`,
    description: action === "inspect" ? "Read XLSX values, formulas, and sheet dimensions." : action === "analyze" ? "Group and aggregate XLSX table data deterministically." : "Edit an existing XLSX while preserving unaffected workbook content.",
    kind,
    risk: kind === "write" ? "medium" : "low",
    requiresApproval: false,
    inputSchema: { type: "object", properties: { targetPath: { type: "string" }, outputPath: { type: "string" }, sheet: { type: "string" }, sheetNames: { type: "array", items: { type: "string" } }, headerRow: { type: "integer" }, groupBy: { type: "array", items: { type: "string" } }, metrics: { type: "array", items: { type: "object" } }, operations: { type: "array", items: { type: "object" } }, maxRows: { type: "integer" }, maxColumns: { type: "integer" }, includeFormulas: { type: "boolean" } }, required: ["targetPath"], additionalProperties: false },
    validate(input) { if (!input?.targetPath) throw new Error("targetPath is required."); if (action === "update" && !input.operations?.length) throw new Error("operations are required."); return input; },
    execute
  };
}

const documentSectionSchema = {
  type: "object",
  properties: {
    heading: { type: "string", description: "Plain-text section heading" },
    body: { type: "string", description: "Plain Chinese or Markdown body. Never HTML/XML." },
    bullets: { type: "array", items: { type: "string" } }
  },
  additionalProperties: false
};

const documentStyleSchema = {
  type: "object",
  description: "Optional document.style overrides (fontFamily, fontSizePt, lineSpacing, headingBold, marginsMm)",
  properties: {
    fontFamily: { type: "string" },
    fontSizePt: { type: "number" },
    lineSpacing: { type: "number" },
    headingBold: { type: "boolean" },
    titleFontSizePt: { type: "number" },
    marginsMm: {
      type: "object",
      properties: {
        top: { type: "number" },
        right: { type: "number" },
        bottom: { type: "number" },
        left: { type: "number" }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
};

function createStructuredDocumentTool(format) {
  const extension = format;
  const properties = {
    targetPath: {
      type: "string",
      minLength: 1,
      description: `Workspace-relative path such as outputs/宣讲稿-第一版.${extension}`
    },
    title: { type: "string", minLength: 1, description: "Document title in plain text" },
    content: {
      type: "string",
      description: "Optional full plain-text/Markdown body when sections are omitted"
    },
    sections: {
      type: "array",
      description: "Preferred structured body",
      items: documentSectionSchema
    },
    style: documentStyleSchema
  };
  if (format === "docx") {
    properties.rows = {
      type: "array",
      description: "Optional comparison/table rows for Word tables (header row first)",
      items: { type: "array", items: {} }
    };
  }
  return {
    name: `document.create_${format}`,
    title: format === "pdf" ? "Create PDF document" : "Create Word document",
    description: [
      `Create a real .${extension} file from structured plain-text sections (OpenClaw-style encapsulation).`,
      "Required: title. Prefer sections:[{heading,body,bullets}].",
      format === "docx"
        ? "For 对照表 / comparison tables, pass rows:[[\"列1\",\"列2\"],[\"...\",\"...\"]] or Markdown pipe tables in body so Word keeps a real table."
        : null,
      "Optional targetPath under outputs/ ending with ." + extension + ".",
      "Never pass HTML/XML tags such as <document>, <p>, <h1>, <font>, or <margins>."
    ].filter(Boolean).join(" "),
    kind: "write",
    risk: "medium",
    requiresApproval: false,
    inputSchema: {
      type: "object",
      properties,
      required: ["title"],
      additionalProperties: false
    },
    validate: (input) => validateDocumentCreateInput(input, format),
    async execute(input, context) {
      return executeArtifactCreate(input, context);
    }
  };
}

async function executeArtifactCreate(input, context) {
  const resolvedStyle = resolveDocumentStyle({
    project: context?.deliveryPreferences?.project,
    thread: context?.deliveryPreferences?.thread,
    turn: context?.deliveryPreferences?.turn,
    explicit: input?.style
  });
  const styledInput = attachResolvedStyleToInput(input, resolvedStyle.values);
  const outputPath = projectArtifactPath(styledInput.targetPath);
  const resolved = await resolveSafeWorkspaceTarget(context.workspacePath, outputPath);
  const previousStat = await fs.stat(resolved.target).catch(() => null);
  const metadata = await generateArtifact(styledInput, resolved.target, {
    workspacePath: context.workspacePath,
    onSlideWritten: typeof context?.onArtifactProgress === "function"
      ? async (progress) => {
        await context.onArtifactProgress({
          path: resolved.relativePath,
          format: styledInput.format,
          slideCount: progress.slideCount,
          total: progress.total
        });
      }
      : undefined
  });
  const companionNote = styledInput.format === "pptx"
    ? ` Companion web deck: ${resolved.relativePath.replace(/\.pptx$/i, ".slides.html")}.`
    : styledInput.format === "html"
      ? " Open the HTML in a browser and use arrow keys to present."
      : "";
  const styleNote = Object.keys(resolvedStyle.values).length
    ? ` Applied delivery style: ${resolvedStyle.summary}.`
    : "";
  return {
    ok: true,
    exitCode: 0,
    output: `Created ${styledInput.format.toUpperCase()} ${resolved.relativePath} (${metadata.size} bytes).${companionNote}${styleNote}`,
    command: `create ${resolved.relativePath}`,
    artifact: {
      path: resolved.relativePath,
      size: metadata.size,
      type: metadata.type,
      format: styledInput.format,
      verified: true,
      changeType: previousStat?.isFile() ? "modified" : "created",
      ...(Object.keys(resolvedStyle.values).length ? { style: resolvedStyle.values } : {})
    }
  };
}
