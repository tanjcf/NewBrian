import { extname } from "node:path";

export const ARTIFACT_PROTOCOL_SCHEME = "newbrain-artifact";
export const ARTIFACT_PROTOCOL_HOST = "preview";
export const ARTIFACT_PROTOCOL_MAX_BYTES = 40 * 1024 * 1024;

/** True when a path/extension should open in the embedded HTML browser preview. */
export function isHtmlArtifactPath(filePath) {
  return /\.html?$/i.test(String(filePath ?? "").trim());
}

export function isHtmlArtifactExtension(extension) {
  const value = String(extension ?? "").toLowerCase();
  return value === ".html" || value === ".htm";
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi"]);

/** True when a path/extension should open in the embedded image preview. */
export function isImageArtifactPath(filePath) {
  return IMAGE_EXTENSIONS.has(extname(String(filePath ?? "")).toLowerCase());
}

export function isImageArtifactExtension(extension) {
  return IMAGE_EXTENSIONS.has(String(extension ?? "").toLowerCase());
}

/** True when a path/extension should open in the embedded video preview. */
export function isVideoArtifactPath(filePath) {
  return VIDEO_EXTENSIONS.has(extname(String(filePath ?? "")).toLowerCase());
}

export function isVideoArtifactExtension(extension) {
  return VIDEO_EXTENSIONS.has(String(extension ?? "").toLowerCase());
}

/** Builds a stable custom-protocol URL for workspace-local HTML and relative assets. */
export function buildWorkspaceArtifactPreviewUrl(workspaceId, relativePath) {
  const id = encodeURIComponent(String(workspaceId ?? "").trim());
  if (!id) throw new Error("Workspace id is required for artifact preview URLs.");
  const parts = String(relativePath ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part));
  if (parts.length === 0) throw new Error("Artifact path is required for preview URLs.");
  return `${ARTIFACT_PROTOCOL_SCHEME}://${ARTIFACT_PROTOCOL_HOST}/${id}/${parts.join("/")}`;
}

/**
 * Parses `newbrain-artifact://preview/<workspaceId>/<relative/path>` requests.
 * Rejects host spoofing, empty segments, and traversal markers before path resolution.
 */
export function parseWorkspaceArtifactPreviewUrl(requestUrl) {
  try {
    const parsed = new URL(String(requestUrl ?? ""));
    if (parsed.protocol !== `${ARTIFACT_PROTOCOL_SCHEME}:`) return null;
    if (parsed.hostname !== ARTIFACT_PROTOCOL_HOST) return null;
    const segments = parsed.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));
    if (segments.length < 2) return null;
    const [workspaceId, ...pathParts] = segments;
    if (!workspaceId || pathParts.some((part) => !part || part === "." || part === "..")) return null;
    return {
      workspaceId,
      relativePath: pathParts.join("/")
    };
  } catch {
    return null;
  }
}

/** MIME types used when serving HTML previews and sibling assets under the artifact protocol. */
/**
 * Parses an HTTP `Range: bytes=` header against a known file size.
 * Returns inclusive start/end byte offsets, or null when invalid.
 */
export function parseByteRangeHeader(rangeHeader, totalSize) {
  const raw = String(rangeHeader ?? "").trim();
  if (!raw.startsWith("bytes=") || !Number.isFinite(totalSize) || totalSize <= 0) return null;
  const [startPart, endPart = ""] = raw.slice("bytes=".length).split("-");
  let start = startPart ? Number(startPart) : Number.NaN;
  let end = endPart ? Number(endPart) : Number.NaN;
  if (!startPart && endPart) {
    const suffixLength = Number(endPart);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, totalSize - suffixLength);
    end = totalSize - 1;
  } else {
    if (!Number.isFinite(start) || start < 0 || start >= totalSize) return null;
    if (!Number.isFinite(end) || end < start) end = totalSize - 1;
    if (end >= totalSize) end = totalSize - 1;
  }
  if (end < start) return null;
  return { start, end };
}

/** Shared response headers for workspace artifact protocol bodies. */
export function artifactProtocolResponseHeaders(mimeType, extra = {}) {
  return {
    "Content-Type": mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extra
  };
}

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".opus", ".mid", ".midi"]);

/** True when an extension looks like an audio media file. */
export function isAudioArtifactExtension(extension) {
  const value = String(extension ?? "").toLowerCase();
  return AUDIO_EXTENSIONS.has(value.startsWith(".") ? value : `.${value}`);
}

/** First audio extension found across one or more path/name hints. */
export function firstAudioArtifactExtension(...paths) {
  for (const filePath of paths) {
    const ext = extname(String(filePath ?? "")).toLowerCase();
    if (AUDIO_EXTENSIONS.has(ext)) return ext;
  }
  return "";
}

/** True when any provided path/name hint looks like audio by extension. */
export function isAudioArtifactCandidate(...paths) {
  return Boolean(firstAudioArtifactExtension(...paths));
}

/** True when a path looks like an audio media file by extension. */
export function isAudioArtifactPath(filePath) {
  return isAudioArtifactExtension(extname(String(filePath ?? "")));
}

/**
 * Sniff common audio containers from a file head.
 * Needed when TTS/mp3 bytes were wrongly saved as `.wav` — Chromium respects
 * Content-Type + nosniff and will not magic-sniff, so a wrong `audio/wav`
 * header makes narration sound garbled in the preview adapter while OS players
 * (which sniff) still sound fine.
 */
export function sniffAudioMimeFromBytes(head) {
  if (!head || head.length < 4) return "";
  const b0 = head[0];
  const b1 = head[1];
  const b2 = head[2];
  const b3 = head[3];
  // RIFF....WAVE
  if (
    b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46
    && head.length >= 12
    && head[8] === 0x57 && head[9] === 0x41 && head[10] === 0x56 && head[11] === 0x45
  ) {
    return "audio/wav";
  }
  // OggS
  if (b0 === 0x4f && b1 === 0x67 && b2 === 0x67 && b3 === 0x53) return "audio/ogg";
  // ID3… or MPEG frame sync (11 set bits)
  if (b0 === 0x49 && b1 === 0x44 && b2 === 0x33) return "audio/mpeg";
  if (b0 === 0xff && (b1 & 0xe0) === 0xe0) return "audio/mpeg";
  // fLaC
  if (b0 === 0x66 && b1 === 0x4c && b2 === 0x61 && b3 === 0x43) return "audio/flac";
  // ftyp....M4A / mp4 audio
  if (
    head.length >= 12
    && b4IsFtyp(head)
  ) {
    const brand = String.fromCharCode(head[8], head[9], head[10], head[11]).toLowerCase();
    if (brand === "m4a " || brand === "mp42" || brand === "isom" || brand === "mp41") {
      return "audio/mp4";
    }
  }
  return "";
}

function b4IsFtyp(head) {
  return head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70;
}

/**
 * Resolve response Content-Type for artifact protocol.
 * For audio paths, prefer sniffed payload type over a mismatched extension.
 */
export function resolveArtifactMimeType(filePath, headBytes) {
  const byExt = mimeTypeForArtifactPath(filePath);
  const sniffed = sniffAudioMimeFromBytes(headBytes);
  if (isAudioArtifactPath(filePath) || sniffed) {
    if (sniffed) return sniffed;
    return byExt.startsWith("audio/") ? byExt : "audio/mpeg";
  }
  return byExt;
}

export function mimeTypeForArtifactPath(filePath) {
  const extension = extname(String(filePath ?? "")).toLowerCase();
  switch (extension) {
    case ".html":
    case ".htm":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".ico":
      return "image/x-icon";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".ttf":
      return "font/ttf";
    case ".otf":
      return "font/otf";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".m4a":
      return "audio/mp4";
    case ".aac":
      return "audio/aac";
    case ".ogg":
    case ".opus":
      return "audio/ogg";
    case ".flac":
      return "audio/flac";
    case ".mid":
    case ".midi":
      return "audio/midi";
    case ".mp4":
    case ".m4v":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    case ".mkv":
      return "video/x-matroska";
    case ".avi":
      return "video/x-msvideo";
    case ".txt":
    case ".md":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}
