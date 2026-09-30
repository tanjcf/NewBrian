/**
 * BRAIN Video Runtime v1 — protocol contract (video scene sub-architecture).
 * Architecture: docs/architecture/brain-video-runtime-v1.md
 */

export const BRAIN_VIDEO_RUNTIME_VERSION = "brain-video-runtime-v1" as const;

export const brainVideoCoreOperations = {
  inspect: "video.inspect",
  probe: "video.probe",
  pipelineGet: "video.pipeline_get",
  pipelineSave: "video.pipeline_save",
  markShot: "video.mark_shot",
  cook: "video.cook",
  render: "video.render",
  subtitleShift: "video.subtitle_shift"
} as const;

export type BrainVideoCoreOperation =
  (typeof brainVideoCoreOperations)[keyof typeof brainVideoCoreOperations];

export const brainVideoDesignSectionKeys = ["script", "storyboard", "caption"] as const;
export type BrainVideoDesignSectionKey = (typeof brainVideoDesignSectionKeys)[number];

export interface BrainVideoShot {
  title: string;
  line: string;
  prompt: string;
  clip: string;
  /** Optional narration / TTS relative path under the project. */
  audio?: string;
  /**
   * Optional first-frame / reference image for image-to-video.
   * Maps to gateway `image_url` / provider first-frame fields (model-agnostic).
   * Project-relative path (e.g. media/refs/…) or https/data URL.
   */
  image?: string;
  /**
   * Optional last-frame image for models that support first+last I2V
   * (MiniMax H3 content role=last_frame, Kling contents, PixVerse first/last, etc.).
   */
  lastImage?: string;
  ready: boolean;
  transition: string;
}

/** Output window / aspect adapter persisted with the video pipeline. */
export interface BrainVideoCanvas {
  /** Preset id: 16:9 | 9:16 | 1:1 | 4:3 | custom */
  aspect: string;
  width: number;
  height: number;
  fps: number;
}

/** Per-shot NLE edits persisted in pipeline-editor.json (keyed by shot-1, shot-2, …). */
export interface BrainVideoTrackEdit {
  muted?: boolean;
  inSec?: number;
  outSec?: number;
  /** Timeline start offset in seconds (horizontal drag). */
  offsetSec?: number;
  /** Video lane id, e.g. v1 / v2 — same-kind drag only. */
  videoTrackId?: string;
  /** Audio lane id, e.g. a1 / a2 — same-kind drag only. */
  audioTrackId?: string;
}

/** NLE lane strip persisted with the pipeline editor. */
export interface BrainVideoLaneState {
  id: string;
  kind: "video" | "audio";
  name: string;
  prompt?: string;
  locked?: boolean;
  output?: boolean;
  muted?: boolean;
  solo?: boolean;
}

/** Premiere-like title/text clip on a video track (V1…Vn). */
export interface BrainVideoTextClip {
  id: string;
  trackId: string;
  startSec: number;
  durationSec: number;
  text: string;
  fontSize: number;
  /** CSS hex #RRGGBB */
  color: string;
  /** Normalized center X in frame (0–1). Default 0.5 (center). */
  x?: number;
  /** Normalized center Y in frame (0–1). Default 0.5 (center). */
  y?: number;
  /** Uniform scale multiplier on fontSize (default 1). */
  scale?: number;
  /** Optional box width as fraction of frame width (layout hint). */
  width?: number;
}

/**
 * Premiere-like volume rubber-band keyframe (clip-local time).
 * Linear gain: 0 = silence, 1 = 0 dB (100%), 2 ≈ +6 dB (200%).
 */
export interface BrainVideoVolumeKeyframe {
  /** Seconds from clip start (0 … durationSec). */
  t: number;
  /** Linear gain 0–2. */
  v: number;
}

/**
 * Multi-instance timeline clip (same media can appear on multiple same-type tracks).
 * When present and non-empty, export prefers these over one-shot-one-slot trackEdits.
 */
export interface BrainVideoClipInstance {
  id: string;
  kind: "video" | "audio";
  /** Originating shot id when tied to storyboard; optional for pure imports. */
  shotId?: string;
  relativePath: string;
  trackId: string;
  startSec: number;
  /** Visible duration on the timeline; defaults from in/out or 4s. */
  durationSec?: number;
  inSec?: number;
  outSec?: number;
  muted?: boolean;
  /**
   * Baseline clip gain (linear 0–2). Multiplies the volume envelope.
   * Default 1 (0 dB / 100%).
   */
  volume?: number;
  /**
   * Volume automation keyframes (音量关键帧) on the rubber-band envelope.
   * Clip-local time; linear interpolation between points.
   */
  volumeKeyframes?: BrainVideoVolumeKeyframe[];
  label?: string;
  /** Linked A/V pair from peel/unlink (move together later). */
  linkGroupId?: string;
}

export type { VideoVoiceCasting, VideoVoiceAnalysisInput } from "./video-voice-casting.js";
export interface BrainVideoPipelineState {
  voiceCasting?: import("./video-voice-casting.js").VideoVoiceCasting;
  schemaVersion?: number;
  pipeline?: typeof BRAIN_VIDEO_RUNTIME_VERSION;
  script: string;
  shots: BrainVideoShot[];
  exportFormat: string;
  /** Window size / aspect for preview letterbox and video_generate size. */
  canvas?: BrainVideoCanvas;
  /** Per-shot trim / mute / offset / track assignment. */
  trackEdits?: Record<string, BrainVideoTrackEdit>;
  /** Video + audio lane definitions (V1…Vn, A1…An). */
  lanes?: BrainVideoLaneState[];
  /** Title/text blocks on video tracks. */
  textClips?: BrainVideoTextClip[];
  /** Independent clip instances for same-type track copy / multi-slot layout. */
  clipInstances?: BrainVideoClipInstance[];
}

export interface BrainVideoPipelineSavePayload {
  state: BrainVideoPipelineState;
}

export interface BrainVideoMarkShotPayload {
  shot_index: number;
  ready: boolean;
}

export const brainVideoCookedPaths = {
  metaDir: ".brain-video",
  manifestFile: ".brain-video/manifest.json",
  pipelineFile: ".brain-video/pipeline.json",
  pipelineEditorFile: ".brain-video/pipeline-editor.json",
  docsRoot: "Docs/BRAIN",
  scriptDoc: "Docs/BRAIN/script.md",
  storyboardDoc: "Docs/BRAIN/storyboard.json",
  subtitlesDoc: "Docs/BRAIN/subtitles.srt",
  exportsDir: "exports"
} as const;

export interface BrainVideoCookPayload {
  script?: string;
  shots?: BrainVideoShot[];
  canvas?: BrainVideoCanvas;
}

export interface BrainVideoCookResult {
  pipeline: typeof BRAIN_VIDEO_RUNTIME_VERSION;
  docsRoot: string;
  exportedFiles: string[];
  manifestPath: string;
}

export function requiresVideoCoreApproval(operation: BrainVideoCoreOperation): boolean {
  return operation !== brainVideoCoreOperations.inspect
    && operation !== brainVideoCoreOperations.probe
    && operation !== brainVideoCoreOperations.pipelineGet;
}

/** Format canvas as spring-app / video_generate `size` (e.g. 1920x1080). */
export function brainVideoCanvasSize(canvas?: BrainVideoCanvas | null): string {
  const width = Math.max(16, Math.round(Number(canvas?.width) || 1920));
  const height = Math.max(16, Math.round(Number(canvas?.height) || 1080));
  return `${width}x${height}`;
}
