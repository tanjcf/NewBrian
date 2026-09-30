/**
 * Preview mix / per-lane mute helpers for the video timeline.
 * Keeps mute UI and audible-track selection pure so they can be unit-tested.
 */

export type PreviewMixLane = {
  id: string;
  muted: boolean;
  solo: boolean;
};

export type PreviewMixClipInput = {
  /** Stable id for the HTMLAudioElement (instanceId or shotId+trackId). */
  id: string;
  shotId: string;
  audioTrackId: string;
  start: number;
  duration: number;
  muted: boolean;
  relativePath?: string;
  volume?: number;
  volumeKeyframes?: Array<{ t: number; v: number }>;
};

export type PreviewMixTrack = {
  id: string;
  url: string;
  muted: boolean;
  gain: number;
  /** Timeline clock time when this clip starts. */
  offsetSec: number;
  /** Timeline clock time when this clip ends. */
  endSec: number;
  label?: string;
};

/** Primary narration lane is index 0 or id a1 (Premiere A1). */
export function isPrimaryAudioLane(laneId: string, laneIndex: number): boolean {
  return laneIndex === 0 || laneId === "a1";
}

/**
 * Header M / mute styling for one lane only.
 * trackEdit.muted syncs only the primary narration lane — never A2+.
 */
export function resolveLaneMuteUi(args: {
  laneMuted: boolean;
  isPrimary: boolean;
  trackEditMuted: boolean;
}): boolean {
  return Boolean(args.laneMuted || (args.isPrimary && args.trackEditMuted));
}

/**
 * Whether a clip on a lane should contribute to the preview / export mix.
 * Matches render IPC: Solo overrides Mute; any Solo silences non-solo lanes.
 */
export function isAudioClipAudible(args: {
  laneMuted: boolean;
  laneSolo: boolean;
  clipMuted: boolean;
  anyAudioSolo: boolean;
}): boolean {
  if (args.clipMuted) return false;
  if (args.anyAudioSolo) return args.laneSolo === true;
  if (args.laneMuted && args.laneSolo !== true) return false;
  return true;
}

export type SampleVolumeFn = (
  keyframes: Array<{ t: number; v: number }> | undefined,
  localT: number,
  duration: number,
  baseline: number
) => number;

/**
 * Build simultaneous mix tracks for preview.
 * Includes every audible audio clip that has a resolvable URL (not only lane[0]).
 */
export function buildPreviewMixTracks(args: {
  clips: PreviewMixClipInput[];
  lanes: PreviewMixLane[];
  resolveUrl: (clip: PreviewMixClipInput) => string;
  playheadSec: number;
  sampleVolume: SampleVolumeFn;
  /** When true, only include clips under the playhead (typical live preview). */
  onlyUnderPlayhead?: boolean;
}): PreviewMixTrack[] {
  const anyAudioSolo = args.lanes.some((lane) => lane.solo);
  const laneById = new Map(args.lanes.map((lane) => [lane.id, lane]));
  const out: PreviewMixTrack[] = [];

  for (const clip of args.clips) {
    if (args.onlyUnderPlayhead !== false) {
      const end = clip.start + clip.duration;
      if (args.playheadSec < clip.start - 0.001 || args.playheadSec >= end) continue;
    }
    const lane = laneById.get(clip.audioTrackId);
    const laneMuted = lane?.muted === true;
    const laneSolo = lane?.solo === true;
    if (!isAudioClipAudible({
      laneMuted,
      laneSolo,
      clipMuted: clip.muted === true,
      anyAudioSolo
    })) {
      continue;
    }
    const url = String(args.resolveUrl(clip) || "").trim();
    if (!url) continue;
    const localT = Math.max(0, args.playheadSec - clip.start);
    const gain = args.sampleVolume(
      clip.volumeKeyframes,
      localT,
      clip.duration,
      clip.volume ?? 1
    );
    // Live preview (onlyUnderPlayhead): HTML video/audio clocks are local to the active
    // clip (0…duration). Absolute timeline offsets would mute every shot after the first.
    const useLocalClock = args.onlyUnderPlayhead !== false;
    const offsetSec = useLocalClock ? 0 : Math.max(0, clip.start);
    const endSec = useLocalClock
      ? Math.max(0.05, clip.duration)
      : Math.max(0, clip.start) + Math.max(0.05, clip.duration);
    out.push({
      id: clip.id,
      url,
      muted: false,
      gain: Math.max(0, Math.min(2, gain)),
      offsetSec,
      endSec,
      label: clip.audioTrackId
    });
  }
  return out;
}
