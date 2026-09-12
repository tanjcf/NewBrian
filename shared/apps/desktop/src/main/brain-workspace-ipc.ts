import { ipcMain } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import {
  brainWorkspaceIpcChannels,
  brainWorkspaceKeys,
  type BrainConversationCreateInput,
  type BrainConversationListInput,
  type BrainConversationGetInput,
  type BrainDraftSaveInput,
  type BrainArtifactRegisterInput,
  type BrainFileRegisterInput,
  type BrainMessageAppendInput,
  type BrainProjectCreateInput,
  type BrainProjectGetInput,
  type BrainProjectListInput,
  type BrainProjectUpdateInput,
  type BrainProjectWorkspaceInput,
  type BrainGameUnrealTemplateCreateInput,
  type BrainWorkspaceSectionGetInput,
  type BrainWorkspaceSectionSaveInput,
  type BrainTaskCreateInput,
  type BrainTaskUpdateInput,
  type BrainWorkspaceKey
} from "@codex-forge/protocol";
import type { BrainFlowDefinition } from "@codex-forge/protocol";
import type { DocumentAnchor } from "@codex-forge/protocol/document-anchor";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.js";
import { BrainDocumentRevisionService } from "./brain-document-revision-service.js";
import { createDocumentRevisionProposal, syncDocumentRevisionTask } from "./document-revision-task.js";
import { inspectGameProject } from "./game-project-inspector.js";
import { GameRuntimeService } from "./game-runtime-service.js";
import { VideoRuntimeService } from "./video-runtime-service.js";
import { MusicRuntimeService } from "./music-runtime-service.js";
import { DataRuntimeService } from "./data-runtime-service.js";
import { buildWorkspaceArtifactPreviewUrl } from "./workspace-artifact-protocol.js";
import { ensureEnginesForWorkspaceKey } from "./engine-bootstrap-service.js";
import { GamePreviewService, type GamePreviewRustClient } from "./game-preview-service.js";
import type { QuantSimulationService } from "./quant-simulation-service.ts";
import type { VideoTimelineService } from "./video-timeline-service.ts";
import type { VideoRenderService } from "./video-render-service.ts";
import type { MusicTimelineService } from "./music-timeline-service.ts";
import type { MusicMediaService } from "./music-media-service.ts";
import type { MusicRenderService } from "./music-render-service.ts";
import { normalizeDataset } from "./data-dataset-policy.ts";
import type { BrainDataset } from "@codex-forge/protocol/data-types";
import { discoverSoftwareScripts } from "./software-script-discovery.ts";
import { SoftwareTaskService, type SoftwareTaskRustClient } from "./software-task-service.ts";
import type { DocumentWorkerResponse } from "@codex-forge/protocol/document-worker";
import { validateDocumentOperation } from "@codex-forge/protocol/document-operation";
import type { DataAnalysisService } from "./data-analysis-service.ts";
import { FlowExecutionService } from "./flow-execution-service.ts";
import { contentHashHex, peelMediaAv, probeMediaAv } from "./video-media-peel.js";

interface BrainWorkspaceIpcDependencies {
  storage: BrainWorkspaceStorage;
  resolveOwnerId: () => Promise<string> | string;
  resolveWorkspaceRoot: (workspaceId: string) => Promise<string>;
  quant?: QuantSimulationService;
  queryQuantMarketOverview?: (limit: number) => Promise<unknown>;
  queryQuantMarketScreener?: (criteria: Record<string, unknown>) => Promise<unknown>;
  video?: VideoTimelineService;
  videoRender?: VideoRenderService;
  music?: MusicTimelineService;
  musicMedia?: MusicMediaService;
  musicRender?: MusicRenderService;
  ingestDocument?: (input: { requestId: string; projectRoot: string; relativePath: string; maxBytes: number }) => Promise<DocumentWorkerResponse>;
  acquireRustCore?: (binding: { projectId: string; projectRoot: string; workspaceType: "game" | "video" | "music" | "data" | "software" }) => Promise<GamePreviewRustClient | SoftwareTaskRustClient>;
  rustConversation?: (input: { projectId: string; projectRoot: string; workspaceType: string; operation: `conversation.${string}`; payload: Record<string, unknown> }) => Promise<unknown>;
  confirmGamePreview?: (input: { projectName: string; projectRoot: string; command: string }) => Promise<boolean>;
  confirmSoftwareTask?: (input: { projectId: string; script: import("@codex-forge/protocol").BrainSoftwareScript; projectRoot: string }) => Promise<boolean>;
  openSoftwareTerminal?: (input: { projectId: string; projectRoot: string }) => Promise<{ ok: boolean }>;
  platform?: NodeJS.Platform;
  dataAnalysis?: DataAnalysisService;
  flowExecution?: FlowExecutionService;
  confirmFlowApproval?: (input: { ownerId: string; projectId: string; flowId: string; runId: string; nodeId: string }) => Promise<boolean>;
  readWorkspaceCatalog?: () => Promise<{
    workspaces: Array<{
      id: string;
      name: string;
      threads?: Array<{ id: string; title?: string; updatedAt?: string; archived?: boolean }>;
    }>;
  }>;
  discoverEngines?: () => Promise<Array<{ engineId: string; executable: string; source: string; version: string }>>;
  ensureEngine?: (engineId: string) => Promise<{ engineId: string; executable: string; source: string; version: string }>;
  ensureEnginesForScene?: (workspaceKey: BrainWorkspaceKey) => Promise<Array<{ engineId: string; executable: string; source: string; version: string }>>;
  runSceneMediaGeneration?: (input: {
    projectId: string;
    kind: "video" | "music" | "image";
    prompt: string;
    model?: string;
    shotIndex?: number;
    size?: string;
    /** First-frame / reference image (path, https, or data URL). */
    imageUrl?: string;
    /** Optional last-frame image for MiniMax H3 first+last I2V. */
    lastFrameImageUrl?: string;
  }) => Promise<{
    content: string;
    kind: string;
    clipRelativePath?: string;
    fileId?: string;
    ready?: boolean;
    jobId?: string;
  }>;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} payload is invalid.`);
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown, label: string) {
  return value === undefined || value === null ? {} : requireRecord(value, label);
}

function requireString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  return value.trim();
}

function optionalString(value: unknown, field: string) {
  if (value === undefined) return undefined;
  return requireString(value, field);
}

function rejectUnexpectedKeys(input: Record<string, unknown>, allowed: readonly string[], label: string) {
  const unexpected = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new TypeError(`${label} contains unsupported fields: ${unexpected.join(", ")}`);
}

function parseGamePreviewStart(value: unknown) {
  const input = requireRecord(value, "Game preview start");
  rejectUnexpectedKeys(input, ["projectId", "conversationId"], "Game preview start");
  return {
    projectId: requireString(input.projectId, "projectId"),
    conversationId: optionalString(input.conversationId, "conversationId")
  };
}

function parseFlowSave(value: unknown) {
  const input = requireRecord(value, "Flow save");
  rejectUnexpectedKeys(input, ["projectId", "id", "name", "definition"], "Flow save");
  const definition = input.definition as BrainFlowDefinition;
  validateFlowDefinition(definition);
  return { projectId: requireString(input.projectId, "projectId"), id: optionalString(input.id, "id"), name: requireString(input.name, "name"), definition };
}

function parseFlowStart(value: unknown) {
  const input = requireRecord(value, "Flow start");
  rejectUnexpectedKeys(input, ["flowId", "values"], "Flow start");
  const values = input.values === undefined ? undefined : requireRecord(input.values, "values");
  if (JSON.stringify(values || {}).length > 64 * 1024) throw new TypeError("Flow values exceed the allowed size.");
  return { flowId: requireString(input.flowId, "flowId"), values };
}

function parseFlowId(value: unknown, field: "flowId" | "runId") {
  const input = requireRecord(value, "Flow identifier");
  rejectUnexpectedKeys(input, [field], "Flow identifier");
  return requireString(input[field], field);
}
function parseFlowScheduleCreate(value: unknown) {
  const input = requireRecord(value, "Flow schedule create");
  rejectUnexpectedKeys(input, ["projectId", "flowId", "timezone", "runAt", "enabled"], "Flow schedule create");
  const runAt = requireString(input.runAt, "runAt");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(runAt)) throw new TypeError("runAt must use HH:mm.");
  const timezone = input.timezone === undefined ? undefined : requireString(input.timezone, "timezone");
  const enabled = input.enabled === undefined ? undefined : input.enabled === true;
  return { projectId: requireString(input.projectId, "projectId"), flowId: requireString(input.flowId, "flowId"), runAt, ...(timezone ? { timezone } : {}), ...(enabled === undefined ? {} : { enabled }) };
}

function parseGamePreviewProject(value: unknown) {
  const input = requireRecord(value, "Game preview");
  rejectUnexpectedKeys(input, ["projectId"], "Game preview");
  return { projectId: requireString(input.projectId, "projectId") };
}

function parseVideoTimelineProject(value: unknown) {
  const input = requireRecord(value, "Video timeline");
  rejectUnexpectedKeys(input, ["projectId"], "Video timeline");
  return { projectId: requireString(input.projectId, "projectId") };
}

function parseVideoTimelineSave(value: unknown) {
  const input = requireRecord(value, "Video timeline save");
  rejectUnexpectedKeys(input, ["projectId", "title", "width", "height", "fps"], "Video timeline save");
  return {
    projectId: requireString(input.projectId, "projectId"),
    title: requireString(input.title, "title"),
    width: requireFiniteNumber(input.width, "width"),
    height: requireFiniteNumber(input.height, "height"),
    fps: requireFiniteNumber(input.fps, "fps")
  };
}

function parseVideoClipAdd(value: unknown) {
  const input = requireRecord(value, "Video clip add");
  rejectUnexpectedKeys(input, ["projectId", "trackType", "sourceFileId", "startMs", "durationMs", "sourceInMs", "volume", "text"], "Video clip add");
  return {
    projectId: requireString(input.projectId, "projectId"),
    trackType: input.trackType,
    sourceFileId: requireString(input.sourceFileId, "sourceFileId"),
    startMs: requireFiniteNumber(input.startMs, "startMs"),
    durationMs: requireFiniteNumber(input.durationMs, "durationMs"),
    sourceInMs: requireFiniteNumber(input.sourceInMs, "sourceInMs"),
    volume: input.volume === undefined ? undefined : requireFiniteNumber(input.volume, "volume"),
    text: input.text === undefined ? undefined : requireString(input.text, "text")
  };
}

function parseVideoRenderStart(value: unknown) {
  const input = requireRecord(value, "Video render start");
  rejectUnexpectedKeys(input, ["projectId", "outputRelativePath", "source", "mediaRelativePaths"], "Video render start");
  const sourceRaw = input.source === undefined ? "timeline" : requireString(input.source, "source");
  if (sourceRaw !== "timeline" && sourceRaw !== "pipeline") throw new TypeError("source must be timeline or pipeline.");
  let mediaRelativePaths: string[] | undefined;
  if (input.mediaRelativePaths !== undefined) {
    if (!Array.isArray(input.mediaRelativePaths)) throw new TypeError("mediaRelativePaths must be an array.");
    mediaRelativePaths = input.mediaRelativePaths.map((item, index) => requireString(item, `mediaRelativePaths[${index}]`));
  }
  return {
    projectId: requireString(input.projectId, "projectId"),
    outputRelativePath: requireString(input.outputRelativePath, "outputRelativePath"),
    source: sourceRaw as "timeline" | "pipeline",
    mediaRelativePaths
  };
}

type PipelineRenderShot = {
  ready?: boolean;
  clip?: string;
  audio?: string;
  transition?: string;
};

type PipelineTrackEdit = {
  muted?: boolean;
  inSec?: number;
  outSec?: number;
  offsetSec?: number;
  videoTrackId?: string;
  audioTrackId?: string;
};

type PipelineLane = {
  id?: string;
  kind?: string;
  output?: boolean;
  muted?: boolean;
  solo?: boolean;
  locked?: boolean;
};

function transitionGapSecForRender(value: string) {
  const key = String(value || "").trim().toLowerCase();
  // Default / empty / none / cut → hard cut (no timeline gap, no xfade).
  if (!key || key === "cut" || key === "none" || /硬切/.test(key)) return 0;
  if (key === "fade-0.6" || key === "0.6") return 0.6;
  if (key === "fade" || key === "淡入淡出") return 0.3;
  if (key === "dissolve" || key === "叠化") return 0.25;
  if (key === "wipe-left" || key === "划像" || /wipe/.test(key)) return 0.25;
  if (key === "blur" || /模糊/.test(key)) return 0.25;
  return 0;
}

function clipDurationSecForRender(edit: PipelineTrackEdit | undefined) {
  const inSec = Number.isFinite(edit?.inSec) ? Number(edit!.inSec) : 0;
  const outSec = Number.isFinite(edit?.outSec) ? Number(edit!.outSec) : 4;
  return Math.max(0.1, outSec - inSec);
}

function normalizeClipRelative(clip: string) {
  const normalized = String(clip || "").replaceAll("\\", "/");
  return normalized.includes("/") ? normalized : `media/clips/${normalized}`;
}

function normalizeAudioRelative(clip: string) {
  const normalized = String(clip || "").replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized) return "";
  return normalized.includes("/") ? normalized : `media/audio/${normalized}`;
}

function mediaKindFromName(name: string, mimeType = ""): "video" | "audio" | "image" | null {
  const lower = `${name} ${mimeType}`.toLowerCase();
  if (/\.(mp4|webm|mov|m4v|mkv)(?:\b|$)/i.test(lower) || lower.includes("video/")) return "video";
  if (/\.(mp3|wav|m4a|aac|ogg|flac)(?:\b|$)/i.test(lower) || lower.includes("audio/")) return "audio";
  if (/\.(png|jpe?g|webp|gif|bmp)(?:\b|$)/i.test(lower) || lower.includes("image/")) return "image";
  return null;
}

function mimeForMediaName(name: string, kind: "video" | "audio" | "image", fallback = "") {
  const lower = name.toLowerCase();
  if (fallback.trim()) return fallback.trim();
  if (kind === "video") {
    if (lower.endsWith(".webm")) return "video/webm";
    if (lower.endsWith(".mov")) return "video/quicktime";
    return "video/mp4";
  }
  if (kind === "image") {
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".gif")) return "image/gif";
    return "image/png";
  }
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  return "audio/mpeg";
}

async function importProjectMediaFile(input: {
  projectRoot: string;
  ownerId: string;
  projectId: string;
  storage: BrainWorkspaceStorage;
  sourcePath?: string;
  fileName?: string;
  mimeType?: string;
  bytesBase64?: string;
  folder?: "imports" | "audio" | "clips" | "refs";
}) {
  const folder = input.folder || "imports";
  let bytes: Buffer;
  let logicalName: string;
  if (input.bytesBase64) {
    bytes = Buffer.from(String(input.bytesBase64), "base64");
    logicalName = basename(String(input.fileName || `media-${Date.now()}.bin`).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_"));
  } else {
    const sourcePath = String(input.sourcePath || "").trim();
    if (!sourcePath) throw new TypeError("sourcePath or bytesBase64 is required.");
    const source = await realpath(sourcePath);
    const sourceStat = await stat(source);
    if (!sourceStat.isFile()) throw new Error("BRAIN_MEDIA_SOURCE_NOT_FILE");
    if (sourceStat.size <= 0 || sourceStat.size > 512 * 1024 * 1024) throw new Error("BRAIN_MEDIA_SOURCE_SIZE_INVALID");
    logicalName = basename(String(input.fileName || source).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_"));
    bytes = await readFile(source);
  }
  if (!bytes.length) throw new Error("BRAIN_MEDIA_EMPTY");
  const kind = mediaKindFromName(logicalName, input.mimeType || "");
  if (!kind) throw new Error("BRAIN_MEDIA_TYPE_UNSUPPORTED");
  if (folder === "refs" && kind !== "image") throw new Error("BRAIN_MEDIA_REFS_IMAGE_ONLY");
  // Keep file extension aligned with payload MIME (MiniMax TTS is mp3 — never leave .wav).
  if (kind === "audio" && input.mimeType) {
    const mime = String(input.mimeType).toLowerCase();
    const wantExt = mime.includes("wav")
      ? ".wav"
      : mime.includes("ogg")
        ? ".ogg"
        : mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")
          ? ".m4a"
          : ".mp3";
    const currentExt = extname(logicalName).toLowerCase();
    if (currentExt !== wantExt) {
      logicalName = `${logicalName.replace(/\.[^.]+$/, "") || "media"}${wantExt}`;
    }
  }
  const root = await realpath(input.projectRoot);
  const safeStem = logicalName.replace(/\.[^.]+$/, "") || "media";
  const ext = extname(logicalName)
    || (kind === "video" ? ".mp4" : kind === "image" ? ".png" : ".wav");
  const relativePath = `media/${folder}/${safeStem}-${Date.now()}${ext}`;
  const target = resolve(root, relativePath);
  const boundary = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!target.startsWith(boundary)) throw new Error("BRAIN_MEDIA_PATH_INVALID");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  const mimeType = mimeForMediaName(logicalName, kind, input.mimeType);
  const existing = input.storage.listFiles(input.ownerId, input.projectId).find((file) => file.storageKey === relativePath);
  const file = existing || input.storage.registerFile({
    ownerId: input.ownerId,
    projectId: input.projectId,
    logicalName,
    mimeType,
    sizeBytes: bytes.length,
    contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    storageKey: relativePath
  });
  return { file: withoutOwner(file), relativePath, kind, mimeType };
}

async function buildPipelineLayerClips(
  projectRoot: string,
  state: {
    shots?: PipelineRenderShot[];
    trackEdits?: Record<string, PipelineTrackEdit>;
    lanes?: PipelineLane[];
    textClips?: Array<{
      id?: string;
      trackId?: string;
      startSec?: number;
      durationSec?: number;
      text?: string;
      fontSize?: number;
      color?: string;
      x?: number;
      y?: number;
      scale?: number;
      width?: number;
    }>;
    clipInstances?: Array<{
      id?: string;
      kind?: string;
      shotId?: string;
      relativePath?: string;
      trackId?: string;
      startSec?: number;
      durationSec?: number;
      inSec?: number;
      outSec?: number;
      muted?: boolean;
      volume?: number;
      volumeKeyframes?: Array<{ t?: number; v?: number }>;
    }>;
  }
) {
  const shots = Array.isArray(state.shots) ? state.shots : [];
  const trackEdits = state.trackEdits && typeof state.trackEdits === "object" ? state.trackEdits : {};
  const lanes = Array.isArray(state.lanes) ? state.lanes : [];
  const videoLaneById = new Map(lanes.filter((lane) => lane.kind === "video" && lane.id).map((lane) => [String(lane.id), lane]));
  const audioLaneById = new Map(lanes.filter((lane) => lane.kind === "audio" && lane.id).map((lane) => [String(lane.id), lane]));
  const videoStackOrder = new Map(
    lanes.filter((lane) => lane.kind === "video" && lane.id).map((lane, index) => [String(lane.id), index])
  );
  const audioStackOrder = new Map(
    lanes.filter((lane) => lane.kind === "audio" && lane.id).map((lane, index) => [String(lane.id), index])
  );
  const anyAudioSolo = [...audioLaneById.values()].some((lane) => lane.solo === true);

  const layerClips: Array<{
    relativePath?: string;
    trackId: string;
    trackType: "video" | "audio" | "text";
    startMs: number;
    durationMs: number;
    volume: number;
    volumeKeyframes?: Array<{ t: number; v: number }>;
    stackOrder?: number;
    transition?: string;
    transitionMs?: number;
    text?: string;
    fontSize?: number;
    color?: string;
    x?: number;
    y?: number;
    scale?: number;
  }> = [];

  const instances = Array.isArray(state.clipInstances)
    ? state.clipInstances.filter((item) => item && (item.kind === "video" || item.kind === "audio") && String(item.relativePath || "").trim())
    : [];

  if (instances.length) {
    for (const instance of instances) {
      const kind = instance.kind === "audio" ? "audio" : "video";
      const trackId = String(instance.trackId || (kind === "video" ? "v1" : "a1"));
      const startMs = Math.round(Math.max(0, Number(instance.startSec) || 0) * 1_000);
      const inSec = Number.isFinite(instance.inSec) ? Number(instance.inSec) : 0;
      const outSec = Number.isFinite(instance.outSec) ? Number(instance.outSec) : (Number(instance.durationSec) || 4) + inSec;
      const durationMs = Math.round(Math.max(0.1, (Number(instance.durationSec) || (outSec - inSec) || 4)) * 1_000);
      if (kind === "video") {
        const videoLane = videoLaneById.get(trackId);
        if (videoLane && videoLane.output === false) continue;
        const relative = normalizeClipRelative(String(instance.relativePath));
        try {
          await access(join(projectRoot, relative));
          const shotIndex = instance.shotId
            ? Math.max(0, Number(String(instance.shotId).replace(/\D/g, "")) - 1)
            : -1;
          const shot = shotIndex >= 0 ? shots[shotIndex] : undefined;
          const transition = shot ? String(shot.transition || "cut") : "cut";
          layerClips.push({
            relativePath: relative,
            trackId,
            trackType: "video",
            startMs,
            durationMs,
            volume: 1,
            stackOrder: videoStackOrder.get(trackId) ?? 0,
            transition,
            transitionMs: Math.round(transitionGapSecForRender(transition) * 1_000)
          });
        } catch {
          // missing
        }
      } else {
        const audioLane = audioLaneById.get(trackId);
        const laneMuted = audioLane?.muted === true && audioLane?.solo !== true;
        const clipMuted = instance.muted === true;
        const soloBlocked = anyAudioSolo && audioLane?.solo !== true;
        if (laneMuted || clipMuted || soloBlocked) continue;
        const baseline = Math.max(0, Math.min(2, Number(instance.volume) || 1));
        const keyframes = Array.isArray(instance.volumeKeyframes)
          ? instance.volumeKeyframes
            .map((item) => ({
              t: Math.max(0, Number(item?.t) || 0),
              v: Math.max(0, Math.min(2, Number(item?.v) || 1))
            }))
            .filter((item) => Number.isFinite(item.t) && Number.isFinite(item.v))
          : undefined;
        const relative = normalizeAudioRelative(String(instance.relativePath));
        try {
          await access(join(projectRoot, relative));
          layerClips.push({
            relativePath: relative,
            trackId,
            trackType: "audio",
            startMs,
            durationMs,
            volume: baseline,
            volumeKeyframes: keyframes?.length ? keyframes : undefined,
            stackOrder: audioStackOrder.get(trackId) ?? 0
          });
        } catch {
          // missing
        }
      }
    }
  } else {
    let cursorSec = 0;
    for (let index = 0; index < shots.length; index += 1) {
      const shot = shots[index]!;
      const shotKey = `shot-${index + 1}`;
      const edit = trackEdits[shotKey] || {};
      const durationSec = clipDurationSecForRender(edit);
      const startSec = Math.max(0, cursorSec + (Number(edit.offsetSec) || 0));
      const startMs = Math.round(startSec * 1_000);
      const durationMs = Math.round(durationSec * 1_000);
      const transition = index < shots.length - 1 ? String(shot.transition || "cut") : "cut";
      const transitionMs = Math.round(transitionGapSecForRender(transition) * 1_000);

      if (shot.ready === true && String(shot.clip || "").trim()) {
        const videoTrackId = String(edit.videoTrackId || "v1");
        const videoLane = videoLaneById.get(videoTrackId);
        const videoEnabled = videoLane ? videoLane.output !== false : true;
        if (videoEnabled) {
          const relative = normalizeClipRelative(String(shot.clip));
          try {
            await access(join(projectRoot, relative));
            layerClips.push({
              relativePath: relative,
              trackId: videoTrackId,
              trackType: "video",
              startMs,
              durationMs,
              volume: 1,
              stackOrder: videoStackOrder.get(videoTrackId) ?? index,
              transition,
              transitionMs
            });
          } catch {
            // missing on disk
          }
        }
      }

      const audioPath = String(shot.audio || "").trim();
      if (audioPath) {
        const audioTrackId = String(edit.audioTrackId || "a1");
        const audioLane = audioLaneById.get(audioTrackId);
        const laneMuted = audioLane?.muted === true && audioLane?.solo !== true;
        const clipMuted = edit.muted === true;
        const soloBlocked = anyAudioSolo && audioLane?.solo !== true;
        const volume = (laneMuted || clipMuted || soloBlocked) ? 0 : 1;
        if (volume > 0) {
          const relative = normalizeAudioRelative(audioPath);
          try {
            await access(join(projectRoot, relative));
            layerClips.push({
              relativePath: relative,
              trackId: audioTrackId,
              trackType: "audio",
              startMs,
              durationMs,
              volume,
              stackOrder: audioStackOrder.get(audioTrackId) ?? index
            });
          } catch {
            // missing narration file
          }
        }
      }

      const gap = index < shots.length - 1 ? transitionGapSecForRender(transition) : 0;
      cursorSec += durationSec + gap;
    }
  }

  for (const text of Array.isArray(state.textClips) ? state.textClips : []) {
    const body = String(text.text || "").trim();
    if (!body) continue;
    const trackId = String(text.trackId || "v1");
    const videoLane = videoLaneById.get(trackId);
    if (videoLane && videoLane.output === false) continue;
    layerClips.push({
      trackId,
      trackType: "text",
      startMs: Math.max(0, Math.round((Number(text.startSec) || 0) * 1_000)),
      durationMs: Math.max(100, Math.round((Number(text.durationSec) || 3) * 1_000)),
      volume: 1,
      stackOrder: videoStackOrder.get(trackId) ?? 0,
      text: body,
      fontSize: Math.max(12, Math.round(Number(text.fontSize) || 48)),
      color: String(text.color || "#ffffff"),
      x: Number.isFinite(Number(text.x)) ? Math.min(1, Math.max(0, Number(text.x))) : 0.5,
      y: Number.isFinite(Number(text.y)) ? Math.min(1, Math.max(0, Number(text.y))) : 0.5,
      scale: Math.max(0.2, Math.min(5, Number(text.scale) || 1))
    });
  }

  return layerClips;
}

function parseSceneMediaGenerate(value: unknown) {
  const input = requireRecord(value, "Scene media generate");
  rejectUnexpectedKeys(
    input,
    ["projectId", "kind", "prompt", "model", "shotIndex", "size", "imageUrl", "lastFrameImageUrl"],
    "Scene media generate"
  );
  const kind = requireString(input.kind, "kind");
  if (kind !== "video" && kind !== "music" && kind !== "image") throw new TypeError("kind must be video, music, or image.");
  const shotIndex = input.shotIndex === undefined ? undefined : requireFiniteNumber(input.shotIndex, "shotIndex");
  if (shotIndex !== undefined && (!Number.isInteger(shotIndex) || shotIndex < 0)) {
    throw new TypeError("shotIndex must be a non-negative integer.");
  }
  return {
    projectId: requireString(input.projectId, "projectId"),
    kind: kind as "video" | "music" | "image",
    prompt: requireString(input.prompt, "prompt"),
    model: optionalString(input.model, "model"),
    shotIndex,
    size: optionalString(input.size, "size"),
    imageUrl: optionalString(input.imageUrl, "imageUrl"),
    lastFrameImageUrl: optionalString(input.lastFrameImageUrl, "lastFrameImageUrl")
  };
}
function parseMusicProject(value: unknown) { const input = requireRecord(value, "Music timeline"); rejectUnexpectedKeys(input, ["projectId"], "Music timeline"); return { projectId: requireString(input.projectId, "projectId") }; }
function parseMusicSave(value: unknown) { const input = requireRecord(value, "Music timeline save"); rejectUnexpectedKeys(input, ["projectId", "title", "sampleRate", "channels"], "Music timeline save"); if (input.channels !== 1 && input.channels !== 2) throw new TypeError("channels must be 1 or 2."); return { projectId: requireString(input.projectId, "projectId"), title: requireString(input.title, "title"), sampleRate: requireFiniteNumber(input.sampleRate, "sampleRate"), channels: input.channels as 1 | 2 }; }
function parseMusicClip(value: unknown) { const input = requireRecord(value, "Music clip add"); rejectUnexpectedKeys(input, ["projectId", "trackType", "sourceFileId", "startMs", "durationMs", "sourceInMs", "gain", "pan"], "Music clip add"); return { projectId: requireString(input.projectId, "projectId"), trackType: input.trackType, sourceFileId: requireString(input.sourceFileId, "sourceFileId"), startMs: requireFiniteNumber(input.startMs, "startMs"), durationMs: requireFiniteNumber(input.durationMs, "durationMs"), sourceInMs: requireFiniteNumber(input.sourceInMs, "sourceInMs"), gain: requireFiniteNumber(input.gain, "gain"), pan: requireFiniteNumber(input.pan, "pan") }; }
function parseDataset(value: unknown): BrainDataset { const input = requireRecord(value, "Dataset save"); rejectUnexpectedKeys(input, ["id", "projectId", "name", "columns", "rowCount", "sourceFileId", "sourceSheet", "contentHash", "updatedAt"], "Dataset save"); return normalizeDataset({ id: requireString(input.id, "id"), projectId: requireString(input.projectId, "projectId"), name: requireString(input.name, "name"), columns: input.columns as BrainDataset["columns"], rowCount: requireFiniteNumber(input.rowCount, "rowCount"), sourceFileId: optionalString(input.sourceFileId, "sourceFileId"), sourceSheet: optionalString(input.sourceSheet, "sourceSheet"), contentHash: requireString(input.contentHash, "contentHash"), updatedAt: requireString(input.updatedAt, "updatedAt") }); }

function requireWorkspaceKey(value: unknown): BrainWorkspaceKey {
  if (typeof value === "string" && (brainWorkspaceKeys as readonly string[]).includes(value)) return value as BrainWorkspaceKey;
  throw new TypeError("workspaceKey is unsupported.");
}

function optionalWorkspaceKey(value: unknown) {
  return value === undefined ? undefined : requireWorkspaceKey(value);
}

function parseProjectList(value: unknown): BrainProjectListInput {
  const input = optionalRecord(value, "Project list");
  if (input.includeArchived !== undefined && typeof input.includeArchived !== "boolean") {
    throw new TypeError("includeArchived must be boolean.");
  }
  return {
    workspaceKey: optionalWorkspaceKey(input.workspaceKey),
    includeArchived: input.includeArchived === true
  };
}

function parseProjectCreate(value: unknown): BrainProjectCreateInput {
  const input = requireRecord(value, "Project create");
  return {
    name: requireString(input.name, "name"),
    primaryWorkspaceKey: requireWorkspaceKey(input.primaryWorkspaceKey),
    localWorkspaceId: optionalString(input.localWorkspaceId, "localWorkspaceId")
  };
}

function parseProjectGet(value: unknown): BrainProjectGetInput {
  const input = requireRecord(value, "Project");
  return { projectId: requireString(input.projectId, "projectId") };
}

function parseGameUnrealTemplateCreate(value: unknown): BrainGameUnrealTemplateCreateInput {
  const input = requireRecord(value, "Unreal template");
  rejectUnexpectedKeys(input, ["projectId", "projectName", "engineAssociation"], "Unreal template");
  return {
    projectId: requireString(input.projectId, "projectId"),
    projectName: optionalString(input.projectName, "projectName"),
    engineAssociation: optionalString(input.engineAssociation, "engineAssociation")
  };
}

const gameDesignSectionKeys = ["design", "world", "level", "combat"] as const;

function loadGameDesignSections(storage: BrainWorkspaceStorage, ownerId: string, projectId: string) {
  return gameDesignSectionKeys.map((sectionKey) => {
    const section = storage.getWorkspaceSection({ ownerId, projectId, workspaceKey: "game", sectionKey });
    return { sectionKey, content: section.content, revision: section.revision };
  });
}

function parseWorkspaceSectionGet(value: unknown): BrainWorkspaceSectionGetInput {
  const input = requireRecord(value, "Workspace section");
  rejectUnexpectedKeys(input, ["projectId", "workspaceKey", "sectionKey"], "Workspace section");
  return {
    projectId: requireString(input.projectId, "projectId"),
    workspaceKey: requireWorkspaceKey(input.workspaceKey),
    sectionKey: requireString(input.sectionKey, "sectionKey")
  };
}

function parseWorkspaceSectionSave(value: unknown): BrainWorkspaceSectionSaveInput {
  const input = requireRecord(value, "Workspace section save");
  rejectUnexpectedKeys(input, ["projectId", "workspaceKey", "sectionKey", "content", "expectedRevision"], "Workspace section save");
  if (typeof input.content !== "string") throw new TypeError("content must be a string.");
  const expectedRevision = requireFiniteNumber(input.expectedRevision, "expectedRevision");
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new TypeError("expectedRevision must be a non-negative integer.");
  return {
    projectId: requireString(input.projectId, "projectId"),
    workspaceKey: requireWorkspaceKey(input.workspaceKey),
    sectionKey: requireString(input.sectionKey, "sectionKey"),
    content: input.content,
    expectedRevision
  };
}

function parseProjectUpdate(value: unknown): BrainProjectUpdateInput {
  const input = requireRecord(value, "Project update");
  const status = input.status;
  if (status !== undefined && status !== "ACTIVE" && status !== "ARCHIVED") throw new TypeError("status is unsupported.");
  return {
    projectId: requireString(input.projectId, "projectId"), name: optionalString(input.name, "name"), status,
    localWorkspaceId: optionalString(input.localWorkspaceId, "localWorkspaceId")
  };
}

function parseProjectWorkspace(value: unknown): BrainProjectWorkspaceInput {
  const input = requireRecord(value, "Project workspace");
  if (typeof input.enabled !== "boolean") throw new TypeError("enabled must be boolean.");
  return {
    projectId: requireString(input.projectId, "projectId"),
    workspaceKey: requireWorkspaceKey(input.workspaceKey),
    enabled: input.enabled
  };
}

function parseConversationCreate(value: unknown): BrainConversationCreateInput {
  const input = requireRecord(value, "Conversation create");
  return {
    projectId: requireString(input.projectId, "projectId"),
    title: requireString(input.title, "title"),
    workspaceKey: optionalWorkspaceKey(input.workspaceKey)
  };
}

function parseConversationList(value: unknown): BrainConversationListInput {
  const input = optionalRecord(value, "Conversation list");
  if (input.includeArchived !== undefined && typeof input.includeArchived !== "boolean") {
    throw new TypeError("includeArchived must be boolean.");
  }
  return {
    projectId: optionalString(input.projectId, "projectId"),
    workspaceKey: optionalWorkspaceKey(input.workspaceKey),
    includeArchived: input.includeArchived === true
  };
}

function parseConversationGet(value: unknown): BrainConversationGetInput {
  const input = requireRecord(value, "Conversation");
  return { conversationId: requireString(input.conversationId, "conversationId") };
}

function parseMessageAppend(value: unknown): BrainMessageAppendInput {
  const input = requireRecord(value, "Message append");
  if (input.role !== "system" && input.role !== "user" && input.role !== "assistant" && input.role !== "tool") {
    throw new TypeError("role is unsupported.");
  }
  return {
    conversationId: requireString(input.conversationId, "conversationId"),
    role: input.role,
    content: typeof input.content === "string" ? input.content : (() => { throw new TypeError("content must be a string."); })(),
    toolCallsJson: input.toolCallsJson === undefined ? undefined : requireString(input.toolCallsJson, "toolCallsJson"),
    sourceRefsJson: input.sourceRefsJson === undefined ? undefined : requireString(input.sourceRefsJson, "sourceRefsJson"),
    requestId: input.requestId === undefined ? undefined : requireString(input.requestId, "requestId")
  };
}

function parseDraftSave(value: unknown): BrainDraftSaveInput {
  const input = requireRecord(value, "Draft save");
  if (typeof input.content !== "string") throw new TypeError("content must be a string.");
  return {
    projectId: requireString(input.projectId, "projectId"),
    conversationId: requireString(input.conversationId, "conversationId"),
    content: input.content
  };
}

function requireFiniteNumber(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${field} must be a finite number.`);
  return value;
}

function parseFileRegister(value: unknown): BrainFileRegisterInput {
  const input = requireRecord(value, "File register");
  return {
    projectId: requireString(input.projectId, "projectId"), logicalName: requireString(input.logicalName, "logicalName"),
    mimeType: requireString(input.mimeType, "mimeType"), sizeBytes: requireFiniteNumber(input.sizeBytes, "sizeBytes"),
    contentHash: requireString(input.contentHash, "contentHash"), storageKey: requireString(input.storageKey, "storageKey"),
    versionNo: input.versionNo === undefined ? undefined : requireFiniteNumber(input.versionNo, "versionNo")
  };
}

function parseTaskCreate(value: unknown): BrainTaskCreateInput {
  const input = requireRecord(value, "Task create");
  return {
    projectId: requireString(input.projectId, "projectId"),
    conversationId: optionalString(input.conversationId, "conversationId"),
    workspaceKey: requireWorkspaceKey(input.workspaceKey), taskType: requireString(input.taskType, "taskType"),
    requestId: optionalString(input.requestId, "requestId"), idempotencyKey: requireString(input.idempotencyKey, "idempotencyKey"),
    maxAttempts: input.maxAttempts === undefined ? undefined : requireFiniteNumber(input.maxAttempts, "maxAttempts"),
    resourceLimitsJson: optionalString(input.resourceLimitsJson, "resourceLimitsJson")
  };
}

function parseTaskUpdate(value: unknown): BrainTaskUpdateInput {
  const input = requireRecord(value, "Task update");
  const statuses = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"];
  if (typeof input.status !== "string" || !statuses.includes(input.status)) throw new TypeError("status is unsupported.");
  return {
    taskId: requireString(input.taskId, "taskId"), status: input.status as BrainTaskUpdateInput["status"],
    progress: input.progress === undefined ? undefined : requireFiniteNumber(input.progress, "progress"),
    errorCode: optionalString(input.errorCode, "errorCode"), errorDetail: optionalString(input.errorDetail, "errorDetail")
  };
}

function parseArtifactRegister(value: unknown): BrainArtifactRegisterInput {
  const input = requireRecord(value, "Artifact register");
  return {
    projectId: requireString(input.projectId, "projectId"), taskId: optionalString(input.taskId, "taskId"),
    sourceFileId: optionalString(input.sourceFileId, "sourceFileId"),
    sourceWorkspaceKey: input.sourceWorkspaceKey === undefined ? undefined : requireWorkspaceKey(String(input.sourceWorkspaceKey)),
    artifactType: requireString(input.artifactType, "artifactType"),
    storageKey: requireString(input.storageKey, "storageKey"), contentHash: requireString(input.contentHash, "contentHash"),
    validationStatus: optionalString(input.validationStatus, "validationStatus")
  };
}

function withoutOwner<T extends { ownerId: string }>(value: T): Omit<T, "ownerId"> {
  const { ownerId: _ownerId, ...safe } = value;
  return safe;
}

export function registerBrainWorkspaceIpcHandlers(dependencies: BrainWorkspaceIpcDependencies): FlowExecutionService | undefined {
  const ownerId = () => Promise.resolve(dependencies.resolveOwnerId()).then((value) => requireString(value, "ownerId"));
  /** Resolve a project's on-disk root, rebinding catalog workspace by name when the stored id is stale. */
  const resolveBoundProjectRoot = async (owner: string, project: { id: string; name: string; localWorkspaceId: string }) => {
    const catalog = dependencies.readWorkspaceCatalog
      ? await dependencies.readWorkspaceCatalog()
      : { workspaces: [] as Array<{ id: string; name: string; path: string }> };
    const workspaces = Array.isArray(catalog.workspaces) ? catalog.workspaces : [];
    if (dependencies.readWorkspaceCatalog) {
      dependencies.storage.importUnboundCatalog({ ownerId: owner, workspaces });
    }
    const tryResolve = (workspaceId: string) => dependencies.resolveWorkspaceRoot(workspaceId);
    const boundId = String(project.localWorkspaceId || "").trim();
    if (boundId) {
      try {
        return await tryResolve(boundId);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "BRAIN_LOCAL_WORKSPACE_NOT_AUTHORIZED") throw error;
      }
    }
    const normalizedName = project.name.trim().toLowerCase();
    const matched = workspaces.find((item) => String(item.name || "").trim().toLowerCase() === normalizedName)
      || workspaces.find((item) => String(item.path || "").replace(/\\/g, "/").toLowerCase().endsWith(`/${normalizedName}`));
    if (!matched?.id) {
      throw new Error(boundId ? "BRAIN_LOCAL_WORKSPACE_NOT_AUTHORIZED" : "BRAIN_LOCAL_WORKSPACE_REQUIRED");
    }
    if (matched.id !== boundId) {
      dependencies.storage.updateProject({ ownerId: owner, projectId: project.id, localWorkspaceId: matched.id });
    }
    return tryResolve(matched.id);
  };
  const revisions = new BrainDocumentRevisionService(dependencies);
  const flowExecution = dependencies.flowExecution ?? (dependencies.confirmFlowApproval ? new FlowExecutionService({
    storage: dependencies.storage,
    confirmApproval: (input) => dependencies.confirmFlowApproval!({ ...input, nodeId: input.node.id }),
    tools: {
      "software.inspect-scripts": { execute: async (_input, _context, binding) => {
        const project = dependencies.storage.getProject(binding.ownerId, binding.projectId);
        if (!project.localWorkspaceId) throw new Error("BRAIN_LOCAL_WORKSPACE_REQUIRED");
        return discoverSoftwareScripts(await dependencies.resolveWorkspaceRoot(project.localWorkspaceId));
      } },
      "software.delay": { execute: async (input, _context, binding) => {
        const milliseconds = typeof input === "number" ? input : (input && typeof input === "object" && "milliseconds" in input ? Number((input as { milliseconds?: unknown }).milliseconds) : NaN);
        if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > 30_000) throw new Error("FLOW_DELAY_INPUT_INVALID");
        if (binding.signal.aborted) throw binding.signal.reason ?? new Error("BRAIN_FLOW_CANCELLED");
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, milliseconds);
          const abort = () => { clearTimeout(timer); reject(binding.signal.reason ?? new Error("BRAIN_FLOW_CANCELLED")); };
          binding.signal.addEventListener("abort", abort, { once: true });
        });
        return { delayedMs: milliseconds };
      } }
    }
  }) : null);
  const gameRuntime = dependencies.acquireRustCore
    ? new GameRuntimeService((binding) => dependencies.acquireRustCore!(binding) as any)
    : null;
  const videoRuntime = dependencies.acquireRustCore
    ? new VideoRuntimeService((binding) => dependencies.acquireRustCore!(binding) as any)
    : null;
  const musicRuntime = dependencies.acquireRustCore
    ? new MusicRuntimeService((binding) => dependencies.acquireRustCore!(binding) as any)
    : null;
  const dataRuntime = dependencies.acquireRustCore
    ? new DataRuntimeService((binding) => dependencies.acquireRustCore!(binding) as any)
    : null;
  const gamePreviews = dependencies.acquireRustCore && dependencies.confirmGamePreview
    ? new GamePreviewService({
      storage: dependencies.storage,
      resolveWorkspaceRoot: dependencies.resolveWorkspaceRoot,
      acquireRustCore: dependencies.acquireRustCore,
      confirmStart: dependencies.confirmGamePreview,
      inspectProject: inspectGameProject,
      platform: dependencies.platform
    })
    : null;
  const softwareTasks = dependencies.acquireRustCore && dependencies.confirmSoftwareTask
    ? new SoftwareTaskService({ storage: dependencies.storage, resolveWorkspaceRoot: dependencies.resolveWorkspaceRoot, acquireRustCore: dependencies.acquireRustCore as any, confirmRun: dependencies.confirmSoftwareTask, platform: dependencies.platform })
    : null;
  if (gamePreviews || softwareTasks || dependencies.videoRender || dependencies.musicRender) {
    // Reconcile game preview tasks before rebuilding the broader workspace state.
    // The storage operation is idempotent; restoreWorkspaceAfterRestart also covers
    // the aggregate recovery path used by non-game task owners.
    if (gamePreviews) dependencies.storage.reconcileInterruptedGamePreviews();
    dependencies.storage.restoreWorkspaceAfterRestart();
  }
  dependencies.storage.pruneRetention();
  ipcMain.handle(brainWorkspaceIpcChannels.workspaceList, async () => {
    if (dependencies.readWorkspaceCatalog) {
      try {
        const catalog = await dependencies.readWorkspaceCatalog();
        dependencies.storage.importUnboundCatalog({
          ownerId: await ownerId(),
          workspaces: catalog.workspaces || []
        });
      } catch {
        // Catalog import must not block listing workspace types. Cross-owner
        // legacy conversation ids are handled inside importUnboundCatalog.
      }
    }
    return dependencies.storage.listWorkspaces();
  });
  ipcMain.handle(brainWorkspaceIpcChannels.projectList, async (_event, value: unknown) =>
    dependencies.storage.listProjects({ ownerId: await ownerId(), ...parseProjectList(value) }).map(withoutOwner));
  ipcMain.handle(brainWorkspaceIpcChannels.projectCreate, async (_event, value: unknown) => {
    const input = parseProjectCreate(value);
    if (input.localWorkspaceId) await dependencies.resolveWorkspaceRoot(input.localWorkspaceId);
    return withoutOwner(dependencies.storage.createProject({ ownerId: await ownerId(), ...input }));
  });
  ipcMain.handle(brainWorkspaceIpcChannels.projectGet, async (_event, value: unknown) =>
    withoutOwner(dependencies.storage.getProject(await ownerId(), parseProjectGet(value).projectId)));
  ipcMain.handle(brainWorkspaceIpcChannels.projectUpdate, async (_event, value: unknown) => {
    const input = parseProjectUpdate(value);
    if (input.localWorkspaceId) await dependencies.resolveWorkspaceRoot(input.localWorkspaceId);
    return withoutOwner(dependencies.storage.updateProject({ ownerId: await ownerId(), ...input }));
  });
  ipcMain.handle(brainWorkspaceIpcChannels.projectWorkspaceEnable, async (_event, value: unknown) => {
    dependencies.storage.setProjectWorkspace({ ownerId: await ownerId(), ...parseProjectWorkspace(value) });
    return { ok: true };
  });
  ipcMain.handle(brainWorkspaceIpcChannels.workspaceSectionGet, async (_event, value: unknown) =>
    dependencies.storage.getWorkspaceSection({ ownerId: await ownerId(), ...parseWorkspaceSectionGet(value) }));
  ipcMain.handle(brainWorkspaceIpcChannels.workspaceSectionSave, async (_event, value: unknown) =>
    dependencies.storage.saveWorkspaceSection({ ownerId: await ownerId(), ...parseWorkspaceSectionSave(value) }));
  ipcMain.handle(brainWorkspaceIpcChannels.conversationCreate, async (_event, value: unknown) =>
    withoutOwner(dependencies.storage.createConversation({ ownerId: await ownerId(), ...parseConversationCreate(value) })));
  ipcMain.handle(brainWorkspaceIpcChannels.conversationList, async (_event, value: unknown) =>
    dependencies.storage.listConversations({ ownerId: await ownerId(), ...parseConversationList(value) }).map(withoutOwner));
  ipcMain.handle(brainWorkspaceIpcChannels.conversationGet, async (_event, value: unknown) =>
    withoutOwner(dependencies.storage.getConversation(await ownerId(), parseConversationGet(value).conversationId)));
  ipcMain.handle(brainWorkspaceIpcChannels.messageList, async (_event, value: unknown) => {
    const input = parseConversationGet(value);
    return dependencies.storage.listMessages(await ownerId(), input.conversationId);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.messageAppend, async (_event, value: unknown) => {
    const input = parseMessageAppend(value);
    return dependencies.storage.appendMessage({
      ownerId: await ownerId(),
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      toolCallsJson: input.toolCallsJson ?? "[]",
      sourceRefsJson: input.sourceRefsJson ?? "[]",
      requestId: input.requestId ?? ""
    });
  });
  const rustConversation = dependencies.rustConversation;
  if (rustConversation) {
    ipcMain.handle(brainWorkspaceIpcChannels.rustConversation, async (_event, value: unknown) => {
      const input = requireRecord(value, "Rust conversation");
      const projectId = requireString(input.projectId, "projectId");
      const project = dependencies.storage.getProject(await ownerId(), projectId);
      if (!project.localWorkspaceId) throw new Error("BRAIN_LOCAL_WORKSPACE_REQUIRED");
      const projectRoot = await dependencies.resolveWorkspaceRoot(project.localWorkspaceId);
      return rustConversation({ projectId, projectRoot, workspaceType: requireString(input.workspaceType, "workspaceType"), operation: requireString(input.operation, "operation") as `conversation.${string}`, payload: requireRecord(input.payload, "payload") });
    });
  }
  ipcMain.handle(brainWorkspaceIpcChannels.draftGet, async (_event, value: unknown) => {
    const input = parseConversationGet(value);
    return dependencies.storage.readDraft(await ownerId(), input.conversationId);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.draftSave, async (_event, value: unknown) => {
    dependencies.storage.saveDraft({ ownerId: await ownerId(), ...parseDraftSave(value) });
    return { ok: true };
  });
  ipcMain.handle(brainWorkspaceIpcChannels.fileList, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    return dependencies.storage.listFiles(await ownerId(), input.projectId).map(withoutOwner);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.fileRegister, async (_event, value: unknown) =>
    withoutOwner(dependencies.storage.registerFile({ ownerId: await ownerId(), ...parseFileRegister(value) })));
  if (dependencies.ingestDocument) {
    ipcMain.handle(brainWorkspaceIpcChannels.fileIngest, async (_event, value: unknown) => {
      const input = requireRecord(value, "File ingest");
      const projectId = requireString(input.projectId, "projectId");
      const fileId = requireString(input.fileId, "fileId");
      const owner = await ownerId();
      const project = dependencies.storage.getProject(owner, projectId);
      if (!project.localWorkspaceId) throw new Error("BRAIN_LOCAL_WORKSPACE_REQUIRED");
      const file = dependencies.storage.getFile(owner, projectId, fileId);
      const projectRoot = await dependencies.resolveWorkspaceRoot(project.localWorkspaceId);
      const requestedMax = input.maxBytes === undefined ? 5 * 1024 * 1024 : requireFiniteNumber(input.maxBytes, "maxBytes");
      const maxBytes = Math.min(Math.max(Math.floor(requestedMax), 1), 20 * 1024 * 1024);
      const result = await dependencies.ingestDocument({ requestId: `brain-document-${randomUUID()}`, projectRoot, relativePath: file.storageKey, maxBytes });
      if (result.status !== "completed" || !result.format || result.text === undefined || !result.anchors || !result.warnings) {
        throw new Error(result.error_code || "BRAIN_DOCUMENT_INGEST_FAILED");
      }
      dependencies.storage.recordFileIngestResult({
        ownerId: owner, projectId, fileId, format: result.format, text: result.text,
        anchors: result.anchors, warnings: result.warnings
      });
      return { format: result.format, text: result.text, anchors: result.anchors, warnings: result.warnings };
    });
  }
  ipcMain.handle(brainWorkspaceIpcChannels.taskList, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    return dependencies.storage.listTasks(await ownerId(), input.projectId);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.taskCreate, async (_event, value: unknown) =>
    dependencies.storage.createTask({ ownerId: await ownerId(), ...parseTaskCreate(value) }));
  ipcMain.handle(brainWorkspaceIpcChannels.taskUpdate, async (_event, value: unknown) =>
    dependencies.storage.updateTask({ ownerId: await ownerId(), ...parseTaskUpdate(value) }));
  ipcMain.handle(brainWorkspaceIpcChannels.artifactList, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    return dependencies.storage.listArtifacts(await ownerId(), input.projectId);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.artifactRegister, async (_event, value: unknown) =>
    dependencies.storage.registerArtifact({ ownerId: await ownerId(), ...parseArtifactRegister(value) }));
  ipcMain.handle(brainWorkspaceIpcChannels.gameProjectInspect, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    const owner = await ownerId();
    const project = dependencies.storage.getProject(owner, input.projectId);
    const gameProjects = dependencies.storage.listProjects({ ownerId: owner, workspaceKey: "game", includeArchived: false });
    if (!gameProjects.some((candidate) => candidate.id === project.id)) throw new Error("BRAIN_GAME_WORKSPACE_REQUIRED");
    if (!project.localWorkspaceId) throw new Error("BRAIN_LOCAL_WORKSPACE_REQUIRED");
    const projectRoot = await dependencies.resolveWorkspaceRoot(project.localWorkspaceId);
    if (gameRuntime) {
      const core = await gameRuntime.inspect({ projectId: project.id, projectRoot });
      const legacy = await inspectGameProject(projectRoot).catch(() => null);
      return {
        schemaVersion: 1 as const,
        engine: core.engine,
        displayName: core.displayName,
        markers: core.markers,
        assets: core.assets,
        preview: legacy?.preview ?? { supported: false, requiresApproval: true },
        warnings: legacy?.warnings ?? (core.engine === "unreal" ? ["未配置可验证的 Unreal Editor，暂不生成试玩命令。"] : []),
        scannedEntries: core.scannedEntries,
        skippedEntries: legacy?.skippedEntries ?? 0,
        truncated: core.truncated
      };
    }
    if (dependencies.ensureEngine) {
      try {
        const { readdir } = await import("node:fs/promises");
        const entries = await readdir(projectRoot, { withFileTypes: true });
        const hasUproject = entries.some((entry) => entry.isFile() && entry.name.endsWith(".uproject"));
        const hasGodot = entries.some((entry) => entry.isFile() && entry.name === "project.godot");
        const hasWeb = entries.some((entry) => entry.isFile() && entry.name === "package.json");
        if (hasUproject) await dependencies.ensureEngine("epic-launcher").catch(() => undefined);
        if (hasGodot) {
          const resolved = await dependencies.ensureEngine("godot").catch(() => null);
          if (resolved?.executable) process.env.BRAIN_GODOT_EXECUTABLE = resolved.executable;
        }
        if (hasWeb) await dependencies.ensureEngine("node").catch(() => undefined);
      } catch { /* inspection still proceeds */ }
    }
    return inspectGameProject(projectRoot);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.filePreviewUrl, async (_event, value: unknown) => {
    const input = requireRecord(value, "File preview url");
    rejectUnexpectedKeys(input, ["projectId", "fileId"], "File preview url");
    const owner = await ownerId();
    const project = dependencies.storage.getProject(owner, requireString(input.projectId, "projectId"));
    if (!project.localWorkspaceId) throw new Error("BRAIN_LOCAL_WORKSPACE_REQUIRED");
    const file = dependencies.storage.getFile(owner, project.id, requireString(input.fileId, "fileId"));
    return buildWorkspaceArtifactPreviewUrl(project.localWorkspaceId, file.storageKey);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.mediaImport, async (_event, value: unknown) => {
    const input = requireRecord(value, "Media import");
    rejectUnexpectedKeys(
      input,
      ["projectId", "sourcePath", "fileName", "mimeType", "bytesBase64", "folder"],
      "Media import"
    );
    const owner = await ownerId();
    const project = dependencies.storage.getProject(owner, requireString(input.projectId, "projectId"));
    if (!project.localWorkspaceId) throw new Error("BRAIN_LOCAL_WORKSPACE_REQUIRED");
    const projectRoot = await dependencies.resolveWorkspaceRoot(project.localWorkspaceId);
    const folderRaw = input.folder === undefined ? "imports" : requireString(input.folder, "folder");
    if (folderRaw !== "imports" && folderRaw !== "audio" && folderRaw !== "clips" && folderRaw !== "refs") {
      throw new TypeError("folder must be imports, audio, clips, or refs.");
    }
    return importProjectMediaFile({
      projectRoot,
      ownerId: owner,
      projectId: project.id,
      storage: dependencies.storage,
      sourcePath: input.sourcePath === undefined ? undefined : requireString(input.sourcePath, "sourcePath"),
      fileName: input.fileName === undefined ? undefined : requireString(input.fileName, "fileName"),
      mimeType: input.mimeType === undefined ? undefined : requireString(input.mimeType, "mimeType"),
      bytesBase64: input.bytesBase64 === undefined ? undefined : requireString(input.bytesBase64, "bytesBase64"),
      folder: folderRaw as "imports" | "audio" | "clips" | "refs"
    });
  });
  ipcMain.handle(brainWorkspaceIpcChannels.mediaPeel, async (_event, value: unknown) => {
    const input = requireRecord(value, "Media peel");
    rejectUnexpectedKeys(input, ["projectId", "relativePath", "fileId", "mode"], "Media peel");
    const modeRaw = input.mode === undefined ? "unlink" : requireString(input.mode, "mode");
    if (modeRaw !== "unlink" && modeRaw !== "probe") {
      throw new TypeError("mode must be unlink or probe.");
    }
    const owner = await ownerId();
    const project = dependencies.storage.getProject(owner, requireString(input.projectId, "projectId"));
    if (!project.localWorkspaceId) throw new Error("BRAIN_LOCAL_WORKSPACE_REQUIRED");
    const projectRoot = await dependencies.resolveWorkspaceRoot(project.localWorkspaceId);
    let relativePath = input.relativePath === undefined ? "" : requireString(input.relativePath, "relativePath").replaceAll("\\", "/");
    if (!relativePath && input.fileId !== undefined) {
      const file = dependencies.storage.getFile(owner, project.id, requireString(input.fileId, "fileId"));
      relativePath = String(file.storageKey || "").replaceAll("\\", "/");
    }
    if (!relativePath) throw new TypeError("relativePath or fileId is required.");
    const absolute = resolve(projectRoot, relativePath);
    const rootBoundary = projectRoot.endsWith(sep) ? projectRoot : `${projectRoot}${sep}`;
    if (!absolute.startsWith(rootBoundary) && absolute !== projectRoot) throw new Error("BRAIN_MEDIA_PATH_INVALID");

    const ffmpeg = dependencies.ensureEngine
      ? await dependencies.ensureEngine("ffmpeg")
      : { executable: process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg" };
    const ffprobe = dependencies.ensureEngine
      ? await dependencies.ensureEngine("ffprobe")
      : { executable: process.platform === "win32" ? "ffprobe.exe" : "ffprobe" };
    const deps = {
      ffmpegExecutable: String(ffmpeg.executable || "ffmpeg"),
      ffprobeExecutable: String(ffprobe.executable || "ffprobe")
    };

    if (modeRaw === "probe") {
      const probe = await probeMediaAv(absolute, deps);
      return { ok: true, mode: "probe", relativePath, ...probe };
    }

    const peeled = await peelMediaAv({
      projectRoot,
      sourceAbsolutePath: absolute,
      sourceRelativePath: relativePath,
      logicalName: basename(relativePath)
    }, deps);

    const registerPeeled = (opts: {
      relativePath: string;
      bytes: Buffer;
      kind: "video" | "audio";
      logicalName: string;
      mimeType: string;
    }) => {
      const existing = dependencies.storage.listFiles(owner, project.id).find((file) => file.storageKey === opts.relativePath);
      const file = existing || dependencies.storage.registerFile({
        ownerId: owner,
        projectId: project.id,
        logicalName: opts.logicalName,
        mimeType: opts.mimeType,
        sizeBytes: opts.bytes.length,
        contentHash: contentHashHex(opts.bytes),
        storageKey: opts.relativePath
      });
      return { file: withoutOwner(file), relativePath: opts.relativePath, kind: opts.kind, mimeType: opts.mimeType };
    };

    const video = peeled.videoRelativePath && peeled.videoBytes
      ? registerPeeled({
        relativePath: peeled.videoRelativePath,
        bytes: peeled.videoBytes,
        kind: "video",
        logicalName: basename(peeled.videoRelativePath),
        mimeType: "video/mp4"
      })
      : null;
    const audioExt = peeled.audioExt || ".wav";
    if (peeled.audioRelativePath && /\.mp4$/i.test(peeled.audioRelativePath)) {
      throw new Error(`BRAIN_MEDIA_PEEL_AUDIO_BAD_EXT:${peeled.audioRelativePath}`);
    }
    const audio = peeled.audioRelativePath && peeled.audioBytes
      ? registerPeeled({
        relativePath: peeled.audioRelativePath,
        bytes: peeled.audioBytes,
        kind: "audio",
        logicalName: basename(peeled.audioRelativePath),
        mimeType: audioExt === ".m4a" ? "audio/mp4" : audioExt === ".wav" ? "audio/wav" : "audio/mpeg"
      })
      : null;

    return {
      ok: true,
      mode: "unlink",
      relativePath,
      hasVideo: peeled.hasVideo,
      hasAudio: peeled.hasAudio,
      durationSec: peeled.durationSec,
      video,
      audio
    };
  });
  if (gamePreviews) {
    ipcMain.handle(brainWorkspaceIpcChannels.gamePreviewStart, async (_event, value: unknown) =>
      gamePreviews.start(await ownerId(), parseGamePreviewStart(value)));
    ipcMain.handle(brainWorkspaceIpcChannels.gamePreviewStatus, async (_event, value: unknown) =>
      gamePreviews.status(await ownerId(), parseGamePreviewProject(value).projectId));
    ipcMain.handle(brainWorkspaceIpcChannels.gamePreviewStop, async (_event, value: unknown) =>
      gamePreviews.stop(await ownerId(), parseGamePreviewProject(value).projectId));
  }
  ipcMain.handle(brainWorkspaceIpcChannels.gameWebTemplateCreate, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    const owner = await ownerId();
    const project = dependencies.storage.getProject(owner, input.projectId);
    const projectRoot = await resolveBoundProjectRoot(owner, project);
    if (!gameRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    return gameRuntime.scaffoldWeb({ projectId: project.id, projectRoot });
  });
  ipcMain.handle(brainWorkspaceIpcChannels.gameUnrealTemplateCreate, async (_event, value: unknown) => {
    const input = parseGameUnrealTemplateCreate(value);
    const owner = await ownerId();
    const project = dependencies.storage.getProject(owner, input.projectId);
    const projectRoot = await resolveBoundProjectRoot(owner, project);
    if (!gameRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    const sections = loadGameDesignSections(dependencies.storage, owner, project.id).map((section) => ({
      sectionKey: section.sectionKey as "design" | "world" | "level" | "combat",
      content: section.content,
      revision: section.revision
    }));
    return gameRuntime.scaffoldUnreal(
      { projectId: project.id, projectRoot },
      {
        projectName: input.projectName || project.name,
        engineAssociation: input.engineAssociation,
        sections,
        runCook: true
      }
    );
  });
  ipcMain.handle(brainWorkspaceIpcChannels.gameDesignExport, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    const owner = await ownerId();
    const project = dependencies.storage.getProject(owner, input.projectId);
    const projectRoot = await resolveBoundProjectRoot(owner, project);
    if (!gameRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    const sections = loadGameDesignSections(dependencies.storage, owner, project.id).map((section) => ({
      sectionKey: section.sectionKey as "design" | "world" | "level" | "combat",
      content: section.content,
      revision: section.revision
    }));
    return gameRuntime.cook({ projectId: project.id, projectRoot }, { sections });
  });
  ipcMain.handle(brainWorkspaceIpcChannels.gameLevelEditorGet, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    const owner = await ownerId();
    const project = dependencies.storage.getProject(owner, input.projectId);
    const projectRoot = await resolveBoundProjectRoot(owner, project);
    if (!gameRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    return gameRuntime.levelEditorGet({ projectId: project.id, projectRoot });
  });
  ipcMain.handle(brainWorkspaceIpcChannels.gameLevelEditorSave, async (_event, value: unknown) => {
    const input = requireRecord(value, "Game level editor save");
    rejectUnexpectedKeys(input, ["projectId", "state"], "Game level editor save");
    const owner = await ownerId();
    const project = dependencies.storage.getProject(owner, requireString(input.projectId, "projectId"));
    const projectRoot = await resolveBoundProjectRoot(owner, project);
    if (!gameRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    const state = requireRecord(input.state, "state");
    return gameRuntime.levelEditorSave({ projectId: project.id, projectRoot }, state as any);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.gameSpawnActor, async (_event, value: unknown) => {
    const input = requireRecord(value, "Game spawn actor");
    rejectUnexpectedKeys(input, ["projectId", "kind", "levelIndex"], "Game spawn actor");
    const kind = requireString(input.kind, "kind");
    if (kind !== "enemy" && kind !== "boss" && kind !== "npc") throw new TypeError("kind is unsupported.");
    const owner = await ownerId();
    const project = dependencies.storage.getProject(owner, requireString(input.projectId, "projectId"));
    const projectRoot = await resolveBoundProjectRoot(owner, project);
    if (!gameRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    const levelIndex = input.levelIndex == null ? 0 : Number(input.levelIndex);
    if (!Number.isInteger(levelIndex) || levelIndex < 0) throw new TypeError("levelIndex is invalid.");
    return gameRuntime.spawnActor({ projectId: project.id, projectRoot }, { kind, levelIndex });
  });
  ipcMain.handle(brainWorkspaceIpcChannels.gameContentTree, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    const owner = await ownerId();
    const project = dependencies.storage.getProject(owner, input.projectId);
    const projectRoot = await resolveBoundProjectRoot(owner, project);
    if (!gameRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    return gameRuntime.contentTree({ projectId: project.id, projectRoot });
  });
  const resolveRuntimeBinding = async (value: unknown, label: string) => {
    const input = requireRecord(value, label);
    const owner = await ownerId();
    const project = dependencies.storage.getProject(owner, requireString(input.projectId, "projectId"));
    return {
      input,
      binding: {
        projectId: project.id,
        projectRoot: await resolveBoundProjectRoot(owner, project)
      }
    };
  };
  ipcMain.handle(brainWorkspaceIpcChannels.videoPipelineGet, async (_event, value: unknown) => {
    const { input, binding } = await resolveRuntimeBinding(value, "Video pipeline get");
    rejectUnexpectedKeys(input, ["projectId"], "Video pipeline get");
    if (!videoRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    return videoRuntime.pipelineGet(binding);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.videoPipelineSave, async (_event, value: unknown) => {
    const { input, binding } = await resolveRuntimeBinding(value, "Video pipeline save");
    rejectUnexpectedKeys(input, ["projectId", "state"], "Video pipeline save");
    if (!videoRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    return videoRuntime.pipelineSave(binding, requireRecord(input.state, "state") as any);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.videoMarkShot, async (_event, value: unknown) => {
    const { input, binding } = await resolveRuntimeBinding(value, "Video mark shot");
    rejectUnexpectedKeys(input, ["projectId", "shotIndex", "ready"], "Video mark shot");
    const shotIndex = requireFiniteNumber(input.shotIndex, "shotIndex");
    if (!Number.isInteger(shotIndex) || shotIndex < 0) throw new TypeError("shotIndex must be a non-negative integer.");
    if (typeof input.ready !== "boolean") throw new TypeError("ready must be boolean.");
    if (!videoRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    return videoRuntime.markShot(binding, shotIndex, input.ready);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.videoPipelineCook, async (_event, value: unknown) => {
    const { input, binding } = await resolveRuntimeBinding(value, "Video pipeline cook");
    rejectUnexpectedKeys(input, ["projectId"], "Video pipeline cook");
    if (!videoRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    return videoRuntime.cook(binding);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.musicDawGet, async (_event, value: unknown) => {
    const { input, binding } = await resolveRuntimeBinding(value, "Music DAW get");
    rejectUnexpectedKeys(input, ["projectId"], "Music DAW get");
    if (!musicRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    return musicRuntime.dawGet(binding);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.musicDawSave, async (_event, value: unknown) => {
    const { input, binding } = await resolveRuntimeBinding(value, "Music DAW save");
    rejectUnexpectedKeys(input, ["projectId", "state"], "Music DAW save");
    if (!musicRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    return musicRuntime.dawSave(binding, requireRecord(input.state, "state") as any);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.musicDawCook, async (_event, value: unknown) => {
    const { input, binding } = await resolveRuntimeBinding(value, "Music DAW cook");
    rejectUnexpectedKeys(input, ["projectId"], "Music DAW cook");
    if (!musicRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    return musicRuntime.cook(binding);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.dataAnalysisGet, async (_event, value: unknown) => {
    const { input, binding } = await resolveRuntimeBinding(value, "Data analysis get");
    rejectUnexpectedKeys(input, ["projectId"], "Data analysis get");
    if (!dataRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    return dataRuntime.analysisGet(binding);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.dataAnalysisSave, async (_event, value: unknown) => {
    const { input, binding } = await resolveRuntimeBinding(value, "Data analysis save");
    rejectUnexpectedKeys(input, ["projectId", "state"], "Data analysis save");
    if (!dataRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    return dataRuntime.analysisSave(binding, requireRecord(input.state, "state") as any);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.dataAnalysisCook, async (_event, value: unknown) => {
    const { input, binding } = await resolveRuntimeBinding(value, "Data analysis cook");
    rejectUnexpectedKeys(input, ["projectId"], "Data analysis cook");
    if (!dataRuntime) throw new Error("BRAIN_CORE_REQUIRED");
    return dataRuntime.cook(binding);
  });
  if (dependencies.discoverEngines) {
    ipcMain.handle(brainWorkspaceIpcChannels.environmentDiscover, async () => dependencies.discoverEngines!());
  }
  if (dependencies.ensureEngine) {
    ipcMain.handle(brainWorkspaceIpcChannels.environmentEnsure, async (_event, value: unknown) => {
      const input = requireRecord(value, "Environment ensure");
      return dependencies.ensureEngine!(requireString(input.engineId, "engineId"));
    });
  }
  if (dependencies.ensureEnginesForScene) {
    ipcMain.handle(brainWorkspaceIpcChannels.environmentEnsureScene, async (_event, value: unknown) => {
      const input = requireRecord(value, "Environment ensure scene");
      rejectUnexpectedKeys(input, ["workspaceKey"], "Environment ensure scene");
      const workspaceKey = requireString(input.workspaceKey, "workspaceKey") as BrainWorkspaceKey;
      if (!brainWorkspaceKeys.includes(workspaceKey)) throw new TypeError("workspaceKey is unsupported.");
      return dependencies.ensureEnginesForScene!(workspaceKey);
    });
  }
  if (dependencies.video) {
    ipcMain.handle(brainWorkspaceIpcChannels.videoTimelineGet, async (_event, value: unknown) => {
      const input = parseVideoTimelineProject(value);
      return dependencies.video!.getTimeline(await ownerId(), input.projectId);
    });
    ipcMain.handle(brainWorkspaceIpcChannels.videoTimelineSave, async (_event, value: unknown) => {
      const input = parseVideoTimelineSave(value);
      return dependencies.video!.ensureTimeline(await ownerId(), input.projectId, {
        title: input.title, width: input.width, height: input.height, fps: input.fps
      });
    });
    ipcMain.handle(brainWorkspaceIpcChannels.videoClipAdd, async (_event, value: unknown) => {
      const input = parseVideoClipAdd(value);
      if (input.trackType !== "video" && input.trackType !== "audio" && input.trackType !== "subtitle") {
        throw new TypeError("trackType is unsupported.");
      }
      return dependencies.video!.addClip(await ownerId(), input.projectId, {
        trackType: input.trackType,
        sourceFileId: input.sourceFileId,
        startMs: input.startMs,
        durationMs: input.durationMs,
        sourceInMs: input.sourceInMs,
        volume: input.volume,
        text: input.text
      });
    });
    ipcMain.handle(brainWorkspaceIpcChannels.videoSubtitleImport, async (_event, value: unknown) => {
      const input = requireRecord(value, "Video subtitle import");
      rejectUnexpectedKeys(input, ["projectId", "srt"], "Video subtitle import");
      const owner = await ownerId();
      return dependencies.video!.importSubtitlesFromSrt(
        owner,
        requireString(input.projectId, "projectId"),
        requireString(input.srt, "srt")
      );
    });
    ipcMain.handle(brainWorkspaceIpcChannels.videoSubtitleExport, async (_event, value: unknown) => {
      const input = parseVideoTimelineProject(value);
      return { srt: dependencies.video!.exportSubtitlesToSrt(await ownerId(), input.projectId) };
    });
  }
  if (dependencies.videoRender && dependencies.video) {
    ipcMain.handle(brainWorkspaceIpcChannels.videoRenderStart, async (_event, value: unknown) => {
      const input = parseVideoRenderStart(value);
      const owner = await ownerId();
      const project = dependencies.storage.getProject(owner, input.projectId);
      if (project.primaryWorkspaceKey !== "video") throw new Error("BRAIN_VIDEO_WORKSPACE_REQUIRED");
      if (!project.localWorkspaceId) throw new Error("BRAIN_LOCAL_WORKSPACE_REQUIRED");
      const projectRoot = await dependencies.resolveWorkspaceRoot(project.localWorkspaceId);
      const timeline = dependencies.video!.getTimeline(owner, input.projectId);
      let mediaRelativePaths = input.mediaRelativePaths;
      let allowSyntheticMedia = false;
      let layerClips: Awaited<ReturnType<typeof buildPipelineLayerClips>> | undefined;
      if (input.source === "pipeline") {
        // Pipeline mux uses multi-track layout + transitions + text from pipeline-editor.json.
        allowSyntheticMedia = false;
        if (!videoRuntime) throw new Error("BRAIN_CORE_REQUIRED");
        const pipeline = await videoRuntime.pipelineGet({ projectId: project.id, projectRoot }) as {
          state?: {
            shots?: Array<{ ready?: boolean; clip?: string; audio?: string; transition?: string }>;
            canvas?: { width?: number; height?: number; fps?: number };
            trackEdits?: Record<string, PipelineTrackEdit>;
            lanes?: PipelineLane[];
            textClips?: Array<{ id?: string; trackId?: string; startSec?: number; durationSec?: number; text?: string; fontSize?: number; color?: string; x?: number; y?: number; scale?: number; width?: number }>;
            clipInstances?: Array<{
              id?: string;
              kind?: string;
              shotId?: string;
              relativePath?: string;
              trackId?: string;
              startSec?: number;
              durationSec?: number;
              inSec?: number;
              outSec?: number;
              muted?: boolean;
              volume?: number;
              volumeKeyframes?: Array<{ t?: number; v?: number }>;
            }>;
          };
        };
        const canvas = pipeline.state?.canvas;
        if (canvas?.width && canvas?.height) {
          dependencies.video!.ensureTimeline(owner, input.projectId, {
            title: timeline.title || "视频工程时间线",
            width: Math.max(16, Math.round(Number(canvas.width) || 1920)),
            height: Math.max(16, Math.round(Number(canvas.height) || 1080)),
            fps: Math.max(1, Math.round(Number(canvas.fps) || timeline.fps || 30))
          });
        }
        layerClips = await buildPipelineLayerClips(projectRoot, pipeline.state || {});
        if (!layerClips.some((clip) => clip.trackType === "video")) {
          throw new Error("BRAIN_VIDEO_PIPELINE_CLIPS_MISSING");
        }
        mediaRelativePaths = layerClips
          .filter((clip) => clip.trackType === "video" && clip.relativePath)
          .map((clip) => String(clip.relativePath));
      } else if (!mediaRelativePaths) {
        mediaRelativePaths = timeline.clips
          .filter((clip) => clip.trackType === "video")
          .map((clip) => dependencies.storage.getFile(owner, input.projectId, clip.sourceFileId).storageKey);
      }
      return dependencies.videoRender!.start(owner, {
        projectId: input.projectId,
        projectRoot,
        timeline: dependencies.video!.getTimeline(owner, input.projectId),
        outputRelativePath: input.outputRelativePath,
        mediaRelativePaths: layerClips ? undefined : mediaRelativePaths,
        layerClips,
        allowSyntheticMedia
      });
    });
    ipcMain.handle(brainWorkspaceIpcChannels.videoRenderStatus, async (_event, value: unknown) => {
      const input = requireRecord(value, "Video render status");
      rejectUnexpectedKeys(input, ["renderId"], "Video render status");
      return dependencies.videoRender!.status(await ownerId(), requireString(input.renderId, "renderId"));
    });
    ipcMain.handle(brainWorkspaceIpcChannels.videoRenderCancel, async (_event, value: unknown) => {
      const input = requireRecord(value, "Video render cancel");
      rejectUnexpectedKeys(input, ["renderId"], "Video render cancel");
      return dependencies.videoRender!.cancel(await ownerId(), requireString(input.renderId, "renderId"));
    });
  }
  if (dependencies.runSceneMediaGeneration) {
    ipcMain.handle(brainWorkspaceIpcChannels.sceneMediaGenerate, async (_event, value: unknown) => {
      const input = parseSceneMediaGenerate(value);
      const owner = await ownerId();
      dependencies.storage.getProject(owner, input.projectId);
      return dependencies.runSceneMediaGeneration!(input);
    });
  }
  if (dependencies.music) {
    ipcMain.handle(brainWorkspaceIpcChannels.musicTimelineGet, async (_event, value: unknown) => { const input = parseMusicProject(value); return dependencies.music!.getTimeline(await ownerId(), input.projectId); });
    ipcMain.handle(brainWorkspaceIpcChannels.musicTimelineSave, async (_event, value: unknown) => { const input = parseMusicSave(value); return dependencies.music!.ensureTimeline(await ownerId(), input.projectId, { title: input.title, sampleRate: input.sampleRate, channels: input.channels }); });
    ipcMain.handle(brainWorkspaceIpcChannels.musicClipAdd, async (_event, value: unknown) => { const input = parseMusicClip(value); if (input.trackType !== "audio" && input.trackType !== "midi") throw new TypeError("trackType is unsupported."); return dependencies.music!.addClip(await ownerId(), input.projectId, input); });
    if (dependencies.musicMedia) ipcMain.handle(brainWorkspaceIpcChannels.musicMediaInspect, async (_event, value: unknown) => { const input = requireRecord(value, "Music media inspect"); rejectUnexpectedKeys(input, ["projectId", "sourceFileId"], "Music media inspect"); return dependencies.musicMedia!.inspect(await ownerId(), requireString(input.projectId, "projectId"), requireString(input.sourceFileId, "sourceFileId")); });
    if (dependencies.musicRender) {
      ipcMain.handle(brainWorkspaceIpcChannels.musicRenderStart, async (_event, value: unknown) => {
        const input = requireRecord(value, "Music render start");
        rejectUnexpectedKeys(input, ["projectId", "outputRelativePath"], "Music render start");
        const owner = await ownerId();
        const project = dependencies.storage.getProject(owner, requireString(input.projectId, "projectId"));
        if (!project.localWorkspaceId) throw new Error("BRAIN_LOCAL_WORKSPACE_REQUIRED");
        const timeline = dependencies.music!.getTimeline(owner, project.id);
        const mediaRelativePaths = timeline.clips
          .filter((clip) => clip.trackType === "audio")
          .map((clip) => dependencies.storage.getFile(owner, project.id, clip.sourceFileId).storageKey);
        return dependencies.musicRender!.start(owner, {
          projectId: project.id,
          outputRelativePath: requireString(input.outputRelativePath, "outputRelativePath"),
          artifactType: "mix",
          timeline,
          mediaRelativePaths,
          projectRoot: await dependencies.resolveWorkspaceRoot(project.localWorkspaceId)
        });
      });
      ipcMain.handle(brainWorkspaceIpcChannels.musicRenderStatus, async (_event, value: unknown) => { const input = requireRecord(value, "Music render status"); return dependencies.musicRender!.status(await ownerId(), requireString(input.renderId, "renderId")); });
      ipcMain.handle(brainWorkspaceIpcChannels.musicRenderCancel, async (_event, value: unknown) => { const input = requireRecord(value, "Music render cancel"); return dependencies.musicRender!.cancel(await ownerId(), requireString(input.renderId, "renderId")); });
    }
  }
  ipcMain.handle(brainWorkspaceIpcChannels.dataDatasetList, async (_event, value: unknown) => { const input = parseProjectGet(value); return dependencies.storage.listDatasets(await ownerId(), input.projectId); });
  ipcMain.handle(brainWorkspaceIpcChannels.dataDatasetSave, async (_event, value: unknown) => { const dataset = parseDataset(value); return dependencies.storage.saveDataset({ ownerId: await ownerId(), dataset }); });
  if (dependencies.dataAnalysis) {
    ipcMain.handle(brainWorkspaceIpcChannels.dataAnalysisSummarize, async (_event, value: unknown) => { const input = requireRecord(value, "Data analysis summarize"); rejectUnexpectedKeys(input, ["projectId", "datasetId"], "Data analysis summarize"); return dependencies.dataAnalysis!.summarize(await ownerId(), requireString(input.projectId, "projectId"), requireString(input.datasetId, "datasetId")); });
    ipcMain.handle(brainWorkspaceIpcChannels.dataAnalysisAggregate, async (_event, value: unknown) => {
      const input = requireRecord(value, "Data analysis aggregate");
      rejectUnexpectedKeys(input, ["projectId", "datasetId", "groupBy", "metrics", "topN", "orderBy", "periodColumn", "compareMetric"], "Data analysis aggregate");
      const groupBy = Array.isArray(input.groupBy) ? input.groupBy.map((item) => requireString(item, "groupBy")) : [];
      const metrics = Array.isArray(input.metrics) ? input.metrics.map((item) => {
        const metric = requireRecord(item, "metric");
        rejectUnexpectedKeys(metric, ["column", "operation", "as"], "metric");
        const operation = requireString(metric.operation, "operation");
        if (!["sum", "count", "avg", "min", "max"].includes(operation)) throw new TypeError("metric.operation is unsupported.");
        return { column: requireString(metric.column, "column"), operation: operation as "sum" | "count" | "avg" | "min" | "max", ...(metric.as === undefined ? {} : { as: requireString(metric.as, "as") }) };
      }) : [];
      const orderBy = input.orderBy === undefined ? undefined : (() => {
        const ordering = requireRecord(input.orderBy, "orderBy");
        rejectUnexpectedKeys(ordering, ["metric", "direction"], "orderBy");
        const direction = requireString(ordering.direction, "direction");
        if (direction !== "asc" && direction !== "desc") throw new TypeError("orderBy.direction is unsupported.");
        return { metric: requireString(ordering.metric, "metric"), direction };
      })();
      return dependencies.dataAnalysis!.aggregate(await ownerId(), requireString(input.projectId, "projectId"), requireString(input.datasetId, "datasetId"), {
        groupBy,
        metrics,
        ...(typeof input.topN === "number" ? { topN: input.topN } : {}),
        ...(orderBy ? { orderBy } : {}),
        ...(input.periodColumn === undefined ? {} : { periodColumn: requireString(input.periodColumn, "periodColumn") }),
        ...(input.compareMetric === undefined ? {} : { compareMetric: requireString(input.compareMetric, "compareMetric") })
      });
    });
    ipcMain.handle(brainWorkspaceIpcChannels.dataAnalysisList, async (_event, value: unknown) => { const input = requireRecord(value, "Data analysis list"); rejectUnexpectedKeys(input, ["projectId", "datasetId"], "Data analysis list"); return dependencies.dataAnalysis!.list(await ownerId(), requireString(input.projectId, "projectId"), requireString(input.datasetId, "datasetId")); });
  }
  ipcMain.handle(brainWorkspaceIpcChannels.softwareScriptsList, async (_event, value: unknown) => { const input = parseProjectGet(value); const owner = await ownerId(); const project = dependencies.storage.getProject(owner, input.projectId); if (project.primaryWorkspaceKey !== "software") throw new Error("BRAIN_SOFTWARE_WORKSPACE_REQUIRED"); if (!project.localWorkspaceId) throw new Error("BRAIN_LOCAL_WORKSPACE_REQUIRED"); const root = await dependencies.resolveWorkspaceRoot(project.localWorkspaceId); return discoverSoftwareScripts(root); });
  if (softwareTasks) {
    ipcMain.handle(brainWorkspaceIpcChannels.softwareTaskStart, async (_event, value: unknown) => { const input = requireRecord(value, "Software task start"); rejectUnexpectedKeys(input, ["projectId", "scriptId", "conversationId"], "Software task start"); return softwareTasks.start(await ownerId(), { projectId: requireString(input.projectId, "projectId"), scriptId: requireString(input.scriptId, "scriptId"), conversationId: optionalString(input.conversationId, "conversationId") }); });
    ipcMain.handle(brainWorkspaceIpcChannels.softwareTaskStatus, async (_event, value: unknown) => { const input = requireRecord(value, "Software task status"); rejectUnexpectedKeys(input, ["taskId"], "Software task status"); return softwareTasks.status(await ownerId(), requireString(input.taskId, "taskId")); });
    ipcMain.handle(brainWorkspaceIpcChannels.softwareTaskCancel, async (_event, value: unknown) => { const input = requireRecord(value, "Software task cancel"); rejectUnexpectedKeys(input, ["taskId"], "Software task cancel"); return softwareTasks.cancel(await ownerId(), requireString(input.taskId, "taskId")); });
  }
  if (dependencies.openSoftwareTerminal) {
    ipcMain.handle(brainWorkspaceIpcChannels.softwareTerminalOpen, async (_event, value: unknown) => {
      const input = parseProjectGet(value);
      const owner = await ownerId();
      const project = dependencies.storage.getProject(owner, input.projectId);
      if (project.primaryWorkspaceKey !== "software") throw new Error("BRAIN_SOFTWARE_WORKSPACE_REQUIRED");
      if (!project.localWorkspaceId) throw new Error("BRAIN_LOCAL_WORKSPACE_REQUIRED");
      return dependencies.openSoftwareTerminal!({ projectId: project.id, projectRoot: await dependencies.resolveWorkspaceRoot(project.localWorkspaceId) });
    });
  }
  ipcMain.handle(brainWorkspaceIpcChannels.flowSave, async (_event, value: unknown) => dependencies.storage.saveFlow({ ownerId: await ownerId(), ...parseFlowSave(value) }));
  ipcMain.handle(brainWorkspaceIpcChannels.flowGet, async (_event, value: unknown) => dependencies.storage.getFlow(await ownerId(), parseFlowId(value, "flowId")));
  ipcMain.handle(brainWorkspaceIpcChannels.flowList, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    return dependencies.storage.listFlows(await ownerId(), input.projectId);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.flowRunLatest, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    return dependencies.storage.getLatestFlowRun(await ownerId(), input.projectId);
  });
  if (flowExecution) {
    ipcMain.handle(brainWorkspaceIpcChannels.flowRunStart, async (_event, value: unknown) => flowExecution.start(await ownerId(), parseFlowStart(value)));
    ipcMain.handle(brainWorkspaceIpcChannels.flowRunGet, async (_event, value: unknown) => flowExecution.get(await ownerId(), parseFlowId(value, "runId")));
    ipcMain.handle(brainWorkspaceIpcChannels.flowRunCancel, async (_event, value: unknown) => flowExecution.cancel(await ownerId(), parseFlowId(value, "runId")));
  }
  ipcMain.handle(brainWorkspaceIpcChannels.flowScheduleCreate, async (_event, value: unknown) => dependencies.storage.createFlowSchedule({ ownerId: await ownerId(), ...parseFlowScheduleCreate(value) }));
  ipcMain.handle(brainWorkspaceIpcChannels.flowScheduleList, async (_event, value: unknown) => { const input = requireRecord(value, "Flow schedule list"); rejectUnexpectedKeys(input, ["projectId"], "Flow schedule list"); return dependencies.storage.listFlowSchedules(await ownerId(), requireString(input.projectId, "projectId")); });
  ipcMain.handle(brainWorkspaceIpcChannels.annotationList, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    return dependencies.storage.listAnnotations(await ownerId(), input.projectId);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.annotationCreate, async (_event, value: unknown) => {
    const input = requireRecord(value, "Annotation create");
    const status = input.status;
    if (status !== undefined && status !== "OPEN" && status !== "APPLIED" && status !== "DISMISSED") {
      throw new TypeError("annotation status is invalid");
    }
    return dependencies.storage.createAnnotation({
      ownerId: await ownerId(), projectId: requireString(input.projectId, "projectId"), fileId: requireString(input.fileId, "fileId"),
      fileVersion: Number(input.fileVersion), anchor: input.anchor as DocumentAnchor,
      instruction: requireString(input.instruction, "instruction"), status,
      geometry: input.geometry && typeof input.geometry === "object" ? input.geometry as Record<string, unknown> : undefined,
      supersedesAnnotationId: typeof input.supersedesAnnotationId === "string" ? input.supersedesAnnotationId : undefined
    });
  });
  ipcMain.handle(brainWorkspaceIpcChannels.changeSetList, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    return dependencies.storage.listChangeSets(await ownerId(), input.projectId);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.changeSetCreate, async (_event, value: unknown) => {
    const input = requireRecord(value, "Change set create");
    const diffJson = typeof input.diffJson === "string" ? input.diffJson : "{}";
    try { const parsed = JSON.parse(diffJson); if (parsed && typeof parsed === "object" && "format" in parsed) validateDocumentOperation(parsed); } catch (error) { throw new TypeError(error instanceof Error ? error.message : "document operation is invalid"); }
    const owner = await ownerId();
    const projectId = requireString(input.projectId, "projectId");
    const proposal = createDocumentRevisionProposal(dependencies.storage, {
      ownerId: owner,
      projectId,
      annotationId: requireString(input.annotationId, "annotationId"),
      baseFileVersion: Number(input.baseFileVersion),
      changeSummary: requireString(input.changeSummary, "changeSummary"),
      diffJson,
      conversationId: typeof input.conversationId === "string" ? input.conversationId : undefined,
      taskId: typeof input.taskId === "string" ? input.taskId : undefined
    });
    return proposal.changeSet;
  });
  ipcMain.handle(brainWorkspaceIpcChannels.changeSetUpdate, async (_event, value: unknown) => {
    const input = requireRecord(value, "Change set update");
    const status = input.status;
    if (status !== "ACCEPTED" && status !== "REJECTED" && status !== "REVERTED") throw new TypeError("status is invalid");
    const owner = await ownerId();
    const projectId = requireString(input.projectId, "projectId");
    const changeSetId = requireString(input.changeSetId, "changeSetId");
    const updated = dependencies.storage.updateChangeSet({ ownerId: owner, projectId, changeSetId, status });
    if (status === "REJECTED") syncDocumentRevisionTask(dependencies.storage, { ownerId: owner, projectId, changeSetId, outcome: "rejected" });
    if (status === "ACCEPTED") syncDocumentRevisionTask(dependencies.storage, { ownerId: owner, projectId, changeSetId, outcome: "accepted" });
    return updated;
  });
  ipcMain.handle(brainWorkspaceIpcChannels.changeSetPreview, async (_event, value: unknown) => {
    const input = requireRecord(value, "Change set preview");
    return revisions.preview(await ownerId(), requireString(input.projectId, "projectId"), requireString(input.changeSetId, "changeSetId"));
  });
  ipcMain.handle(brainWorkspaceIpcChannels.changeSetExport, async (_event, value: unknown) => {
    const input = requireRecord(value, "Change set export");
    const owner = await ownerId();
    const projectId = requireString(input.projectId, "projectId");
    const changeSetId = requireString(input.changeSetId, "changeSetId");
    const result = await revisions.export(owner, projectId, changeSetId);
    syncDocumentRevisionTask(dependencies.storage, { ownerId: owner, projectId, changeSetId, outcome: "exported" });
    return result;
  });
  if (dependencies.quant) {
    const authorizeQuantProject = async (input: Record<string, unknown>) => {
      const projectId = requireString(input.projectId, "projectId");
      dependencies.storage.getProject(await ownerId(), projectId);
      return projectId;
    };
    ipcMain.handle(brainWorkspaceIpcChannels.quantSessionCreate, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant session");
      dependencies.quant!.createSession(await authorizeQuantProject(input), typeof input.initialCash === "number" ? input.initialCash : 100_000);
      return { ok: true };
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantBarsQuery, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant bars");
      return dependencies.quant!.queryBarsAsync(await authorizeQuantProject(input), input.query as any);
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantMarketOverview, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant market overview");
      await authorizeQuantProject(input);
      if (!dependencies.queryQuantMarketOverview) throw new Error("MARKET_OVERVIEW_UNAVAILABLE");
      const requestedLimit = input.limit === undefined ? 20 : Number(input.limit);
      if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
        throw new TypeError("limit must be an integer between 1 and 100");
      }
      return dependencies.queryQuantMarketOverview(requestedLimit);
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantMarketScreener, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant market screener");
      await authorizeQuantProject(input);
      if (!dependencies.queryQuantMarketScreener) throw new Error("MARKET_SCREENER_UNAVAILABLE");
      const criteria = requireRecord(input.criteria, "Quant market screener criteria");
      return dependencies.queryQuantMarketScreener(criteria);
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantOrderExecute, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant order");
      return dependencies.quant!.executeOrder(await authorizeQuantProject(input), input.order as any);
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantSnapshot, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant snapshot");
      return dependencies.quant!.snapshot(await authorizeQuantProject(input), (input.prices || {}) as Record<string, number>);
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantActivity, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant activity");
      return dependencies.quant!.activity(await authorizeQuantProject(input), (input.prices || {}) as Record<string, number>);
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantSkillPerformance, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant performance");
      return dependencies.quant!.performance(await authorizeQuantProject(input), requireString(input.skillId, "skillId"));
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantSkillRunSimulation, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant skill simulation");
      const projectId = await authorizeQuantProject(input);
      const quantity = Number(input.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) throw new TypeError("quantity must be a positive integer");
      const query = requireRecord(input.query, "Quant skill simulation query");
      return dependencies.quant!.runSkillSimulation(projectId, {
        skillId: requireString(input.skillId, "skillId"),
        symbol: requireString(input.symbol, "symbol"),
        quantity,
        query: query as any,
        reset: input.reset !== false
      });
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantSkillActivity, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant skill activity");
      return dependencies.quant!.skillActivity(
        await authorizeQuantProject(input),
        requireString(input.skillId, "skillId"),
        (input.prices || {}) as Record<string, number>
      );
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantScheduleList, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant schedule list");
      return dependencies.storage.listQuantStrategySchedules(await ownerId(), requireString(input.projectId, "projectId"));
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantScheduleCreate, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant schedule create");
      const exchange = requireString(input.exchange, "exchange");
      if (exchange !== "SSE" && exchange !== "SZSE" && exchange !== "BSE") throw new TypeError("exchange is invalid");
      const quantity = Number(input.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) throw new TypeError("quantity must be a positive integer");
      return dependencies.storage.createQuantStrategySchedule({
        ownerId: await ownerId(), projectId: requireString(input.projectId, "projectId"),
        skillId: requireString(input.skillId, "skillId"), exchange, runAt: requireString(input.runAt, "runAt"),
        symbol: requireString(input.symbol, "symbol"), quantity
      });
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantScheduleSetEnabled, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant schedule state");
      if (typeof input.enabled !== "boolean") throw new TypeError("enabled must be a boolean");
      return dependencies.storage.setQuantStrategyScheduleEnabled({ ownerId: await ownerId(), projectId: requireString(input.projectId, "projectId"), scheduleId: requireString(input.scheduleId, "scheduleId"), enabled: input.enabled });
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantScheduleRunList, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant schedule run list");
      return dependencies.storage.listQuantStrategyRuns(await ownerId(), requireString(input.projectId, "projectId"), typeof input.scheduleId === "string" ? input.scheduleId : undefined);
    });
  }
  return flowExecution;
}
