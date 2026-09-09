import { VideoScriptWorkbench } from "./VideoScriptWorkbench";
import { VideoVoiceCasting } from "./VideoVoiceCasting";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type {
  BrainVideoCanvas,
  BrainVideoClipInstance,
  BrainVideoLaneState,
  BrainVideoPipelineState,
  BrainVideoShot,
  BrainVideoTextClip,
  BrainVideoTrackEdit
} from "@codex-forge/protocol/brain-video-runtime";
import { brainVideoCanvasSize } from "@codex-forge/protocol/brain-video-runtime";
import {
  buildPreviewMixTracks,
  isPrimaryAudioLane,
  resolveLaneMuteUi
} from "./video-pipeline-preview-mix";
import {
  PreviewTextOverlayLayer,
  WorkspaceVideoViewer,
  type WorkspaceMixAudioTrack,
  type WorkspaceVideoTextOverlay,
  type WorkspaceVideoTransitionLayer
} from "./workspace-video-viewer";
import type { ProjectFileOption } from "./ProjectFilePicker";
import {
  buildVideoPipelineAgentQuestion,
  looksLikeAiInstructionPrompt,
  looksLikeLiteralDialogueLine,
  type VideoPipelineAiKind,
  type VideoPipelineAiRequest
} from "./video-pipeline-ai-flow";
import {
  copyInstanceToTrack,
  createClipInstanceId,
  deriveClipInstancesFromShots,
  findLinkedPeers,
  findRelinkCandidate,
  hasPeeledSoundtrackForShot,
  instanceDurationSec,
  isLinkedClipGroup,
  reconcileClipInstancesWithShots,
  relinkAvInstances,
  sequenceBaseSecForShot,
  unlinkClipGroup,
  upsertPeeledSoundtrackInstance,
  upsertPrimaryInstance
} from "./video-pipeline-clip-instances";
import {
  audioTrackLabelForPath,
  healSharedUnscopedAudioPaths,
  isBrokenPeeledAudioMp4Path,
  isPeeledEmbeddedAudioPath,
  isPeeledVideoOnlyPath,
  normalizeMediaPath,
  peeledVideoOriginalMuxCandidates,
  peeledVideoSiblingAudioCandidates,
  pickFirstExistingMediaPath,
  resolveAudioFileId,
  resolveAudioRelativePath
} from "./video-pipeline-audio-resolve";
import {
  DEFAULT_MINIMAX_NARRATION_VOICE_ID,
  MINIMAX_NARRATION_VOICES,
  readStoredMinimaxNarrationVoiceId,
  resolveMinimaxNarrationVoice,
  storeMinimaxNarrationVoiceId,
  type MinimaxNarrationVoiceId
} from "../../shared/minimax-narration-voices";
import {
  clampVolumeGain,
  effectiveVolumeKeyframes,
  gainToDb,
  gainToPercent,
  healSilentVolumeKeyframes,
  insertVolumeKeyframe,
  nudgeVolumeEnvelope,
  removeVolumeKeyframe,
  sampleVolumeEnvelope,
  updateVolumeKeyframe,
  volumeGainToYRatio,
  yRatioToVolumeGain,
  type VolumeKeyframe
} from "../../shared/video-volume-envelope";

type TimelineClipBlock = {
  shotId: string;
  instanceId?: string;
  index: number;
  start: number;
  duration: number;
  label: string;
  ready: boolean;
  muted: boolean;
  hasLine: boolean;
  transitionAfter: number;
  videoTrackId: string;
  audioTrackId: string;
  kind?: "video" | "audio";
  relativePath?: string;
  volume?: number;
  volumeKeyframes?: VolumeKeyframe[];
  linkGroupId?: string;
};

export type VideoPipelineStep = "script" | "storyboard" | "generate" | "tracks" | "mux" | "export";

export type VideoPipelineModelOption = {
  model: string;
  label?: string;
  capabilities?: string[];
};

export type VideoPipelineShellProps = {
  projectId?: string;
  activeStep?: VideoPipelineStep;
  onStepChange?: (step: VideoPipelineStep) => void;
  files?: ProjectFileOption[];
  /** Parent refreshes project file list after media import / TTS persist. */
  onFilesChanged?: () => void;
  /**
   * Hand AI instruction prompts to BRAIN composer / askModel (Auto + skills + tools).
   * Required for prompt-field regenerate; without it, instruction text must not be TTS'd.
   */
  onAskBrain?: (request: VideoPipelineAiRequest) => void | Promise<void>;
  /** Authorized models from 模型管理 / settings (used to pick video_generate model). */
  availableModels?: VideoPipelineModelOption[];
  /** Desktop default model when it is video-capable (never silently force hy-video-v1.5). */
  preferredVideoModel?: string;
};

export type { VideoPipelineAiKind, VideoPipelineAiRequest };

type Shot = BrainVideoShot & { id: string };

type TrackEdit = {
  muted: boolean;
  inSec: number;
  outSec: number;
  trimOpen: boolean;
  /** Timeline start offset (seconds) after drag reposition. */
  offsetSec: number;
  videoTrackId: string;
  audioTrackId: string;
};

type PreviewMode = "shot" | "sequence";

type NleToolId =
  | "selection"
  | "razor"
  | "pen"
  | "hand"
  | "transition"
  | "text";

type TrackHeaderState = {
  locked: boolean;
  output: boolean;
  muted: boolean;
  solo: boolean;
};

type NleLane = {
  id: string;
  kind: "video" | "audio";
  name: string;
  header: TrackHeaderState;
  /** Per-lane editable prompt (video = visual prompt; audio = narration/TTS text). */
  prompt: string;
};

type TimelineTextClip = BrainVideoTextClip;

type MediaBinItem = {
  id: string;
  fileId: string;
  kind: "video" | "audio";
  name: string;
  relativePath: string;
  previewUrl?: string;
  /** Imported muxed file still has an embedded audio stream (Premiere-style composite). */
  hasEmbeddedAudio?: boolean;
  /** Set after unlink peel; peer bin item id for linked A/V. */
  linkGroupId?: string;
  durationSec?: number;
};

const NLE_TOOLS: Array<{ id: NleToolId; label: string; glyph: string; sequenceOnly?: boolean }> = [
  { id: "selection", label: "选择工具 (V)", glyph: "↖" },
  { id: "razor", label: "剃刀工具 (C)", glyph: "✂" },
  { id: "pen", label: "钢笔 · 音量关键帧 (P)", glyph: "✎" },
  { id: "hand", label: "手形工具 (H)", glyph: "✋" },
  { id: "transition", label: "切换特效", glyph: "⟡", sequenceOnly: true },
  { id: "text", label: "文字 (T)", glyph: "T" }
];

const defaultTrackHeader = (): TrackHeaderState => ({
  locked: false,
  output: true,
  muted: false,
  solo: false
});

const createVideoLane = (index: number, prompt = ""): NleLane => ({
  id: `v${index + 1}`,
  kind: "video",
  name: `V${index + 1}`,
  header: defaultTrackHeader(),
  prompt
});

const createAudioLane = (index: number, prompt = ""): NleLane => ({
  id: `a${index + 1}`,
  kind: "audio",
  name: `A${index + 1}`,
  header: defaultTrackHeader(),
  prompt
});

const CANVAS_PRESETS: Array<{ id: string; label: string; width: number; height: number }> = [
  { id: "16:9", label: "16:9 横屏", width: 1920, height: 1080 },
  { id: "9:16", label: "9:16 竖屏", width: 1080, height: 1920 },
  { id: "1:1", label: "1:1 方形", width: 1080, height: 1080 },
  { id: "4:3", label: "4:3", width: 1440, height: 1080 },
  { id: "custom", label: "自定义", width: 1920, height: 1080 }
];

/** Default shot/timeline transition: hard cut (no FFmpeg xfade). */
const DEFAULT_SHOT_TRANSITION = "cut";

const TRANSITION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "cut", label: "硬切" },
  { value: "fade", label: "淡入淡出 · 0.3s" },
  { value: "fade-0.6", label: "淡入淡出 · 0.6s" },
  { value: "dissolve", label: "叠化" },
  { value: "wipe-left", label: "划像 · 左" },
  { value: "blur", label: "模糊过渡" }
];

const steps: Array<{ key: VideoPipelineStep; label: string }> = [
  { key: "script", label: "脚本" },
  { key: "storyboard", label: "分镜" },
  { key: "generate", label: "单镜生成" },
  { key: "tracks", label: "本镜音视频轨" }
];

const defaultCanvas = (): BrainVideoCanvas => ({ aspect: "16:9", width: 1920, height: 1080, fps: 30 });
const defaultTrackEdit = (): TrackEdit => ({
  muted: false,
  inSec: 0,
  outSec: 4,
  trimOpen: false,
  offsetSec: 0,
  videoTrackId: "v1",
  audioTrackId: "a1"
});

function clampNorm(value: number, fallback = 0.5) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function createTextClip(trackId: string, startSec: number, patch: Partial<TimelineTextClip> = {}): TimelineTextClip {
  return {
    id: patch.id || `text-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
    trackId,
    startSec: Math.max(0, Number.isFinite(startSec) ? startSec : 0),
    durationSec: Math.max(0.5, Number(patch.durationSec) || 3),
    text: String(patch.text ?? "标题文字"),
    fontSize: Math.max(12, Math.round(Number(patch.fontSize) || 48)),
    color: String(patch.color || "#ffffff"),
    x: clampNorm(patch.x ?? 0.5, 0.5),
    y: clampNorm(patch.y ?? 0.5, 0.5),
    scale: Math.max(0.2, Math.min(5, Number(patch.scale) || 1)),
    width: patch.width === undefined ? undefined : clampNorm(patch.width, 0.6)
  };
}

function formatTrackRange(edit: TrackEdit) {
  const inSec = Number.isFinite(edit.inSec) ? edit.inSec : 0;
  const outSec = Number.isFinite(edit.outSec) ? edit.outSec : 4;
  return `${inSec}–${outSec}s`;
}

function base64ToObjectUrl(audioBase64: string, mimeType = "audio/wav") {
  const binary = window.atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mimeType || "audio/wav" }));
}

/** Match MiniMax/Kokoro payload to a real extension (never force .wav on mp3 bytes). */
function narrationFileNameForSpeech(shotId: string, mimeType?: string) {
  const mime = String(mimeType || "").toLowerCase();
  const ext = mime.includes("wav")
    ? "wav"
    : mime.includes("ogg")
      ? "ogg"
      : mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")
        ? "m4a"
        : "mp3";
  const safeId = String(shotId || "shot").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  return `narration-${safeId}-${crypto.randomUUID()}.${ext}`;
}

function formatTimecode(sec: number) {
  const t = Math.max(0, Number.isFinite(sec) ? sec : 0);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * 30);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

const TIMELINE_PX_PER_SEC = 64;
/** Track-header column width; must match CSS `--brain-nle-header-w` / sticky headers. */
const NLE_HEADER_WIDTH_PX = 220;
const MIN_AV_TRIM_SEC = 0.1;
const MIN_TEXT_TRIM_SEC = 0.5;
const MAX_MEDIA_OUT_SEC = 600;

type ClipDragMode = "move" | "trim-in" | "trim-out";

function roundTimelineSec(value: number) {
  return Number(Math.max(0, value).toFixed(2));
}

function transitionLabel(value: string) {
  return TRANSITION_OPTIONS.find((item) => item.value === value)?.label || value || "硬切";
}

function normalizeTransition(raw: string | undefined | null) {
  const value = String(raw ?? "").trim();
  if (!value || /^(none|cut|硬切)$/i.test(value)) return DEFAULT_SHOT_TRANSITION;
  if (TRANSITION_OPTIONS.some((item) => item.value === value)) return value;
  if (/硬切|cut/i.test(value)) return "cut";
  if (/0\.6/.test(value)) return "fade-0.6";
  if (/淡入淡出|^fade$/i.test(value) || value === "fade") return "fade";
  if (/叠化|dissolve/i.test(value)) return "dissolve";
  if (/划像|wipe/i.test(value)) return "wipe-left";
  if (/模糊|blur/i.test(value)) return "blur";
  return DEFAULT_SHOT_TRANSITION;
}

function transitionGapSec(value: string) {
  const key = normalizeTransition(value);
  if (key === "cut") return 0;
  if (key === "fade-0.6") return 0.6;
  if (key === "fade") return 0.3;
  if (key === "dissolve" || key === "wipe-left" || key === "blur") return 0.25;
  return 0;
}

function normalizeCanvas(raw?: BrainVideoCanvas | null): BrainVideoCanvas {
  const base = defaultCanvas();
  if (!raw) return base;
  return {
    aspect: String(raw.aspect || base.aspect),
    width: Math.max(16, Math.round(Number(raw.width) || base.width)),
    height: Math.max(16, Math.round(Number(raw.height) || base.height)),
    fps: Math.max(1, Math.round(Number(raw.fps) || base.fps))
  };
}

function createShot(index: number, patch: Partial<BrainVideoShot> = {}): Shot {
  return {
    id: `shot-${index + 1}`,
    title: patch.title || `镜头 ${index + 1}`,
    line: patch.line || "",
    prompt: patch.prompt || "",
    clip: patch.clip || "",
    audio: patch.audio || "",
    image: patch.image || "",
    lastImage: patch.lastImage || "",
    ready: patch.ready === true,
    transition: normalizeTransition(patch.transition ?? DEFAULT_SHOT_TRANSITION)
  };
}

function shotsFromPipeline(state: BrainVideoPipelineState): Shot[] {
  const rows = Array.isArray(state.shots) ? state.shots : [];
  if (!rows.length) return [createShot(0)];
  return rows.map((item, index) => createShot(index, item));
}

function reindexShots(rows: Shot[]): Shot[] {
  return rows.map((item, index) => ({ ...item, id: `shot-${index + 1}` }));
}

function formatMediaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  // Do NOT treat bare "TokenHub" / "token" as quota — upstream 500001 is an unknown server error.
  if (/401008|额度已耗尽|quota exhausted|余额不足|额度不足|daily quota|monthly quota|subscription quota/i.test(message)) {
    return `额度限制：${message}`;
  }
  if (/credential authentication failed|凭证解密|密文无法解密|needs_reentry/i.test(message)) {
    return `网关凭证异常：${message}`;
  }
  if (/400004|服务 ID.*不存在|model .* is not available|服务未开通/i.test(message)) {
    return `模型/服务不可用：${message}`;
  }
  if (/500001|发生未知错误|unknown error occurred/i.test(message)) {
    return `TokenHub 上游未知错误（非额度）：${message}`;
  }
  return message;
}

function resolveClipFileId(files: ProjectFileOption[], clip: string): string | undefined {
  const norm = String(clip || "").replaceAll("\\", "/").replace(/^\.\//, "");
  if (!norm) return undefined;
  const name = norm.split("/").pop() || norm;
  return files.find((file) => {
    const key = String(file.storageKey || file.relativePath || "").replaceAll("\\", "/");
    return key === norm || key.endsWith(`/${norm}`) || key.endsWith(`/${name}`) || key === name;
  })?.id;
}

async function pollVideoRender(renderId: string, onTick: (status: string) => void) {
  const getStatus = window.newbrain?.getVideoRenderStatus;
  if (!getStatus) throw new Error("当前构建未接入渲染状态查询");
  for (;;) {
    const state = await getStatus({ renderId });
    onTick(String(state?.status || "RUNNING"));
    if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(String(state?.status || ""))) return state;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

const VIDEO_PIPELINE_MODEL_KEY = "brain.video.pipeline.model";

function looksLikeVideoModelId(model: string): boolean {
  const text = String(model || "").trim().toLowerCase();
  if (!text || text === "auto") return false;
  return /(?:^|[^a-z0-9])(?:seedance|kling|runway|luma|pika|wanx|wan2\.|hy-?video|hunyuan[-_]?video|doubao-seedance|musesteamer|pixverse|vidu|minimax-video|yt-video|t2v|i2v|video[-_]?gen)(?:[^a-z0-9]|$)/i.test(text)
    || /\b(?:text-to-video|image-to-video|video-gen)\b/i.test(text);
}

function isVideoCapableOption(item: VideoPipelineModelOption): boolean {
  const caps = Array.isArray(item.capabilities) ? item.capabilities : [];
  if (caps.some((tag) => /^(?:video|t2v|i2v|text[_-]?to[_-]?video|image[_-]?to[_-]?video|first[_-]?last[_-]?frame(?:[_-]?video)?|video[_-]?gen|minimax-video|hy-video|supports_i2v)$/i.test(String(tag || "").trim()))) {
    return true;
  }
  return looksLikeVideoModelId(item.model) || looksLikeVideoModelId(item.label || "");
}

/** Model-agnostic I2V hint from 模型管理 capability tags / id. */
function videoModelI2vHint(model: string, options: VideoPipelineModelOption[]): string {
  const id = String(model || "").trim().toLowerCase();
  if (!id) return "未选模型时由网关 Auto 选型；有首帧则走图生视频，无图则文生视频。";
  const option = options.find((item) => String(item.model || "").trim().toLowerCase() === id);
  const caps = (option?.capabilities || []).map((tag) => String(tag || "").toLowerCase());
  const blob = `${id},${caps.join(",")},${option?.label || ""}`.toLowerCase();
  const supportsI2v = caps.some((tag) => /image-to-video|i2v|first-last-frame|supports_i2v/.test(tag))
    || /minimax-video|hy-?video|hunyuan|kling|pixverse|yt-video|youtu/.test(blob);
  const supportsLast = caps.some((tag) => /first-last-frame|supports_first_last_frame/.test(tag))
    || /minimax-video-h3|minimax-video|kling|pixverse/.test(blob);
  if (!supportsI2v) {
    return `「${model}」疑似仅文生视频：请勿提交首/尾帧，或改选带 image-to-video 的模型。`;
  }
  if (!supportsLast) {
    return `「${model}」支持首帧 I2V；尾帧请留空（仅 MiniMax H3 / Kling / PixVerse 等支持首尾帧）。`;
  }
  return `「${model}」可提交首帧，亦可选填尾帧（first+last）。`;
}

function readStoredVideoModel(): string {
  try {
    return String(window.localStorage?.getItem(VIDEO_PIPELINE_MODEL_KEY) || "").trim();
  } catch {
    return "";
  }
}

function writeStoredVideoModel(model: string) {
  try {
    const value = String(model || "").trim();
    if (!value) window.localStorage?.removeItem(VIDEO_PIPELINE_MODEL_KEY);
    else window.localStorage?.setItem(VIDEO_PIPELINE_MODEL_KEY, value);
  } catch {
    // ignore quota / private mode
  }
}

export function VideoPipelineShell({
  projectId,
  activeStep,
  onStepChange,
  files = [],
  onFilesChanged,
  onAskBrain,
  availableModels = [],
  preferredVideoModel = ""
}: VideoPipelineShellProps) {
  const [localStep, setLocalStep] = useState<VideoPipelineStep>("storyboard");
  const [shotIndex, setShotIndex] = useState(0);
  const [script, setScript] = useState("");
  const [shots, setShots] = useState<Shot[]>([createShot(0)]);
  const [canvas, setCanvas] = useState<BrainVideoCanvas>(defaultCanvas);
  const [status, setStatus] = useState(projectId ? "正在加载工程…" : "请先选择视频工程");
  const [exportPreviewUrl, setExportPreviewUrl] = useState("");
  const [shotPreviewUrl, setShotPreviewUrl] = useState("");
  const [sequenceUrls, setSequenceUrls] = useState<string[]>([]);
  const [sequenceIndex, setSequenceIndex] = useState(0);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("shot");
  const [trackEdits, setTrackEdits] = useState<Record<string, TrackEdit>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const videoModelOptions = useMemo(
    () => availableModels.filter((item) => isVideoCapableOption(item)),
    [availableModels]
  );
  const [videoModel, setVideoModel] = useState(() => {
    const stored = readStoredVideoModel();
    if (stored) return stored;
    const preferred = String(preferredVideoModel || "").trim();
    if (preferred && preferred.toLowerCase() !== "auto" && looksLikeVideoModelId(preferred)) {
      return preferred;
    }
    return "";
  });

  useEffect(() => {
    if (videoModel) return;
    const preferred = String(preferredVideoModel || "").trim();
    if (preferred && preferred.toLowerCase() !== "auto" && looksLikeVideoModelId(preferred)) {
      setVideoModel(preferred);
      return;
    }
    // Prefer a TokenHub video model the credential typically supports over leaving Auto
    // (Auto previously could mis-route to chat models like hy3).
    const recommendedIds = ["minimax-video-h3", "kling-video-v3", "pixverse-video-c1"];
    for (const id of recommendedIds) {
      const hit = videoModelOptions.find((item) => String(item.model || "").trim().toLowerCase() === id);
      if (hit) {
        setVideoModel(String(hit.model || "").trim());
        return;
      }
    }
    if (videoModelOptions.length === 1) {
      setVideoModel(String(videoModelOptions[0]?.model || "").trim());
    }
  }, [preferredVideoModel, videoModel, videoModelOptions]);
  const [previewTime, setPreviewTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [seekTo, setSeekTo] = useState<number | null>(null);
  const [seekToken, setSeekToken] = useState(0);
  const [playToken, setPlayToken] = useState(0);
  /** Premiere-like continuous clock for 全片序列 (seconds on the full timeline). */
  const [timelineClockSec, setTimelineClockSec] = useState(0);
  const [sequencePlaying, setSequencePlaying] = useState(false);
  const timelineClockRef = useRef(0);
  const sequencePlayingRef = useRef(false);
  const sequenceIndexRef = useRef(0);
  /** Incoming-local seconds already shown during an outgoing→incoming preview blend. */
  const transitionConsumedRef = useRef(0);
  const timelineClipsRef = useRef<TimelineClipBlock[]>([]);
  const [nleTool, setNleTool] = useState<NleToolId>("selection");
  const [selectedClipKey, setSelectedClipKey] = useState<string | null>(null);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  /** Shift+click partner for explicit Relink of V+A (including 旁白 when intended). */
  const [linkPartnerInstanceId, setLinkPartnerInstanceId] = useState<string | null>(null);
  const [videoLanes, setVideoLanes] = useState<NleLane[]>([createVideoLane(0)]);
  const [audioLanes, setAudioLanes] = useState<NleLane[]>([createAudioLane(0)]);
  const [selectedLaneId, setSelectedLaneId] = useState<string>("v1");
  const [razorCuts, setRazorCuts] = useState<Record<string, number[]>>({});
  const [audioRazorCuts, setAudioRazorCuts] = useState<Record<string, number[]>>({});
  const [shotAudioUrls, setShotAudioUrls] = useState<Record<string, string>>({});
  /** Preview URLs keyed by normalized relativePath (A2 peel + multi-track mix). */
  const [pathAudioUrls, setPathAudioUrls] = useState<Record<string, string>>({});
  const [textClips, setTextClips] = useState<TimelineTextClip[]>([]);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [textEditorFocusToken, setTextEditorFocusToken] = useState(0);
  const [mediaBin, setMediaBin] = useState<MediaBinItem[]>([]);
  const [clipInstances, setClipInstances] = useState<BrainVideoClipInstance[]>([]);
  const [narrationVoiceId, setNarrationVoiceId] = useState<MinimaxNarrationVoiceId>(DEFAULT_MINIMAX_NARRATION_VOICE_ID);
  const [voiceCasting, setVoiceCasting] = useState<BrainVideoPipelineState["voiceCasting"]>();
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    instanceId: string;
    kind: "video" | "audio";
  } | null>(null);
  const [dropTargetLaneId, setDropTargetLaneId] = useState<string | null>(null);
  const [transitionPickerShotId, setTransitionPickerShotId] = useState<string | null>(null);
  const timelineLaneRef = useRef<HTMLDivElement | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const shotFrameInputRef = useRef<HTMLInputElement | null>(null);
  const shotFrameTargetRef = useRef<"image" | "lastImage">("image");
  const [shotFramePreviews, setShotFramePreviews] = useState<{ image?: string; lastImage?: string }>({});
  const textEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const handDragRef = useRef<{ startX: number; scrollLeft: number } | null>(null);
  const trackDragRef = useRef<{ kind: "video" | "audio"; laneId: string; fromIndex: number } | null>(null);
  const clipDragRef = useRef<{
    shotId?: string;
    instanceId?: string;
    textId?: string;
    kind: "video" | "audio" | "text";
    mode: ClipDragMode;
    originX: number;
    originY: number;
    originOffset: number;
    originTrackId: string;
    originInSec?: number;
    originOutSec?: number;
    originDuration?: number;
    fromBinId?: string;
    copyMode?: boolean;
    /** Linked peers at drag start (excluding primary) for sync move/trim. */
    linkPeerOrigins?: Array<{
      id: string;
      shotId?: string;
      startSec: number;
      inSec: number;
      outSec: number;
      durationSec: number;
    }>;
  } | null>(null);
  const volumeKfDragRef = useRef<{
    instanceId: string;
    keyIndex: number | "baseline";
    originClientX: number;
    originClientY: number;
    originT: number;
    originV: number;
    originKeyframes: VolumeKeyframe[];
    originBaseline: number;
    clipDuration: number;
    clipHeight: number;
    clipWidth: number;
  } | null>(null);
  const [selectedVolumeKfIndex, setSelectedVolumeKfIndex] = useState<number | null>(null);
  const overlayDragRef = useRef<{
    textId: string;
    mode: "move" | "scale";
    originClientX: number;
    originClientY: number;
    originX: number;
    originY: number;
    originScale: number;
    stageWidth: number;
    stageHeight: number;
  } | null>(null);
  const previewStageRef = useRef<HTMLDivElement | null>(null);
  const shotAudioUrlsRef = useRef(shotAudioUrls);
  shotAudioUrlsRef.current = shotAudioUrls;
  const autoTtsAttemptedRef = useRef<Record<string, boolean>>({});
  const peelAttemptedRef = useRef<Record<string, boolean>>({});
  const paneRaw = activeStep ?? localStep;
  const pane: VideoPipelineStep = (paneRaw === "mux" || paneRaw === "export") ? "tracks" : paneRaw;
  const shot = shots[shotIndex] ?? shots[0]!;
  const trackEdit = trackEdits[shot.id] ?? defaultTrackEdit();
  const videoTrackHeader = videoLanes[0]?.header ?? defaultTrackHeader();
  const audioTrackHeader = audioLanes[0]?.header ?? defaultTrackHeader();
  const selectedLane = [...videoLanes, ...audioLanes].find((lane) => lane.id === selectedLaneId) || videoLanes[0]!;
  const readyCount = shots.filter((item) => item.ready && String(item.clip || "").trim()).length;
  const muxUnlocked = shots.length > 0 && readyCount === shots.length;
  const aspectRatio = canvas.width / Math.max(1, canvas.height);
  // Compute early: later useCallbacks must not hit TDZ on dependency-array evaluation
  // (historical crash: "Cannot access 'usingExportPreview' before initialization").
  const sequenceHasClipUrl = Boolean(String(sequenceUrls[sequenceIndex] || "").trim());
  const usingExportPreview = previewMode === "sequence" && Boolean(exportPreviewUrl) && !sequenceHasClipUrl;
  const usingExportPreviewRef = useRef(usingExportPreview);
  usingExportPreviewRef.current = usingExportPreview;

  const rememberShotAudio = useCallback((shotId: string, objectUrl: string) => {
    setShotAudioUrls((current) => {
      const prev = current[shotId];
      if (prev && prev !== objectUrl) {
        try { URL.revokeObjectURL(prev); } catch { /* ignore */ }
      }
      return { ...current, [shotId]: objectUrl };
    });
  }, []);

  const persistSpeechToProject = useCallback(async (shotId: string, result: { ok?: boolean; audioBase64?: string; mimeType?: string; durationMs?: number }) => {
    if (!projectId || !result?.ok || !result.audioBase64 || !window.newbrain?.importBrainMedia) return null;
    try {
      const imported = await window.newbrain.importBrainMedia({
        projectId,
        fileName: narrationFileNameForSpeech(shotId, result.mimeType),
        mimeType: result.mimeType || "audio/mpeg",
        bytesBase64: result.audioBase64,
        folder: "audio"
      }) as { relativePath?: string; file?: { id?: string }; kind?: string };
      const relativePath = String(imported?.relativePath || "").trim();
      if (!relativePath) return null;
      updateShot(shotId, { audio: relativePath });
      const edit = trackEdits[shotId] ?? defaultTrackEdit();
      const durationSec = result.durationMs && result.durationMs > 0 ? result.durationMs / 1000
        : Math.max(0.1, (Number.isFinite(edit.outSec) ? edit.outSec : 4) - (Number.isFinite(edit.inSec) ? edit.inSec : 0));
      const startSec = sequenceBaseSecForShot(shots, shotId, trackEdits, clipInstances) + (edit.offsetSec || 0);
      setClipInstances((current) => upsertPrimaryInstance(current, {
        kind: "audio",
        shotId,
        relativePath,
        trackId: edit.audioTrackId || "a1",
        startSec,
        durationSec,
        label: `${shots.find((item) => item.id === shotId)?.title || shotId} · 旁白`
      }));
      onFilesChanged?.();
      return relativePath;
    } catch {
      return null;
    }
  }, [projectId, onFilesChanged, trackEdits, shots, clipInstances]);

  const ingestSpeechResult = useCallback(async (shotId: string, result: { ok?: boolean; audioBase64?: string; mimeType?: string }) => {
    if (!result?.ok || !result.audioBase64) return false;
    const stored = await persistSpeechToProject(shotId, result);
    if (!stored) throw new Error("旁白已生成，但写入项目失败，请重试");
    const url = base64ToObjectUrl(result.audioBase64, result.mimeType || "audio/wav");
    rememberShotAudio(shotId, url);
    return true;
  }, [rememberShotAudio, persistSpeechToProject]);

  useEffect(() => () => {
    for (const url of Object.values(shotAudioUrlsRef.current)) {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }
  }, []);

  const shotClipDuration = useCallback((shotId: string, fallbackMedia = 0) => {
    const edit = trackEdits[shotId] ?? defaultTrackEdit();
    const trimmed = Math.max(0.1, (Number.isFinite(edit.outSec) ? edit.outSec : 4) - (Number.isFinite(edit.inSec) ? edit.inSec : 0));
    if (edit.inSec === 0 && edit.outSec === 4 && fallbackMedia > 0.1) return fallbackMedia;
    return trimmed;
  }, [trackEdits]);

  useEffect(() => {
    setNarrationVoiceId(readStoredMinimaxNarrationVoiceId());
  }, []);

  const shotTimelineBaseSec = useMemo(
    () => sequenceBaseSecForShot(shots, shot.id, trackEdits, clipInstances),
    [shots, shot.id, trackEdits, clipInstances]
  );

  const timelineClips = useMemo((): TimelineClipBlock[] => {
    const mapInstance = (
      instance: BrainVideoClipInstance,
      index: number,
      startSec: number,
      transitionAfter: number
    ): TimelineClipBlock => {
      const shotIdx = instance.shotId
        ? shots.findIndex((item) => item.id === instance.shotId)
        : -1;
      const shotRef = shotIdx >= 0 ? shots[shotIdx] : undefined;
      const duration = instanceDurationSec(instance);
      return {
        shotId: instance.shotId || `import-${instance.id}`,
        instanceId: instance.id,
        index: shotIdx >= 0 ? shotIdx : index,
        start: Math.max(0, startSec),
        duration,
        label: instance.label || shotRef?.title || (instance.kind === "audio" ? "音频" : "视频"),
        ready: Boolean(instance.relativePath),
        muted: instance.muted === true,
        hasLine: instance.kind === "audio"
          ? Boolean(String(shotRef?.line || instance.relativePath || "").trim())
          : Boolean(instance.relativePath),
        transitionAfter,
        videoTrackId: instance.kind === "video" ? instance.trackId : "v1",
        audioTrackId: instance.kind === "audio" ? instance.trackId : "a1",
        kind: instance.kind,
        relativePath: instance.relativePath,
        volume: instance.kind === "audio" ? clampVolumeGain(instance.volume ?? 1) : undefined,
        volumeKeyframes: instance.kind === "audio" && Array.isArray(instance.volumeKeyframes)
          ? instance.volumeKeyframes.map((kf) => ({
            t: Math.max(0, Number(kf.t) || 0),
            v: clampVolumeGain(kf.v)
          }))
          : undefined,
        linkGroupId: instance.linkGroupId ? String(instance.linkGroupId) : undefined
      };
    };

    if (clipInstances.length) {
      if (previewMode === "shot") {
        const filtered = clipInstances.filter((instance) => instance.shotId === shot.id);
        if (filtered.length) {
          return filtered.map((instance, index) => mapInstance(
            instance,
            index,
            (instance.startSec || 0) - shotTimelineBaseSec,
            0
          ));
        }
        // No instances for this shot yet — fall through to legacy single-block placeholder.
      } else {
        // 全片序列：全部 instance，绝对时间轴
        return clipInstances.map((instance, index) => {
          const shotIdx = instance.shotId
            ? shots.findIndex((item) => item.id === instance.shotId)
            : -1;
          const transitionAfter = shotIdx >= 0 && shotIdx < shots.length - 1
            ? transitionGapSec(shots[shotIdx]?.transition || DEFAULT_SHOT_TRANSITION)
            : 0;
          return mapInstance(instance, index, instance.startSec || 0, transitionAfter);
        });
      }
    }
    if (previewMode === "shot") {
      const dur = shotClipDuration(shot.id, mediaDuration);
      const edit = trackEdits[shot.id] ?? defaultTrackEdit();
      const blocks: TimelineClipBlock[] = [{
        shotId: shot.id,
        index: shotIndex,
        start: Math.max(0, edit.offsetSec || 0),
        duration: dur,
        label: shot.title || `镜 ${shotIndex + 1}`,
        ready: Boolean(shot.ready && shot.clip),
        muted: false,
        hasLine: Boolean(String(shot.line || "").trim()),
        transitionAfter: 0,
        videoTrackId: edit.videoTrackId || "v1",
        audioTrackId: "a1",
        kind: "video",
        relativePath: shot.clip || undefined
      }];
      if (String(shot.audio || "").trim() || String(shot.line || "").trim()) {
        blocks.push({
          shotId: shot.id,
          index: shotIndex,
          start: Math.max(0, edit.offsetSec || 0),
          duration: dur,
          label: shot.title ? `${shot.title} · 旁白` : "旁白",
          ready: Boolean(String(shot.audio || "").trim()),
          muted: edit.muted,
          hasLine: Boolean(String(shot.line || shot.audio || "").trim()),
          transitionAfter: 0,
          videoTrackId: "v1",
          audioTrackId: edit.audioTrackId || "a1",
          kind: "audio",
          relativePath: shot.audio || undefined
        });
      }
      return blocks;
    }
    // 全片序列（无 clipInstances）：按镜头顺序铺轨；转场显示为间隙；offset 可微调
    let cursor = 0;
    const blocks: TimelineClipBlock[] = [];
    shots.forEach((item, index) => {
      const edit = trackEdits[item.id] ?? defaultTrackEdit();
      const isActiveSeq = Boolean(String(sequenceUrls[sequenceIndex] || "").trim()) && index === sequenceIndex;
      const dur = shotClipDuration(item.id, isActiveSeq ? mediaDuration : 0);
      const gap = index < shots.length - 1 ? transitionGapSec(item.transition) : 0;
      const start = Math.max(0, cursor + (edit.offsetSec || 0));
      blocks.push({
        shotId: item.id,
        index,
        start,
        duration: dur,
        label: item.title || `镜 ${index + 1}`,
        ready: Boolean(item.ready && item.clip),
        muted: false,
        hasLine: Boolean(String(item.line || "").trim()),
        transitionAfter: gap,
        videoTrackId: edit.videoTrackId || "v1",
        audioTrackId: "a1",
        kind: "video",
        relativePath: item.clip || undefined
      });
      if (String(item.audio || "").trim() || String(item.line || "").trim()) {
        blocks.push({
          shotId: item.id,
          index,
          start,
          duration: dur,
          label: item.title ? `${item.title} · 旁白` : `旁白 ${index + 1}`,
          ready: Boolean(String(item.audio || "").trim()),
          muted: edit.muted,
          hasLine: Boolean(String(item.line || item.audio || "").trim()),
          transitionAfter: gap,
          videoTrackId: "v1",
          audioTrackId: edit.audioTrackId || "a1",
          kind: "audio",
          relativePath: item.audio || undefined
        });
      }
      cursor += dur + gap;
    });
    return blocks;
  }, [clipInstances, previewMode, shot, shotIndex, shotClipDuration, mediaDuration, trackEdits, shots, sequenceUrls, sequenceIndex, shotTimelineBaseSec]);

  /** Selected A-track clip for the volume-envelope inspector (must exist — render references it). */
  const selectedAudioClip = useMemo((): TimelineClipBlock | undefined => {
    if (selectedInstanceId) {
      const byInstance = timelineClips.find(
        (clip) => clip.kind === "audio" && clip.instanceId === selectedInstanceId
      );
      if (byInstance) return byInstance;
    }
    if (!selectedClipKey) return undefined;
    const match = /^audio-(.+)-seg-\d+$/.exec(selectedClipKey);
    if (!match) return undefined;
    const shotIdFromKey = match[1]!;
    return timelineClips.find(
      (clip) => clip.kind === "audio" && clip.shotId === shotIdFromKey
    );
  }, [timelineClips, selectedInstanceId, selectedClipKey]);

  /** Text clips visible on the current timeline (本镜 → local window; 全片 → absolute). */
  const visibleTextClips = useMemo(() => {
    if (previewMode !== "shot") return textClips;
    const shotEnd = shotTimelineBaseSec + Math.max(
      ...timelineClips.map((clip) => clip.start + clip.duration),
      shotClipDuration(shot.id, mediaDuration),
      0.1
    );
    return textClips
      .filter((clip) => {
        const end = clip.startSec + clip.durationSec;
        return end > shotTimelineBaseSec + 0.001 && clip.startSec < shotEnd - 0.001;
      })
      .map((clip) => ({
        ...clip,
        startSec: Math.max(0, clip.startSec - shotTimelineBaseSec)
      }));
  }, [previewMode, textClips, shotTimelineBaseSec, timelineClips, shot.id, shotClipDuration, mediaDuration]);

  // Keep V1/A1 prompts aligned with the active shot when empty / when shot switches
  useEffect(() => {
    setVideoLanes((lanes) => lanes.map((lane, index) => (
      index === 0 && !lane.prompt.trim() ? { ...lane, prompt: shot.prompt || "" } : lane
    )));
    setAudioLanes((lanes) => lanes.map((lane, index) => (
      index === 0 && !lane.prompt.trim() ? { ...lane, prompt: shot.line || "" } : lane
    )));
  }, [shot.id, shot.prompt, shot.line]);

  // Heal all-zero volume rubber-bands (line stuck at clip bottom → silent) back to flat 100%.
  useEffect(() => {
    setClipInstances((current) => {
      let changed = false;
      const next = current.map((item) => {
        if (item.kind !== "audio" || !Array.isArray(item.volumeKeyframes) || !item.volumeKeyframes.length) {
          return item;
        }
        const duration = Math.max(0.1, Number(item.durationSec) || 4);
        const baseline = clampVolumeGain(item.volume ?? 1);
        const healed = healSilentVolumeKeyframes(item.volumeKeyframes, duration, baseline);
        if (!healed) return item;
        const same = healed.length === item.volumeKeyframes.length
          && healed.every((kf, index) => {
            const prev = item.volumeKeyframes![index]!;
            return Math.abs(prev.t - kf.t) < 0.001 && Math.abs(prev.v - kf.v) < 0.001;
          });
        if (same) return item;
        changed = true;
        return { ...item, volume: baseline > 0.001 ? baseline : 1, volumeKeyframes: healed };
      });
      return changed ? next : current;
    });
  }, [clipInstances.length]);

  // Resolve project narration files into preview URLs when blob cache misses
  useEffect(() => {
    if (!projectId || !window.newbrain?.getBrainFilePreviewUrl) return;
    let cancelled = false;
    void (async () => {
      for (const item of shots) {
        if (shotAudioUrlsRef.current[item.id]) continue;
        const fileId = resolveAudioFileId(files, item.id, item.audio);
        if (!fileId) continue;
        try {
          const url = await window.newbrain!.getBrainFilePreviewUrl!({ projectId, fileId });
          if (!cancelled && url) rememberShotAudio(item.id, url);
        } catch {
          // skip missing
        }
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, files, shots, rememberShotAudio]);

  // Resolve audio clip paths into preview URLs for multi-track mix (A1旁白 + A2原声).
  useEffect(() => {
    if (!projectId || !window.newbrain?.getBrainFilePreviewUrl) return;
    let cancelled = false;
    void (async () => {
      const paths = new Set<string>();
      for (const clip of timelineClips) {
        if (clip.kind !== "audio") continue;
        const path = String(clip.relativePath || "").replaceAll("\\", "/").trim();
        if (path) paths.add(path);
      }
      for (const item of mediaBin) {
        if (item.kind !== "audio") continue;
        const path = String(item.relativePath || "").replaceAll("\\", "/").trim();
        if (path) paths.add(path);
      }
      const known = pathAudioUrls;
      for (const path of paths) {
        if (cancelled) return;
        if (known[path]) continue;
        const binUrl = mediaBin.find((row) => String(row.relativePath || "").replaceAll("\\", "/") === path)?.previewUrl;
        if (binUrl) {
          setPathAudioUrls((current) => current[path] ? current : { ...current, [path]: binUrl });
          continue;
        }
        const fileId = resolveClipFileId(files, path);
        if (!fileId) continue;
        try {
          const url = await window.newbrain!.getBrainFilePreviewUrl!({ projectId, fileId });
          if (!cancelled && url) {
            setPathAudioUrls((current) => current[path] ? current : { ...current, [path]: url });
          }
        } catch {
          // skip missing
        }
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- pathAudioUrls read once per timeline/media change
  }, [projectId, files, timelineClips, mediaBin]);

  // Backfill shot.audio from shot-scoped media-bin files only; heal shared unscoped narration copies.
  useEffect(() => {
    const healed = healSharedUnscopedAudioPaths(shots);
    let shotsPatched = healed.changed;
    const withAudioPaths = healed.shots.map((item) => {
      const resolved = resolveAudioRelativePath(files, item.id, item.audio);
      const current = String(item.audio || "").trim().replaceAll("\\", "/");
      if (resolved && resolved !== current) {
        shotsPatched = true;
        return { ...item, audio: resolved };
      }
      return item;
    });
    if (shotsPatched) {
      setShots(withAudioPaths);
      return;
    }
    setClipInstances((current) => {
      const next = reconcileClipInstancesWithShots(current, shots, trackEdits);
      if (next.length === current.length
        && next.every((item, index) => item.id === current[index]?.id
          && item.relativePath === current[index]?.relativePath
          && item.label === current[index]?.label)) {
        return current;
      }
      return next;
    });
  }, [shots, files, trackEdits]);

  // Auto-peel muxed shot clips → silent V + embedded audio on A2 (Premiere unlink).
  // Skip when already video-only or peel soundtrack exists (never reshuffle user layout).
  useEffect(() => {
    if (!projectId || !window.newbrain?.peelBrainMedia) return;
    let cancelled = false;
    void (async () => {
      for (const item of shots) {
        if (cancelled) return;
        const clip = String(item.clip || "").replaceAll("\\", "/").trim();
        if (!clip || !item.ready || isPeeledVideoOnlyPath(clip)) continue;
        if (hasPeeledSoundtrackForShot(pipelineSnapshotRef.current.clipInstances, item.id)) continue;
        await peelShotClipIfNeeded(item.id, clip);
      }
    })();
    return () => { cancelled = true; };
    // peelShotClipIfNeeded closes over latest shots/trackEdits; re-run when clips change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, shots.map((item) => `${item.id}:${item.clip}:${item.ready}`).join("|")]);

  const timelineDuration = useMemo(() => {
    if (previewMode === "sequence" && exportPreviewUrl && !sequenceUrls.some((url) => Boolean(String(url || "").trim())) && mediaDuration > 0.1) {
      return mediaDuration;
    }
    if (previewMode === "sequence") {
      const textEnd = textClips.reduce((max, clip) => Math.max(max, clip.startSec + clip.durationSec), 0);
      const clipsEnd = timelineClips.reduce(
        (max, clip) => Math.max(max, clip.start + clip.duration + (clip.transitionAfter || 0)),
        0
      );
      return Math.max(clipsEnd, textEnd, 1);
    }
    const last = timelineClips[timelineClips.length - 1];
    const textEnd = visibleTextClips.reduce((max, clip) => Math.max(max, clip.startSec + clip.durationSec), 0);
    if (!last) return Math.max(mediaDuration, textEnd, 4);
    return Math.max(last.start + last.duration, mediaDuration, textEnd, 1);
  }, [previewMode, exportPreviewUrl, sequenceUrls, mediaDuration, timelineClips, textClips, visibleTextClips]);

  const rulerTicks = useMemo(() => {
    const step = timelineDuration > 30 ? 5 : timelineDuration > 12 ? 2 : 1;
    const ticks: number[] = [];
    for (let t = 0; t <= timelineDuration + 0.001; t += step) ticks.push(Number(t.toFixed(2)));
    const end = Number(timelineDuration.toFixed(2));
    if (ticks[ticks.length - 1] !== end) ticks.push(end);
    return ticks;
  }, [timelineDuration]);

  timelineClipsRef.current = timelineClips;
  sequenceIndexRef.current = sequenceIndex;
  sequencePlayingRef.current = sequencePlaying;
  timelineClockRef.current = timelineClockSec;

  const playheadSec = previewMode === "sequence" && sequenceHasClipUrl
    ? timelineClockSec
    : previewTime;

  /** Text clips active at the current playhead (preview overlay). */
  const previewActiveTextClips = useMemo(() => {
    return visibleTextClips.filter((clip) => {
      const lane = videoLanes.find((item) => item.id === clip.trackId);
      if (lane && lane.header.output === false) return false;
      const end = clip.startSec + clip.durationSec;
      return playheadSec >= clip.startSec - 0.001 && playheadSec < end;
    });
  }, [visibleTextClips, videoLanes, playheadSec]);

  const previewTextOverlays = useMemo((): WorkspaceVideoTextOverlay[] => {
    const laneOrder = new Map(videoLanes.map((lane, index) => [lane.id, index]));
    return previewActiveTextClips.map((clip) => ({
      id: clip.id,
      text: clip.text || "标题文字",
      fontSize: clip.fontSize,
      color: clip.color,
      x: clip.x,
      y: clip.y,
      scale: clip.scale,
      width: clip.width,
      zIndex: (laneOrder.get(clip.trackId) ?? 0) + 1,
      selected: selectedTextId === clip.id
    }));
  }, [previewActiveTextClips, videoLanes, selectedTextId]);

  const findSequenceClipAt = useCallback((timeSec: number, clips: TimelineClipBlock[]) => {
    if (!clips.length) return null;
    // Prefer video (or non-audio) blocks so A-track duplicates don't shift sequenceIndex.
    const pool = clips.some((clip) => clip.kind !== "audio")
      ? clips.filter((clip) => clip.kind !== "audio")
      : clips;
    for (let i = 0; i < pool.length; i += 1) {
      const clip = pool[i]!;
      if (timeSec >= clip.start && timeSec < clip.start + clip.duration - 0.001) {
        return { clip, index: clip.index, local: Math.max(0, timeSec - clip.start), inGap: false };
      }
    }
    for (let i = 0; i < pool.length; i += 1) {
      const clip = pool[i]!;
      if (timeSec < clip.start) {
        return { clip, index: clip.index, local: 0, inGap: true };
      }
    }
    const last = pool[pool.length - 1]!;
    return {
      clip: last,
      index: last.index,
      local: Math.max(0, last.duration - 0.05),
      inGap: false,
      pastEnd: true as const
    };
  }, []);

  const sequenceClipForShotIndex = useCallback((clips: TimelineClipBlock[], shotIdx: number) => {
    return clips.find((clip) => clip.index === shotIdx && clip.kind !== "audio")
      ?? clips.find((clip) => clip.index === shotIdx)
      ?? null;
  }, []);

  const patchTrack = (shotId: string, patch: Partial<TrackEdit>) => {
    setTrackEdits((current) => ({
      ...current,
      [shotId]: { ...defaultTrackEdit(), ...current[shotId], ...patch }
    }));
  };

  const applyLoadedState = useCallback((state: BrainVideoPipelineState, source: string) => {
    setVoiceCasting(state.voiceCasting);
    setScript(state.script || "");
    const loaded = shotsFromPipeline(state);
    setShots(loaded);
    setCanvas(normalizeCanvas(state.canvas));
    setShotIndex((current) => Math.min(current, Math.max(0, loaded.length - 1)));
    const edits: Record<string, TrackEdit> = {};
    for (const [key, value] of Object.entries(state.trackEdits || {})) {
      edits[key] = {
        ...defaultTrackEdit(),
        muted: value.muted === true,
        inSec: Number(value.inSec) || 0,
        outSec: Number(value.outSec) || 4,
        offsetSec: Number(value.offsetSec) || 0,
        videoTrackId: String(value.videoTrackId || "v1"),
        audioTrackId: String(value.audioTrackId || "a1")
      };
    }
    setTrackEdits(edits);
    const lanes = Array.isArray(state.lanes) ? state.lanes : [];
    const vLanes = lanes.filter((lane) => lane.kind === "video").map((lane, index) => ({
      id: lane.id || `v${index + 1}`,
      kind: "video" as const,
      name: lane.name || `V${index + 1}`,
      prompt: lane.prompt || "",
      header: {
        locked: lane.locked === true,
        output: lane.output !== false,
        muted: lane.muted === true,
        solo: lane.solo === true
      }
    }));
    const aLanes = lanes.filter((lane) => lane.kind === "audio").map((lane, index) => ({
      id: lane.id || `a${index + 1}`,
      kind: "audio" as const,
      name: lane.name || `A${index + 1}`,
      prompt: lane.prompt || "",
      header: {
        locked: lane.locked === true,
        output: lane.output !== false,
        muted: lane.muted === true,
        solo: lane.solo === true
      }
    }));
    setVideoLanes(vLanes.length ? vLanes : [createVideoLane(0)]);
    setAudioLanes(aLanes.length ? aLanes : [createAudioLane(0)]);
    setTextClips((Array.isArray(state.textClips) ? state.textClips : []).map((clip) => createTextClip(
      String(clip.trackId || "v1"),
      Number(clip.startSec) || 0,
      clip
    )));
    const loadedInstances = Array.isArray(state.clipInstances) && state.clipInstances.length
      ? state.clipInstances.map((item) => ({
        id: String(item.id || createClipInstanceId(item.kind === "audio" ? "audio" : "video")),
        kind: (item.kind === "audio" ? "audio" : "video") as "video" | "audio",
        shotId: item.shotId ? String(item.shotId) : undefined,
        relativePath: String(item.relativePath || ""),
        trackId: String(item.trackId || (item.kind === "audio" ? "a1" : "v1")),
        startSec: Math.max(0, Number(item.startSec) || 0),
        durationSec: Number(item.durationSec) || undefined,
        inSec: Number.isFinite(item.inSec) ? Number(item.inSec) : undefined,
        outSec: Number.isFinite(item.outSec) ? Number(item.outSec) : undefined,
        muted: item.muted === true,
        volume: item.kind === "audio" ? clampVolumeGain(item.volume ?? 1) : undefined,
        volumeKeyframes: item.kind === "audio"
          ? (() => {
            const duration = Math.max(0.1, Number(item.durationSec) || 4);
            const baseline = clampVolumeGain(item.volume ?? 1);
            const raw = Array.isArray(item.volumeKeyframes)
              ? item.volumeKeyframes.map((kf) => ({
                t: Math.max(0, Number(kf.t) || 0),
                v: clampVolumeGain(kf.v)
              }))
              : undefined;
            return healSilentVolumeKeyframes(raw, duration, baseline);
          })()
          : undefined,
        label: item.label ? String(item.label) : undefined,
        linkGroupId: item.linkGroupId ? String(item.linkGroupId) : undefined
      })).filter((item) => item.relativePath)
      : deriveClipInstancesFromShots(loaded, edits);
    // Persisted clipInstances may be video-only while shot.audio still has narration paths.
    setClipInstances(reconcileClipInstancesWithShots(loadedInstances, loaded, edits));
    setStatus(source);
  }, []);

  const pipelineSnapshotRef = useRef({
    voiceCasting,
    script,
    shots,
    canvas,
    trackEdits,
    videoLanes,
    audioLanes,
    textClips,
    clipInstances
  });
  pipelineSnapshotRef.current = {
    voiceCasting,
    script,
    shots,
    canvas,
    trackEdits,
    videoLanes,
    audioLanes,
    textClips,
    clipInstances
  };
  const pipelineDirtyRef = useRef(false);
  const pipelineSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildPipelineState = useCallback((): BrainVideoPipelineState => {
    const snap = pipelineSnapshotRef.current;
    return {
      schemaVersion: 1,
      voiceCasting: snap.voiceCasting,
      pipeline: "brain-video-runtime-v1",
      script: snap.script,
      shots: snap.shots.map(({ id: _id, ...item }) => ({
        ...item,
        transition: normalizeTransition(item.transition ?? DEFAULT_SHOT_TRANSITION)
      })),
      exportFormat: "mp4",
      canvas: snap.canvas,
      trackEdits: Object.fromEntries(
        Object.entries(snap.trackEdits).map(([key, edit]) => {
          const persisted: BrainVideoTrackEdit = {
            muted: edit.muted,
            inSec: edit.inSec,
            outSec: edit.outSec,
            offsetSec: edit.offsetSec,
            videoTrackId: edit.videoTrackId || "v1",
            audioTrackId: edit.audioTrackId || "a1"
          };
          return [key, persisted];
        })
      ),
      lanes: [...snap.videoLanes, ...snap.audioLanes].map((lane): BrainVideoLaneState => ({
        id: lane.id,
        kind: lane.kind,
        name: lane.name,
        prompt: lane.prompt,
        locked: lane.header.locked,
        output: lane.header.output,
        muted: lane.header.muted,
        solo: lane.header.solo
      })),
      textClips: snap.textClips,
      clipInstances: snap.clipInstances
    };
  }, []);

  /** @deprecated prefer buildPipelineState — kept name for call sites / other agents. */
  const pipelineState = (): BrainVideoPipelineState => buildPipelineState();

  const reloadPipeline = useCallback(async (source = "已从工程重新加载") => {
    if (!projectId || !window.newbrain?.getBrainVideoPipeline) return;
    const result = await window.newbrain.getBrainVideoPipeline({ projectId }) as { state?: BrainVideoPipelineState };
    if (!result.state) return;
    applyLoadedState(result.state, source);
  }, [applyLoadedState, projectId]);

  useEffect(() => {
    if (!projectId || !window.newbrain?.getBrainVideoPipeline) {
      setStatus(projectId ? "当前构建未接入视频 pipeline" : "请先选择视频工程");
      return;
    }
    void window.newbrain.getBrainVideoPipeline({ projectId }).then((result: { state?: BrainVideoPipelineState; persisted?: boolean }) => {
      if (!result.state) {
        setStatus("工程无分镜状态");
        return;
      }
      applyLoadedState(result.state, result.persisted ? "已从 Rust 工程加载" : "已加载默认分镜（尚未保存）");
    }).catch((error: unknown) => setStatus(`加载失败：${formatMediaError(error)}`));
  }, [applyLoadedState, projectId]);

  useEffect(() => {
    const videoFiles = files.filter((file) => String(file.mimeType || "").startsWith("video/"));
    const output = videoFiles.find((file) => /(?:^|\/)exports?\//iu.test(String(file.relativePath || file.storageKey || "")))
      ?? videoFiles.find((file) => /pipeline-/iu.test(String(file.logicalName || file.storageKey || "")));
    if (!projectId || !output?.id || !window.newbrain?.getBrainFilePreviewUrl) { setExportPreviewUrl(""); return; }
    void window.newbrain.getBrainFilePreviewUrl({ projectId, fileId: output.id }).then(setExportPreviewUrl).catch(() => setExportPreviewUrl(""));
  }, [projectId, files]);

  useEffect(() => {
    const fileId = resolveClipFileId(files, shot.clip);
    if (!projectId || !fileId || !window.newbrain?.getBrainFilePreviewUrl) {
      setShotPreviewUrl("");
      return;
    }
    void window.newbrain.getBrainFilePreviewUrl({ projectId, fileId }).then(setShotPreviewUrl).catch(() => setShotPreviewUrl(""));
  }, [projectId, files, shot.clip, shot.id]);

  useEffect(() => {
    if (!projectId || !window.newbrain?.getBrainFilePreviewUrl) {
      setSequenceUrls([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      // Index-aligned with shots[] so sequenceIndex === shot index
      const urls: string[] = Array.from({ length: shots.length }, () => "");
      await Promise.all(shots.map(async (item, index) => {
        const fileId = resolveClipFileId(files, item.clip);
        if (!fileId) return;
        try {
          urls[index] = await window.newbrain!.getBrainFilePreviewUrl!({ projectId, fileId });
        } catch {
          // leave empty
        }
      }));
      if (!cancelled) {
        setSequenceUrls(urls);
        setSequenceIndex((current) => Math.min(current, Math.max(0, urls.length - 1)));
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, files, shots]);

  const clipPathsForMux = useMemo(() => (
    shots
      .filter((item) => item.ready && String(item.clip || "").trim())
      .map((item) => {
        const clip = String(item.clip).replaceAll("\\", "/");
        return clip.includes("/") ? clip : `media/clips/${clip}`;
      })
  ), [shots]);

  const savePipeline = async (label = "分镜已保存") => {
    if (!projectId) {
      setStatus("请先绑定视频工程后再保存");
      return false;
    }
    if (!window.newbrain?.saveBrainVideoPipeline) {
      setStatus("当前构建未接入 pipeline 保存");
      return false;
    }
    await window.newbrain.saveBrainVideoPipeline({ projectId, state: buildPipelineState() });
    pipelineDirtyRef.current = false;
    if (window.newbrain.saveVideoTimeline) {
      try {
        await window.newbrain.saveVideoTimeline({
          projectId,
          title: "视频工程时间线",
          width: canvas.width,
          height: canvas.height,
          fps: canvas.fps
        });
      } catch {
        // timeline sync is best-effort
      }
    }
    setStatus(label);
    return true;
  };

  /** Debounced persist so drag-end / lane reorder survive desktop restart. */
  const schedulePipelineSave = (label: string, delayMs = 160) => {
    pipelineDirtyRef.current = true;
    if (pipelineSaveTimerRef.current) clearTimeout(pipelineSaveTimerRef.current);
    pipelineSaveTimerRef.current = setTimeout(() => {
      pipelineSaveTimerRef.current = null;
      void savePipeline(label);
    }, delayMs);
  };

  const flushPipelineSave = async (label = "退出前已保存分镜") => {
    if (pipelineSaveTimerRef.current) {
      clearTimeout(pipelineSaveTimerRef.current);
      pipelineSaveTimerRef.current = null;
    }
    if (!projectId) return false;
    if (!pipelineDirtyRef.current) return false;
    return savePipeline(label);
  };

  useEffect(() => {
    if (!projectId) return;
    const onHide = () => {
      void flushPipelineSave("退出前已保存分镜");
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
    };
    window.addEventListener("beforeunload", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      if (pipelineSaveTimerRef.current) {
        clearTimeout(pipelineSaveTimerRef.current);
        pipelineSaveTimerRef.current = null;
      }
    };
  }, [projectId]);

  const applyCanvasPreset = (presetId: string) => {
    const preset = CANVAS_PRESETS.find((item) => item.id === presetId) || CANVAS_PRESETS[0]!;
    setCanvas((current) => ({
      aspect: preset.id,
      width: preset.id === "custom" ? current.width : preset.width,
      height: preset.id === "custom" ? current.height : preset.height,
      fps: current.fps
    }));
  };

  const updateShot = (id: string, patch: Partial<Shot>) => {
    setShots((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const importShotFrameImage = useCallback(async (
    file: File,
    slot: "image" | "lastImage",
    shotId = shot.id
  ) => {
    if (!projectId) {
      setStatus("请先绑定视频工程后再添加参考图");
      return;
    }
    if (!window.newbrain?.importBrainMedia) {
      setStatus("当前构建未接入媒体导入");
      return;
    }
    const name = file.name || `frame-${Date.now()}.png`;
    const mime = file.type || "";
    const isImage = /^image\//i.test(mime) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(name);
    if (!isImage) {
      setStatus(`请选择图片文件：${name}`);
      return;
    }
    setBusyAction(`frame:${slot}:${shotId}`);
    try {
      const pathFromOs = typeof window.newbrain.getPathForFile === "function"
        ? String(window.newbrain.getPathForFile(file) || "").trim()
        : "";
      let imported: { relativePath?: string; file?: { id?: string } } | null = null;
      if (pathFromOs) {
        imported = await window.newbrain.importBrainMedia({
          projectId,
          sourcePath: pathFromOs,
          fileName: name,
          mimeType: mime || undefined,
          folder: "refs"
        });
      } else {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        imported = await window.newbrain.importBrainMedia({
          projectId,
          fileName: name,
          mimeType: mime || "image/png",
          bytesBase64: btoa(binary),
          folder: "refs"
        });
      }
      const relativePath = String(imported?.relativePath || "").trim();
      if (!relativePath) throw new Error("参考图导入未返回路径");
      updateShot(shotId, { [slot]: relativePath });
      onFilesChanged?.();
      setStatus(slot === "image" ? `已添加首帧参考图 · ${relativePath}` : `已添加尾帧参考图 · ${relativePath}`);
      void savePipeline(slot === "image" ? "首帧已写入分镜" : "尾帧已写入分镜");
    } catch (error) {
      setStatus(`参考图导入失败：${formatMediaError(error)}`);
    } finally {
      setBusyAction((current) => current?.startsWith("frame:") ? null : current);
    }
  }, [projectId, shot.id, onFilesChanged]);

  useEffect(() => {
    let cancelled = false;
    const resolvePreview = async (relativePath: string) => {
      const norm = String(relativePath || "").replaceAll("\\", "/").replace(/^\.\//, "");
      if (!norm) return "";
      if (/^https?:\/\//i.test(norm) || /^data:image\//i.test(norm)) return norm;
      const fileId = resolveClipFileId(files, norm);
      if (!projectId || !fileId || !window.newbrain?.getBrainFilePreviewUrl) return "";
      try {
        return await window.newbrain.getBrainFilePreviewUrl({ projectId, fileId });
      } catch {
        return "";
      }
    };
    void (async () => {
      const image = await resolvePreview(String(shot.image || ""));
      const lastImage = await resolvePreview(String(shot.lastImage || ""));
      if (!cancelled) setShotFramePreviews({ image: image || undefined, lastImage: lastImage || undefined });
    })();
    return () => { cancelled = true; };
  }, [projectId, files, shot.id, shot.image, shot.lastImage]);

  /** Ensure A2 exists so peeled soundtrack stays off A1 (旁白). */
  const ensureSoundtrackLaneId = (): string => {
    const existing = audioLanes[1]?.id;
    if (existing) return existing;
    const nextId = `a${Math.max(2, audioLanes.length + 1)}`;
    setAudioLanes((lanes) => {
      if (lanes.some((lane) => lane.id === nextId) || lanes.length >= 2) return lanes;
      return [...lanes, createAudioLane(lanes.length)];
    });
    return nextId;
  };

  /**
   * Premiere unlink: muxed shot clip → video-only on V + embedded audio on A (aligned).
   * Soundtrack is a secondary A clip (A2); shot.audio stays reserved for旁白 TTS.
   */
  const peelShotClipIfNeeded = async (shotId: string, clipRelativePath: string): Promise<boolean> => {
    if (!projectId || !window.newbrain?.peelBrainMedia) return false;
    const clip = String(clipRelativePath || "").replaceAll("\\", "/").trim();
    if (!clip || isPeeledVideoOnlyPath(clip)) return false;
    // Already peeled this shot — never reshuffle startSec/trackId on reload.
    if (hasPeeledSoundtrackForShot(pipelineSnapshotRef.current.clipInstances, shotId)) return false;
    const attemptKey = `${shotId}:${clip}`;
    if (peelAttemptedRef.current[attemptKey]) return false;
    peelAttemptedRef.current[attemptKey] = true;
    try {
      const probe = await window.newbrain.peelBrainMedia({
        projectId,
        relativePath: clip,
        mode: "probe"
      }) as { ok?: boolean; hasAudio?: boolean };
      if (!probe?.ok || !probe.hasAudio) return false;

      setStatus(`正在解链本镜原声 · ${clip}…`);
      const result = await window.newbrain.peelBrainMedia({
        projectId,
        relativePath: clip,
        mode: "unlink"
      }) as {
        ok?: boolean;
        hasAudio?: boolean;
        durationSec?: number;
        video?: { relativePath?: string; file?: { id?: string; logicalName?: string } };
        audio?: { relativePath?: string; file?: { id?: string; logicalName?: string } };
        detail?: string;
      };
      if (!result?.ok || !result.hasAudio || !result.audio?.relativePath) {
        setStatus(result?.detail ? `解链跳过：${result.detail}` : `无嵌入音轨可解链 · ${clip}`);
        return false;
      }

      const videoPath = String(result.video?.relativePath || clip).replaceAll("\\", "/");
      const audioPath = String(result.audio.relativePath).replaceAll("\\", "/");
      const shotRef = shots.find((item) => item.id === shotId);
      const existingAudio = String(shotRef?.audio || "").trim().replaceAll("\\", "/");
      // Clear mistaken prior assignment of peeled path into the旁白 slot.
      const clearMistakenPeelAsNarration = isPeeledEmbeddedAudioPath(existingAudio);
      const linkGroupId = `peel-${shotId}-${Date.now()}`;
      const edit = trackEdits[shotId] ?? defaultTrackEdit();
      const existingForShot = pipelineSnapshotRef.current.clipInstances.filter((item) => item.shotId === shotId);
      const existingStart = existingForShot.find((item) => Number.isFinite(item.startSec))?.startSec;
      const startSec = Number.isFinite(existingStart)
        ? Number(existingStart)
        : sequenceBaseSecForShot(shots, shotId, trackEdits, clipInstances) + (Number(edit.offsetSec) || 0);
      const durationSec = Math.max(
        0.1,
        Number(result.durationSec) || Math.max(0.1, (Number(edit.outSec) || 4) - (Number(edit.inSec) || 0))
      );
      const shotIndexForLabel = Math.max(0, shots.findIndex((item) => item.id === shotId));
      const vLane = String(edit.videoTrackId || videoLanes[0]?.id || "v1");
      const soundtrackLane = ensureSoundtrackLaneId();

      updateShot(shotId, {
        clip: videoPath,
        ready: true,
        ...(clearMistakenPeelAsNarration ? { audio: "" } : {})
      });
      patchTrack(shotId, { videoTrackId: vLane });

      setClipInstances((current) => {
        const existingVideo = current.find((item) => item.kind === "video" && item.shotId === shotId);
        const existingPeel = current.find(
          (item) => item.kind === "audio" && item.shotId === shotId && String(item.id || "").includes("-peel")
        );
        const placedStart = existingVideo?.startSec ?? existingPeel?.startSec ?? startSec;
        const placedVLane = existingVideo?.trackId || vLane;
        const placedALane = existingPeel?.trackId || soundtrackLane;
        let next = upsertPrimaryInstance(current, {
          kind: "video",
          shotId,
          relativePath: videoPath,
          trackId: placedVLane,
          startSec: placedStart,
          durationSec: existingVideo ? instanceDurationSec(existingVideo) : durationSec,
          label: shotRef?.title || `镜 ${shotIndexForLabel + 1}`,
          linkGroupId,
          placement: "keep-if-present"
        });
        next = upsertPeeledSoundtrackInstance(next, {
          shotId,
          relativePath: audioPath,
          trackId: placedALane,
          startSec: placedStart,
          durationSec: existingPeel ? instanceDurationSec(existingPeel) : durationSec,
          label: audioTrackLabelForPath(audioPath, shotRef?.title, shotIndexForLabel),
          linkGroupId,
          placement: "keep-if-present"
        });
        pipelineSnapshotRef.current = {
          ...pipelineSnapshotRef.current,
          clipInstances: next
        };
        return next;
      });
      schedulePipelineSave("解链后已保存分镜布局");

      const videoFileId = String(result.video?.file?.id || "");
      const audioFileId = String(result.audio.file?.id || "");
      let audioPreview = "";
      try {
        if (audioFileId && window.newbrain.getBrainFilePreviewUrl) {
          audioPreview = await window.newbrain.getBrainFilePreviewUrl({ projectId, fileId: audioFileId }) || "";
        }
      } catch { /* optional */ }

      setMediaBin((current) => {
        const videoItem: MediaBinItem = {
          id: `bin-${videoFileId || videoPath}`,
          fileId: videoFileId || videoPath,
          kind: "video",
          name: String(result.video?.file?.logicalName || `${shotRef?.title || shotId} · 画面`),
          relativePath: videoPath,
          hasEmbeddedAudio: false,
          linkGroupId,
          durationSec: result.durationSec
        };
        const audioItem: MediaBinItem = {
          id: `bin-${audioFileId || audioPath}`,
          fileId: audioFileId || audioPath,
          kind: "audio",
          name: String(result.audio.file?.logicalName || `${shotRef?.title || shotId} · 音轨`),
          relativePath: audioPath,
          previewUrl: audioPreview || undefined,
          linkGroupId,
          durationSec: result.durationSec
        };
        const withoutSource = current.filter((row) => {
          const path = String(row.relativePath || "").replaceAll("\\", "/");
          return path !== clip && row.fileId !== videoItem.fileId && row.fileId !== audioItem.fileId;
        });
        return [videoItem, audioItem, ...withoutSource];
      });
      onFilesChanged?.();
      setStatus(`已解链：画面 V=${vLane.toUpperCase()} · 原声 A=${soundtrackLane.toUpperCase()}（旁白仍用 A1）`);
      return true;
    } catch (error) {
      // Allow retry on transient FFmpeg failures.
      delete peelAttemptedRef.current[attemptKey];
      setStatus(`解链失败：${formatMediaError(error)}`);
      return false;
    }
  };

  const addShot = () => {
    setShots((current) => {
      const next = reindexShots([...current, createShot(current.length)]);
      setShotIndex(next.length - 1);
      return next;
    });
    setStatus("已添加镜头（请保存分镜）");
  };

  const deleteShot = (id: string) => {
    setShots((current) => {
      if (current.length <= 1) {
        setStatus("至少保留一个镜头");
        return current;
      }
      const next = reindexShots(current.filter((item) => item.id !== id));
      setShotIndex((index) => Math.min(index, next.length - 1));
      setStatus("已删除镜头（请保存分镜）");
      return next;
    });
  };

  /**
   * 合成 = FFmpeg concat / lavfi，不是再调 video_generate。
   * 需要 AI 模型的是「单镜生成」；本步骤只 mux 本地 clips。
   */
  const muxAndExport = async (label: string) => {
    if (!projectId || !window.newbrain?.startVideoRender) {
      setStatus(`${label}失败：无渲染 IPC（FFmpeg）`);
      return;
    }
    if (!muxUnlocked || clipPathsForMux.length === 0) {
      setStatus(`合成未解锁：需全部镜头就绪（当前 ${readyCount}/${shots.length}），且 clip 已落盘`);
      return;
    }
    setBusyAction("mux");
    setStatus(`正在${label}（FFmpeg concat，非 AI 模型）…`);
    try {
      if (!await savePipeline(`${label}前已保存分镜`)) return;
      setStatus(`正在启动全片${label}…`);
      const started = await window.newbrain.startVideoRender({
        projectId,
        outputRelativePath: `exports/pipeline-${Date.now()}.mp4`,
        source: "pipeline"
      });
      setStatus(`FFmpeg 已启动 · ${started.renderId}`);
      const finished = await pollVideoRender(started.renderId, (tick) => setStatus(`FFmpeg ${tick} · ${started.renderId}`));
      if (finished?.status === "SUCCEEDED") {
        onFilesChanged?.();
        setStatus(`${label}完成 · ${finished.outputPath || started.outputPath || "exports/*.mp4"}`);
      } else {
        setStatus(`${label}结束：${finished?.status || "unknown"}${finished?.errorCode ? ` · ${finished.errorCode}` : ""}`);
      }
    } catch (error) {
      setStatus(`${label}失败：${formatMediaError(error)}`);
    } finally {
      setBusyAction((current) => current === "mux" ? null : current);
    }
  };

  const chooseStep = (key: VideoPipelineStep) => {
    if (activeStep) return;
    setLocalStep(key);
    setStatus(`已切换到${steps.find((item) => item.key === key)?.label}`);
  };

  const handoffToBrainAi = async (input: {
    kind: VideoPipelineAiKind;
    shotId: string;
    userPrompt: string;
    persistFields?: Partial<Pick<Shot, "line" | "prompt">>;
  }): Promise<boolean> => {
    const index = shots.findIndex((item) => item.id === input.shotId);
    const target = shots[index];
    const userPrompt = String(input.userPrompt || "").trim();
    if (!target || index < 0) {
      setStatus("请先选择镜头");
      return false;
    }
    if (!userPrompt) {
      setStatus(input.kind === "narration" ? "请先填写旁白提示词或台词" : "请先填写本镜提示词 Prompt");
      return false;
    }
    if (!onAskBrain) {
      setStatus("当前界面未接入对话 Auto，无法把提示词交给 BRAIN 正常 AI 流程");
      return false;
    }
    if (input.persistFields) {
      updateShot(input.shotId, input.persistFields);
    }
    const size = brainVideoCanvasSize(canvas);
    const question = buildVideoPipelineAgentQuestion({
      projectId,
      shotIndex: index,
      shotId: target.id,
      shotTitle: target.title,
      canvasSize: size,
      kind: input.kind,
      userPrompt,
      currentLine: input.persistFields?.line ?? target.line,
      currentVisualPrompt: input.persistFields?.prompt ?? target.prompt
    });
    try {
      await savePipeline("交给 Auto 前已保存分镜");
    } catch {
      // Still hand off; save failure must not block agent routing.
    }
    setStatus("已交给对话 Auto 处理…");
    await onAskBrain({
      kind: input.kind,
      question,
      shotId: target.id,
      shotIndex: index
    });
    return true;
  };

  const generateShot = async (
    id: string,
    label = "生成",
    options?: { manageBusy?: boolean; skipSave?: boolean; skipReload?: boolean }
  ): Promise<boolean> => {
    const manageBusy = options?.manageBusy !== false;
    const index = shots.findIndex((item) => item.id === id);
    const target = shots[index];
    if (!projectId || index < 0 || !target) {
      setStatus("请先绑定视频工程后再生成分镜，不会做本地假生成");
      return false;
    }
    const promptText = String(target.prompt || target.title || "").trim();
    if (!promptText) {
      setStatus("请先填写本镜提示词 Prompt");
      return false;
    }
    // Instruction-like prompts (rewrite / write-then-TTS / etc.) must go through chat Auto.
    if (looksLikeAiInstructionPrompt(promptText) || !window.newbrain?.generateBrainSceneMedia) {
      return handoffToBrainAi({
        kind: "video",
        shotId: id,
        userPrompt: promptText,
        persistFields: { prompt: promptText }
      });
    }
    const actionKey = `video:${id}`;
    if (manageBusy) setBusyAction(actionKey);
    const size = brainVideoCanvasSize(canvas);
    setStatus(`正在${label} 镜 ${index + 1}（video_generate · ${size}）…`);
    try {
      if (!options?.skipSave) {
        await savePipeline("生成前已保存分镜与画幅");
      }
      const resolvedModel = String(videoModel || "").trim();
      const firstFrame = String(target.image || "").trim();
      const lastFrame = String(target.lastImage || "").trim();
      const result = await window.newbrain.generateBrainSceneMedia({
        projectId,
        kind: "video",
        prompt: promptText,
        model: resolvedModel || undefined,
        shotIndex: index,
        size,
        ...(firstFrame ? { imageUrl: firstFrame } : {}),
        ...(lastFrame ? { lastFrameImageUrl: lastFrame } : {})
      });
      if (resolvedModel) writeStoredVideoModel(resolvedModel);
      const clipPath = String((result as { clipRelativePath?: string })?.clipRelativePath || "").trim();
      if (!clipPath) {
        throw new Error("视频生成尚未返回可播放文件，原镜头已保留。");
      }
      // Preview URLs resolve through the registered file catalog, not just shot.clip.
      onFilesChanged?.();
      const resolvedClip = clipPath || `media/clips/shot-${String(index + 1).padStart(3, "0")}.mp4`;
      setShots((current) => current.map((item, i) => (
        i === index
          ? { ...item, ready: true, clip: clipPath || item.clip || resolvedClip }
          : item
      )));
      setStatus(clipPath
        ? `镜 ${index + 1} 已生成 · ${clipPath} · ${size}`
        : `镜 ${index + 1} 已走 video_generate 并标记就绪 · ${size}`);
      if (!options?.skipReload) {
        await reloadPipeline(`镜 ${index + 1} ${label}完成`);
      }
      const peeled = await peelShotClipIfNeeded(target.id, clipPath || resolvedClip);
      const line = String(target.line || "").trim();
      // Only auto-TTS when peel did not already put embedded audio on A (avoid overwriting 原声).
      if (!voiceCasting && !peeled && looksLikeLiteralDialogueLine(line) && window.newbrain?.synthesizeNovelSpeech) {
        try {
          setStatus(`镜 ${index + 1} 视频就绪，正在生成旁白 TTS…`);
          const narrationVoice = resolveMinimaxNarrationVoice(narrationVoiceId);
          const speech = await window.newbrain.synthesizeNovelSpeech({
            text: line,
            voiceId: narrationVoice.id,
            voiceLabel: narrationVoice.label,
            playback: false,
            preferGateway: true
          } as { text: string; voiceId: string; voiceLabel: string; playback?: boolean; preferGateway?: boolean });
          if (speech?.ok) {
            await ingestSpeechResult(target.id, speech);
            setStatus(`镜 ${index + 1} 视频+TTS 完成 · ${clipPath || "clip"}`);
          } else setStatus(`镜 ${index + 1} 视频已就绪；TTS 失败：${speech?.detail || "未知错误"}`);
        } catch (ttsError) {
          setStatus(`镜 ${index + 1} 视频已就绪；TTS 失败：${formatMediaError(ttsError)}`);
        }
      } else if (peeled) {
        setStatus(`镜 ${index + 1} 视频已解链：画面 V + 原声 A`);
      } else if (line && looksLikeAiInstructionPrompt(line)) {
        setStatus(`镜 ${index + 1} 视频已就绪；旁白字段是 AI 指令，请点「按旁白重新生成」交给 Auto 写稿+配音`);
      }
      return true;
    } catch (error) {
      setStatus(`${label}失败：${formatMediaError(error)}`);
      return false;
    } finally {
      if (manageBusy) {
        setBusyAction((current) => current === actionKey ? null : current);
      }
    }
  };

  const generateAllPending = async () => {
    const pending = shots.filter((item) => !(item.ready && String(item.clip || "").trim()));
    if (!pending.length) {
      setStatus("全部镜头已就绪，无需再生成");
      return;
    }
    const concurrency = Math.min(2, pending.length);
    setBusyAction("video:all");
    setStatus(`并发生成未完成镜（并发 ${concurrency}）· 共 ${pending.length} 镜…`);
    try {
      await savePipeline("批量生成前已保存分镜与画幅");
      let cursor = 0;
      let failed = false;
      const workers = Array.from({ length: concurrency }, async () => {
        while (!failed) {
          const index = cursor;
          cursor += 1;
          if (index >= pending.length) return;
          const item = pending[index]!;
          setStatus(`并发生成中 · 镜 ${item.id}（${index + 1}/${pending.length}）…`);
          const ok = await generateShot(item.id, "生成", {
            manageBusy: false,
            skipSave: true,
            skipReload: true
          });
          if (!ok) {
            failed = true;
            return;
          }
        }
      });
      await Promise.all(workers);
      await reloadPipeline(failed ? "批量生成中断，已刷新分镜" : "批量生成完成");
      if (!failed) {
        setStatus(`批量生成完成 · ${pending.length} 镜`);
      }
    } catch (error) {
      setStatus(`批量生成失败：${formatMediaError(error)}`);
    } finally {
      setBusyAction((current) => current === "video:all" ? null : current);
    }
  };

  /** Mute one audio lane only (Premiere-style). Primary narration lane also syncs clip mute. */
  const setLaneMute = (laneId: string, shotId: string, nextMuted: boolean) => {
    const lane = audioLanes.find((item) => item.id === laneId);
    if (lane?.header.locked) {
      setStatus(`${lane.name} 已锁定，无法修改静音`);
      return;
    }
    patchLaneHeader(laneId, "audio", { muted: nextMuted });
    const isPrimaryNarrationLane = laneId === "a1" || audioLanes[0]?.id === laneId;
    if (isPrimaryNarrationLane) {
      patchTrack(shotId, { muted: nextMuted });
    }
    const label = lane?.name || laneId.toUpperCase();
    setStatus(nextMuted ? `${label} 已静音` : `${label} 已取消静音`);
  };

  const toggleLaneMute = (laneId: string, shotId: string) => {
    const lane = audioLanes.find((item) => item.id === laneId);
    const isPrimaryNarrationLane = laneId === "a1" || audioLanes[0]?.id === laneId;
    const clipMute = isPrimaryNarrationLane
      ? (trackEdits[shotId] ?? defaultTrackEdit()).muted
      : false;
    const current = Boolean(lane?.header.muted || clipMute);
    setLaneMute(laneId, shotId, !current);
  };

  const toggleTrimUi = (shotId: string) => {
    if (videoTrackHeader.locked) {
      setStatus("视频轨已锁定，无法裁剪");
      return;
    }
    const current = trackEdits[shotId] ?? defaultTrackEdit();
    const nextOpen = !current.trimOpen;
    patchTrack(shotId, { trimOpen: nextOpen });
    setStatus(nextOpen ? `${shotId} 入出点编辑已打开` : `${shotId} 入出点编辑已关闭`);
  };

  const applyTrim = (shotId: string, inSec: number, outSec: number) => {
    if (videoTrackHeader.locked) {
      setStatus("视频轨已锁定，无法应用入出点");
      return;
    }
    if (!Number.isFinite(inSec) || !Number.isFinite(outSec) || inSec < 0 || outSec <= inSec) {
      setStatus("入出点无效：需满足 0 ≤ 入点 < 出点");
      return;
    }
    patchTrack(shotId, { inSec, outSec, trimOpen: true });
    setStatus(`${shotId} 入出点已设为 ${inSec}–${outSec}s`);
  };

  /** Direct Kokoro/TTS only for short literal dialogue — never for AI instruction strings. */
  const regenerateLiteralTts = async (shotId: string, textOverride?: string) => {
    if (voiceCasting) {
      const panel = document.querySelector<HTMLDetailsElement>(".video-voice-casting");
      if (panel) { panel.open = true; panel.scrollIntoView({ block: "nearest" }); }
      setStatus("请在角色配音中重做台词，试听并采用新版本。");
      return;
    }
    const target = shots.find((item) => item.id === shotId);
    const line = String(textOverride ?? target?.line ?? "").trim();
    if (!line) {
      setStatus("本镜无旁白文案，无法重生成 TTS");
      return;
    }
    if (looksLikeAiInstructionPrompt(line) || !looksLikeLiteralDialogueLine(line)) {
      await handoffToBrainAi({
        kind: "narration",
        shotId,
        userPrompt: line,
        persistFields: { line }
      });
      return;
    }
    if (!window.newbrain?.synthesizeNovelSpeech) {
      if (onAskBrain) {
        await handoffToBrainAi({
          kind: "narration",
          shotId,
          userPrompt: line,
          persistFields: { line }
        });
        return;
      }
      setStatus("当前构建未接入 TTS，无法重生成旁白");
      return;
    }
    const actionKey = `tts:${shotId}`;
    setBusyAction(actionKey);
    setStatus(`正在重生成 TTS · ${shotId}…`);
    try {
      if (textOverride !== undefined) {
        updateShot(shotId, { line: textOverride });
      }
      const narrationVoice = resolveMinimaxNarrationVoice(narrationVoiceId);
      const result = await window.newbrain.synthesizeNovelSpeech({
        text: line,
        voiceId: narrationVoice.id,
        voiceLabel: narrationVoice.label,
        playback: false,
        preferGateway: true
      } as { text: string; voiceId: string; voiceLabel: string; playback?: boolean; preferGateway?: boolean });
      if (!result?.ok) {
        setStatus(`TTS 失败：${result?.detail || "未知错误"}`);
        return;
      }
      const stored = await persistSpeechToProject(shotId, result);
      if (stored && result.audioBase64) {
        rememberShotAudio(shotId, base64ToObjectUrl(result.audioBase64, result.mimeType || "audio/wav"));
        schedulePipelineSave("旁白绑定已保存");
      }
      setStatus(stored
        ? `TTS 已生成并写入项目 · ${shotId}${result.durationMs ? ` · ${Math.round(result.durationMs)}ms` : ""}`
        : `TTS 已返回，但音频未能写入项目，请重试 · ${shotId}`);
    } catch (error) {
      setStatus(`TTS 失败：${formatMediaError(error)}`);
    } finally {
      setBusyAction((current) => current === actionKey ? null : current);
    }
  };

  /** Explicit A-track / prompt regenerate: hand off to BRAIN Auto (not raw TTS of the prompt). */
  const regenerateNarrationFromPrompt = async (shotId: string, textOverride?: string) => {
    if (voiceCasting) { await regenerateLiteralTts(shotId, textOverride); return; }
    const target = shots.find((item) => item.id === shotId);
    const line = String(textOverride ?? target?.line ?? "").trim();
    if (!line) {
      setStatus("本镜无旁白文案，无法重生成");
      return;
    }
    if (looksLikeAiInstructionPrompt(line) || !looksLikeLiteralDialogueLine(line)) {
      await handoffToBrainAi({
        kind: "narration",
        shotId,
        userPrompt: line,
        persistFields: { line }
      });
      return;
    }
    await regenerateLiteralTts(shotId, line);
  };

  /** V1 / video-lane regenerate from prompt field → Auto when instruction-like or callback present. */
  const regenerateVideoFromPrompt = async (shotId: string, promptOverride?: string) => {
    const target = shots.find((item) => item.id === shotId);
    const promptText = String(promptOverride ?? target?.prompt ?? target?.title ?? "").trim();
    if (!promptText) {
      setStatus("请先填写本镜提示词 Prompt");
      return;
    }
    if (promptOverride !== undefined) {
      updateShot(shotId, { prompt: promptOverride });
    }
    if (looksLikeAiInstructionPrompt(promptText)) {
      await handoffToBrainAi({
        kind: "video",
        shotId,
        userPrompt: promptText,
        persistFields: { prompt: promptText }
      });
      return;
    }
    await generateShot(shotId, "重新生成");
  };

  // Text-only 旁白 without audio file → auto TTS once for literal lines only (never silent-fail).
  useEffect(() => {
    const target = shots[shotIndex];
    if (!target || (pane !== "tracks" && pane !== "generate")) return;
    const line = String(target.line || "").trim();
    if (!line) return;
    if (shotAudioUrls[target.id]) {
      autoTtsAttemptedRef.current[target.id] = false;
      return;
    }
    if (resolveAudioFileId(files, target.id, target.audio)) return;
    if (autoTtsAttemptedRef.current[target.id]) return;
    if (busyAction === `tts:${target.id}`) return;
    if (looksLikeAiInstructionPrompt(line)) {
      autoTtsAttemptedRef.current[target.id] = true;
      setStatus(`镜 ${shotIndex + 1} 旁白字段是 AI 指令，不会直接 TTS；请点「按旁白重新生成」交给 Auto`);
      return;
    }
    if (!looksLikeLiteralDialogueLine(line)) {
      autoTtsAttemptedRef.current[target.id] = true;
      return;
    }
    if (!window.newbrain?.synthesizeNovelSpeech) {
      setStatus(`镜 ${shotIndex + 1} 无旁白文件（仅有文案）。当前构建未接入 TTS，请先生成旁白。`);
      autoTtsAttemptedRef.current[target.id] = true;
      return;
    }
    autoTtsAttemptedRef.current[target.id] = true;
    setStatus(`镜 ${shotIndex + 1} 无旁白文件，正在自动生成 TTS…`);
    void regenerateLiteralTts(target.id, line);
  }, [pane, shotIndex, shots, shotAudioUrls, files, busyAction]);

  const handlePreviewTimeUpdate = useCallback((currentTime: number, duration: number) => {
    const idx = sequenceIndexRef.current;
    const hasSeqMedia = Boolean(String(sequenceUrls[idx] || "").trim())
      || Boolean(shotAudioUrlsRef.current[shots[idx]?.id || ""]);
    if (previewMode === "sequence" && hasSeqMedia && !usingExportPreviewRef.current) {
      const clips = timelineClipsRef.current;
      const clip = sequenceClipForShotIndex(clips, idx);
      if (clip) {
        const mapped = clip.start + Math.max(0, currentTime);
        timelineClockRef.current = mapped;
        setTimelineClockSec(mapped);
        if (duration > 0.2 && currentTime >= Math.max(0.05, duration - 0.08) && sequencePlayingRef.current) {
          const nextTime = clip.start + clip.duration + (clip.transitionAfter || 0);
          if (nextTime > mapped + 0.02) {
            timelineClockRef.current = nextTime;
          }
        }
      }
      return;
    }
    setPreviewTime(currentTime);
    if (duration > 0.05) setMediaDuration(duration);
  }, [previewMode, sequenceUrls, shots, sequenceClipForShotIndex]);

  const handlePreviewDuration = useCallback((duration: number) => {
    const idx = sequenceIndexRef.current;
    const hasSeqVideo = Boolean(String(sequenceUrls[idx] || "").trim());
    if (previewMode === "sequence" && hasSeqVideo && !usingExportPreviewRef.current) return;
    if (duration > 0.05) setMediaDuration(duration);
  }, [previewMode, sequenceUrls]);

  const seekPreviewLocal = useCallback((localSec: number) => {
    const clamped = Math.max(0, localSec);
    setSeekTo(clamped);
    setSeekToken((token) => token + 1);
    setPreviewTime(clamped);
  }, []);

  const shotHasPlayableMedia = useCallback((index: number) => {
    if (String(sequenceUrls[index] || "").trim()) return true;
    const item = shots[index];
    if (!item) return false;
    return Boolean(shotAudioUrls[item.id] || resolveAudioFileId(files, item.id, item.audio));
  }, [sequenceUrls, shots, shotAudioUrls, files]);

  const syncSequenceClock = useCallback((timeSec: number, opts?: { play?: boolean; fromEnded?: boolean }) => {
    const clips = timelineClipsRef.current;
    const duration = (() => {
      const last = clips[clips.length - 1];
      if (!last) return 1;
      return Math.max(last.start + last.duration + last.transitionAfter, 1);
    })();
    let target = Math.max(0, Math.min(timeSec, duration));
    const hit = findSequenceClipAt(target, clips);
    if (!hit || (hit as { pastEnd?: boolean }).pastEnd) {
      timelineClockRef.current = duration;
      setTimelineClockSec(duration);
      sequencePlayingRef.current = false;
      setSequencePlaying(false);
      setStatus("全片序列播放完毕");
      return;
    }
    if (hit.inGap) {
      target = hit.clip.start;
    }
    timelineClockRef.current = target;
    setTimelineClockSec(target);
    const local = Math.max(0, Math.min(target - hit.clip.start, Math.max(hit.clip.duration - 0.02, 0)));
    if (hit.index !== sequenceIndexRef.current) {
      sequenceIndexRef.current = hit.index;
      setSequenceIndex(hit.index);
      setShotIndex(hit.index);
    }
    setSeekTo(local);
    setSeekToken((token) => token + 1);
    const shouldPlay = opts?.play ?? sequencePlayingRef.current;
    if (shouldPlay) {
      sequencePlayingRef.current = true;
      setSequencePlaying(true);
      setPlayToken((token) => token + 1);
      setStatus(`全片序列 · 镜 ${hit.index + 1}/${shots.length} · ${formatTimecode(target)} / ${formatTimecode(duration)}`);
    }
  }, [findSequenceClipAt, shots.length]);

  const seekTimeline = useCallback((timelineSec: number) => {
    const target = Math.max(0, Math.min(timelineSec, timelineDuration));
    const idx = sequenceIndexRef.current;
    const hasSeqVideo = Boolean(String(sequenceUrls[idx] || "").trim());
    const hasSeqNarration = Boolean(shotAudioUrlsRef.current[shots[idx]?.id || ""]);
    if (
      previewMode === "shot"
      || (previewMode === "sequence" && !hasSeqVideo && exportPreviewUrl)
      || (previewMode === "sequence" && !hasSeqVideo && hasSeqNarration)
    ) {
      if (previewMode === "sequence" && !hasSeqVideo && hasSeqNarration && !exportPreviewUrl) {
        // Narration-only segment: map timeline click onto local narration clock.
        const clip = sequenceClipForShotIndex(timelineClipsRef.current, idx);
        const local = clip ? Math.max(0, target - clip.start) : target;
        seekPreviewLocal(local);
        timelineClockRef.current = target;
        setTimelineClockSec(target);
        return;
      }
      seekPreviewLocal(target);
      return;
    }
    syncSequenceClock(target, { play: sequencePlayingRef.current });
  }, [timelineDuration, previewMode, exportPreviewUrl, sequenceUrls, shots, seekPreviewLocal, syncSequenceClock, sequenceClipForShotIndex]);

  const onSequenceClipEnded = useCallback(() => {
    if (previewMode !== "sequence" || !sequencePlayingRef.current) return;
    const idx = sequenceIndexRef.current;
    const hasSeqMedia = Boolean(String(sequenceUrls[idx] || "").trim())
      || Boolean(shotAudioUrlsRef.current[shots[idx]?.id || ""]);
    if (!hasSeqMedia) return;
    const clips = timelineClipsRef.current;
    const clip = sequenceClipForShotIndex(clips, idx);
    if (!clip) {
      sequencePlayingRef.current = false;
      setSequencePlaying(false);
      return;
    }
    const nextTime = clip.start + clip.duration + (clip.transitionAfter || 0);
    const full = clips.reduce(
      (max, item) => Math.max(max, item.start + item.duration + (item.transitionAfter || 0)),
      nextTime
    );
    if (nextTime >= full - 0.05 || idx >= shots.length - 1) {
      timelineClockRef.current = full;
      setTimelineClockSec(full);
      sequencePlayingRef.current = false;
      setSequencePlaying(false);
      setStatus("全片序列播放完毕");
      return;
    }
    // Skip slots with neither video nor narration; keep narration-only shots.
    let nextIdx = idx + 1;
    while (nextIdx < shots.length && !shotHasPlayableMedia(nextIdx)) {
      nextIdx += 1;
    }
    if (nextIdx >= shots.length) {
      timelineClockRef.current = full;
      setTimelineClockSec(full);
      sequencePlayingRef.current = false;
      setSequencePlaying(false);
      setStatus("全片序列播放完毕（后续镜无预览文件）");
      return;
    }
    const nextClip = sequenceClipForShotIndex(clips, nextIdx);
    const consumed = Math.max(0, transitionConsumedRef.current);
    transitionConsumedRef.current = 0;
    sequencePlayingRef.current = true;
    setSequencePlaying(true);
    // Overlap model: incoming head already played during blend → land past that offset.
    const landAt = nextClip
      ? nextClip.start + Math.min(consumed, Math.max(nextClip.duration * 0.45, 0))
      : nextTime;
    syncSequenceClock(landAt, { play: true, fromEnded: true });
  }, [previewMode, sequenceUrls, shots, shotHasPlayableMedia, syncSequenceClock, sequenceClipForShotIndex]);

  const onTimelinePointer = useCallback((event: { clientX: number; shiftKey?: boolean }) => {
    if (nleTool === "hand") return;
    const lane = timelineLaneRef.current;
    if (!lane) return;
    const rect = lane.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const time = ratio * timelineDuration;
    if (nleTool === "selection" || nleTool === "razor") {
      seekTimeline(time);
    }
  }, [seekTimeline, timelineDuration, nleTool]);

  const clientXToTimelineSec = useCallback((clientX: number) => {
    const lane = timelineLaneRef.current;
    if (!lane) return 0;
    const rect = lane.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * timelineDuration;
  }, [timelineDuration]);

  const applyRazorAt = useCallback((shotId: string, timelineSec: number, clipStart: number, clipDuration: number, kind: "video" | "audio") => {
    if (kind === "video" && videoTrackHeader.locked) {
      setStatus("视频轨已锁定，无法使用剃刀");
      return;
    }
    if (kind === "audio" && audioTrackHeader.locked) {
      setStatus("音频轨已锁定，无法使用剃刀");
      return;
    }
    const local = Math.max(0, timelineSec - clipStart);
    if (local <= 0.15 || local >= clipDuration - 0.15) {
      setStatus("剃刀位置太靠近入/出点");
      return;
    }
    const setter = kind === "video" ? setRazorCuts : setAudioRazorCuts;
    setter((current) => {
      const prev = current[shotId] || [];
      if (prev.some((cut) => Math.abs(cut - local) < 0.08)) return current;
      return { ...current, [shotId]: [...prev, local].sort((a, b) => a - b) };
    });
    seekTimeline(timelineSec);
    setStatus(`剃刀切开${kind === "audio" ? "音频" : "视频"} · ${shotId} @ ${local.toFixed(2)}s`);
  }, [videoTrackHeader.locked, audioTrackHeader.locked, seekTimeline]);

  const chooseNleTool = (tool: NleToolId, label: string) => {
    setNleTool(tool);
    setStatus(`已选择${label}`);
  };

  const addVideoLane = () => {
    setVideoLanes((current) => {
      const next = [...current, createVideoLane(current.length)];
      setSelectedLaneId(next[next.length - 1]!.id);
      setStatus(`已添加 ${next[next.length - 1]!.name} 视频轨`);
      return next;
    });
  };

  const addAudioLane = () => {
    setAudioLanes((current) => {
      const next = [...current, createAudioLane(current.length)];
      setSelectedLaneId(next[next.length - 1]!.id);
      setStatus(`已添加 ${next[next.length - 1]!.name} 音频轨`);
      return next;
    });
  };

  const patchLaneHeader = (laneId: string, kind: "video" | "audio", patch: Partial<TrackHeaderState>) => {
    const setter = kind === "video" ? setVideoLanes : setAudioLanes;
    setter((lanes) => lanes.map((lane) => lane.id === laneId ? { ...lane, header: { ...lane.header, ...patch } } : lane));
  };

  const patchLanePrompt = (laneId: string, kind: "video" | "audio", prompt: string) => {
    const setter = kind === "video" ? setVideoLanes : setAudioLanes;
    setter((lanes) => lanes.map((lane) => lane.id === laneId ? { ...lane, prompt } : lane));
    if (laneId === "v1" || (kind === "video" && videoLanes[0]?.id === laneId)) {
      updateShot(shot.id, { prompt });
    }
    if (laneId === "a1" || (kind === "audio" && audioLanes[0]?.id === laneId)) {
      updateShot(shot.id, { line: prompt });
    }
  };

  const resolveAvTrimOrigin = (shotId: string, kind: "video" | "audio", instanceId?: string) => {
    const instance = instanceId ? clipInstances.find((item) => item.id === instanceId) : undefined;
    const edit = trackEdits[shotId] ?? defaultTrackEdit();
    const duration = instance
      ? instanceDurationSec(instance)
      : Math.max(MIN_AV_TRIM_SEC, (Number.isFinite(edit.outSec) ? edit.outSec : 4) - (Number.isFinite(edit.inSec) ? edit.inSec : 0));
    const inSec = Number.isFinite(instance?.inSec)
      ? Number(instance!.inSec)
      : (Number.isFinite(edit.inSec) ? edit.inSec : 0);
    const outSec = Number.isFinite(instance?.outSec)
      ? Number(instance!.outSec)
      : (Number.isFinite(edit.outSec) ? edit.outSec : inSec + duration);
    const startSec = instance ? instance.startSec : (edit.offsetSec || 0);
    const trackId = instance
      ? instance.trackId
      : (kind === "video" ? (edit.videoTrackId || "v1") : (edit.audioTrackId || "a1"));
    return {
      instance,
      inSec: Math.max(0, inSec),
      outSec: Math.max(inSec + MIN_AV_TRIM_SEC, outSec),
      duration: Math.max(MIN_AV_TRIM_SEC, duration),
      startSec: Math.max(0, startSec),
      trackId
    };
  };

  const applyAvTrimPatch = (
    shotId: string | undefined,
    instanceId: string | undefined,
    next: { startSec: number; inSec: number; outSec: number; durationSec: number },
    linkedPeers?: Array<{
      id: string;
      shotId?: string;
      startSec: number;
      inSec: number;
      outSec: number;
      durationSec: number;
      /** Absolute patched values for this peer */
      patch: { startSec: number; inSec: number; outSec: number; durationSec: number };
    }>
  ) => {
    if (instanceId || (linkedPeers && linkedPeers.length)) {
      const peerPatchById = new Map(
        (linkedPeers || []).map((peer) => [peer.id, peer.patch] as const)
      );
      setClipInstances((current) => current.map((item) => {
        if (instanceId && item.id === instanceId) {
          return {
            ...item,
            startSec: next.startSec,
            inSec: next.inSec,
            outSec: next.outSec,
            durationSec: next.durationSec
          };
        }
        const peerPatch = peerPatchById.get(item.id);
        if (peerPatch) {
          return {
            ...item,
            startSec: peerPatch.startSec,
            inSec: peerPatch.inSec,
            outSec: peerPatch.outSec,
            durationSec: peerPatch.durationSec
          };
        }
        return item;
      }));
    }
    // Sync legacy trackEdits for primary (non-copy) or shot-only clips so the trim panel stays correct.
    // offsetSec stays local-to-shot (not sequence-absolute), matching deriveClipInstancesFromShots.
    if (shotId && (!instanceId || !String(instanceId).includes("-copy"))) {
      const base = sequenceBaseSecForShot(shots, shotId, trackEdits, clipInstances);
      patchTrack(shotId, {
        inSec: next.inSec,
        outSec: next.outSec,
        offsetSec: Math.max(0, next.startSec - base),
        trimOpen: true
      });
    }
  };

  const captureLinkPeerOrigins = (instanceId?: string) => {
    if (!instanceId) return [] as Array<{
      id: string;
      shotId?: string;
      startSec: number;
      inSec: number;
      outSec: number;
      durationSec: number;
    }>;
    const peers = findLinkedPeers(clipInstances, instanceId).filter((item) => item.id !== instanceId);
    return peers.map((peer) => {
      const inSec = Number.isFinite(peer.inSec) ? Number(peer.inSec) : 0;
      const durationSec = instanceDurationSec(peer);
      const outSec = Number.isFinite(peer.outSec) ? Number(peer.outSec) : inSec + durationSec;
      return {
        id: peer.id,
        shotId: peer.shotId,
        startSec: Math.max(0, peer.startSec || 0),
        inSec: Math.max(0, inSec),
        outSec: Math.max(inSec + MIN_AV_TRIM_SEC, outSec),
        durationSec: Math.max(MIN_AV_TRIM_SEC, durationSec)
      };
    });
  };

  const patchAudioVolumeEnvelope = useCallback((
    instanceId: string,
    patch: { volume?: number; volumeKeyframes?: VolumeKeyframe[] }
  ) => {
    setClipInstances((current) => current.map((item) => (
      item.id === instanceId && item.kind === "audio"
        ? {
          ...item,
          volume: patch.volume === undefined ? item.volume : clampVolumeGain(patch.volume),
          volumeKeyframes: patch.volumeKeyframes === undefined
            ? item.volumeKeyframes
            : patch.volumeKeyframes.map((kf) => ({
              t: Math.max(0, Number(kf.t) || 0),
              v: clampVolumeGain(kf.v)
            }))
        }
        : item
    )));
  }, []);

  const beginVolumeKeyframeDrag = (
    event: ReactMouseEvent,
    clip: TimelineClipBlock,
    keyIndex: number | "baseline"
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (!clip.instanceId || laneLockedForClip(clip)) return;
    const el = event.currentTarget.closest(".brain-video-nle__clip") as HTMLElement | null;
    const rect = el?.getBoundingClientRect();
    const duration = Math.max(0.1, clip.duration);
    const points = effectiveVolumeKeyframes(clip.volumeKeyframes, duration, clip.volume ?? 1);
    const originT = keyIndex === "baseline" ? 0 : (points[keyIndex]?.t ?? 0);
    const originV = keyIndex === "baseline"
      ? clampVolumeGain(clip.volume ?? 1)
      : (points[keyIndex]?.v ?? 1);
    volumeKfDragRef.current = {
      instanceId: clip.instanceId,
      keyIndex,
      originClientX: event.clientX,
      originClientY: event.clientY,
      originT,
      originV,
      originKeyframes: points.map((p) => ({ ...p })),
      originBaseline: clampVolumeGain(clip.volume ?? 1),
      clipDuration: duration,
      clipHeight: Math.max(8, rect?.height || 40),
      clipWidth: Math.max(8, rect?.width || 80)
    };
    if (typeof keyIndex === "number") setSelectedVolumeKfIndex(keyIndex);
    setSelectedClipKey(`audio-${clip.shotId}-seg-0`);
    if (clip.instanceId) setSelectedInstanceId(clip.instanceId);
    clipDragRef.current = null;
  };

  const laneLockedForClip = (clip: TimelineClipBlock) => {
    const lane = audioLanes.find((item) => item.id === clip.audioTrackId);
    return Boolean(lane?.header.locked);
  };

  const addVolumeKeyframeAtClient = (
    event: ReactMouseEvent,
    clip: TimelineClipBlock
  ) => {
    if (!clip.instanceId || laneLockedForClip(clip)) return;
    const el = event.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const xRatio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    const yRatio = Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)));
    const t = xRatio * Math.max(0.1, clip.duration);
    const v = yRatioToVolumeGain(yRatio);
    const next = insertVolumeKeyframe(clip.volumeKeyframes, clip.duration, t, v, clip.volume ?? 1);
    patchAudioVolumeEnvelope(clip.instanceId, { volumeKeyframes: next, volume: clip.volume ?? 1 });
    const idx = next.findIndex((p) => Math.abs(p.t - t) < 0.05);
    setSelectedVolumeKfIndex(idx >= 0 ? idx : null);
    setSelectedClipKey(`audio-${clip.shotId}-seg-0`);
    if (clip.instanceId) setSelectedInstanceId(clip.instanceId);
    setStatus(`已添加音量关键帧 · ${gainToPercent(v)}% (${gainToDb(v).toFixed(1)} dB)`);
    void savePipeline("音量关键帧已写入分镜");
  };

  const beginClipDrag = (event: ReactMouseEvent, shotId: string, kind: "video" | "audio", instanceId?: string) => {
    if (nleTool !== "selection") return;
    const origin = resolveAvTrimOrigin(shotId, kind, instanceId);
    const lane = (kind === "video" ? videoLanes : audioLanes).find((item) => item.id === origin.trackId);
    if (lane?.header.locked) {
      setStatus(`${lane.name} 已锁定，无法拖动`);
      return;
    }
    const resolvedId = origin.instance?.id ?? instanceId;
    clipDragRef.current = {
      shotId,
      instanceId: resolvedId,
      kind,
      mode: "move",
      originX: event.clientX,
      originY: event.clientY,
      originOffset: origin.startSec,
      originTrackId: origin.trackId,
      originInSec: origin.inSec,
      originOutSec: origin.outSec,
      originDuration: origin.duration,
      copyMode: event.ctrlKey || event.metaKey,
      linkPeerOrigins: event.ctrlKey || event.metaKey ? [] : captureLinkPeerOrigins(resolvedId)
    };
    event.preventDefault();
    event.stopPropagation();
  };

  const beginClipTrim = (
    event: ReactMouseEvent,
    shotId: string,
    kind: "video" | "audio",
    edge: "in" | "out",
    instanceId?: string
  ) => {
    if (nleTool !== "selection") return;
    const origin = resolveAvTrimOrigin(shotId, kind, instanceId);
    const lane = (kind === "video" ? videoLanes : audioLanes).find((item) => item.id === origin.trackId);
    if (lane?.header.locked) {
      setStatus(`${lane.name} 已锁定，无法裁剪`);
      return;
    }
    const resolvedId = origin.instance?.id ?? instanceId;
    clipDragRef.current = {
      shotId,
      instanceId: resolvedId,
      kind,
      mode: edge === "in" ? "trim-in" : "trim-out",
      originX: event.clientX,
      originY: event.clientY,
      originOffset: origin.startSec,
      originTrackId: origin.trackId,
      originInSec: origin.inSec,
      originOutSec: origin.outSec,
      originDuration: origin.duration,
      copyMode: false,
      linkPeerOrigins: captureLinkPeerOrigins(resolvedId)
    };
    event.preventDefault();
    event.stopPropagation();
  };

  const beginTextDrag = (event: ReactMouseEvent, textId: string) => {
    if (nleTool !== "selection") return;
    const clip = textClips.find((item) => item.id === textId);
    if (!clip) return;
    const lane = videoLanes.find((item) => item.id === clip.trackId);
    if (lane?.header.locked) {
      setStatus(`${lane.name} 已锁定，无法拖动文字`);
      return;
    }
    clipDragRef.current = {
      textId,
      kind: "text",
      mode: "move",
      originX: event.clientX,
      originY: event.clientY,
      originOffset: clip.startSec,
      originTrackId: clip.trackId,
      originDuration: clip.durationSec,
      copyMode: false
    };
    event.preventDefault();
    event.stopPropagation();
  };

  const beginTextTrim = (event: ReactMouseEvent, textId: string, edge: "in" | "out") => {
    if (nleTool !== "selection") return;
    const clip = textClips.find((item) => item.id === textId);
    if (!clip) return;
    const lane = videoLanes.find((item) => item.id === clip.trackId);
    if (lane?.header.locked) {
      setStatus(`${lane.name} 已锁定，无法裁剪文字`);
      return;
    }
    clipDragRef.current = {
      textId,
      kind: "text",
      mode: edge === "in" ? "trim-in" : "trim-out",
      originX: event.clientX,
      originY: event.clientY,
      originOffset: clip.startSec,
      originTrackId: clip.trackId,
      originDuration: Math.max(MIN_TEXT_TRIM_SEC, clip.durationSec),
      copyMode: false
    };
    event.preventDefault();
    event.stopPropagation();
  };

  const hitTestLane = (clientY: number, kind: "video" | "audio" | "text") => {
    const root = timelineLaneRef.current;
    if (!root) return null;
    const nodes = root.querySelectorAll<HTMLElement>("[data-track-id][data-track-kind]");
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (clientY < rect.top || clientY > rect.bottom) continue;
      const trackKind = node.dataset.trackKind as "video" | "audio";
      const trackId = String(node.dataset.trackId || "");
      if (!trackId) continue;
      if (kind === "text" || kind === "video") {
        if (trackKind !== "video") return { id: trackId, kind: trackKind, valid: false };
        return { id: trackId, kind: trackKind, valid: true };
      }
      if (trackKind !== "audio") return { id: trackId, kind: trackKind, valid: false };
      return { id: trackId, kind: trackKind, valid: true };
    }
    return null;
  };

  const onClipDragMove = (event: ReactMouseEvent) => {
    const volumeDrag = volumeKfDragRef.current;
    if (volumeDrag) {
      const duration = Math.max(0.1, volumeDrag.clipDuration);
      const dy = event.clientY - volumeDrag.originClientY;
      const dx = event.clientX - volumeDrag.originClientX;
      const deltaV = -(dy / volumeDrag.clipHeight) * 2;
      if (volumeDrag.keyIndex === "baseline") {
        const nudged = nudgeVolumeEnvelope(
          volumeDrag.originKeyframes,
          duration,
          deltaV,
          volumeDrag.originBaseline
        );
        patchAudioVolumeEnvelope(volumeDrag.instanceId, {
          volumeKeyframes: nudged.keyframes,
          volume: clampVolumeGain(volumeDrag.originBaseline + deltaV)
        });
      } else {
        const deltaT = (dx / volumeDrag.clipWidth) * duration;
        const next = updateVolumeKeyframe(
          volumeDrag.originKeyframes,
          duration,
          volumeDrag.keyIndex,
          {
            t: volumeDrag.originT + deltaT,
            v: volumeDrag.originV + deltaV
          }
        );
        patchAudioVolumeEnvelope(volumeDrag.instanceId, { volumeKeyframes: next });
        setSelectedVolumeKfIndex(volumeDrag.keyIndex);
      }
      return;
    }

    const drag = clipDragRef.current;
    if (!drag) return;

    if (drag.mode === "trim-in" || drag.mode === "trim-out") {
      const deltaSec = (event.clientX - drag.originX) / TIMELINE_PX_PER_SEC;
      if (drag.kind === "text" && drag.textId) {
        const originStart = drag.originOffset;
        const originDur = Math.max(MIN_TEXT_TRIM_SEC, drag.originDuration || MIN_TEXT_TRIM_SEC);
        const originEnd = originStart + originDur;
        if (drag.mode === "trim-in") {
          let nextStart = roundTimelineSec(originStart + deltaSec);
          nextStart = Math.max(0, nextStart);
          let nextDur = roundTimelineSec(originEnd - nextStart);
          if (nextDur < MIN_TEXT_TRIM_SEC) {
            nextDur = MIN_TEXT_TRIM_SEC;
            nextStart = roundTimelineSec(Math.max(0, originEnd - nextDur));
          }
          setTextClips((current) => current.map((item) => (
            item.id === drag.textId ? { ...item, startSec: nextStart, durationSec: nextDur } : item
          )));
        } else {
          const nextDur = roundTimelineSec(Math.max(MIN_TEXT_TRIM_SEC, originDur + deltaSec));
          setTextClips((current) => current.map((item) => (
            item.id === drag.textId ? { ...item, durationSec: nextDur } : item
          )));
        }
        return;
      }

      if (drag.kind === "video" || drag.kind === "audio") {
        const originIn = Math.max(0, drag.originInSec ?? 0);
        const originOut = Math.max(originIn + MIN_AV_TRIM_SEC, drag.originOutSec ?? (originIn + (drag.originDuration || 4)));
        const originStart = Math.max(0, drag.originOffset);
        const peers = drag.linkPeerOrigins || [];
        if (drag.mode === "trim-in") {
          let delta = deltaSec;
          delta = Math.max(delta, -originIn);
          delta = Math.max(delta, -originStart);
          delta = Math.min(delta, originOut - originIn - MIN_AV_TRIM_SEC);
          for (const peer of peers) {
            delta = Math.max(delta, -peer.inSec);
            delta = Math.max(delta, -peer.startSec);
            delta = Math.min(delta, peer.outSec - peer.inSec - MIN_AV_TRIM_SEC);
          }
          const nextIn = roundTimelineSec(originIn + delta);
          const nextStart = roundTimelineSec(originStart + delta);
          const nextOut = roundTimelineSec(originOut);
          const nextDur = roundTimelineSec(Math.max(MIN_AV_TRIM_SEC, nextOut - nextIn));
          applyAvTrimPatch(drag.shotId, drag.instanceId, {
            startSec: nextStart,
            inSec: nextIn,
            outSec: nextOut,
            durationSec: nextDur
          }, peers.map((peer) => {
            const peerIn = roundTimelineSec(peer.inSec + delta);
            const peerStart = roundTimelineSec(peer.startSec + delta);
            const peerOut = roundTimelineSec(peer.outSec);
            return {
              ...peer,
              patch: {
                startSec: peerStart,
                inSec: peerIn,
                outSec: peerOut,
                durationSec: roundTimelineSec(Math.max(MIN_AV_TRIM_SEC, peerOut - peerIn))
              }
            };
          }));
        } else {
          let delta = deltaSec;
          delta = Math.max(delta, -(originOut - originIn - MIN_AV_TRIM_SEC));
          delta = Math.min(delta, MAX_MEDIA_OUT_SEC - originOut);
          for (const peer of peers) {
            delta = Math.max(delta, -(peer.outSec - peer.inSec - MIN_AV_TRIM_SEC));
            delta = Math.min(delta, MAX_MEDIA_OUT_SEC - peer.outSec);
          }
          const nextIn = roundTimelineSec(originIn);
          const nextOut = roundTimelineSec(originOut + delta);
          const nextDur = roundTimelineSec(Math.max(MIN_AV_TRIM_SEC, nextOut - nextIn));
          applyAvTrimPatch(drag.shotId, drag.instanceId, {
            startSec: originStart,
            inSec: nextIn,
            outSec: nextOut,
            durationSec: nextDur
          }, peers.map((peer) => {
            const peerIn = roundTimelineSec(peer.inSec);
            const peerOut = roundTimelineSec(peer.outSec + delta);
            return {
              ...peer,
              patch: {
                startSec: peer.startSec,
                inSec: peerIn,
                outSec: peerOut,
                durationSec: roundTimelineSec(Math.max(MIN_AV_TRIM_SEC, peerOut - peerIn))
              }
            };
          }));
        }
      }
      return;
    }

    const hit = hitTestLane(event.clientY, drag.kind);
    const changingTrack = Boolean(hit?.valid && hit.id !== drag.originTrackId);
    setDropTargetLaneId(hit?.valid ? hit.id : (hit && !hit.valid ? null : drag.originTrackId));
    if (changingTrack) {
      if (drag.copyMode && drag.instanceId && hit?.valid) {
        // Ctrl+drag: preview status only; copy applied on mouseup
        setStatus(`松开以复制到 ${hit.id.toUpperCase()}（时间位置不变）`);
        return;
      }
      if (drag.copyMode && !drag.instanceId && drag.shotId && hit?.valid) {
        setStatus(`松开以复制到 ${hit.id.toUpperCase()}（时间位置不变）`);
        return;
      }
      // Premiere: reassign track, keep timeline position
      if (drag.kind === "text" && drag.textId) {
        setTextClips((current) => current.map((item) => (
          item.id === drag.textId ? { ...item, trackId: hit!.id, startSec: drag.originOffset } : item
        )));
      } else if (drag.instanceId) {
        setClipInstances((current) => current.map((item) => {
          if (item.id === drag.instanceId) {
            return { ...item, trackId: hit!.id, startSec: drag.originOffset };
          }
          const peer = (drag.linkPeerOrigins || []).find((row) => row.id === item.id);
          if (peer) {
            // Vertical reassign only moves the dragged clip; peers keep their origin times.
            return { ...item, startSec: peer.startSec };
          }
          return item;
        }));
        if (drag.shotId) {
          const localOffset = Math.max(0, drag.originOffset - sequenceBaseSecForShot(shots, drag.shotId, trackEdits, clipInstances));
          const patch = drag.kind === "video"
            ? { videoTrackId: hit!.id, offsetSec: localOffset }
            : { audioTrackId: hit!.id, offsetSec: localOffset };
          patchTrack(drag.shotId, patch);
        }
      } else if (drag.shotId) {
        const patch = drag.kind === "video"
          ? { videoTrackId: hit!.id, offsetSec: drag.originOffset }
          : { audioTrackId: hit!.id, offsetSec: drag.originOffset };
        patchTrack(drag.shotId, patch);
      }
      return;
    }
    const deltaSec = (event.clientX - drag.originX) / TIMELINE_PX_PER_SEC;
    const nextOffset = Math.max(0, Math.min(600, drag.originOffset + deltaSec));
    if (drag.kind === "text" && drag.textId) {
      setTextClips((current) => current.map((item) => (
        item.id === drag.textId ? { ...item, startSec: Number(nextOffset.toFixed(2)) } : item
      )));
    } else if (drag.instanceId) {
      const peers = drag.linkPeerOrigins || [];
      const peerNextById = new Map(
        peers.map((peer) => [
          peer.id,
          Number(Math.max(0, Math.min(600, peer.startSec + deltaSec)).toFixed(2))
        ] as const)
      );
      setClipInstances((current) => current.map((item) => {
        if (item.id === drag.instanceId) {
          return { ...item, startSec: Number(nextOffset.toFixed(2)) };
        }
        const peerStart = peerNextById.get(item.id);
        if (peerStart !== undefined) {
          return { ...item, startSec: peerStart };
        }
        return item;
      }));
      if (drag.shotId) {
        const localOffset = Math.max(0, nextOffset - sequenceBaseSecForShot(shots, drag.shotId, trackEdits, clipInstances));
        patchTrack(drag.shotId, { offsetSec: Number(localOffset.toFixed(2)) });
      }
    } else if (drag.shotId) {
      patchTrack(drag.shotId, { offsetSec: Number(nextOffset.toFixed(2)) });
    }
  };

  const endClipDrag = () => {
    if (volumeKfDragRef.current) {
      volumeKfDragRef.current = null;
      void savePipeline("音量包络已写入分镜");
      setStatus("音量关键帧已更新");
      return;
    }
    const drag = clipDragRef.current;
    if (!drag) return;
    if (drag.mode === "trim-in" || drag.mode === "trim-out") {
      const edgeLabel = drag.mode === "trim-in" ? "入点" : "出点";
      const kindLabel = drag.kind === "text" ? "文字" : drag.kind === "audio" ? "音频" : "视频";
      setStatus(`已裁剪${kindLabel}${edgeLabel}`);
      clipDragRef.current = null;
      setDropTargetLaneId(null);
      schedulePipelineSave("裁剪已写入分镜");
      return;
    }
    if (drag.copyMode && dropTargetLaneId && dropTargetLaneId !== drag.originTrackId) {
      if (drag.instanceId) {
        const result = copyInstanceToTrack(clipInstances, drag.instanceId, dropTargetLaneId);
        if (result.error) setStatus(result.error);
        else {
          setClipInstances(result.next);
          pipelineSnapshotRef.current = {
            ...pipelineSnapshotRef.current,
            clipInstances: result.next
          };
          setStatus(`已复制到 ${dropTargetLaneId.toUpperCase()}（时间位置不变）`);
        }
      } else if (drag.shotId && (drag.kind === "video" || drag.kind === "audio")) {
        // Bootstrap instance then copy when legacy shot-only model
        const edit = trackEdits[drag.shotId] ?? defaultTrackEdit();
        const target = shots.find((item) => item.id === drag.shotId);
        const path = drag.kind === "video" ? String(target?.clip || "") : String(target?.audio || "");
        if (path) {
          const seed: BrainVideoClipInstance = {
            id: createClipInstanceId(drag.kind),
            kind: drag.kind,
            shotId: drag.shotId,
            relativePath: path,
            trackId: drag.originTrackId,
            startSec: drag.originOffset,
            durationSec: Math.max(0.1, (edit.outSec || 4) - (edit.inSec || 0)),
            label: target?.title
          };
          const withSeed = clipInstances.some((item) => item.id === seed.id)
            ? clipInstances
            : [...clipInstances, seed];
          const result = copyInstanceToTrack(withSeed, seed.id, dropTargetLaneId);
          if (result.error) setStatus(result.error);
          else {
            setClipInstances(result.next);
            pipelineSnapshotRef.current = {
              ...pipelineSnapshotRef.current,
              clipInstances: result.next
            };
            setStatus(`已复制到 ${dropTargetLaneId.toUpperCase()}（时间位置不变）`);
          }
        }
      }
    } else if (dropTargetLaneId && dropTargetLaneId !== drag.originTrackId) {
      setStatus(`已移至 ${dropTargetLaneId.toUpperCase()}（时间位置不变）`);
    } else {
      const linkedCount = (drag.linkPeerOrigins?.length || 0) + (drag.instanceId ? 1 : 0);
      const movedLabel = drag.kind === "text" ? "文字" : drag.kind === "audio" ? "音频" : "视频";
      setStatus(
        linkedCount > 1
          ? `已移动链接组（${linkedCount}）`
          : `已移动${movedLabel}片段`
      );
    }
    clipDragRef.current = null;
    setDropTargetLaneId(null);
    schedulePipelineSave("轨道布局已写入分镜");
  };

  const copySelectedToTrack = (targetTrackId: string) => {
    if (!contextMenu) return;
    const result = copyInstanceToTrack(clipInstances, contextMenu.instanceId, targetTrackId);
    setContextMenu(null);
    if (result.error) {
      setStatus(result.error);
      return;
    }
    setClipInstances(result.next);
    pipelineSnapshotRef.current = {
      ...pipelineSnapshotRef.current,
      clipInstances: result.next
    };
    setStatus(`已复制到 ${targetTrackId.toUpperCase()}（时间位置不变）`);
    schedulePipelineSave("复制片段已写入分镜");
  };

  const openClipContextMenu = (
    event: ReactMouseEvent,
    kind: "video" | "audio",
    instanceId?: string
  ) => {
    if (!instanceId) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedInstanceId(instanceId);
    setContextMenu({ x: event.clientX, y: event.clientY, instanceId, kind });
  };

  const selectClipInstance = (
    event: ReactMouseEvent,
    segKey: string,
    instanceId: string | undefined,
    kind: "video" | "audio"
  ) => {
    if (!instanceId) {
      setSelectedClipKey(segKey);
      setSelectedInstanceId(null);
      setLinkPartnerInstanceId(null);
      return;
    }
    if (event.shiftKey && selectedInstanceId && selectedInstanceId !== instanceId) {
      const selected = clipInstances.find((item) => item.id === selectedInstanceId);
      const next = clipInstances.find((item) => item.id === instanceId);
      if (selected && next && selected.kind !== next.kind) {
        setLinkPartnerInstanceId(instanceId);
        setSelectedClipKey(segKey);
        setStatus(`已点选配对：${selected.kind === "video" ? "V" : "A"} + ${kind === "video" ? "V" : "A"}，可「重新链接」`);
        return;
      }
    }
    setSelectedClipKey(segKey);
    setSelectedInstanceId(instanceId);
    setLinkPartnerInstanceId(null);
  };

  const breakClipLink = (instanceId: string) => {
    const result = unlinkClipGroup(clipInstances, instanceId);
    setContextMenu(null);
    if (!result.cleared) {
      setStatus("当前片段未链接");
      return;
    }
    setClipInstances(result.next);
    pipelineSnapshotRef.current = {
      ...pipelineSnapshotRef.current,
      clipInstances: result.next
    };
    setStatus(`已取消链接（${result.cleared} 个片段可独立移动/裁剪）`);
    schedulePipelineSave("取消链接已写入分镜");
  };

  const relinkSelectedClips = (instanceId?: string | null, partnerId?: string | null) => {
    const primaryId = instanceId || selectedInstanceId || contextMenu?.instanceId;
    if (!primaryId) {
      setStatus("请先选中视频或原声片段");
      return;
    }
    const partner = partnerId
      || linkPartnerInstanceId
      || findRelinkCandidate(clipInstances, primaryId)?.id;
    const result = relinkAvInstances(clipInstances, primaryId, partner || undefined);
    setContextMenu(null);
    if (result.error || !result.linkGroupId) {
      setStatus(result.error || "重新链接失败");
      return;
    }
    setClipInstances(result.next);
    pipelineSnapshotRef.current = {
      ...pipelineSnapshotRef.current,
      clipInstances: result.next
    };
    setLinkPartnerInstanceId(null);
    setStatus("已重新链接：拖动/裁剪入点将保持时间对齐");
    schedulePipelineSave("重新链接已写入分镜");
  };

  const selectedIsLinked = Boolean(
    selectedInstanceId && isLinkedClipGroup(clipInstances, selectedInstanceId)
  );
  const selectedCanRelink = Boolean(
    selectedInstanceId
    && !selectedIsLinked
    && (
      linkPartnerInstanceId
      || findRelinkCandidate(clipInstances, selectedInstanceId)
    )
  );

  const addTextAtPlayhead = () => {
    const laneId = selectedLane?.kind === "video" ? selectedLane.id : (videoLanes[0]?.id || "v1");
    const lane = videoLanes.find((item) => item.id === laneId);
    if (lane?.header.locked) {
      setStatus(`${lane.name} 已锁定，无法添加文字`);
      return;
    }
    const clip = createTextClip(
      laneId,
      playheadSec + (previewMode === "shot" ? shotTimelineBaseSec : 0),
      { text: "标题文字", fontSize: 48, color: "#ffffff", durationSec: 3 }
    );
    setTextClips((current) => [...current, clip]);
    openTextEditor(clip.id, { focus: true });
    setSelectedLaneId(laneId);
    setNleTool("selection");
    setStatus(`已在 ${laneId.toUpperCase()} @ ${formatTimecode(playheadSec)} 添加文字，可直接编辑内容`);
  };

  const cycleTransitionForShot = (shotId: string) => {
    const target = shots.find((item) => item.id === shotId);
    if (!target) return;
    const current = normalizeTransition(target.transition);
    const index = TRANSITION_OPTIONS.findIndex((item) => item.value === current);
    const next = TRANSITION_OPTIONS[(index + 1) % TRANSITION_OPTIONS.length]!;
    updateShot(shotId, { transition: next.value });
    setTransitionPickerShotId(shotId);
    setStatus(`切换特效：${next.label}`);
  };

  const patchTextClip = (id: string, patch: Partial<TimelineTextClip>) => {
    setTextClips((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const beginOverlayTextDrag = (event: ReactMouseEvent, textId: string, mode: "move" | "scale") => {
    const stage = previewStageRef.current;
    if (!stage) return;
    const clip = textClips.find((item) => item.id === textId);
    if (!clip) return;
    const lane = videoLanes.find((item) => item.id === clip.trackId);
    if (lane?.header.locked) {
      setStatus(`${lane.name} 已锁定，无法在预览中编辑文字`);
      return;
    }
    const rect = stage.getBoundingClientRect();
    overlayDragRef.current = {
      textId,
      mode,
      originClientX: event.clientX,
      originClientY: event.clientY,
      originX: clampNorm(clip.x ?? 0.5),
      originY: clampNorm(clip.y ?? 0.5),
      originScale: Math.max(0.2, Math.min(5, Number(clip.scale) || 1)),
      stageWidth: Math.max(1, rect.width),
      stageHeight: Math.max(1, rect.height)
    };
    openTextEditor(textId, { focus: false });
    event.preventDefault();
    event.stopPropagation();
  };

  const onOverlayTextDragMove = (event: ReactMouseEvent) => {
    const drag = overlayDragRef.current;
    if (!drag) return;
    if (drag.mode === "move") {
      const dx = (event.clientX - drag.originClientX) / drag.stageWidth;
      const dy = (event.clientY - drag.originClientY) / drag.stageHeight;
      patchTextClip(drag.textId, {
        x: clampNorm(drag.originX + dx),
        y: clampNorm(drag.originY + dy)
      });
      return;
    }
    const delta = Math.max(
      (event.clientX - drag.originClientX) / drag.stageWidth,
      (event.clientY - drag.originClientY) / drag.stageHeight
    );
    const nextScale = Math.max(0.2, Math.min(5, Number((drag.originScale * (1 + delta * 2)).toFixed(3))));
    patchTextClip(drag.textId, { scale: nextScale });
  };

  const endOverlayTextDrag = () => {
    if (!overlayDragRef.current) return;
    overlayDragRef.current = null;
    void savePipeline("标题位置已保存");
  };

  const openTextEditor = useCallback((textId: string, opts?: { focus?: boolean }) => {
    setSelectedTextId(textId);
    setSelectedClipKey(null);
    if (opts?.focus !== false) setTextEditorFocusToken((token) => token + 1);
    setStatus("编辑标题文字：预览可拖动 / 角点缩放；下方改内容 / 字号 / 颜色");
  }, []);

  useEffect(() => {
    if (!selectedTextId || !textEditorRef.current) return;
    if (textEditorFocusToken <= 0) return;
    const node = textEditorRef.current;
    node.focus();
    const len = node.value.length;
    try { node.setSelectionRange(0, len); } catch { /* ignore */ }
  }, [textEditorFocusToken, selectedTextId]);

  const reorderLanes = useCallback((kind: "video" | "audio", fromId: string, toId: string) => {
    if (!fromId || !toId || fromId === toId) return;
    const setter = kind === "video" ? setVideoLanes : setAudioLanes;
    setter((lanes) => {
      const from = lanes.findIndex((lane) => lane.id === fromId);
      const to = lanes.findIndex((lane) => lane.id === toId);
      if (from < 0 || to < 0 || from === to) return lanes;
      const next = [...lanes];
      const [moved] = next.splice(from, 1);
      if (!moved) return lanes;
      next.splice(to, 0, moved);
      setStatus(`已调整${kind === "video" ? "视频" : "音频"}轨顺序：${next.map((lane) => lane.name).join(" → ")}`);
      return next;
    });
  }, []);

  const beginTrackReorder = (kind: "video" | "audio", laneId: string, index: number) => {
    trackDragRef.current = { kind, laneId, fromIndex: index };
  };

  const onTrackReorderMove = (kind: "video" | "audio", overLaneId: string) => {
    const drag = trackDragRef.current;
    if (!drag || drag.kind !== kind || drag.laneId === overLaneId) return;
    reorderLanes(kind, drag.laneId, overLaneId);
    trackDragRef.current = { ...drag, laneId: drag.laneId };
  };

  const endTrackReorder = () => {
    trackDragRef.current = null;
    schedulePipelineSave("轨序已写入分镜");
  };

  const unlinkMediaBinItem = useCallback(async (
    item: MediaBinItem,
    opts?: { placeAligned?: boolean; atSec?: number; videoLaneId?: string; sourceRelativePath?: string }
  ) => {
    if (!projectId || !window.newbrain?.peelBrainMedia) {
      setStatus("当前构建未接入解链抽音");
      return false;
    }
    if (item.kind !== "video") {
      setStatus("仅视频素材可解链抽音");
      return false;
    }
    const peelRelativePath = normalizeMediaPath(opts?.sourceRelativePath || item.relativePath);
    setBusyAction(`peel:${item.id}`);
    setStatus(`正在解链抽音 · ${item.name}…`);
    try {
      const result = await window.newbrain.peelBrainMedia({
        projectId,
        relativePath: peelRelativePath,
        fileId: opts?.sourceRelativePath ? undefined : item.fileId,
        mode: "unlink"
      }) as {
        ok?: boolean;
        hasAudio?: boolean;
        durationSec?: number;
        video?: { relativePath?: string; file?: { id?: string; logicalName?: string }; kind?: string };
        audio?: { relativePath?: string; file?: { id?: string; logicalName?: string }; kind?: string };
        detail?: string;
      };
      if (!result?.ok) {
        setStatus(`解链失败：${result?.detail || "未知错误"}`);
        return false;
      }
      if (!result.hasAudio || !result.audio?.relativePath) {
        setStatus(`无音轨可提取 · ${item.name}`);
        setMediaBin((current) => current.map((row) => row.id === item.id ? { ...row, hasEmbeddedAudio: false } : row));
        return false;
      }
      const linkGroupId = `peel-${Date.now()}`;
      const videoPath = String(result.video?.relativePath || item.relativePath);
      const audioPath = String(result.audio.relativePath);
      const videoFileId = String(result.video?.file?.id || item.fileId);
      const audioFileId = String(result.audio.file?.id || "");
      let videoPreview = item.previewUrl;
      let audioPreview = "";
      try {
        if (result.video?.file?.id) {
          videoPreview = await window.newbrain.getBrainFilePreviewUrl!({ projectId, fileId: videoFileId }) || videoPreview;
        }
        if (audioFileId) {
          audioPreview = await window.newbrain.getBrainFilePreviewUrl!({ projectId, fileId: audioFileId }) || "";
        }
      } catch { /* optional */ }
      const videoItem: MediaBinItem = {
        id: `bin-${videoFileId}`,
        fileId: videoFileId,
        kind: "video",
        name: String(result.video?.file?.logicalName || `${item.name} · 画面`),
        relativePath: videoPath,
        previewUrl: videoPreview,
        hasEmbeddedAudio: false,
        linkGroupId,
        durationSec: result.durationSec
      };
      const audioItem: MediaBinItem = {
        id: `bin-${audioFileId || `audio-${Date.now()}`}`,
        fileId: audioFileId || `audio-${Date.now()}`,
        kind: "audio",
        name: String(result.audio.file?.logicalName || `${item.name} · 音轨`),
        relativePath: audioPath,
        previewUrl: audioPreview || undefined,
        linkGroupId,
        durationSec: result.durationSec
      };
      setMediaBin((current) => [
        videoItem,
        audioItem,
        ...current.filter((row) => row.id !== item.id && row.fileId !== videoItem.fileId && row.fileId !== audioItem.fileId)
      ]);
      onFilesChanged?.();
      if (opts?.placeAligned) {
        const targetId = shots[shotIndex]?.id || shot.id;
        const absoluteStart = Math.max(0, opts.atSec || 0);
        const localOffset = previewMode === "shot"
          ? Math.max(0, absoluteStart - shotTimelineBaseSec)
          : absoluteStart;
        const vLane = (opts.videoLaneId && opts.videoLaneId.startsWith("v"))
          ? opts.videoLaneId
          : (videoLanes[0]?.id || "v1");
        const soundtrackLane = ensureSoundtrackLaneId();
        const existingNarration = String(shots.find((row) => row.id === targetId)?.audio || "").trim();
        updateShot(targetId, {
          clip: videoPath,
          ready: true,
          title: item.name.replace(/\.[^.]+$/, "") || shots[shotIndex]?.title,
          // Never write peeled soundtrack into shot.audio (旁白 slot).
          ...(isPeeledEmbeddedAudioPath(existingNarration) ? { audio: "" } : {})
        });
        patchTrack(targetId, { videoTrackId: vLane, offsetSec: localOffset });
        setClipInstances((current) => {
          let next = upsertPrimaryInstance(current, {
            kind: "video",
            shotId: targetId,
            relativePath: videoPath,
            trackId: vLane,
            startSec: absoluteStart,
            durationSec: result.durationSec || 4,
            label: videoItem.name,
            linkGroupId
          });
          next = upsertPeeledSoundtrackInstance(next, {
            shotId: targetId,
            relativePath: audioPath,
            trackId: soundtrackLane,
            startSec: absoluteStart,
            durationSec: result.durationSec || 4,
            label: audioItem.name,
            linkGroupId
          });
          return next;
        });
        setStatus(`已解链并上轨 V=${vLane.toUpperCase()} / 原声=${soundtrackLane.toUpperCase()} · 时间对齐`);
      } else {
        setStatus(`已解链：画面 + 音轨已入素材箱（可分别拖到 V/A）`);
      }
      return true;
    } catch (error) {
      setStatus(`解链失败：${formatMediaError(error)}`);
      return false;
    } finally {
      setBusyAction((current) => current === `peel:${item.id}` ? null : current);
    }
  }, [projectId, onFilesChanged, shots, shotIndex, shot.id, videoLanes, audioLanes, previewMode, shotTimelineBaseSec]);

  /**
   * Premiere drop: video onto V MUST land silent picture + real soundtrack on A2 (linked).
   * Already-peeled bin items have hasEmbeddedAudio=false — still place the linkGroup / stamp sibling.
   */
  const placeImportedOnTrack = useCallback(async (item: MediaBinItem, laneId: string, atSec: number) => {
    const laneKind = laneId.startsWith("a") ? "audio" : "video";
    const localAt = Math.max(0, atSec);
    const startSec = localAt + (previewMode === "shot" ? shotTimelineBaseSec : 0);
    const targetId = shots[shotIndex]?.id || shot.id;
    const knownPaths = [
      ...mediaBin.map((row) => row.relativePath),
      ...files.map((file) => String(file.storageKey || file.relativePath || ""))
    ];

    const placeLinkedAvPair = (args: {
      videoPath: string;
      audioPath: string;
      videoLaneId: string;
      durationSec: number;
      videoLabel: string;
      audioLabel: string;
      linkGroupId: string;
      audioPreviewUrl?: string;
    }) => {
      if (isBrokenPeeledAudioMp4Path(args.audioPath)) {
        setStatus(`原声文件无效（静音 mp4 容器）：${args.audioPath}，请重新解链`);
        return false;
      }
      const soundtrackLane = ensureSoundtrackLaneId();
      const existingNarration = String(shots.find((row) => row.id === targetId)?.audio || "").trim();
      updateShot(targetId, {
        clip: args.videoPath,
        ready: true,
        title: args.videoLabel.replace(/\.[^.]+$/, "") || shots[shotIndex]?.title,
        ...(isPeeledEmbeddedAudioPath(existingNarration) || isBrokenPeeledAudioMp4Path(existingNarration)
          ? { audio: "" }
          : {})
      });
      patchTrack(targetId, { videoTrackId: args.videoLaneId, offsetSec: localAt });
      setClipInstances((current) => {
        let next = upsertPrimaryInstance(current, {
          kind: "video",
          shotId: targetId,
          relativePath: args.videoPath,
          trackId: args.videoLaneId,
          startSec,
          durationSec: args.durationSec,
          label: args.videoLabel,
          linkGroupId: args.linkGroupId
        });
        next = upsertPeeledSoundtrackInstance(next, {
          shotId: targetId,
          relativePath: args.audioPath,
          trackId: soundtrackLane,
          startSec,
          durationSec: args.durationSec,
          label: args.audioLabel,
          linkGroupId: args.linkGroupId
        });
        return next;
      });
      if (args.audioPreviewUrl) {
        setPathAudioUrls((current) => (
          current[args.audioPath] ? current : { ...current, [args.audioPath]: args.audioPreviewUrl! }
        ));
      }
      setSelectedLaneId(args.videoLaneId);
      setStatus(`已放入 V=${args.videoLaneId.toUpperCase()} + 原声=${soundtrackLane.toUpperCase()}（已链接）`);
      schedulePipelineSave("拖入解链素材已保存");
      return true;
    };

    if (item.kind === "video" && laneKind === "video") {
      const videoLaneId = laneId;
      const linkGroupId = item.linkGroupId || `peel-drop-${Date.now()}`;

      // 1) Same linkGroup audio sibling already in the media bin.
      const linkedAudio = item.linkGroupId
        ? mediaBin.find((row) => (
          row.kind === "audio"
          && row.linkGroupId === item.linkGroupId
          && isPeeledEmbeddedAudioPath(row.relativePath)
          && !isBrokenPeeledAudioMp4Path(row.relativePath)
        ))
        : undefined;
      if (linkedAudio) {
        placeLinkedAvPair({
          videoPath: item.relativePath,
          audioPath: linkedAudio.relativePath,
          videoLaneId,
          durationSec: item.durationSec || linkedAudio.durationSec || 4,
          videoLabel: item.name,
          audioLabel: linkedAudio.name,
          linkGroupId,
          audioPreviewUrl: linkedAudio.previewUrl
        });
        return;
      }

      // 2) Same-stamp sibling on disk / in bin (`*-video-N.mp4` ↔ `*-audio-N.m4a`).
      const siblingPath = pickFirstExistingMediaPath(
        peeledVideoSiblingAudioCandidates(item.relativePath),
        knownPaths
      );
      if (siblingPath) {
        const siblingBin = mediaBin.find((row) => normalizeMediaPath(row.relativePath) === siblingPath);
        placeLinkedAvPair({
          videoPath: item.relativePath,
          audioPath: siblingPath,
          videoLaneId,
          durationSec: item.durationSec || siblingBin?.durationSec || 4,
          videoLabel: item.name,
          audioLabel: siblingBin?.name || `${item.name} · 音轨`,
          linkGroupId,
          audioPreviewUrl: siblingBin?.previewUrl
        });
        return;
      }

      // 3) Composite AV still muxed — FFmpeg peel then place V+A2.
      if (item.hasEmbeddedAudio && projectId && window.newbrain?.peelBrainMedia) {
        const peeled = await unlinkMediaBinItem(item, {
          placeAligned: true,
          atSec: startSec,
          videoLaneId
        });
        if (peeled) return;
      }

      // 4) Silent picture without sibling — re-peel from original muxed source if findable.
      if (isPeeledVideoOnlyPath(item.relativePath) && projectId && window.newbrain?.peelBrainMedia) {
        const originals = peeledVideoOriginalMuxCandidates(item.relativePath);
        const knownOriginal = pickFirstExistingMediaPath(originals, knownPaths);
        const tryPaths = knownOriginal ? [knownOriginal, ...originals.filter((p) => p !== knownOriginal)] : originals;
        for (const sourcePath of tryPaths) {
          try {
            const probe = await window.newbrain.peelBrainMedia({
              projectId,
              relativePath: sourcePath,
              mode: "probe"
            }) as { ok?: boolean; hasAudio?: boolean };
            if (!probe?.hasAudio) continue;
            const peeled = await unlinkMediaBinItem(
              { ...item, relativePath: sourcePath, hasEmbeddedAudio: true },
              { placeAligned: true, atSec: startSec, videoLaneId, sourceRelativePath: sourcePath }
            );
            if (peeled) return;
          } catch {
            // try next candidate
          }
        }
      }

      // 5) Probe any unmarked video — if it still has audio, peel on drop.
      if (!isPeeledVideoOnlyPath(item.relativePath) && projectId && window.newbrain?.peelBrainMedia) {
        try {
          const probe = await window.newbrain.peelBrainMedia({
            projectId,
            relativePath: item.relativePath,
            fileId: item.fileId,
            mode: "probe"
          }) as { hasAudio?: boolean };
          if (probe?.hasAudio) {
            const peeled = await unlinkMediaBinItem(
              { ...item, hasEmbeddedAudio: true },
              { placeAligned: true, atSec: startSec, videoLaneId }
            );
            if (peeled) return;
          }
        } catch { /* fall through to video-only place */ }
      }

      updateShot(targetId, {
        clip: item.relativePath,
        ready: true,
        title: item.name.replace(/\.[^.]+$/, "") || shots[shotIndex]?.title
      });
      patchTrack(targetId, { videoTrackId: videoLaneId, offsetSec: localAt });
      setClipInstances((current) => upsertPrimaryInstance(current, {
        kind: "video",
        shotId: targetId,
        relativePath: item.relativePath,
        trackId: videoLaneId,
        startSec,
        durationSec: item.durationSec || 4,
        label: item.name
      }));
      setSelectedLaneId(videoLaneId);
      setStatus(
        isPeeledVideoOnlyPath(item.relativePath)
          ? `已放入 ${videoLaneId.toUpperCase()}（未找到原声 sibling，请重新导入含音频源片）· ${item.name}`
          : `已放入 ${videoLaneId.toUpperCase()} · ${item.name}`
      );
      return;
    }

    if (item.kind !== laneKind) {
      setStatus(`只能拖到同类型轨道（${item.kind === "video" ? "视频→V" : "音频→A"}）`);
      return;
    }

    // Peeled soundtrack: secondary A clip — never overwrite旁白 shot.audio.
    if (item.kind === "audio" && (isPeeledEmbeddedAudioPath(item.relativePath) || item.linkGroupId)) {
      if (isBrokenPeeledAudioMp4Path(item.relativePath)) {
        setStatus(`原声文件无效（静音 mp4）：${item.relativePath}`);
        return;
      }
      const soundtrackLane = laneId.startsWith("a") ? laneId : ensureSoundtrackLaneId();
      setClipInstances((current) => upsertPeeledSoundtrackInstance(current, {
        shotId: targetId,
        relativePath: item.relativePath,
        trackId: soundtrackLane,
        startSec,
        durationSec: item.durationSec || 4,
        label: item.name,
        linkGroupId: item.linkGroupId
      }));
      if (item.previewUrl) {
        setPathAudioUrls((current) => (
          current[item.relativePath] ? current : { ...current, [item.relativePath]: item.previewUrl! }
        ));
      }
      setSelectedLaneId(soundtrackLane);
      setStatus(`原声已挂到 ${soundtrackLane.toUpperCase()} · ${item.name}`);
      schedulePipelineSave("原声上轨已保存");
      return;
    }

    updateShot(targetId, { audio: item.relativePath });
    patchTrack(targetId, { audioTrackId: laneId, offsetSec: localAt });
    setClipInstances((current) => upsertPrimaryInstance(current, {
      kind: "audio",
      shotId: targetId,
      relativePath: item.relativePath,
      trackId: laneId,
      startSec,
      durationSec: item.durationSec || 4,
      label: item.name
    }));
    if (item.previewUrl) rememberShotAudio(targetId, item.previewUrl);
    else if (projectId && item.fileId && window.newbrain?.getBrainFilePreviewUrl) {
      try {
        const url = await window.newbrain.getBrainFilePreviewUrl({ projectId, fileId: item.fileId });
        if (url) rememberShotAudio(targetId, url);
      } catch { /* ignore */ }
    }
    setSelectedLaneId(laneId);
    setStatus(`旁白已挂到 ${laneId.toUpperCase()} · ${item.name}`);
  }, [
    shots,
    shotIndex,
    shot.id,
    projectId,
    rememberShotAudio,
    previewMode,
    shotTimelineBaseSec,
    videoLanes,
    audioLanes,
    mediaBin,
    files,
    unlinkMediaBinItem,
    schedulePipelineSave
  ]);

  const importMediaFiles = useCallback(async (fileList: FileList | File[]) => {
    if (!projectId) {
      setStatus("请先绑定视频工程后再导入");
      return;
    }
    if (!window.newbrain?.importBrainMedia) {
      setStatus("当前构建未接入媒体导入");
      return;
    }
    const filesToImport = Array.from(fileList || []);
    if (!filesToImport.length) return;
    setBusyAction("import");
    const added: MediaBinItem[] = [];
    try {
      for (const file of filesToImport) {
        const name = file.name || `media-${Date.now()}`;
        const mime = file.type || "";
        const isVideo = /^video\//i.test(mime) || /\.(mp4|webm|mov|m4v|mkv)$/i.test(name);
        const isAudio = /^audio\//i.test(mime) || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(name);
        if (!isVideo && !isAudio) {
          setStatus(`跳过不支持的文件：${name}`);
          continue;
        }
        const pathFromOs = typeof window.newbrain.getPathForFile === "function"
          ? String(window.newbrain.getPathForFile(file) || "").trim()
          : "";
        let imported: { relativePath?: string; file?: { id?: string; logicalName?: string }; kind?: string } | null = null;
        if (pathFromOs) {
          imported = await window.newbrain.importBrainMedia({
            projectId,
            sourcePath: pathFromOs,
            fileName: name,
            mimeType: mime || undefined,
            folder: "imports"
          });
        } else {
          const buffer = await file.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = "";
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
          }
          imported = await window.newbrain.importBrainMedia({
            projectId,
            fileName: name,
            mimeType: mime || (isVideo ? "video/mp4" : "audio/mpeg"),
            bytesBase64: btoa(binary),
            folder: "imports"
          });
        }
        const relativePath = String(imported?.relativePath || "").trim();
        const fileId = String(imported?.file?.id || "").trim();
        if (!relativePath || !fileId) continue;
        let previewUrl = "";
        try {
          previewUrl = await window.newbrain.getBrainFilePreviewUrl!({ projectId, fileId });
        } catch { /* optional */ }
        let hasEmbeddedAudio = false;
        let durationSec: number | undefined;
        if (isVideo && window.newbrain.peelBrainMedia) {
          try {
            const probe = await window.newbrain.peelBrainMedia({
              projectId,
              relativePath,
              fileId,
              mode: "probe"
            }) as { hasAudio?: boolean; durationSec?: number };
            hasEmbeddedAudio = probe?.hasAudio === true;
            if (Number.isFinite(probe?.durationSec)) durationSec = Number(probe.durationSec);
          } catch { /* optional */ }
        }
        added.push({
          id: `bin-${fileId}`,
          fileId,
          kind: isVideo ? "video" : "audio",
          name: String(imported?.file?.logicalName || name),
          relativePath,
          previewUrl: previewUrl || undefined,
          hasEmbeddedAudio,
          durationSec
        });
        // Auto-peel muxed imports into silent picture + audio bin items (Premiere unlink).
        if (isVideo && hasEmbeddedAudio && window.newbrain.peelBrainMedia) {
          try {
            const peeled = await window.newbrain.peelBrainMedia({
              projectId,
              relativePath,
              fileId,
              mode: "unlink"
            }) as {
              ok?: boolean;
              hasAudio?: boolean;
              durationSec?: number;
              video?: { relativePath?: string; file?: { id?: string; logicalName?: string } };
              audio?: { relativePath?: string; file?: { id?: string; logicalName?: string } };
            };
            if (peeled?.ok && peeled.hasAudio && peeled.audio?.relativePath && peeled.video?.relativePath) {
              const linkGroupId = `peel-import-${Date.now()}`;
              const vId = String(peeled.video.file?.id || "");
              const aId = String(peeled.audio.file?.id || "");
              let vPreview = previewUrl;
              let aPreview = "";
              try {
                if (vId && window.newbrain.getBrainFilePreviewUrl) {
                  vPreview = await window.newbrain.getBrainFilePreviewUrl({ projectId, fileId: vId }) || vPreview;
                }
                if (aId && window.newbrain.getBrainFilePreviewUrl) {
                  aPreview = await window.newbrain.getBrainFilePreviewUrl({ projectId, fileId: aId }) || "";
                }
              } catch { /* optional */ }
              added.pop();
              added.push({
                id: `bin-${vId || peeled.video.relativePath}`,
                fileId: vId || peeled.video.relativePath,
                kind: "video",
                name: String(peeled.video.file?.logicalName || `${name} · 画面`),
                relativePath: String(peeled.video.relativePath),
                previewUrl: vPreview || undefined,
                hasEmbeddedAudio: false,
                linkGroupId,
                durationSec: peeled.durationSec ?? durationSec
              });
              added.push({
                id: `bin-${aId || peeled.audio.relativePath}`,
                fileId: aId || peeled.audio.relativePath,
                kind: "audio",
                name: String(peeled.audio.file?.logicalName || `${name} · 音轨`),
                relativePath: String(peeled.audio.relativePath),
                previewUrl: aPreview || undefined,
                linkGroupId,
                durationSec: peeled.durationSec ?? durationSec
              });
            }
          } catch {
            // Keep composite AV item; user can click 解链 manually.
          }
        }
      }
      if (added.length) {
        setMediaBin((current) => [...added, ...current.filter((item) => !added.some((row) => row.fileId === item.fileId))]);
        onFilesChanged?.();
        const peeledPairs = Math.floor(added.filter((item) => item.linkGroupId).length / 2);
        const peelHint = peeledPairs
          ? `；已自动解链 ${peeledPairs} 组画面/音轨`
          : (added.some((item) => item.hasEmbeddedAudio) ? "；含音频的视频可点「解链」拆到 V/A" : "");
        setStatus(`已导入 ${added.length} 个素材到 media/imports/，可拖入同类型轨道${peelHint}`);
      }
    } catch (error) {
      setStatus(`导入失败：${formatMediaError(error)}`);
    } finally {
      setBusyAction((current) => current === "import" ? null : current);
    }
  }, [projectId, onFilesChanged]);

  const activePreviewUrl = previewMode === "sequence"
    ? (sequenceUrls[sequenceIndex] || exportPreviewUrl || "")
    : (shotPreviewUrl || "");
  const sequenceHasAnyClipUrl = sequenceUrls.some((url) => Boolean(String(url || "").trim()));

  /** Dual-layer dissolve/blur/wipe for 全片序列 (export uses FFmpeg xfade). */
  const sequenceTransitionLayer = useMemo((): WorkspaceVideoTransitionLayer | null => {
    if (previewMode !== "sequence" || usingExportPreview) return null;
    const idx = sequenceIndex;
    if (idx < 0 || idx >= shots.length - 1) return null;
    const kind = normalizeTransition(shots[idx]?.transition);
    const durationSec = transitionGapSec(kind);
    if (kind === "cut" || durationSec <= 0) return null;
    const nextUrl = String(sequenceUrls[idx + 1] || "").trim();
    if (!nextUrl) return null;
    return { url: nextUrl, kind, durationSec };
  }, [previewMode, usingExportPreview, sequenceIndex, shots, sequenceUrls]);

  // When export fills the monitor, map its clock onto sequence clips for A-track narration.
  const exportNarrationHit = usingExportPreview
    ? findSequenceClipAt(previewTime, timelineClips)
    : null;

  useEffect(() => {
    if (previewMode === "sequence" && !usingExportPreview) return;
    setPreviewTime(0);
    setMediaDuration(0);
  }, [previewMode, activePreviewUrl, usingExportPreview, shot.id, shotAudioUrls[shot.id]]);

  useEffect(() => {
    if (pane === "storyboard") setPreviewMode("shot");
  }, [pane]);

  useEffect(() => {
    if (previewMode !== "sequence" && nleTool === "transition") setNleTool("selection");
  }, [previewMode, nleTool]);

  // Keep sequence index aligned with continuous clock when clips layout changes.
  useEffect(() => {
    if (previewMode !== "sequence" || usingExportPreview) return;
    const hit = findSequenceClipAt(timelineClockRef.current, timelineClips);
    if (hit && hit.index !== sequenceIndexRef.current && !hit.inGap) {
      sequenceIndexRef.current = hit.index;
      setSequenceIndex(hit.index);
    }
  }, [previewMode, usingExportPreview, timelineClips, findSequenceClipAt]);

  useEffect(() => {
    if (!usingExportPreview || !exportNarrationHit || exportNarrationHit.inGap) return;
    if (exportNarrationHit.index !== sequenceIndexRef.current) {
      sequenceIndexRef.current = exportNarrationHit.index;
      setSequenceIndex(exportNarrationHit.index);
      setShotIndex(exportNarrationHit.index);
    }
  }, [usingExportPreview, exportNarrationHit?.index, exportNarrationHit?.inGap]);

  const narrationShotIdForClock = usingExportPreview
    ? (exportNarrationHit && !exportNarrationHit.inGap ? exportNarrationHit.clip.shotId : "")
    : (previewMode === "shot" ? shot.id : (shots[sequenceIndex]?.id || shot.id));

  const narrationAudioTrackId = (() => {
    const edit = trackEdits[narrationShotIdForClock || ""] ?? trackEdit;
    return String(edit.audioTrackId || audioLanes[0]?.id || "a1");
  })();
  const narrationAudioLane = audioLanes.find((lane) => lane.id === narrationAudioTrackId) ?? audioLanes[0];
  const clipMuted = previewMode === "shot"
    ? trackEdit.muted
    : (previewMode === "sequence"
      ? (trackEdits[narrationShotIdForClock || ""] ?? defaultTrackEdit()).muted
      : false);

  // Premiere: any Solo silences non-solo tracks; Solo overrides Mute on the soloed track.
  const anyAudioSolo = audioLanes.some((lane) => lane.header.solo);
  const narrationLaneMuted = Boolean(narrationAudioLane?.header.muted || clipMuted);
  const narrationMuted = anyAudioSolo
    ? !(narrationAudioLane?.header.solo)
    : narrationLaneMuted;
  const previewMuted = narrationMuted;
  // Hide picture only when every video lane is off, or playhead video sits only on output-off lanes.
  const anyVideoLaneOutput = videoLanes.some((lane) => lane.header.output);
  const videoClipsAtPlayhead = timelineClips.filter((clip) => (
    clip.kind !== "audio"
    && playheadSec >= clip.start - 0.001
    && playheadSec < clip.start + clip.duration
  ));
  const visibleVideoAtPlayhead = videoClipsAtPlayhead.some((clip) => {
    const lane = videoLanes.find((item) => item.id === clip.videoTrackId);
    return lane ? lane.header.output : true;
  });
  const videoHidden = videoLanes.length > 0 && (
    !anyVideoLaneOutput
    || (videoClipsAtPlayhead.length > 0 && !visibleVideoAtPlayhead)
  );
  const activeNarrationShotId = narrationShotIdForClock;
  const activeNarrationUrl = activeNarrationShotId ? (shotAudioUrls[activeNarrationShotId] || "") : "";
  const activeNarrationShot = activeNarrationShotId
    ? shots.find((item) => item.id === activeNarrationShotId)
    : undefined;
  const narrationMissingFile = Boolean(
    activeNarrationShot
    && String(activeNarrationShot.line || "").trim()
    && !activeNarrationUrl
  );
  const narrationOffsetSec = usingExportPreview && exportNarrationHit && !exportNarrationHit.inGap
    ? exportNarrationHit.clip.start
    : 0;

  const resolveAudioClipPreviewUrl = (clip: { shotId: string; relativePath?: string; audioTrackId: string }) => {
    const path = String(clip.relativePath || "").replaceAll("\\", "/").trim();
    if (path && pathAudioUrls[path]) return pathAudioUrls[path]!;
    const binUrl = mediaBin.find((row) => String(row.relativePath || "").replaceAll("\\", "/") === path)?.previewUrl;
    if (binUrl) return binUrl;
    // Primary narration fallback: shot-scoped blob cache
    if (clip.audioTrackId === "a1" || audioLanes[0]?.id === clip.audioTrackId) {
      return shotAudioUrls[clip.shotId] || "";
    }
    return "";
  };

  const previewMixTracks: WorkspaceMixAudioTrack[] = buildPreviewMixTracks({
    clips: timelineClips
      .filter((clip) => clip.kind === "audio")
      .map((clip) => ({
        id: clip.instanceId || (clip.shotId + ":" + clip.audioTrackId),
        shotId: clip.shotId,
        audioTrackId: clip.audioTrackId,
        start: clip.start,
        duration: clip.duration,
        muted: clip.muted === true,
        relativePath: clip.relativePath,
        volume: clip.volume,
        volumeKeyframes: clip.volumeKeyframes
      })),
    lanes: audioLanes.map((lane) => ({
      id: lane.id,
      muted: lane.header.muted,
      solo: lane.header.solo
    })),
    resolveUrl: (clip) => resolveAudioClipPreviewUrl(clip),
    playheadSec,
    sampleVolume: sampleVolumeEnvelope,
    onlyUnderPlayhead: true
  });

  // Legacy single-track gain kept for status / fallback when mix empty.
  const narrationGain = (() => {
    if (previewMixTracks.length) return previewMixTracks[0]!.gain;
    if (narrationMuted) return 0;
    return 1;
  })();
  // Narration-only shots must still mount the monitor (black letterbox + A-track),
  // otherwise "旁白已完成" looks like a broken empty preview.
  const showPreviewMonitor = Boolean(activePreviewUrl || activeNarrationUrl || previewMixTracks.length);
  const narrationOnlyPreview = Boolean(activeNarrationUrl || previewMixTracks.length) && !activePreviewUrl;

  const shotTabs = (
    <div className="brain-video-pipe__shot-tabs" role="tablist" aria-label="分镜头" data-testid="brain-video-shot-tabs">
      {shots.map((item, index) => (
        <button
          key={item.id}
          type="button"
          className={`brain-video-pipe__shot-tab${index === shotIndex ? " brain-video-pipe__shot-tab--active" : ""}`}
          aria-selected={index === shotIndex}
          onClick={(event) => {
            setShotIndex(index);
            setPreviewMode("shot");
            event.currentTarget.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
          }}
        >
          <span className="brain-video-pipe__shot-tab-title">镜 {index + 1}</span>
          <small>{item.title || "未命名"}{item.ready ? " · 就绪" : ""}</small>
        </button>
      ))}
    </div>
  );

  const adapterPanel = (
    <div className="brain-video-pipe__adapter" data-testid="brain-video-canvas-adapter" aria-label="画幅适配器">
      <div className="brain-video-pipe__adapter-head">
        <strong>画幅</strong>
        <span className="brain-video-pipe__adapter-badge">{brainVideoCanvasSize(canvas)} · {canvas.fps}fps</span>
      </div>
      <div className="brain-video-pipe__adapter-presets" role="group" aria-label="比例预设">
        {CANVAS_PRESETS.filter((item) => item.id !== "custom").map((item) => (
          <button
            key={item.id}
            type="button"
            className={`brain-video-pipe__adapter-preset${canvas.aspect === item.id ? " brain-video-pipe__adapter-preset--active" : ""}`}
            onClick={() => applyCanvasPreset(item.id)}
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          className={`brain-video-pipe__adapter-preset${canvas.aspect === "custom" ? " brain-video-pipe__adapter-preset--active" : ""}`}
          onClick={() => applyCanvasPreset("custom")}
        >
          自定义
        </button>
      </div>
      <div className="brain-video-pipe__adapter-fields">
        <label>
          <span>宽</span>
          <input
            type="number"
            min={16}
            value={canvas.width}
            onChange={(event) => setCanvas((current) => ({ ...current, aspect: "custom", width: Number(event.target.value) || current.width }))}
          />
        </label>
        <label>
          <span>高</span>
          <input
            type="number"
            min={16}
            value={canvas.height}
            onChange={(event) => setCanvas((current) => ({ ...current, aspect: "custom", height: Number(event.target.value) || current.height }))}
          />
        </label>
        <label>
          <span>fps</span>
          <input
            type="number"
            min={1}
            value={canvas.fps}
            onChange={(event) => setCanvas((current) => ({ ...current, fps: Number(event.target.value) || current.fps }))}
          />
        </label>
      </div>
    </div>
  );

  const previewPanel = (
    <div className="brain-video-pipe__player" data-testid="brain-video-pipeline-preview">
      <div className="brain-video-pipe__player-toolbar">
        <strong>预览窗口</strong>
        <div>
          <button type="button" className={previewMode === "shot" ? "brain-video-pipe__track-btn--active" : undefined} onClick={() => setPreviewMode("shot")}>本镜</button>
          <button
            type="button"
            className={previewMode === "sequence" ? "brain-video-pipe__track-btn--active" : undefined}
            onClick={() => {
              setPreviewMode("sequence");
              sequenceIndexRef.current = 0;
              setSequenceIndex(0);
              setShotIndex(0);
              timelineClockRef.current = 0;
              setTimelineClockSec(0);
              sequencePlayingRef.current = true;
              setSequencePlaying(true);
              setSeekTo(0);
              setSeekToken((token) => token + 1);
              setPlayToken((token) => token + 1);
              setStatus(`全片序列播放 · 总长 ${formatTimecode(Math.max(timelineDuration, 1))}`);
            }}
          >
            全片序列
          </button>
        </div>
      </div>
      <div
        className="brain-video-pipe__player-stage"
        style={{ aspectRatio: String(aspectRatio) }}
        ref={previewStageRef}
        data-testid="brain-video-preview-stage"
        onMouseMove={onOverlayTextDragMove}
        onMouseUp={endOverlayTextDrag}
        onMouseLeave={endOverlayTextDrag}
      >
        {showPreviewMonitor ? (
          <WorkspaceVideoViewer
            previewUrl={activePreviewUrl}
            aspectRatio={aspectRatio}
            autoPlay={previewMode === "sequence" ? sequencePlaying : false}
            playToken={playToken}
            resetOnSrcChange={previewMode === "sequence" && !usingExportPreview}
            muted={previewMuted}
            narrationUrl={previewMixTracks.length ? "" : activeNarrationUrl}
            narrationMuted={previewMixTracks.length ? false : narrationMuted}
            narrationGain={narrationGain}
            narrationOffsetSec={narrationOffsetSec}
            mixTracks={previewMixTracks}
            videoHidden={videoHidden}
            seekTo={seekTo}
            seekToken={seekToken}
            transitionLayer={sequenceTransitionLayer}
            onTransitionConsumed={(consumedSec) => {
              transitionConsumedRef.current = Math.max(0, Number(consumedSec) || 0);
            }}
            onTimeUpdate={(currentTime, duration) => {
              const clip = sequenceClipForShotIndex(timelineClipsRef.current, sequenceIndexRef.current);
              if (previewMode === "sequence" && !usingExportPreview && clip && currentTime >= clip.duration) {
                onSequenceClipEnded();
                return;
              }
              handlePreviewTimeUpdate(currentTime, duration);
            }}
            onDurationChange={handlePreviewDuration}
            onEnded={previewMode === "sequence" && !usingExportPreview ? onSequenceClipEnded : undefined}
            onNarrationError={(detail) => setStatus(`旁白播放失败：${detail}`)}
          />
        ) : (
          <div className="brain-video-pipe__player-empty">
            <strong>
              {previewMode === "shot"
                ? "本镜尚无视频 clip / 旁白"
                : sequenceHasAnyClipUrl
                  ? "当前镜无视频与旁白"
                  : "序列尚无就绪镜头 / 成片"}
            </strong>
            <small>
              {previewMode === "shot"
                ? `生成本镜视频或旁白后将在此按 ${canvas.aspect} letterbox 播放`
                : sequenceHasAnyClipUrl
                  ? "可点时间线其它镜，或为本镜生成视频 / 旁白"
                  : `生成镜头或渲染后将在此按 ${canvas.aspect} letterbox 播放`}
            </small>
          </div>
        )}
        <PreviewTextOverlayLayer
          items={previewTextOverlays}
          canvasWidth={canvas.width}
          canvasHeight={canvas.height}
          onSelect={(id) => openTextEditor(id, { focus: false })}
          onChange={(id, text) => patchTextClip(id, { text })}
          onCommit={() => { void savePipeline("标题文字已写入分镜"); }}
          onMovePointerDown={(event, id) => beginOverlayTextDrag(event, id, "move")}
          onScalePointerDown={(event, id) => beginOverlayTextDrag(event, id, "scale")}
        />
      </div>
      <small>
        {previewMode === "shot"
          ? `镜 ${shotIndex + 1} · ${shot.clip || (narrationOnlyPreview ? "仅旁白" : "无 clip")} · ${brainVideoCanvasSize(canvas)} · ${formatTimecode(playheadSec)} / ${formatTimecode(timelineDuration)}`
          : usingExportPreview
            ? `成片 exports 预览 · A轨旁白叠加 · ${brainVideoCanvasSize(canvas)} · ${formatTimecode(playheadSec)} / ${formatTimecode(timelineDuration)}`
            : narrationOnlyPreview
              ? `全片 · 镜 ${Math.min(sequenceIndex + 1, Math.max(shots.length, 1))} 仅旁白 · ${formatTimecode(playheadSec)} / ${formatTimecode(timelineDuration)} · ${sequencePlaying ? "播放中" : "暂停"}`
              : `全片时钟 ${formatTimecode(playheadSec)} / ${formatTimecode(timelineDuration)} · 镜 ${Math.min(sequenceIndex + 1, Math.max(shots.length, 1))}/${shots.length} · ${sequencePlaying ? "播放中" : "暂停"} · ${brainVideoCanvasSize(canvas)}`}
        {narrationMuted
          ? (isPeeledEmbeddedAudioPath(activeNarrationShot?.audio || "") ? " · 音轨已静音" : " · 旁白已静音")
          : activeNarrationUrl
            ? (isPeeledEmbeddedAudioPath(activeNarrationShot?.audio || "") ? " · 音轨可播放" : " · 旁白可播放")
            : narrationMissingFile ? " · 无旁白文件" : " · 无旁白"}
      </small>
    </div>
  );

  const timelineWidthPx = Math.max(420, Math.ceil(timelineDuration * TIMELINE_PX_PER_SEC));
  /** Full grid = sticky headers + clips/ruler so X-scroll matches TIMELINE_PX_PER_SEC. */
  const nleGridWidthPx = NLE_HEADER_WIDTH_PX + timelineWidthPx;
  const playheadPct = timelineDuration > 0 ? Math.min(100, Math.max(0, (playheadSec / timelineDuration) * 100)) : 0;
  const videoEditDisabled = videoTrackHeader.locked;
  const audioEditDisabled = audioTrackHeader.locked;

  const renderClipSegments = (clip: TimelineClipBlock, kind: "video" | "audio") => {
    const cuts = ((kind === "video" ? razorCuts : audioRazorCuts)[clip.shotId] || [])
      .filter((cut) => cut > 0.05 && cut < clip.duration - 0.05);
    const edges = [0, ...cuts, clip.duration];
    const segments: Array<{ key: string; start: number; duration: number; label: string }> = [];
    for (let i = 0; i < edges.length - 1; i += 1) {
      const segIn = edges[i]!;
      const segOut = edges[i + 1]!;
      segments.push({
        key: `${kind}-${clip.shotId}-seg-${i}`,
        start: clip.start + segIn,
        duration: Math.max(0.05, segOut - segIn),
        label: i === 0 ? clip.label : `${clip.label} ·${i + 1}`
      });
    }
    return segments;
  };

  const laneTemplate = `28px ${videoLanes.map(() => "52px").join(" ")} ${audioLanes.map(() => "52px").join(" ")}`;

  const nleTimeline = (
    <div className="brain-video-nle" data-testid="brain-video-nle-timeline" aria-label="Premiere 风格时间线">
      <div className="brain-video-nle__toolbar">
        <strong>{previewMode === "shot" ? "本镜时间线" : "全片序列时间线"}</strong>
        <span>{formatTimecode(playheadSec)} / {formatTimecode(timelineDuration)} · {NLE_TOOLS.find((t) => t.id === nleTool)?.label}</span>
        <div className="brain-video-nle__link-actions">
          <button
            type="button"
            title="取消链接：V 与原声可独立移动/裁剪"
            disabled={!selectedIsLinked}
            onClick={() => selectedInstanceId && breakClipLink(selectedInstanceId)}
          >
            取消链接
          </button>
          <button
            type="button"
            title="重新链接：优先配对本镜原声；或 Shift+点选 V+A 后链接（含旁白）"
            disabled={!selectedCanRelink}
            onClick={() => relinkSelectedClips()}
          >
            重新链接
          </button>
        </div>
        <div className="brain-video-nle__add-tracks">
          <button
            type="button"
            title="导入视频/音频到素材箱"
            disabled={!projectId || busyAction === "import"}
            onClick={() => importInputRef.current?.click()}
          >
            {busyAction === "import" ? "导入中…" : "导入"}
          </button>
          <button type="button" title="添加视频轨" onClick={addVideoLane}>+V</button>
          <button type="button" title="添加音频轨" onClick={addAudioLane}>+A</button>
        </div>
        <input
          ref={importInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v,audio/mpeg,audio/wav,audio/mp4,audio/aac,.mp3,.wav,.m4a,.aac"
          multiple
          hidden
          onChange={(event) => {
            const list = event.target.files;
            if (list?.length) void importMediaFiles(list);
            event.target.value = "";
          }}
        />
      </div>
      {mediaBin.length ? (
        <div className="brain-video-nle__media-bin" data-testid="brain-video-media-bin">
          <strong>素材箱</strong>
          <div className="brain-video-nle__media-bin-list">
            {mediaBin.map((item) => (
              <div key={item.id} className={`brain-video-nle__media-bin-item brain-video-nle__media-bin-item--${item.kind}`}>
                <button
                  type="button"
                  draggable
                  title={`拖到${item.kind === "video" ? "V" : "A"}轨 · ${item.relativePath}${item.hasEmbeddedAudio ? " · 含音频可解链" : ""}`}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("application/x-brain-media-bin", item.id);
                    event.dataTransfer.effectAllowed = "copy";
                  }}
                  onDoubleClick={() => {
                    const laneId = item.kind === "video"
                      ? (selectedLane?.kind === "video" ? selectedLane.id : (videoLanes[0]?.id || "v1"))
                      : (selectedLane?.kind === "audio" ? selectedLane.id : (audioLanes[0]?.id || "a1"));
                    void placeImportedOnTrack(item, laneId, playheadSec);
                  }}
                >
                  <span>{item.kind === "video" ? (item.hasEmbeddedAudio ? "AV" : "V") : "A"}</span>
                  <em>{item.name}</em>
                </button>
                {item.hasEmbeddedAudio ? (
                  <button
                    type="button"
                    className="brain-video-nle__media-bin-peel"
                    title="解链：拆成无声画面 + 独立音轨"
                    disabled={busyAction === `peel:${item.id}`}
                    onClick={() => void unlinkMediaBinItem(item)}
                  >
                    {busyAction === `peel:${item.id}` ? "…" : "解链"}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="brain-video-nle__body">
        <div className="brain-video-nle__tools" role="toolbar" aria-label="剪辑工具">
          {NLE_TOOLS.filter((tool) => !tool.sequenceOnly || previewMode === "sequence").map((tool) => (
            <button
              key={tool.id}
              type="button"
              title={tool.label}
              aria-label={tool.label}
              aria-pressed={nleTool === tool.id}
              className={`brain-video-nle__tool${nleTool === tool.id ? " brain-video-nle__tool--active" : ""}`}
              onClick={() => {
                if (tool.id === "text") {
                  addTextAtPlayhead();
                  return;
                }
                chooseNleTool(tool.id, tool.label);
              }}
            >
              <span aria-hidden>{tool.glyph}</span>
            </button>
          ))}
        </div>
        <div
          className={`brain-video-nle__scroll${nleTool === "hand" ? " brain-video-nle__scroll--hand" : ""}${nleTool === "razor" ? " brain-video-nle__scroll--razor" : ""}`}
          ref={timelineScrollRef}
          onMouseDown={(event) => {
            if (nleTool !== "hand") return;
            const scroller = timelineScrollRef.current;
            if (!scroller) return;
            handDragRef.current = { startX: event.clientX, scrollLeft: scroller.scrollLeft };
            event.preventDefault();
          }}
          onMouseMove={(event) => {
            onClipDragMove(event);
            if (nleTool !== "hand" || !handDragRef.current) return;
            const scroller = timelineScrollRef.current;
            if (!scroller) return;
            scroller.scrollLeft = handDragRef.current.scrollLeft - (event.clientX - handDragRef.current.startX);
          }}
          onMouseUp={() => { handDragRef.current = null; endClipDrag(); }}
          onMouseLeave={() => { handDragRef.current = null; endClipDrag(); }}
        >
          <div
            className="brain-video-nle__grid"
            style={{
              width: nleGridWidthPx,
              gridTemplateColumns: `${NLE_HEADER_WIDTH_PX}px ${timelineWidthPx}px`
            }}
          >
            <div className="brain-video-nle__headers" style={{ gridTemplateRows: laneTemplate }}>
              <div className="brain-video-nle__corner" />
              {videoLanes.map((lane, laneIndex) => (
                <div
                  key={lane.id}
                  className={`brain-video-nle__header-row${lane.header.locked ? " brain-video-nle__header-row--locked" : ""}${lane.header.output ? "" : " brain-video-nle__header-row--off"}${selectedLaneId === lane.id ? " brain-video-nle__header-row--selected" : ""}`}
                  draggable={!lane.header.locked}
                  title="上下拖动可调整同类型轨道顺序（上层覆盖下层）"
                  onDragStart={() => beginTrackReorder("video", lane.id, laneIndex)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    onTrackReorderMove("video", lane.id);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    endTrackReorder();
                  }}
                  onDragEnd={() => endTrackReorder()}
                  onClick={() => setSelectedLaneId(lane.id)}
                >
                  <b>{lane.name}</b>
                  <div className="brain-video-nle__header-toggles">
                    <button
                      type="button"
                      title={lane.header.locked ? "解锁轨道" : "锁定轨道"}
                      aria-pressed={lane.header.locked}
                      className={lane.header.locked ? "brain-video-nle__toggle--on" : undefined}
                      onClick={(event) => {
                        event.stopPropagation();
                        patchLaneHeader(lane.id, "video", { locked: !lane.header.locked });
                      }}
                    >
                      {lane.header.locked ? "🔒" : "🔓"}
                    </button>
                    <button
                      type="button"
                      title="切换轨道输出 (Eye)"
                      aria-pressed={lane.header.output}
                      className={lane.header.output ? "brain-video-nle__toggle--on" : undefined}
                      onClick={(event) => {
                        event.stopPropagation();
                        const next = !lane.header.output;
                        patchLaneHeader(lane.id, "video", { output: next });
                        setStatus(next ? `${lane.name} 输出已开启` : `${lane.name} 输出已关闭`);
                      }}
                    >
                      {lane.header.output ? "👁" : "🚫"}
                    </button>
                  </div>
                  <div className="brain-video-nle__header-actions">
                    <button
                      type="button"
                      className={trackEdit.trimOpen && lane.id === videoLanes[0]?.id ? "brain-video-pipe__track-btn--active" : undefined}
                      disabled={lane.header.locked}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleTrimUi(shot.id);
                      }}
                    >
                      裁剪
                    </button>
                    <button
                      type="button"
                      disabled={lane.header.locked || busyAction === `video:${shot.id}` || !projectId}
                      onClick={(event) => {
                        event.stopPropagation();
                        void regenerateVideoFromPrompt(shot.id, lane.prompt || shot.prompt);
                      }}
                    >
                      {busyAction === `video:${shot.id}` ? "…" : "重新生成"}
                    </button>
                  </div>
                </div>
              ))}
              {audioLanes.map((lane, laneIndex) => {
                const isPrimaryNarrationLane = isPrimaryAudioLane(lane.id, laneIndex);
                const laneMuteOn = resolveLaneMuteUi({
                  laneMuted: lane.header.muted,
                  isPrimary: isPrimaryNarrationLane,
                  trackEditMuted: trackEdit.muted
                });
                return (
                <div
                  key={lane.id}
                  className={`brain-video-nle__header-row brain-video-nle__header-row--audio${lane.header.locked ? " brain-video-nle__header-row--locked" : ""}${laneMuteOn && !lane.header.solo ? " brain-video-nle__header-row--muted" : ""}${selectedLaneId === lane.id ? " brain-video-nle__header-row--selected" : ""}`}
                  draggable={!lane.header.locked}
                  title="上下拖动可调整同类型轨道顺序"
                  onDragStart={() => beginTrackReorder("audio", lane.id, laneIndex)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    onTrackReorderMove("audio", lane.id);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    endTrackReorder();
                  }}
                  onDragEnd={() => endTrackReorder()}
                  onClick={() => setSelectedLaneId(lane.id)}
                >
                  <b>{lane.name}</b>
                  <div className="brain-video-nle__header-toggles">
                    <button
                      type="button"
                      title={lane.header.locked ? "解锁轨道" : "锁定轨道"}
                      aria-pressed={lane.header.locked}
                      className={lane.header.locked ? "brain-video-nle__toggle--on" : undefined}
                      onClick={(event) => {
                        event.stopPropagation();
                        patchLaneHeader(lane.id, "audio", { locked: !lane.header.locked });
                      }}
                    >
                      {lane.header.locked ? "🔒" : "🔓"}
                    </button>
                    <button
                      type="button"
                      title="Mute (M)"
                      aria-pressed={laneMuteOn}
                      disabled={lane.header.locked}
                      className={laneMuteOn ? "brain-video-nle__toggle--on brain-video-nle__toggle--mute-on" : undefined}
                      onClick={(event) => {
                        event.stopPropagation();
                        setLaneMute(lane.id, shot.id, !laneMuteOn);
                      }}
                    >
                      M
                    </button>
                    <button
                      type="button"
                      title="Solo (S)"
                      aria-pressed={lane.header.solo}
                      disabled={lane.header.locked}
                      className={lane.header.solo ? "brain-video-nle__toggle--solo" : undefined}
                      onClick={(event) => {
                        event.stopPropagation();
                        const next = !lane.header.solo;
                        patchLaneHeader(lane.id, "audio", { solo: next });
                        setStatus(next ? `${lane.name} 已 Solo（覆盖 Mute）` : `${lane.name} 已取消 Solo`);
                      }}
                    >
                      S
                    </button>
                  </div>
                  <div className="brain-video-nle__header-actions">
                    <button
                      type="button"
                      disabled={lane.header.locked || busyAction === `tts:${shot.id}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void regenerateNarrationFromPrompt(shot.id, lane.prompt || shot.line);
                      }}
                    >
                      {busyAction === `tts:${shot.id}` ? "…" : "重新生成"}
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
            <div
              className="brain-video-nle__lanes"
              ref={timelineLaneRef}
              style={{ gridTemplateRows: laneTemplate }}
              onClick={onTimelinePointer}
              role="slider"
              aria-valuemin={0}
              aria-valuemax={timelineDuration}
              aria-valuenow={playheadSec}
              tabIndex={0}
            >
              <div className="brain-video-nle__ruler">
                {rulerTicks.map((tick) => (
                  <span key={tick} className="brain-video-nle__tick" style={{ left: `${(tick / Math.max(timelineDuration, 0.01)) * 100}%` }}>
                    {formatTimecode(tick)}
                  </span>
                ))}
              </div>
              {videoLanes.map((lane) => {
                const laneClips = timelineClips.filter((clip) => clip.videoTrackId === lane.id && clip.kind !== "audio");
                const laneTexts = visibleTextClips.filter((clip) => clip.trackId === lane.id);
                return (
                  <div
                    key={`lane-${lane.id}`}
                    data-track-id={lane.id}
                    data-track-kind="video"
                    className={`brain-video-nle__lane brain-video-nle__lane--video${lane.header.output ? "" : " brain-video-nle__lane--dim"}${dropTargetLaneId === lane.id ? " brain-video-nle__lane--drop" : ""}`}
                    onDragOver={(event) => {
                      if (!event.dataTransfer.types.includes("application/x-brain-media-bin")) return;
                      event.preventDefault();
                      setDropTargetLaneId(lane.id);
                    }}
                    onDragLeave={() => setDropTargetLaneId((current) => current === lane.id ? null : current)}
                    onDrop={(event) => {
                      const binId = event.dataTransfer.getData("application/x-brain-media-bin");
                      if (!binId) return;
                      event.preventDefault();
                      event.stopPropagation();
                      const item = mediaBin.find((row) => row.id === binId);
                      setDropTargetLaneId(null);
                      if (item) void placeImportedOnTrack(item, lane.id, clientXToTimelineSec(event.clientX));
                    }}
                  >
                    {laneClips.flatMap((clip) => {
                      const segments = renderClipSegments(clip, "video");
                      return segments.map((seg, segIndex) => (
                      <div
                        key={seg.key}
                        className={`brain-video-nle__clip brain-video-nle__clip--video${clip.ready ? "" : " brain-video-nle__clip--empty"}${selectedClipKey === seg.key || selectedInstanceId === clip.instanceId ? " brain-video-nle__clip--selected" : ""}${linkPartnerInstanceId && clip.instanceId === linkPartnerInstanceId ? " brain-video-nle__clip--link-partner" : ""}${clip.linkGroupId ? " brain-video-nle__clip--linked" : ""}${previewMode === "sequence" && clip.index === sequenceIndex ? " brain-video-nle__clip--active" : ""}`}
                        style={{
                          left: `${(seg.start / timelineDuration) * 100}%`,
                          width: `${Math.max(1.2, (seg.duration / timelineDuration) * 100)}%`
                        }}
                        title={`${seg.label} · ${lane.name}${clip.linkGroupId ? " · 已链接" : ""} · 拖边缘裁剪 · 横移改时间 / 竖移换同型轨 · 右键链接`}
                        onMouseDown={(event) => beginClipDrag(event, clip.shotId, "video", clip.instanceId)}
                        onContextMenu={(event) => openClipContextMenu(event, "video", clip.instanceId)}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (clipDragRef.current) return;
                          const time = clientXToTimelineSec(event.clientX);
                          if (nleTool === "razor") {
                            applyRazorAt(clip.shotId, time, clip.start, clip.duration, "video");
                            return;
                          }
                          if (nleTool === "hand") return;
                          if (nleTool === "transition" && previewMode === "sequence") {
                            cycleTransitionForShot(clip.shotId);
                            return;
                          }
                          selectClipInstance(event, seg.key, clip.instanceId, "video");
                          setSelectedTextId(null);
                          setSelectedLaneId(lane.id);
                          if (previewMode === "sequence") {
                            setShotIndex(clip.index);
                            setSequenceIndex(clip.index);
                            setPlayToken((token) => token + 1);
                          } else {
                            setShotIndex(clip.index);
                          }
                          seekTimeline(nleTool === "selection" ? time : seg.start);
                        }}
                      >
                        {nleTool === "selection" && !lane.header.locked && segIndex === 0 ? (
                          <i
                            className="brain-video-nle__clip-edge brain-video-nle__clip-edge--in"
                            title="拖拽裁剪入点"
                            onMouseDown={(event) => beginClipTrim(event, clip.shotId, "video", "in", clip.instanceId)}
                          />
                        ) : null}
                        <span>{seg.label}</span>
                        <small>{clip.ready ? (() => {
                          const edit = trackEdits[clip.shotId] ?? defaultTrackEdit();
                          const inst = clip.instanceId ? clipInstances.find((item) => item.id === clip.instanceId) : undefined;
                          if (inst) {
                            const inSec = Number.isFinite(inst.inSec) ? Number(inst.inSec) : (edit.inSec || 0);
                            const outSec = Number.isFinite(inst.outSec) ? Number(inst.outSec) : inSec + instanceDurationSec(inst);
                            return `${inSec}–${outSec}s`;
                          }
                          return formatTrackRange(edit);
                        })() : "无 clip"}</small>
                        {nleTool === "selection" && !lane.header.locked && segIndex === segments.length - 1 ? (
                          <i
                            className="brain-video-nle__clip-edge brain-video-nle__clip-edge--out"
                            title="拖拽裁剪出点"
                            onMouseDown={(event) => beginClipTrim(event, clip.shotId, "video", "out", clip.instanceId)}
                          />
                        ) : null}
                      </div>
                      ));
                    })}
                    {previewMode === "sequence" ? laneClips.filter((clip) => clip.index < shots.length - 1).map((clip) => {
                      const isCut = normalizeTransition(shots[clip.index]?.transition || DEFAULT_SHOT_TRANSITION) === "cut";
                      const gap = isCut
                        ? 0.08
                        : Math.max(clip.transitionAfter, transitionGapSec(shots[clip.index]?.transition || DEFAULT_SHOT_TRANSITION));
                      return (
                        <button
                          key={`gap-${lane.id}-${clip.shotId}`}
                          type="button"
                          className={`brain-video-nle__gap${isCut ? " brain-video-nle__gap--cut" : " brain-video-nle__gap--fx"}${transitionPickerShotId === clip.shotId ? " brain-video-nle__gap--active" : ""}`}
                          style={{
                            left: `${((clip.start + clip.duration) / timelineDuration) * 100}%`,
                            width: `${Math.max(0.6, (gap / timelineDuration) * 100)}%`
                          }}
                          title={`切换特效：${transitionLabel(shots[clip.index]?.transition || DEFAULT_SHOT_TRANSITION)}（点击切换）`}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (nleTool === "hand") return;
                            cycleTransitionForShot(clip.shotId);
                          }}
                        >
                          <span>{isCut ? "✂" : "✦"}</span>
                        </button>
                      );
                    }) : null}
                    {laneTexts.map((clip) => (
                      <div
                        key={clip.id}
                        className={`brain-video-nle__clip brain-video-nle__clip--text${selectedTextId === clip.id ? " brain-video-nle__clip--selected" : ""}`}
                        style={{
                          left: `${(clip.startSec / timelineDuration) * 100}%`,
                          width: `${Math.max(1.5, (clip.durationSec / timelineDuration) * 100)}%`
                        }}
                        title={`双击编辑 · 拖边缘改时长 · ${clip.text}`}
                        onMouseDown={(event) => {
                          if (event.detail >= 2) return;
                          beginTextDrag(event, clip.id);
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (clipDragRef.current) return;
                          openTextEditor(clip.id, { focus: false });
                          setSelectedLaneId(lane.id);
                        }}
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          event.preventDefault();
                          clipDragRef.current = null;
                          openTextEditor(clip.id, { focus: true });
                          setSelectedLaneId(lane.id);
                        }}
                      >
                        {nleTool === "selection" && !lane.header.locked ? (
                          <i
                            className="brain-video-nle__clip-edge brain-video-nle__clip-edge--in"
                            title="拖拽左侧：移动起点并改时长"
                            onMouseDown={(event) => beginTextTrim(event, clip.id, "in")}
                          />
                        ) : null}
                        <span>T {clip.text.slice(0, 16) || "标题文字"}</span>
                        <small>{clip.fontSize}px · {clip.durationSec}s</small>
                        {nleTool === "selection" && !lane.header.locked ? (
                          <i
                            className="brain-video-nle__clip-edge brain-video-nle__clip-edge--out"
                            title="拖拽右侧：改时长"
                            onMouseDown={(event) => beginTextTrim(event, clip.id, "out")}
                          />
                        ) : null}
                      </div>
                    ))}
                    {!laneClips.length && !laneTexts.length ? (
                      <div className="brain-video-nle__clip brain-video-nle__clip--empty" style={{ left: "0%", width: "12%" }}>
                        <span>{lane.name} 空轨</span>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {audioLanes.map((lane) => {
                const laneClips = timelineClips.filter((clip) => clip.audioTrackId === lane.id && clip.kind === "audio");
                const laneIndex = audioLanes.findIndex((item) => item.id === lane.id);
                const laneMuteOn = resolveLaneMuteUi({
                  laneMuted: lane.header.muted,
                  isPrimary: isPrimaryAudioLane(lane.id, laneIndex),
                  trackEditMuted: trackEdit.muted
                });
                const laneSilenced = anyAudioSolo ? !lane.header.solo : (laneMuteOn && !lane.header.solo);
                return (
                  <div
                    key={`lane-${lane.id}`}
                    data-track-id={lane.id}
                    data-track-kind="audio"
                    className={`brain-video-nle__lane brain-video-nle__lane--audio${laneSilenced ? " brain-video-nle__lane--dim" : ""}${dropTargetLaneId === lane.id ? " brain-video-nle__lane--drop" : ""}`}
                    onDragOver={(event) => {
                      if (!event.dataTransfer.types.includes("application/x-brain-media-bin")) return;
                      event.preventDefault();
                      setDropTargetLaneId(lane.id);
                    }}
                    onDragLeave={() => setDropTargetLaneId((current) => current === lane.id ? null : current)}
                    onDrop={(event) => {
                      const binId = event.dataTransfer.getData("application/x-brain-media-bin");
                      if (!binId) return;
                      event.preventDefault();
                      event.stopPropagation();
                      const item = mediaBin.find((row) => row.id === binId);
                      setDropTargetLaneId(null);
                      if (item) void placeImportedOnTrack(item, lane.id, clientXToTimelineSec(event.clientX));
                    }}
                  >
                    {laneClips.flatMap((clip) => {
                      const segments = renderClipSegments(clip, "audio");
                      const envelope = effectiveVolumeKeyframes(
                        clip.volumeKeyframes,
                        clip.duration,
                        clip.volume ?? 1
                      );
                      const polyPoints = envelope
                        .map((kf) => {
                          const x = (kf.t / Math.max(0.1, clip.duration)) * 100;
                          const y = volumeGainToYRatio(kf.v) * 100;
                          return `${x},${y}`;
                        })
                        .join(" ");
                      return segments.map((seg, segIndex) => (
                      <div
                        key={seg.key}
                        className={`brain-video-nle__clip brain-video-nle__clip--audio${clip.muted || laneSilenced ? " brain-video-nle__clip--muted" : ""}${clip.hasLine ? "" : " brain-video-nle__clip--empty"}${selectedClipKey === seg.key || selectedInstanceId === clip.instanceId ? " brain-video-nle__clip--selected" : ""}${linkPartnerInstanceId && clip.instanceId === linkPartnerInstanceId ? " brain-video-nle__clip--link-partner" : ""}${clip.linkGroupId ? " brain-video-nle__clip--linked" : ""}`}
                        style={{
                          left: `${(seg.start / timelineDuration) * 100}%`,
                          width: `${Math.max(1.2, (seg.duration / timelineDuration) * 100)}%`
                        }}
                        title={clip.hasLine
                          ? `${clip.label || shots[clip.index]?.title || "音频"} · 音量包络 ${gainToPercent(clip.volume ?? 1)}%${clip.linkGroupId ? " · 已链接" : ""} · 钢笔加关键帧 · 右键链接`
                          : "无音频"}
                        onMouseDown={(event) => {
                          if (nleTool === "pen") return;
                          beginClipDrag(event, clip.shotId, "audio", clip.instanceId);
                        }}
                        onContextMenu={(event) => openClipContextMenu(event, "audio", clip.instanceId)}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (volumeKfDragRef.current || clipDragRef.current) return;
                          if (nleTool === "hand") return;
                          const time = clientXToTimelineSec(event.clientX);
                          if (nleTool === "razor") {
                            applyRazorAt(clip.shotId, time, clip.start, clip.duration, "audio");
                            return;
                          }
                          if (nleTool === "pen" && clip.hasLine && clip.instanceId) {
                            addVolumeKeyframeAtClient(event, clip);
                            return;
                          }
                          if (nleTool === "selection" && event.altKey && clip.hasLine && clip.instanceId) {
                            addVolumeKeyframeAtClient(event, clip);
                            return;
                          }
                          selectClipInstance(event, seg.key, clip.instanceId, "audio");
                          setSelectedTextId(null);
                          setSelectedLaneId(lane.id);
                          setSelectedVolumeKfIndex(null);
                          seekTimeline(time);
                        }}
                        onDoubleClick={(event) => {
                          if (!clip.instanceId || nleTool === "hand") return;
                          event.stopPropagation();
                          // Double-click empty rubber-band area → add keyframe
                          if (nleTool === "selection" || nleTool === "pen") {
                            addVolumeKeyframeAtClient(event, clip);
                          }
                        }}
                      >
                        {nleTool === "selection" && !lane.header.locked && segIndex === 0 ? (
                          <i
                            className="brain-video-nle__clip-edge brain-video-nle__clip-edge--in"
                            title="拖拽裁剪入点"
                            onMouseDown={(event) => beginClipTrim(event, clip.shotId, "audio", "in", clip.instanceId)}
                          />
                        ) : null}
                        <span>{(clip.muted || laneSilenced) ? "M " : lane.header.solo ? "S " : ""}{clip.hasLine
                          ? (clip.label
                            || (isPeeledEmbeddedAudioPath(clip.relativePath || "") ? "音轨" : "旁白"))
                          : "空"}</span>
                        <small>{clip.hasLine
                          ? (isPeeledEmbeddedAudioPath(clip.relativePath || "")
                            ? (clip.relativePath || "").split("/").pop() || "音轨"
                            : (shots[clip.index]?.line || clip.relativePath || "").slice(0, 18))
                          : "—"}</small>
                        {clip.hasLine && clip.instanceId && segIndex === 0 ? (
                          <svg
                            className="brain-video-nle__rubber"
                            viewBox="0 0 100 100"
                            preserveAspectRatio="none"
                            aria-hidden
                          >
                            <polyline
                              className="brain-video-nle__rubber-line"
                              points={polyPoints}
                              onMouseDown={(event) => {
                                if (lane.header.locked) return;
                                if (nleTool !== "selection" && nleTool !== "pen") return;
                                beginVolumeKeyframeDrag(event, clip, "baseline");
                              }}
                            />
                            {envelope.map((kf, kfIndex) => {
                              const cx = (kf.t / Math.max(0.1, clip.duration)) * 100;
                              const cy = volumeGainToYRatio(kf.v) * 100;
                              const selected = selectedClipKey === seg.key && selectedVolumeKfIndex === kfIndex;
                              return (
                                <polygon
                                  key={`vkf-${clip.instanceId}-${kfIndex}`}
                                  className={`brain-video-nle__rubber-kf${selected ? " brain-video-nle__rubber-kf--selected" : ""}`}
                                  points={`${cx},${cy - 3.2} ${cx + 3.2},${cy} ${cx},${cy + 3.2} ${cx - 3.2},${cy}`}
                                  onMouseDown={(event) => {
                                    if (lane.header.locked) return;
                                    beginVolumeKeyframeDrag(event, clip, kfIndex);
                                  }}
                                  onDoubleClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    if (lane.header.locked || !clip.instanceId) return;
                                    const next = removeVolumeKeyframe(clip.volumeKeyframes, clip.duration, kfIndex);
                                    patchAudioVolumeEnvelope(clip.instanceId, { volumeKeyframes: next });
                                    setSelectedVolumeKfIndex(null);
                                    setStatus("已删除音量关键帧");
                                    void savePipeline("音量关键帧已写入分镜");
                                  }}
                                />
                              );
                            })}
                          </svg>
                        ) : null}
                        {nleTool === "selection" && !lane.header.locked && segIndex === segments.length - 1 ? (
                          <i
                            className="brain-video-nle__clip-edge brain-video-nle__clip-edge--out"
                            title="拖拽裁剪出点"
                            onMouseDown={(event) => beginClipTrim(event, clip.shotId, "audio", "out", clip.instanceId)}
                          />
                        ) : null}
                      </div>
                      ));
                    })}
                    {!laneClips.length ? (
                      <div className="brain-video-nle__clip brain-video-nle__clip--empty" style={{ left: "0%", width: "12%" }}>
                        <span>{lane.name} 空轨</span>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              <div className="brain-video-nle__playhead" style={{ left: `${playheadPct}%` }} aria-hidden>
                <i />
              </div>
            </div>
          </div>
        </div>
      </div>
      {contextMenu ? (() => {
        const linked = isLinkedClipGroup(clipInstances, contextMenu.instanceId);
        const canRelink = !linked && Boolean(
          linkPartnerInstanceId
          || findRelinkCandidate(clipInstances, contextMenu.instanceId)
          || (selectedInstanceId && selectedInstanceId !== contextMenu.instanceId)
        );
        const sameTypeTargets = (contextMenu.kind === "video" ? videoLanes : audioLanes)
          .filter((lane) => {
            const src = clipInstances.find((item) => item.id === contextMenu.instanceId);
            return src && lane.id !== src.trackId;
          });
        return (
          <div
            className="brain-video-nle__context-menu"
            role="menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {linked ? (
              <button type="button" role="menuitem" onClick={() => breakClipLink(contextMenu.instanceId)}>
                取消链接
              </button>
            ) : (
              <button
                type="button"
                role="menuitem"
                disabled={!canRelink}
                onClick={() => relinkSelectedClips(
                  contextMenu.instanceId,
                  linkPartnerInstanceId
                    || (selectedInstanceId && selectedInstanceId !== contextMenu.instanceId ? selectedInstanceId : undefined)
                )}
              >
                重新链接
              </button>
            )}
            {sameTypeTargets.length ? (
              <>
                <hr />
                <strong>复制到轨道</strong>
                {sameTypeTargets.map((lane) => (
                  <button
                    key={lane.id}
                    type="button"
                    role="menuitem"
                    onClick={() => copySelectedToTrack(lane.id)}
                  >
                    {lane.name}
                  </button>
                ))}
              </>
            ) : null}
            <hr />
            <button type="button" role="menuitem" onClick={() => setContextMenu(null)}>关闭</button>
          </div>
        );
      })() : null}
      {contextMenu ? (
        <button
          type="button"
          className="brain-video-nle__context-scrim"
          aria-label="关闭菜单"
          onClick={() => setContextMenu(null)}
        />
      ) : null}
      {selectedTextId ? (() => {
        const text = textClips.find((item) => item.id === selectedTextId);
        if (!text) return null;
        return (
          <div className="brain-video-nle__text-editor" data-testid="brain-video-text-editor">
            <label className="brain-video-nle__text-editor-main">
              <span>标题文字（可选中标记后改写）</span>
              <textarea
                ref={textEditorRef}
                rows={2}
                value={text.text}
                placeholder="输入标题内容…"
                onChange={(event) => patchTextClip(text.id, { text: event.target.value })}
                onBlur={() => {
                  void savePipeline("标题文字已写入分镜");
                }}
              />
            </label>
            <label>
              <span>字号</span>
              <input type="number" min={12} max={200} value={text.fontSize} onChange={(event) => patchTextClip(text.id, { fontSize: Number(event.target.value) || 48 })} />
            </label>
            <label>
              <span>缩放</span>
              <input
                type="number"
                min={0.2}
                max={5}
                step={0.1}
                value={Number(text.scale) || 1}
                onChange={(event) => patchTextClip(text.id, { scale: Math.max(0.2, Math.min(5, Number(event.target.value) || 1)) })}
              />
            </label>
            <label>
              <span>颜色</span>
              <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(text.color) ? text.color : "#ffffff"} onChange={(event) => patchTextClip(text.id, { color: event.target.value })} />
            </label>
            <label>
              <span>时长 (s)</span>
              <input type="number" min={0.5} step={0.1} value={text.durationSec} onChange={(event) => patchTextClip(text.id, { durationSec: Number(event.target.value) || 3 })} />
            </label>
            <button
              type="button"
              className="brain-video-pipe__action"
              onClick={() => {
                void savePipeline("标题文字已保存");
                setStatus("编辑标题文字：预览可拖动 / 角点缩放；下方改内容 / 字号 / 颜色");
              }}
            >
              保存文字
            </button>
            <button type="button" className="brain-video-pipe__action" onClick={() => {
              setTextClips((current) => current.filter((item) => item.id !== text.id));
              setSelectedTextId(null);
              setStatus("已删除文字片段");
              void savePipeline("已删除文字并保存分镜");
            }}
            >
              删除文字
            </button>
          </div>
        );
      })() : null}
      {!selectedTextId && selectedAudioClip?.instanceId && selectedAudioClip.kind === "audio" ? (() => {
        const instanceId = selectedAudioClip.instanceId!;
        const baseline = clampVolumeGain(selectedAudioClip.volume ?? 1);
        const points = effectiveVolumeKeyframes(
          selectedAudioClip.volumeKeyframes,
          selectedAudioClip.duration,
          baseline
        );
        const playheadLocal = Math.max(0, playheadSec - selectedAudioClip.start);
        const live = sampleVolumeEnvelope(
          selectedAudioClip.volumeKeyframes,
          playheadLocal,
          selectedAudioClip.duration,
          baseline
        );
        return (
          <div className="brain-video-nle__text-editor" data-testid="brain-video-volume-envelope">
            <strong>音量包络 / 音量关键帧</strong>
            <label>
              <span>片段增益</span>
              <input
                type="range"
                min={0}
                max={200}
                step={1}
                value={Math.round(baseline * 100)}
                onChange={(event) => {
                  const next = clampVolumeGain(Number(event.target.value) / 100);
                  patchAudioVolumeEnvelope(instanceId, { volume: next });
                }}
                onMouseUp={() => { void savePipeline("音量增益已写入分镜"); }}
              />
            </label>
            <label>
              <span>{gainToPercent(baseline)}% · {gainToDb(baseline).toFixed(1)} dB</span>
              <input
                type="number"
                min={0}
                max={200}
                step={1}
                value={Math.round(baseline * 100)}
                onChange={(event) => {
                  const next = clampVolumeGain(Number(event.target.value) / 100);
                  patchAudioVolumeEnvelope(instanceId, { volume: next });
                }}
                onBlur={() => { void savePipeline("音量增益已写入分镜"); }}
              />
            </label>
            <small>播放头处 {gainToPercent(live)}% · 关键帧 {points.length}</small>
            <button
              type="button"
              className="brain-video-pipe__action"
              onClick={() => {
                setNleTool("pen");
                setStatus("钢笔工具：在 A 片段橡皮筋上点击添加音量关键帧");
              }}
            >
              钢笔加关键帧
            </button>
            <button
              type="button"
              className="brain-video-pipe__action"
              disabled={selectedVolumeKfIndex == null || points.length <= 2}
              onClick={() => {
                if (selectedVolumeKfIndex == null) return;
                const next = removeVolumeKeyframe(
                  selectedAudioClip.volumeKeyframes,
                  selectedAudioClip.duration,
                  selectedVolumeKfIndex
                );
                patchAudioVolumeEnvelope(instanceId, { volumeKeyframes: next });
                setSelectedVolumeKfIndex(null);
                void savePipeline("音量关键帧已写入分镜");
              }}
            >
              删除选中关键帧
            </button>
            <button
              type="button"
              className="brain-video-pipe__action"
              onClick={() => {
                patchAudioVolumeEnvelope(instanceId, {
                  volume: 1,
                  volumeKeyframes: [
                    { t: 0, v: 1 },
                    { t: Math.max(0.1, selectedAudioClip.duration), v: 1 }
                  ]
                });
                setSelectedVolumeKfIndex(null);
                void savePipeline("音量包络已重置");
                setStatus("已重置音量包络为平直 100%");
              }}
            >
              重置包络
            </button>
          </div>
        );
      })() : null}
      {previewMode === "sequence" && transitionPickerShotId ? (() => {
        const target = shots.find((item) => item.id === transitionPickerShotId);
        if (!target) return null;
        return (
          <div className="brain-video-nle__transition-bar" data-testid="brain-video-transition-bar">
            <strong>切换特效 · {target.title || transitionPickerShotId}</strong>
            <select
              value={normalizeTransition(target.transition)}
              onChange={(event) => {
                updateShot(target.id, { transition: event.target.value });
                setStatus(`切换特效：${transitionLabel(event.target.value)}`);
              }}
            >
              {TRANSITION_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
        );
      })() : null}
      {selectedLane ? (
        <div className="brain-video-nle__prompt" data-testid="brain-video-lane-prompt">
          <label>
            <span>{selectedLane.name} 提示词{selectedLane.kind === "audio" ? " / 旁白" : ""}</span>
            <textarea
              value={selectedLane.prompt}
              placeholder={selectedLane.kind === "audio"
                ? "AI 指令（如写旁白再转语音）或本镜台词；指令会交给对话 Auto"
                : "本轨视频提示词或 AI 指令；点重新生成走 BRAIN Auto / video_generate"}
              onChange={(event) => patchLanePrompt(selectedLane.id, selectedLane.kind, event.target.value)}
            />
          </label>
          <button
            type="button"
            className="brain-video-pipe__action"
            disabled={Boolean(busyAction) || !projectId || selectedLane.header.locked}
            onClick={() => {
              if (selectedLane.kind === "video") {
                void regenerateVideoFromPrompt(shot.id, selectedLane.prompt || shot.prompt);
              } else {
                void regenerateNarrationFromPrompt(shot.id, selectedLane.prompt || shot.line);
              }
            }}
          >
            {selectedLane.kind === "video"
              ? (busyAction === `video:${shot.id}` ? "生成中…" : "按提示词重新生成")
              : (busyAction === `tts:${shot.id}` ? "TTS…" : "按旁白重新生成")}
          </button>
        </div>
      ) : null}
      {trackEdit.trimOpen && !videoEditDisabled ? (
        <div className="brain-video-pipe__trim" data-testid="brain-video-track-trim">
          <label>
            入点 (s)
            <input type="number" min={0} step={0.1} value={trackEdit.inSec} onChange={(event) => patchTrack(shot.id, { inSec: Number(event.target.value) })} />
          </label>
          <label>
            出点 (s)
            <input type="number" min={0} step={0.1} value={trackEdit.outSec} onChange={(event) => patchTrack(shot.id, { outSec: Number(event.target.value) })} />
          </label>
          <button type="button" className="brain-video-pipe__action" onClick={() => applyTrim(shot.id, trackEdit.inSec, trackEdit.outSec)}>
            应用入出点
          </button>
        </div>
      ) : null}
    </div>
  );

  return (
    <section className="brain-video-pipe" aria-label="视频制作流水线" data-testid="brain-video-pipeline-shell">
      <header className="brain-video-pipe__header">
        <div className="brain-video-pipe__heading">
          <strong>视频流水线 · 分镜 → 单镜生成 → FFmpeg 合成</strong>
          <span>{projectId ? `工程 ${projectId}` : "未绑定工程"} · {brainVideoCanvasSize(canvas)} · {status}</span>
        </div>
        <button
          type="button"
          className="brain-video-pipe__run"
          disabled={Boolean(busyAction) || !projectId}
          onClick={() => void generateAllPending()}
        >
          ▶ 生成全部未完成镜
        </button>
      </header>

      {!activeStep ? (
        <nav className="brain-video-pipe__steps" aria-label="成片步骤">
          {steps.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`brain-video-pipe__step${pane === item.key ? " brain-video-pipe__step--active" : ""}`}
              aria-current={pane === item.key ? "step" : undefined}
              onClick={() => chooseStep(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      ) : null}

      <div className="brain-video-pipe__pane" role="tabpanel">
        <div className="brain-video-pipe__main">
          {projectId && <VideoVoiceCasting key={projectId} projectId={projectId} script={script} shots={shots}
            value={voiceCasting} onChange={value => {
              setVoiceCasting(value);
              pipelineSnapshotRef.current = { ...pipelineSnapshotRef.current, voiceCasting: value };
              pipelineDirtyRef.current = true;
            }} onSave={() => savePipeline("角色配音方案已保存")}
            onApply={async (shotId, result) => {
              const path = await persistSpeechToProject(shotId, result);
              if (path) rememberShotAudio(shotId, base64ToObjectUrl(result.audioBase64, result.mimeType));
              return path;
            }} />}
          {pane === "script" && (
            <VideoScriptWorkbench
              key={projectId || "unbound"}
              script={script}
              segments={shots.map(item => ({ title: item.title, prompt: item.prompt, line: item.line, duration: Math.max(0, (trackEdits[item.id]?.outSec ?? 4) - (trackEdits[item.id]?.inSec ?? 0)) }))}
              disabled={!projectId}
              canvasControls={adapterPanel}
              onScriptChange={(value) => { setScript(value); pipelineDirtyRef.current = true; }}
              onSegmentChange={(index, patch) => {
                const target = shots[index];
                if (!target) return;
                const { duration, ...fields } = patch;
                updateShot(target.id, fields);
                if (duration !== undefined) patchTrack(target.id, { outSec: (trackEdits[target.id]?.inSec ?? 0) + duration });
                pipelineDirtyRef.current = true;
              }}
              onAdd={addShot}
              onSave={() => savePipeline("脚本分段与画幅已保存到工程")}
              onConfirm={() => { if (onStepChange) onStepChange("storyboard"); else setLocalStep("storyboard"); }}
            />
          )}

          {pane === "storyboard" && (
            <div className="brain-video-pipe__section">
              <h3>分镜 · 可增删改并持久化</h3>
              <p>预览在上方；选择镜头后编辑该镜配置，相邻转场只显示与本镜相关的入/出。</p>
              {previewPanel}
              <div className="brain-video-pipe__storyboard-actions">
                <button type="button" className="brain-video-pipe__action" onClick={addShot}>＋ 添加镜头</button>
                <button type="button" className="brain-video-pipe__action" onClick={() => void savePipeline("分镜已保存")}>保存分镜</button>
                <button
                  type="button"
                  className="brain-video-pipe__action brain-video-pipe__action--danger"
                  disabled={shots.length <= 1}
                  onClick={() => deleteShot(shot.id)}
                >
                  删除本镜
                </button>
              </div>
              {shotTabs}
              <article key={shot.id} className="brain-video-pipe__shot-card" data-testid="brain-video-selected-shot-editor">
                <header className="brain-video-pipe__shot-card-head">
                  <strong>镜 {shotIndex + 1} 配置</strong>
                  <small>{shot.ready ? "已就绪" : "未生成"}</small>
                </header>
                <label>镜头标题
                  <input value={shot.title} onChange={(event) => updateShot(shot.id, { title: event.target.value })} />
                </label>
                <label>本镜剧本 / 台词
                  <textarea value={shot.line} onChange={(event) => updateShot(shot.id, { line: event.target.value })} />
                </label>
                <label>提示词 Prompt
                  <textarea value={shot.prompt} onChange={(event) => updateShot(shot.id, { prompt: event.target.value })} />
                </label>
                <div className="brain-video-pipe__shot-frames" data-testid="brain-video-shot-frames">
                  <div className="brain-video-pipe__shot-frame">
                    <strong>首帧（图生视频）</strong>
                    <small>提交为 image_url / first_frame；各模型按自身协议映射</small>
                    {shotFramePreviews.image || shot.image ? (
                      <div className="brain-video-pipe__shot-frame-preview">
                        {shotFramePreviews.image ? (
                          <img src={shotFramePreviews.image} alt="首帧预览" />
                        ) : (
                          <em>{shot.image}</em>
                        )}
                        <button
                          type="button"
                          className="brain-video-pipe__action"
                          onClick={() => {
                            updateShot(shot.id, { image: "" });
                            setStatus("已清除首帧");
                          }}
                        >
                          清除
                        </button>
                      </div>
                    ) : null}
                    <div className="brain-video-pipe__shot-frame-actions">
                      <button
                        type="button"
                        className="brain-video-pipe__action"
                        disabled={!projectId || busyAction?.startsWith("frame:")}
                        onClick={() => {
                          shotFrameTargetRef.current = "image";
                          shotFrameInputRef.current?.click();
                        }}
                      >
                        {busyAction === `frame:image:${shot.id}` ? "导入中…" : "添加首帧"}
                      </button>
                    </div>
                    <div
                      className="brain-video-pipe__shot-frame-drop"
                      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const file = event.dataTransfer.files?.[0];
                        if (file) void importShotFrameImage(file, "image");
                      }}
                    >
                      拖放图片到此处
                    </div>
                  </div>
                  <div className="brain-video-pipe__shot-frame">
                    <strong>尾帧（可选）</strong>
                    <small>提交为 last_frame；需模型支持首尾帧（如 MiniMax H3 / Kling / PixVerse）</small>
                    {shotFramePreviews.lastImage || shot.lastImage ? (
                      <div className="brain-video-pipe__shot-frame-preview">
                        {shotFramePreviews.lastImage ? (
                          <img src={shotFramePreviews.lastImage} alt="尾帧预览" />
                        ) : (
                          <em>{shot.lastImage}</em>
                        )}
                        <button
                          type="button"
                          className="brain-video-pipe__action"
                          onClick={() => {
                            updateShot(shot.id, { lastImage: "" });
                            setStatus("已清除尾帧");
                          }}
                        >
                          清除
                        </button>
                      </div>
                    ) : null}
                    <div className="brain-video-pipe__shot-frame-actions">
                      <button
                        type="button"
                        className="brain-video-pipe__action"
                        disabled={!projectId || busyAction?.startsWith("frame:")}
                        onClick={() => {
                          shotFrameTargetRef.current = "lastImage";
                          shotFrameInputRef.current?.click();
                        }}
                      >
                        {busyAction === `frame:lastImage:${shot.id}` ? "导入中…" : "添加尾帧"}
                      </button>
                    </div>
                    <div
                      className="brain-video-pipe__shot-frame-drop"
                      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const file = event.dataTransfer.files?.[0];
                        if (file) void importShotFrameImage(file, "lastImage");
                      }}
                    >
                      拖放图片到此处
                    </div>
                  </div>
                  <input
                    ref={shotFrameInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      const slot = shotFrameTargetRef.current;
                      if (file) void importShotFrameImage(file, slot);
                      event.target.value = "";
                    }}
                  />
                </div>
                {shots.length > 1 ? (
                  <div className="brain-video-pipe__shot-transitions" aria-label="本镜相关转场">
                    {shotIndex > 0 ? (
                      <label className="brain-video-pipe__transition">
                        <span>入场 · 镜 {shotIndex} → 镜 {shotIndex + 1}</span>
                        <select
                          value={normalizeTransition(shots[shotIndex - 1]!.transition)}
                          onChange={(event) => updateShot(shots[shotIndex - 1]!.id, { transition: event.target.value })}
                        >
                          {TRANSITION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {shotIndex < shots.length - 1 ? (
                      <label className="brain-video-pipe__transition">
                        <span>出场 · 镜 {shotIndex + 1} → 镜 {shotIndex + 2}</span>
                        <select
                          value={normalizeTransition(shot.transition)}
                          onChange={(event) => updateShot(shot.id, { transition: event.target.value })}
                        >
                          {TRANSITION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <small className="brain-video-pipe__transition-end">本镜为序列末镜，无出场转场</small>
                    )}
                  </div>
                ) : null}
                <div className="brain-video-pipe__workflow">
                  工作流：保存分镜 → video_generate（含画幅 size）→ media/clips → FFmpeg 合成（非 AI）
                </div>
                <small>{shot.clip ? `clip: ${shot.clip}` : "尚未生成 clip"} · {shot.ready ? "已就绪" : "未生成"}</small>
              </article>
            </div>
          )}

          {pane === "generate" && (
            <div className="brain-video-pipe__section">
              <h3>单镜生成</h3>
              <p>调用 spring-app <code>video_generate</code>（size={brainVideoCanvasSize(canvas)}），下载 MP4 并更新分镜。</p>
              {previewPanel}
              <label className="brain-video-pipe__field">视频模型（来自模型管理；勿写死 hy-video）
                {videoModelOptions.length > 0 ? (
                  <select
                    value={videoModel}
                    onChange={(event) => {
                      const next = event.target.value;
                      setVideoModel(next);
                      writeStoredVideoModel(next);
                    }}
                  >
                    <option value="">网关 Auto（仅真实视频模型；推荐显选 minimax-video-h3）</option>
                    {videoModelOptions.map((item) => (
                      <option key={item.model} value={item.model}>{item.label || item.model}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={videoModel}
                    placeholder="例如 minimax-video-h3（推荐；留空=网关 Auto）"
                    onChange={(event) => {
                      const next = event.target.value;
                      setVideoModel(next);
                      writeStoredVideoModel(next);
                    }}
                  />
                )}
              </label>
              <small className="brain-video-pipe__workflow">{videoModelI2vHint(videoModel, videoModelOptions)}</small>
              <div className="brain-video-pipe__shot-list">
                {shots.map((item, index) => (
                  <article
                    key={item.id}
                    className={`brain-video-pipe__shot-row${index === shotIndex ? " brain-video-pipe__shot-row--active" : ""}`}
                    onClick={() => { setShotIndex(index); setPreviewMode("shot"); }}
                  >
                    <b>{index + 1}</b>
                    <span>
                      <strong>{item.title || "未命名"}</strong>
                      <small>
                        {item.clip || "无 clip"}
                        {" · "}
                        {item.prompt ? "有 Prompt" : "缺 Prompt"}
                        {item.image ? " · 有首帧" : ""}
                        {item.lastImage ? " · 有尾帧" : ""}
                      </small>
                    </span>
                    <em>{item.ready && item.clip ? "已就绪" : "未生成"}</em>
                    <button
                      type="button"
                      disabled={Boolean(busyAction) || !projectId}
                      onClick={(event) => {
                        event.stopPropagation();
                        void generateShot(item.id, item.ready ? "重新生成" : "生成");
                      }}
                    >
                      {busyAction === `video:${item.id}` ? "生成中…" : item.ready ? "重新生成" : "生成本镜"}
                    </button>
                  </article>
                ))}
              </div>
              <div className="brain-video-pipe__ready">
                完成 {readyCount}/{shots.length} · {muxUnlocked ? "合成已解锁" : "合成未解锁（需全部镜头就绪）"}
              </div>
            </div>
          )}

          {pane === "tracks" && (
            <div className="brain-video-pipe__section">
              <h3>本镜音视频轨</h3>
              <p>Premiere 风格时间线：播放头随预览移动；全片序列会自动续播各镜。画幅仅在「脚本」中配置。</p>
              <div className="brain-video-pipe__tracks-actions">
                <button
                  type="button"
                  className="brain-video-pipe__action brain-video-pipe__action--primary"
                  disabled={!muxUnlocked || busyAction === "mux" || !projectId}
                  onClick={() => void muxAndExport("渲染")}
                >
                  {busyAction === "mux" ? "FFmpeg 渲染中…" : "渲染"}
                </button>
                <button
                  type="button"
                  className="brain-video-pipe__action"
                  disabled={!muxUnlocked || busyAction === "mux" || !projectId}
                  onClick={() => void muxAndExport("导出")}
                >
                  {busyAction === "mux" ? "FFmpeg 导出中…" : "导出"}
                </button>
                <span className="brain-video-pipe__ready">
                  {busyAction === "mux"
                    ? status
                    : muxUnlocked
                      ? `可渲染 · ${clipPathsForMux.length} 个 clip → exports/`
                      : `渲染未解锁 · 完成 ${readyCount}/${shots.length} 镜`}
                </span>
              </div>
              {shotTabs}
              {previewPanel}
              {nleTimeline}
              <div className="brain-video-pipe__tracks-status" aria-live="polite">{status}</div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
