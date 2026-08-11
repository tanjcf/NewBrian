import { extname } from "node:path";

export const ARTIFACT_PROTOCOL_SCHEME = "codecn-artifact";
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
 * Parses `codecn-artifact://preview/<workspaceId>/<relative/path>` requests.
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
