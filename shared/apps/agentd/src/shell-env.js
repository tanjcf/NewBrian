import { existsSync, readdirSync } from "node:fs";
import { delimiter, join } from "node:path";

const PATH_KEY = process.platform === "win32" ? "Path" : "PATH";

/** Read Path/PATH from a plain env object (case-insensitive; merges duplicate keys). */
export function readPathFromEnv(env = {}) {
  return mergePathEntries(
    ...Object.entries(env ?? {})
      .filter(([key]) => key.toLowerCase() === "path")
      .map(([, value]) => String(value ?? ""))
  );
}

/** Collapse duplicate Path/PATH keys onto the platform-canonical key. */
export function writePathToEnv(env = {}, pathValue = "") {
  const next = { ...(env ?? {}) };
  for (const key of Object.keys(next)) {
    if (key.toLowerCase() === "path") delete next[key];
  }
  next[PATH_KEY] = String(pathValue ?? "");
  return next;
}

/** Deduplicate path segments while preserving order (first wins). */
export function mergePathEntries(...segments) {
  const seen = new Set();
  const out = [];
  for (const segment of segments) {
    for (const part of String(segment ?? "").split(delimiter)) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const key = process.platform === "win32" ? trimmed.toLowerCase() : trimmed;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
  }
  return out.join(delimiter);
}

function listExistingDirs(candidates) {
  return candidates.filter((candidate) => {
    try {
      return Boolean(candidate) && existsSync(candidate);
    } catch {
      return false;
    }
  });
}

/** Prepends BRAIN managed engine bins (ffmpeg/node/godot) when present under user data. */
export function discoverManagedEnginePathEntries(managedEnginesRoot = "") {
  const root = String(managedEnginesRoot || "").trim();
  if (!root) return [];
  const ffmpegBin = join(root, "ffmpeg", "bin");
  const nodeBin = process.platform === "win32" ? join(root, "node") : join(root, "node", "bin");
  const godotDir = join(root, "godot");
  return listExistingDirs([ffmpegBin, nodeBin, godotDir]);
}

function listWindowsPythonInstallDirs(localAppData) {
  if (!localAppData) return [];
  const root = join(localAppData, "Programs", "Python");
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^Python\d+/i.test(entry.name))
      .flatMap((entry) => {
        const base = join(root, entry.name);
        return [base, join(base, "Scripts")];
      });
  } catch {
    return [];
  }
}

/** Common Windows host locations for python.exe / py.exe (no install). */
export function discoverHostToolPathEntries(env = process.env) {
  if (process.platform !== "win32") {
    return listExistingDirs([
      "/usr/local/bin",
      "/opt/homebrew/bin",
      join(String(env.HOME || ""), ".local", "bin")
    ]);
  }
  const localAppData = String(env.LOCALAPPDATA || "").trim();
  const userProfile = String(env.USERPROFILE || "").trim();
  const programFiles = String(env.ProgramFiles || "C:\\Program Files").trim();
  const programFilesX86 = String(env["ProgramFiles(x86)"] || "C:\\Program Files (x86)").trim();
  return listExistingDirs([
    localAppData ? join(localAppData, "Programs", "Python", "Launcher") : "",
    ...listWindowsPythonInstallDirs(localAppData),
    userProfile ? join(userProfile, "AppData", "Local", "Programs", "Python", "Launcher") : "",
    join(programFiles, "nodejs"),
    join(programFilesX86, "nodejs"),
    localAppData ? join(localAppData, "Microsoft", "WindowsApps") : ""
  ]);
}

/**
 * Merge process + tool shell env Path keys and prepend discovered host tool dirs.
 * Fixes Electron/Windows plain-object Path vs PATH loss that drops user Python.
 */
export function enrichShellEnvForTools(shellEnv = {}, options = {}) {
  const processEnv = options.processEnv ?? process.env ?? {};
  const merged = { ...processEnv, ...(shellEnv ?? {}) };
  const managedRoot = String(options.managedEnginesRoot || merged.BRAIN_MANAGED_ENGINES_ROOT || processEnv.BRAIN_MANAGED_ENGINES_ROOT || "").trim();
  const combinedPath = mergePathEntries(
    ...discoverManagedEnginePathEntries(managedRoot),
    ...(options.extraPathEntries ?? []),
    ...discoverHostToolPathEntries(merged),
    readPathFromEnv(shellEnv),
    readPathFromEnv(processEnv),
    readPathFromEnv(merged)
  );
  return writePathToEnv(merged, combinedPath);
}

const MISSING_COMMAND_RE =
  /(?:CommandNotFoundException|不是内部或外部命令|无法识别|not recognized as (?:an internal or external command|the name of a cmdlet)|command not found|TerminatingError)/i;

/**
 * When PowerShell/cmd cannot find python/py/node, return actionable Chinese guidance.
 * Returns null when the failure is unrelated.
 */
export function formatMissingHostToolGuidance(command = "", output = "") {
  const text = `${command}\n${output}`;
  if (!MISSING_COMMAND_RE.test(text) && !/\b(python3?|py|node|npm|pnpm|git)\b/i.test(command)) {
    return null;
  }
  const wantsPython = /\b(python3?|py)\b/i.test(text);
  const wantsNode = /\b(node|npm|pnpm)\b/i.test(text);
  const wantsGit = /\bgit\b/i.test(text);
  if (!wantsPython && !wantsNode && !wantsGit) return null;
  if (!MISSING_COMMAND_RE.test(output) && !MISSING_COMMAND_RE.test(text)) return null;

  const lines = [
    "未能在当前工具宿主 PATH 中找到所需命令（并非安全策略拦截）。"
  ];
  if (wantsPython) {
    lines.push(
      "请确认已安装 Python 3，并勾选 “Add python.exe to PATH”，或安装后将以下目录加入用户 PATH：",
      `%LOCALAPPDATA%\\Programs\\Python\\Python3xx 与 ...\\Scripts、以及 %LOCALAPPDATA%\\Programs\\Python\\Launcher。`,
      "也可直接使用绝对路径，例如：",
      `"$env:LOCALAPPDATA\\Programs\\Python\\Python312\\python.exe" --version`,
      "注意：Microsoft Store 的 python 别名若未安装真实 Python，会表现为“找不到命令”；可在“应用执行别名”中关闭。",
      "修改 PATH 后请完全退出并重启 NewBrain（不要只关窗口）。"
    );
  }
  if (wantsNode) {
    lines.push(
      "请确认已安装 Node.js，并将安装目录（通常为 C:\\Program Files\\nodejs）加入用户 PATH 后重启 NewBrain。"
    );
  }
  if (wantsGit) {
    lines.push(
      "请确认已安装 Git for Windows，并将 git.exe 所在目录（通常为 C:\\Program Files\\Git\\cmd）加入用户 PATH 后重启 NewBrain。"
    );
  }
  return lines.join("\n");
}

const UNBOUNDED_RECURSIVE_RE =
  /Get-ChildItem[\s\S]*-Recurse|Select-String[\s\S]*-Recurse|\bdir\s+\/s\b|\btree\s+\/[fFaA]|\bfind\s+\S+\s+-type\b|\bls\s+-[a-zA-Z]*R|\*\*\/\*\*/i;

const GREP_RECURSE_RE = /\bgrep\b[\s\S]*(?:\s-[a-zA-Z]*[rR][a-zA-Z]*\s|\s-R\s|--recursive\b)/i;

const MAX_ALLOWED_RECURSE_DEPTH = 8;

const BROAD_LISTING_ROOTS = new Set([".", "..", "./", "../", ""]);

function normalizeListingPath(rawPath = "") {
  return String(rawPath ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .replace(/^\.\/+/, "");
}

function isBroadListingRoot(rawPath = "") {
  const normalized = normalizeListingPath(rawPath);
  if (!normalized || BROAD_LISTING_ROOTS.has(normalized)) return true;
  if (/^[a-zA-Z]:$/.test(normalized) || /^[a-zA-Z]:\/?$/.test(normalized)) return true;
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) return true;
  if (segments.every((segment) => segment === "." || segment === "..")) return true;
  return false;
}

function extractGetChildItemPath(command = "") {
  const text = String(command ?? "");
  const flagMatch =
    text.match(/-(?:Path|LiteralPath)\s+(["'])(.*?)\1/i) ||
    text.match(/-(?:Path|LiteralPath)\s+([^\s|;&]+)/i);
  if (flagMatch) return flagMatch[2] ?? flagMatch[1];

  const quotedPositional = text.match(/Get-ChildItem\s+(?!-)(["'])([^"']+)\1/i);
  if (quotedPositional) return quotedPositional[2];

  const barePositional = text.match(/Get-ChildItem\s+(?!-)([^\s|;&-][^\s|;&]*)/i);
  if (barePositional) {
    const candidate = barePositional[1];
    if (!/^(?:Filter|Include|Recurse|Depth|File|Directory|Name|Force)$/i.test(candidate)) {
      return candidate;
    }
  }
  return "";
}

function hasListingFileFilter(command = "") {
  return /-(?:Filter|Include)\s+(?:["'][^"']+["']|[^\s|;&]+)/i.test(String(command ?? ""));
}

function hasDepthLimit(command = "", maxDepth = MAX_ALLOWED_RECURSE_DEPTH) {
  const text = String(command ?? "");
  const depthMatch = text.match(/-Depth\s+(\d+)/i)
    || text.match(/--max-depth(?:=|\s+)(\d+)/i)
    || text.match(/-maxdepth\s+(\d+)/i);
  return Boolean(depthMatch && Number(depthMatch[1]) <= maxDepth);
}

function extractSelectStringPath(command = "") {
  const text = String(command ?? "");
  const flagMatch =
    text.match(/-Path\s+(["'])(.*?)\1/i) ||
    text.match(/-Path\s+([^\s|;&]+)/i);
  return flagMatch ? (flagMatch[2] ?? flagMatch[1]) : "";
}

function extractGrepRecursivePath(command = "") {
  const text = String(command ?? "").trim();
  const recursive = text.match(/\bgrep\b[\s\S]*?(?:\s-[a-zA-Z]*[rR][a-zA-Z]*\s|\s-R\s|--recursive\b)/i);
  if (!recursive) return "";
  const tail = text.slice(recursive.index + recursive[0].length).trim();
  if (!tail) return ".";
  const tokens = [];
  const tokenRe = /(["'])(.*?)\1|(\S+)/g;
  let match;
  while ((match = tokenRe.exec(tail)) !== null) {
    const token = match[2] ?? match[3] ?? "";
    if (token.startsWith("-")) continue;
    tokens.push(token);
  }
  return tokens.length >= 2 ? tokens[tokens.length - 1] : ".";
}

function isUnboundedGrepRecurse(command = "") {
  if (!GREP_RECURSE_RE.test(String(command ?? ""))) return false;
  return isBroadListingRoot(extractGrepRecursivePath(command));
}

function isUnboundedSelectStringRecurse(command = "") {
  const text = String(command ?? "");
  if (!/Select-String[\s\S]*-Recurse/i.test(text)) return false;
  const listingPath = extractSelectStringPath(text);
  return !listingPath || isBroadListingRoot(listingPath);
}

/** Cross-platform guidance when shell recurse/search is blocked. */
export function formatUnboundedRecursiveSearchGuidance(platform = process.platform) {
  const lines = [
    "已拒绝可能撑爆内存的超大递归检索（并非安全策略拦截）。",
    "请优先使用 workspace.glob / workspace.grep（别名 glob / grep；查找文件或内容，自带忽略与命中上限），或 workspace.scan 浏览结构。"
  ];
  if (platform === "win32") {
    lines.push("若必须用 PowerShell，请为 Get-ChildItem 指定子目录并加 -Filter/-Include，或加 -Depth 2~8 后重试。");
  } else {
    lines.push("若必须用 shell，请限定子目录并加深度上限（如 find src -maxdepth 4），不要用无范围 grep -r / find / ls -R。");
  }
  return lines.join("\n");
}

function isScopedFilteredRecurse(command = "") {
  if (!hasListingFileFilter(command)) return false;
  const listingPath = extractGetChildItemPath(command);
  if (isBroadListingRoot(listingPath)) return false;
  return true;
}

/** Soft-fail clearly unbounded recursive listing that often OOMs the tool host. */
export function guardUnboundedRecursiveSearch(command = "") {
  const text = String(command ?? "").trim();
  const matchesRecursivePattern = UNBOUNDED_RECURSIVE_RE.test(text)
    || isUnboundedGrepRecurse(text)
    || isUnboundedSelectStringRecurse(text);
  if (!text || !matchesRecursivePattern) return null;
  if (hasDepthLimit(text)) return null;
  if (/\b(rg|ripgrep)\b/i.test(text) && /--max-depth\b/i.test(text)) return null;
  if (/Get-ChildItem[\s\S]*-Recurse/i.test(text) && isScopedFilteredRecurse(text)) return null;
  return {
    ok: false,
    exitCode: 1,
    output: formatUnboundedRecursiveSearchGuidance(),
    command: text,
    guarded: "unbounded_recursive_search"
  };
}

const SHELL_WHOLE_FILE_WRITE_RE = new RegExp([
  String.raw`\b(?:Set-Content|Add-Content|Out-File)\b`,
  String.raw`\bNew-Item\b[\s\S]*-ItemType\s+['"]?File\b`,
  String.raw`(?:^|[;&|]\s*)(?:cat|tee)\s+.*?(?:>|>>)`,
  String.raw`<<['"]?EOF\b`,
  String.raw`@'\s*$`,
  String.raw`\$\s*\(\s*cat\b`,
  String.raw`(?:^|[;&|]\s*)(?:echo|printf)\s+.*?(?:>|>>)\s*['"]?[\w./\\-]`
].join("|"), "im");

function formatShellWholeFileWriteGuidance() {
  return [
    "拒绝：请勿用 shell.exec 整文件写盘（Set-Content / Out-File / Add-Content / heredoc / cat> / echo>）。",
    "请改用 workspace.write_file（相对路径，例如 outputs/report.html），局部修改用 workspace.edit 或 workspace.apply_patch。",
    "Windows 宿主是 PowerShell，Bash 的 $(...) / <<EOF 会导致语法失败。",
    "",
    "next_action: Call workspace.write_file with a workspace-relative targetPath and full content; do not retry shell file writes."
  ].join("\n");
}

/**
 * Block shell-based whole-file writes. Models often fall back to Set-Content/heredoc
 * after write_file mistakes; that path fails on PowerShell and bypasses file tools.
 */
export function guardShellWholeFileWrite(command = "") {
  const text = String(command ?? "").trim();
  if (!text || !SHELL_WHOLE_FILE_WRITE_RE.test(text)) return null;
  return {
    ok: false,
    exitCode: 1,
    output: formatShellWholeFileWriteGuidance(),
    next_action: "Call workspace.write_file with a workspace-relative targetPath and full content; do not retry shell file writes.",
    command: text,
    guarded: "shell_whole_file_write"
  };
}
