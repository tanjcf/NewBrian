/**
 * Windows child-process stdout/stderr decoding with UTF-8 first, OEM/GBK fallback.
 * Borrowed from OpenClaw windows-encoding patterns (strict UTF-8 → legacy code page).
 */
import { spawnSync } from "node:child_process";

const WINDOWS_CODEPAGE_ENCODING_MAP = Object.freeze({
  65001: "utf-8",
  54936: "gb18030",
  936: "gbk",
  950: "big5",
  932: "shift_jis",
  949: "euc-kr",
  1252: "windows-1252"
});

let cachedConsoleEncoding = undefined;

/** Parse a Windows code-page number from `chcp` / PowerShell output. */
export function parseWindowsCodePage(raw = "") {
  const match = String(raw ?? "").match(/\b(\d{3,5})\b/);
  if (!match) return null;
  const codePage = Number.parseInt(match[1], 10);
  return Number.isFinite(codePage) && codePage > 0 ? codePage : null;
}

function probeConsoleEncoding() {
  if (process.platform !== "win32") return null;
  try {
    const result = spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "chcp"], {
      windowsHide: true,
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const raw = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const codePage = parseWindowsCodePage(raw);
    return codePage !== null ? (WINDOWS_CODEPAGE_ENCODING_MAP[codePage] ?? null) : null;
  } catch {
    return null;
  }
}

/** Resolve (and cache) the active Windows console encoding. */
export function resolveWindowsConsoleEncoding() {
  if (process.platform !== "win32") return null;
  if (cachedConsoleEncoding !== undefined) return cachedConsoleEncoding;
  cachedConsoleEncoding = probeConsoleEncoding();
  return cachedConsoleEncoding;
}

/** Test helper to clear the encoding cache. */
export function resetWindowsEncodingCache() {
  cachedConsoleEncoding = undefined;
}

function decodeStrictUtf8(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

function tryDecode(buffer, encoding) {
  if (!encoding || String(encoding).toLowerCase() === "utf-8") {
    return buffer.toString("utf8");
  }
  try {
    return new TextDecoder(encoding).decode(buffer);
  } catch {
    return null;
  }
}

/**
 * Decode one complete subprocess output buffer.
 * Prefers valid UTF-8; on Windows falls back to console OEM/GBK then common legacy pages.
 * @param {Buffer | string} input
 * @param {{ platform?: NodeJS.Platform, windowsEncoding?: string | null }} [options]
 */
export function decodeChildOutputBuffer(input, options = {}) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(String(input ?? ""), "binary");
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    return buffer.toString("utf8");
  }

  const utf8 = decodeStrictUtf8(buffer);
  if (utf8 !== null) return utf8;

  const preferred = options.windowsEncoding ?? resolveWindowsConsoleEncoding();
  const candidates = [
    preferred,
    "gbk",
    "gb18030",
    "windows-1252"
  ].filter(Boolean);

  const seen = new Set();
  for (const encoding of candidates) {
    const key = String(encoding).toLowerCase();
    if (seen.has(key) || key === "utf-8") continue;
    seen.add(key);
    const decoded = tryDecode(buffer, encoding);
    if (decoded !== null) return decoded;
  }
  return buffer.toString("utf8");
}
