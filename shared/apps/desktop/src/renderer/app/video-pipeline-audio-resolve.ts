/**
 * Resolve per-shot narration files without cross-shot leakage.
 * Never fall back to "any narration in the media bin" — that assigns the newest
 * (often last-shot) WAV to every empty shot.audio.
 */

export type AudioResolveFile = {
  id?: string;
  mimeType?: string;
  storageKey?: string;
  relativePath?: string;
  logicalName?: string;
};

export function isLikelyAudioFile(file: AudioResolveFile): boolean {
  if (String(file.mimeType || "").startsWith("audio/")) return true;
  const key = String(file.storageKey || file.relativePath || file.logicalName || "");
  return /\.(mp3|wav|m4a|aac|ogg|flac|wma)$/i.test(key);
}

export function normalizeMediaPath(path: string): string {
  return String(path || "").replaceAll("\\", "/").replace(/^\.\//, "").trim();
}

/** Tokens that uniquely identify a shot in filenames (never bare digits like "1"). */
export function shotIdMatchTokens(shotId: string): string[] {
  const id = String(shotId || "").trim().toLowerCase();
  if (!id) return [];
  const tokens = new Set<string>([id]);
  const digits = id.replace(/\D/g, "");
  if (digits) {
    const n = String(Number(digits));
    for (const form of [n, n.padStart(2, "0"), n.padStart(3, "0")]) {
      tokens.add(`shot-${form}`);
      tokens.add(`shot_${form}`);
    }
  }
  return [...tokens];
}

/** True when a media key/path is clearly scoped to this shot (not a bare narration-timestamp.wav). */
export function fileKeyMatchesShot(key: string, shotId: string): boolean {
  const lower = normalizeMediaPath(key).toLowerCase();
  if (!lower) return false;
  return shotIdMatchTokens(shotId).some((token) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[/\\\\_-])${escaped}(?:[/\\\\_.-]|$)`, "i").test(lower);
  });
}

export function resolveAudioFileId(
  files: AudioResolveFile[],
  shotId: string,
  audioPath?: string
): string | undefined {
  const norm = normalizeMediaPath(audioPath || "");
  if (norm) {
    const name = norm.split("/").pop() || norm;
    const byPath = files.find((file) => {
      const key = normalizeMediaPath(file.storageKey || file.relativePath || "");
      return key === norm || key.endsWith(`/${norm}`) || key.endsWith(`/${name}`) || key === name;
    });
    if (byPath?.id) return byPath.id;
  }
  const audioFiles = files.filter(isLikelyAudioFile);
  const byShot = audioFiles.find((file) => {
    const key = String(file.storageKey || file.relativePath || file.logicalName || "");
    return /narration|旁白|tts|speech/i.test(key) && fileKeyMatchesShot(key, shotId);
  });
  // Intentionally no "any narration file" fallback — that caused every A clip to share one WAV.
  return byShot?.id;
}

/** Prefer explicit shot.audio; else shot-scoped narration path from media bin only. */
export function resolveAudioRelativePath(
  files: AudioResolveFile[],
  shotId: string,
  audioPath?: string
): string {
  const direct = normalizeMediaPath(audioPath || "");
  if (direct) return direct;
  const fileId = resolveAudioFileId(files, shotId, audioPath);
  if (!fileId) return "";
  const file = files.find((item) => item.id === fileId);
  return normalizeMediaPath(file?.relativePath || file?.storageKey || "");
}

/**
 * Drop cross-shot copies of the same unscoped narration path.
 * Keeps a shared path only on shots whose id appears in the filename.
 */
/** Peeled embedded track from FFmpeg unlink (`*-audio-<stamp>.wav|m4a` under media/imports). */
export function isPeeledEmbeddedAudioPath(path: string): boolean {
  const p = normalizeMediaPath(path);
  return /(?:^|\/)media\/imports\/.+-audio-\d+\.(?:wav|m4a|aac|mp3)$/i.test(p)
    || /.+-audio-\d+\.(?:wav|m4a|aac|mp3)$/i.test(p);
}

/**
 * Broken peel artifact: audio slot wrongly saved as `*-audio-*.mp4` (silent / video container).
 * Treat as needing re-extract — never as a playable soundtrack.
 */
export function isBrokenPeeledAudioMp4Path(path: string): boolean {
  const p = normalizeMediaPath(path);
  return /(?:^|\/)media\/imports\/.+-audio-\d+\.mp4$/i.test(p)
    || /.+-audio-\d+\.mp4$/i.test(p);
}

/** Peeled silent picture from FFmpeg unlink. */
export function isPeeledVideoOnlyPath(path: string): boolean {
  const p = normalizeMediaPath(path);
  return /(?:^|\/)media\/imports\/.+-video-\d+\.mp4$/i.test(p)
    || /.+-video-\d+\.mp4$/i.test(p);
}

/**
 * Same-stamp audio siblings for a peeled silent picture
 * (`…-video-123.mp4` → `…-audio-123.m4a|wav|…`).
 */
export function peeledVideoSiblingAudioCandidates(videoPath: string): string[] {
  const p = normalizeMediaPath(videoPath);
  const match = p.match(/^(.*)-video-(\d+)\.mp4$/i);
  if (!match) return [];
  const stem = match[1]!;
  const stamp = match[2]!;
  return [".m4a", ".wav", ".aac", ".mp3"].map((ext) => `${stem}-audio-${stamp}${ext}`);
}

/**
 * Likely original muxed sources before FFmpeg unlink
 * (`media/imports/foo-video-123.mp4` → `media/imports/foo.mp4`, `media/clips/foo.mp4`).
 */
export function peeledVideoOriginalMuxCandidates(videoPath: string): string[] {
  const p = normalizeMediaPath(videoPath);
  const match = p.match(/^(?:media\/imports\/)(.+)-video-\d+\.mp4$/i);
  if (!match) return [];
  const stem = match[1]!;
  return [
    `media/imports/${stem}.mp4`,
    `media/imports/${stem}.mov`,
    `media/imports/${stem}.webm`,
    `media/clips/${stem}.mp4`,
    `media/clips/${stem}.mov`,
    `media/clips/${stem}.webm`
  ];
}

/** Pick first existing candidate from a known path set (media bin / files). */
export function pickFirstExistingMediaPath(
  candidates: string[],
  knownPaths: Iterable<string>
): string {
  const known = new Set(
    [...knownPaths].map((item) => normalizeMediaPath(item)).filter(Boolean)
  );
  for (const candidate of candidates) {
    const norm = normalizeMediaPath(candidate);
    if (known.has(norm)) return norm;
    const base = norm.split("/").pop() || "";
    for (const path of known) {
      if (path === base || path.endsWith(`/${base}`)) return path;
    }
  }
  return "";
}

export function audioTrackLabelForPath(
  audioPath: string,
  shotTitle: string | undefined,
  index: number
): string {
  if (isPeeledEmbeddedAudioPath(audioPath)) {
    return shotTitle ? `${shotTitle} · 音轨` : `音轨 ${index + 1}`;
  }
  return shotTitle ? `${shotTitle} · 旁白` : `旁白 ${index + 1}`;
}

export function healSharedUnscopedAudioPaths<T extends { id: string; audio?: string }>(
  shots: T[]
): { shots: T[]; changed: boolean } {
  const counts = new Map<string, number>();
  for (const shot of shots) {
    const path = normalizeMediaPath(shot.audio || "");
    if (!path) continue;
    counts.set(path, (counts.get(path) || 0) + 1);
  }
  let changed = false;
  const next = shots.map((shot) => {
    const path = normalizeMediaPath(shot.audio || "");
    if (!path || (counts.get(path) || 0) <= 1) return shot;
    if (fileKeyMatchesShot(path, shot.id)) return shot;
    changed = true;
    return { ...shot, audio: "" };
  });
  return { shots: next, changed };
}
