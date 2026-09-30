import { existsSync } from "node:fs";
import { buildFfmpegVolumeFilterFragment } from "../shared/video-volume-envelope.js";
import { mapXfadeTransition } from "./video-xfade-map.js";

export { mapXfadeTransition } from "./video-xfade-map.js";

/** Timed clip on a named NLE track (same trackId merges by time; tracks stack/mix). */
export type VideoRenderLayerClip = {
  relativePath?: string;
  trackId: string;
  trackType: "video" | "audio" | "text";
  startMs: number;
  durationMs?: number;
  volume?: number;
  /** Premiere-like volume rubber-band keyframes (clip-local seconds, linear gain 0–2). */
  volumeKeyframes?: Array<{ t: number; v: number }>;
  /**
   * UI lane index (0 = top of timeline). Lower index overlays higher index
   * (Premiere: tracks listed higher sit above).
   */
  stackOrder?: number;
  /** Transition applied into the next clip on the same video track. */
  transition?: string;
  transitionMs?: number;
  text?: string;
  fontSize?: number;
  color?: string;
  /** Normalized center X (0–1). */
  x?: number;
  /** Normalized center Y (0–1). */
  y?: number;
  /** Uniform scale on fontSize. */
  scale?: number;
};

function trackSortKey(trackId: string): number {
  const match = String(trackId || "").match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function escapeDrawtext(value: string) {
  return String(value || "")
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replaceAll(":", "\\:")
    .replaceAll("%", "%%")
    .replaceAll("\n", " ")
    .replaceAll("\r", "");
}

/** Prefer an explicit fontfile so drawtext does not depend on fontconfig (often missing after env_clear). */
export function resolveDrawtextFontfile(platform: NodeJS.Platform = process.platform): string {
  const candidates = platform === "win32"
    ? [
      "C:/Windows/Fonts/arial.ttf",
      "C:/Windows/Fonts/segoeui.ttf",
      "C:/Windows/Fonts/msyh.ttc",
      "C:/Windows/Fonts/msyhbd.ttc",
      "C:/Windows/Fonts/simhei.ttf"
    ]
    : platform === "darwin"
      ? [
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/Helvetica.ttc"
      ]
      : [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
      ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      // Windows drive letters must be double-escaped for drawtext filtergraph when
      // args are passed via spawn (argv), not a shell: C: → C\\:
      // Single-escape (C\:) is rejected as an option separator by FFmpeg 9.
      return candidate.replaceAll("\\", "/").replaceAll(":", "\\\\:");
    }
  }
  return "";
}

function hexToFfmpegColor(color: string) {
  const raw = String(color || "#ffffff").trim();
  const match = raw.match(/^#?([0-9a-fA-F]{6})$/);
  return match ? `0x${match[1]}` : "0xffffff";
}

/** Build FFmpeg args that merge clips per track (Premiere-like stack + mix + titles). */
export function buildLayeredVideoFfmpegArgs(
  layerClips: VideoRenderLayerClip[],
  output: string,
  videoSettings: { width: number; height: number; fps: number },
  subtitleRelative?: string,
  options?: { fontfile?: string }
): string[] {
  const mediaVideo = layerClips.filter((clip) => clip.trackType === "video" && String(clip.relativePath || "").trim());
  const audioClips = layerClips.filter((clip) => clip.trackType === "audio" && String(clip.relativePath || "").trim());
  const textClips = layerClips.filter((clip) => clip.trackType === "text" && String(clip.text || "").trim());
  const width = videoSettings.width;
  const height = videoSettings.height;
  const fps = videoSettings.fps;

  if (!mediaVideo.length && !textClips.length) {
    return [
      "-y",
      "-f", "lavfi", "-i", `color=c=black:s=${width}x${height}:d=2`,
      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
      "-t", "2",
      "-c:v", "libx264",
      "-c:a", "aac",
      "-shortest",
      output
    ];
  }

  const totalMs = Math.max(
    1_000,
    ...mediaVideo.map((clip) => clip.startMs + Math.max(100, clip.durationMs || 4_000)),
    ...audioClips.map((clip) => clip.startMs + Math.max(100, clip.durationMs || 4_000)),
    ...textClips.map((clip) => clip.startMs + Math.max(100, clip.durationMs || 2_000))
  );
  const totalSec = Number((totalMs / 1_000).toFixed(3));

  const args: string[] = ["-y"];
  for (const clip of mediaVideo) args.push("-i", String(clip.relativePath));
  for (const clip of audioClips) args.push("-i", String(clip.relativePath));

  const chains: string[] = [];
  // Normalize every clip to the same fps/format/timebase before concat/xfade.
  // fps must come AFTER setpts; otherwise xfade sees mixed timebases (1/1e6 vs 1/fps)
  // and fails with -22, which the UI reports as a failed process.run.
  mediaVideo.forEach((clip, index) => {
    const dur = Math.max(0.1, (clip.durationMs || 4_000) / 1_000);
    chains.push(
      `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,`
      + `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,`
      + `trim=0:${dur},setpts=PTS-STARTPTS,fps=${fps},format=yuv420p[vraw${index}]`
    );
  });

  const byTrack = new Map<string, Array<{ clip: VideoRenderLayerClip; index: number }>>();
  mediaVideo.forEach((clip, index) => {
    const key = clip.trackId || "v1";
    const list = byTrack.get(key) || [];
    list.push({ clip, index });
    byTrack.set(key, list);
  });
  const stackOf = (trackId: string, items: Array<{ clip: VideoRenderLayerClip }>) => {
    const fromClip = items[0]?.clip.stackOrder;
    if (typeof fromClip === "number" && Number.isFinite(fromClip)) return fromClip;
    return trackSortKey(trackId);
  };
  // Bottom-of-UI first as base; top-of-UI overlays last (Premiere stack).
  const orderedTracks = [...byTrack.entries()].sort((a, b) => stackOf(b[0], b[1]) - stackOf(a[0], a[1]));
  for (const [, items] of orderedTracks) {
    items.sort((a, b) => a.clip.startMs - b.clip.startMs || a.index - b.index);
  }

  const trackLabels: string[] = [];
  orderedTracks.forEach(([, items], trackIdx) => {
    let current = `vraw${items[0]!.index}`;
    let currentDur = Math.max(0.1, (items[0]!.clip.durationMs || 4_000) / 1_000);
    for (let i = 0; i < items.length - 1; i += 1) {
      const left = items[i]!;
      const right = items[i + 1]!;
      const xf = mapXfadeTransition(left.clip.transition);
      const nextRaw = `vraw${right.index}`;
      const nextDur = Math.max(0.1, (right.clip.durationMs || 4_000) / 1_000);
      const out = `tx${trackIdx}_${i}`;
      if (xf) {
        const requested = left.clip.transitionMs ? left.clip.transitionMs / 1_000 : xf.durationSec;
        const dur = Math.min(xf.durationSec, requested, currentDur * 0.45, nextDur * 0.45);
        const offset = Math.max(0.05, currentDur - dur);
        const leftNorm = `xfL${trackIdx}_${i}`;
        const rightNorm = `xfR${trackIdx}_${i}`;
        chains.push(`[${current}]fps=${fps},format=yuv420p[${leftNorm}]`);
        chains.push(`[${nextRaw}]fps=${fps},format=yuv420p[${rightNorm}]`);
        chains.push(`[${leftNorm}][${rightNorm}]xfade=transition=${xf.name}:duration=${dur.toFixed(3)}:offset=${offset.toFixed(3)}[${out}]`);
        currentDur = currentDur + nextDur - dur;
      } else {
        const leftNorm = `ctL${trackIdx}_${i}`;
        const rightNorm = `ctR${trackIdx}_${i}`;
        chains.push(`[${current}]fps=${fps},format=yuv420p[${leftNorm}]`);
        chains.push(`[${nextRaw}]fps=${fps},format=yuv420p[${rightNorm}]`);
        chains.push(`[${leftNorm}][${rightNorm}]concat=n=2:v=1:a=0[${out}]`);
        currentDur = currentDur + nextDur;
      }
      current = out;
    }
    const trackStart = Math.max(0, items[0]!.clip.startMs / 1_000);
    const delayed = `trk${trackIdx}`;
    if (trackStart > 0.001) {
      chains.push(`[${current}]setpts=PTS-STARTPTS+${trackStart}/TB[${delayed}]`);
    } else {
      chains.push(`[${current}]null[${delayed}]`);
    }
    trackLabels.push(delayed);
  });

  chains.push(`color=c=black:s=${width}x${height}:d=${totalSec}:r=${fps}[base]`);
  let lastLabel = "base";
  if (!trackLabels.length) {
    lastLabel = "base";
  } else {
    trackLabels.forEach((label, index) => {
      const out = `comp${index}`;
      chains.push(`[${lastLabel}][${label}]overlay=eof_action=pass[${out}]`);
      lastLabel = out;
    });
  }

  const sortedText = [...textClips].sort((a, b) => trackSortKey(a.trackId) - trackSortKey(b.trackId) || a.startMs - b.startMs);
  // Prefer a project-relative font (no drive-letter ':') — Windows FFmpeg filtergraph
  // treats unescaped ':' as an option separator and fails the whole render.
  const fontfile = String(options?.fontfile || "").trim() || resolveDrawtextFontfile();
  sortedText.forEach((clip, index) => {
    // Skip title burn-in when no usable font is available; a broken drawtext
    // option string breaks the whole filter_complex and surfaces as process failure.
    if (!fontfile) return;
    const start = Math.max(0, clip.startMs / 1_000);
    const end = start + Math.max(0.1, (clip.durationMs || 2_000) / 1_000);
    const scale = Math.max(0.2, Math.min(5, Number(clip.scale) || 1));
    const fontsize = Math.max(12, Math.min(400, Math.round((clip.fontSize || 48) * scale)));
    const color = hexToFfmpegColor(clip.color || "#ffffff");
    const body = escapeDrawtext(String(clip.text || ""));
    const xNorm = Number.isFinite(clip.x) ? Math.min(1, Math.max(0, Number(clip.x))) : 0.5;
    const yNorm = Number.isFinite(clip.y) ? Math.min(1, Math.max(0, Number(clip.y))) : 0.5;
    const out = `txt${index}`;
    // Keep option order simple: fontfile first, no nested quotes around enable commas.
    chains.push(
      `[${lastLabel}]drawtext=fontfile=${fontfile}:text='${body}':fontsize=${fontsize}:fontcolor=${color}:`
      + `x=(w-text_w)*${xNorm.toFixed(4)}:y=(h-text_h)*${yNorm.toFixed(4)}:`
      + `box=1:boxcolor=black@0.35:boxborderw=12:`
      + `enable=between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})[${out}]`
    );
    lastLabel = out;
  });

  if (subtitleRelative) {
    const safe = subtitleRelative.replaceAll("'", "\\'");
    const burned = "vsub";
    chains.push(`[${lastLabel}]subtitles='${safe}'[${burned}]`);
    lastLabel = burned;
  }

  const audioStartIndex = mediaVideo.length;
  if (audioClips.length) {
    audioClips.forEach((clip, index) => {
      const inputIndex = audioStartIndex + index;
      const delay = Math.max(0, Math.round(clip.startMs));
      const durationSec = Math.max(0.1, (clip.durationMs || 4_000) / 1_000);
      const volumeFilter = buildFfmpegVolumeFilterFragment(
        clip.volumeKeyframes,
        durationSec,
        clip.volume ?? 1,
        false
      );
      // volume before adelay so envelope t=0 is clip start (not delayed silence).
      chains.push(`[${inputIndex}:a]${volumeFilter},adelay=${delay}|${delay}[a${index}]`);
    });
    const mixInputs = audioClips.map((_, index) => `[a${index}]`).join("");
    chains.push(`${mixInputs}amix=inputs=${audioClips.length}:duration=longest:normalize=0[aout]`);
    args.push("-filter_complex", chains.join(";"), "-map", `[${lastLabel}]`, "-map", "[aout]");
  } else {
    args.push("-filter_complex", chains.join(";"), "-map", `[${lastLabel}]`);
  }

  args.push("-t", String(totalSec), "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", output);
  return args;
}
