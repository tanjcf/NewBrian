/**
 * Automatic merge helpers for user-knowledge markdown (git-like, no manual VCS).
 * Prefer union/dedupe for preference bullets and append-only digests.
 */

const CONFLICT_START = "<<<<<<< local";
const CONFLICT_MID = "=======";
const CONFLICT_END = ">>>>>>> remote";

export type KnowledgeMergeMode = "bullet-union" | "digest-append" | "safe-concat" | "project-os";

export type KnowledgeMergeResult = {
  content: string;
  changed: boolean;
  conflictMarkers: boolean;
  mode: KnowledgeMergeMode;
};

function normalizeNewlines(value: string): string {
  return String(value || "").replace(/\r\n/g, "\n");
}

function splitHeaderAndBody(content: string): { header: string; lines: string[] } {
  const text = normalizeNewlines(content).trimEnd();
  const lines = text ? text.split("\n") : [];
  if (!lines.length) return { header: "", lines: [] };
  if (lines[0].startsWith("#")) {
    return { header: lines[0], lines: lines.slice(1) };
  }
  return { header: "", lines };
}

function extractBulletLines(lines: string[]): string[] {
  const bullets: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) continue;
    const body = trimmed.slice(2).trim();
    if (!body || body === "(none)") continue;
    bullets.push(body);
  }
  return bullets;
}

function uniquePreserveOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/** Merge preference / open-question files by union of bullet lines. */
export function mergeBulletKnowledge(
  localContent: string,
  remoteContent: string,
  title: string
): KnowledgeMergeResult {
  const local = splitHeaderAndBody(localContent);
  const remote = splitHeaderAndBody(remoteContent);
  const mergedBullets = uniquePreserveOrder([
    ...extractBulletLines(local.lines),
    ...extractBulletLines(remote.lines)
  ]);
  const header = local.header || remote.header || title;
  const next = [
    header,
    "",
    ...(mergedBullets.length ? mergedBullets.map((line) => `- ${line}`) : ["- (none)"]),
    ""
  ].join("\n");
  const localNorm = normalizeNewlines(localContent).trim();
  const remoteNorm = normalizeNewlines(remoteContent).trim();
  const nextNorm = next.trim();
  return {
    content: next,
    changed: nextNorm !== localNorm,
    conflictMarkers: false,
    mode: "bullet-union"
  };
}

/** Merge session digests by appending unique non-empty body lines (append-only). */
export function mergeDigestKnowledge(
  localContent: string,
  remoteContent: string,
  title = "# Session Digest"
): KnowledgeMergeResult {
  const local = splitHeaderAndBody(localContent);
  const remote = splitHeaderAndBody(remoteContent);
  const bodyLines = uniquePreserveOrder([
    ...local.lines.map((line) => line.trimEnd()).filter((line) => line.trim()),
    ...remote.lines.map((line) => line.trimEnd()).filter((line) => line.trim())
  ]);
  const header = local.header || remote.header || title;
  const next = [header, "", ...bodyLines, ""].join("\n");
  return {
    content: next,
    changed: normalizeNewlines(next).trim() !== normalizeNewlines(localContent).trim(),
    conflictMarkers: false,
    mode: "digest-append"
  };
}

/**
 * Merge repo-root Project OS (NEWBRAIN.md): take the other side when empty,
 * prefer real content over stock scaffolds, keep longer when one subsumes the other,
 * otherwise keep-both markers.
 */
export function mergeProjectOsKnowledge(
  localContent: string,
  remoteContent: string
): KnowledgeMergeResult {
  const local = normalizeNewlines(localContent).trim();
  const remote = normalizeNewlines(remoteContent).trim();
  const localScaffold = isDefaultProjectOsScaffoldText(local);
  const remoteScaffold = isDefaultProjectOsScaffoldText(remote);
  if (!local) {
    return { content: remoteContent || remote, changed: Boolean(remote), conflictMarkers: false, mode: "project-os" };
  }
  if (!remote || local === remote) {
    return { content: localContent || local, changed: false, conflictMarkers: false, mode: "project-os" };
  }
  // Upgrade-friendly: stock local scaffold loses to real remote Project OS.
  if (localScaffold && !remoteScaffold) {
    return { content: remoteContent.trimEnd() + "\n", changed: true, conflictMarkers: false, mode: "project-os" };
  }
  if (!localScaffold && remoteScaffold) {
    return { content: localContent, changed: false, conflictMarkers: false, mode: "project-os" };
  }
  if (remote.includes(local) && remote.length > local.length) {
    return { content: remoteContent.trimEnd() + "\n", changed: true, conflictMarkers: false, mode: "project-os" };
  }
  if (local.includes(remote)) {
    return { content: localContent, changed: false, conflictMarkers: false, mode: "project-os" };
  }
  const marked = [
    CONFLICT_START,
    local,
    CONFLICT_MID,
    remote,
    CONFLICT_END,
    ""
  ].join("\n");
  return { content: marked, changed: true, conflictMarkers: true, mode: "project-os" };
}

function isDefaultProjectOsScaffoldText(text: string): boolean {
  const trimmed = String(text || "").trim();
  if (!trimmed) return true;
  return trimmed.includes("_(fill in)_")
    && /Project OS/i.test(trimmed)
    && /repo-root source of truth/i.test(trimmed);
}

/**
 * Choose an automatic merge strategy for a knowledge doc type.
 * Unsafe free-form divergence falls back to keep-both markers (chat still unblocked).
 */
export function mergeKnowledgeDocuments(input: {
  docType: string;
  localContent: string;
  remoteContent: string;
}): KnowledgeMergeResult {
  const local = normalizeNewlines(input.localContent);
  const remote = normalizeNewlines(input.remoteContent);
  if (!local.trim()) {
    return { content: remote, changed: Boolean(remote.trim()), conflictMarkers: false, mode: "safe-concat" };
  }
  if (!remote.trim() || local.trim() === remote.trim()) {
    return { content: local, changed: false, conflictMarkers: false, mode: "safe-concat" };
  }
  const docType = String(input.docType || "").replace(/\.md$/i, "");
  if (docType === "project-os") {
    return mergeProjectOsKnowledge(local, remote);
  }
  if (docType === "user-output-rules" || docType === "learning-open-questions" || docType === "project-knowledge") {
    const title = docType === "project-knowledge"
      ? "# Project Knowledge"
      : docType === "learning-open-questions"
        ? "# Learning Open Questions"
        : "# User Output Rules";
    return mergeBulletKnowledge(local, remote, title);
  }
  if (docType === "session-digest") {
    return mergeDigestKnowledge(local, remote);
  }
  // Last-safe fallback: keep both with markers so nothing is silently clobbered.
  const marked = [
    CONFLICT_START,
    local.trimEnd(),
    CONFLICT_MID,
    remote.trimEnd(),
    CONFLICT_END,
    ""
  ].join("\n");
  return {
    content: marked,
    changed: true,
    conflictMarkers: true,
    mode: "safe-concat"
  };
}

/** Enforce soft size caps used by local cache before push. */
export function clampKnowledgeContent(docType: string, content: string): string {
  const caps: Record<string, number> = {
    "user-output-rules": 16_384,
    "learning-open-questions": 8_192,
    "project-knowledge": 65_536,
    "session-digest": 131_072,
    "project-os": 32_768
  };
  const key = String(docType || "").replace(/\.md$/i, "");
  const cap = caps[key] ?? 32_768;
  const bytes = Buffer.from(content, "utf8");
  if (bytes.length <= cap) return content;
  return bytes.subarray(0, cap).toString("utf8");
}
