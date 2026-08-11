import { extname } from "node:path";
import {
  buildWorkspaceArtifactPreviewUrl,
  mimeTypeForArtifactPath
} from "./workspace-artifact-protocol.js";

export const WORKSPACE_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".ico"
]);

export const WORKSPACE_VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".webm",
  ".mov",
  ".m4v",
  ".mkv",
  ".avi"
]);

export type WorkspaceMediaKind = "image" | "video";

/** True when the path looks like a supported workspace image. */
export function isWorkspaceImagePath(filePath: string) {
  return WORKSPACE_IMAGE_EXTENSIONS.has(extname(String(filePath ?? "")).toLowerCase());
}

/** True when the path looks like a supported workspace video. */
export function isWorkspaceVideoPath(filePath: string) {
  return WORKSPACE_VIDEO_EXTENSIONS.has(extname(String(filePath ?? "")).toLowerCase());
}

/** Returns the media kind or null when unsupported. */
export function detectWorkspaceMediaKind(filePath: string): WorkspaceMediaKind | null {
  if (isWorkspaceImagePath(filePath)) return "image";
  if (isWorkspaceVideoPath(filePath)) return "video";
  return null;
}

/**
 * Validates that a caller-requested media kind matches the file extension.
 * Throws when the path is empty or the extension is wrong for the tool.
 */
export function assertWorkspaceMediaKind(filePath: string, expected: WorkspaceMediaKind) {
  const trimmed = String(filePath ?? "").trim();
  if (!trimmed) throw new Error("A workspace-relative media path is required.");
  const kind = detectWorkspaceMediaKind(trimmed);
  if (kind !== expected) {
    const label = expected === "image" ? "image" : "video";
    throw new Error(`Path is not a supported workspace ${label} file: ${trimmed}`);
  }
  return trimmed;
}

/** Builds the agent-facing open payload after path resolution succeeds. */
export function buildWorkspaceMediaOpenPayload(input: {
  workspaceId: string;
  relativePath: string;
  kind: WorkspaceMediaKind;
  size: number;
}) {
  const normalizedRelative = input.relativePath.replace(/\\/g, "/");
  return {
    ok: true,
    kind: input.kind,
    path: normalizedRelative,
    mimeType: mimeTypeForArtifactPath(normalizedRelative),
    size: input.size,
    previewUrl: buildWorkspaceArtifactPreviewUrl(input.workspaceId, normalizedRelative),
    openedInSidePanel: true
  };
}
