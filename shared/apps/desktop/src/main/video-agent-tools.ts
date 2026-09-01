import { createHash } from "node:crypto";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";
import { brainVideoCanvasSize, type BrainVideoCanvas } from "@codex-forge/protocol/brain-video-runtime";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.js";
import type { VideoRenderService } from "./video-render-service.js";
import type { VideoRuntimeService } from "./video-runtime-service.js";
import type { VideoTimelineService } from "./video-timeline-service.js";

type ToolRuntime = {
  unregisterExternalTools(namespace?: string): unknown;
  registerExternalTool(definition: Record<string, unknown>, execute: (input: Record<string, unknown>) => Promise<{ ok: boolean; output: string }>): unknown;
};

export type VideoGenerationResult = { url: string; providerResult: unknown };
export type AudioGenerationResult = { bytes: Buffer; mimeType: string; providerResult: unknown };

type VideoPipelineState = {
  script: string;
  shots: Array<{
    title: string;
    line: string;
    prompt: string;
    clip: string;
    audio?: string;
    image?: string;
    lastImage?: string;
    ready: boolean;
    transition: string;
  }>;
  exportFormat: "mp4";
  canvas: BrainVideoCanvas;
};

export type VideoAgentToolDependencies = {
  ownerId: () => Promise<string>;
  projectId: string;
  projectRoot: string;
  storage: BrainWorkspaceStorage;
  videoRuntime: VideoRuntimeService;
  timeline: VideoTimelineService;
  render: VideoRenderService;
  generateVideo: (input: { prompt: string; model?: string; size?: string }) => Promise<VideoGenerationResult>;
  generateSpeech?: (input: { text: string; model?: string; voice?: string }) => Promise<AudioGenerationResult>;
  fetchImpl?: typeof fetch;
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => String(value ?? "").trim();
const TRUSTED_COS_HOST = /(?:^|\.)(?:cos\.[a-z0-9-]+\.myqcloud\.com|cos\.[a-z0-9-]+\.tencentcos\.cn)$/i;

async function fetchGeneratedMedia(deps: VideoAgentToolDependencies, parsed: URL): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    return await fetchImpl(parsed);
  } catch (error) {
    if (parsed.protocol !== "https:" || !TRUSTED_COS_HOST.test(parsed.hostname)) throw error;
    const fallback = new URL(parsed);
    fallback.protocol = "http:";
    return fetchImpl(fallback);
  }
}

function normalizeCanvas(value: unknown): BrainVideoCanvas {
  const row = record(value);
  return {
    aspect: text(row.aspect) || "16:9",
    width: Math.max(16, Math.round(Number(row.width) || 1920)),
    height: Math.max(16, Math.round(Number(row.height) || 1080)),
    fps: Math.max(1, Math.round(Number(row.fps) || 30))
  };
}

function normalizePipeline(value: unknown): VideoPipelineState {
  const input = record(value);
  const shots = Array.isArray(input.shots) ? input.shots.map((item) => {
    const row = record(item);
    return {
      title: text(row.title),
      line: text(row.line),
      prompt: text(row.prompt),
      clip: text(row.clip),
      audio: text(row.audio) || undefined,
      image: text(row.image) || undefined,
      lastImage: text(row.lastImage) || undefined,
      ready: row.ready === true,
      transition: (() => {
        const raw = text(row.transition);
        if (!raw || /^(none|cut|硬切)$/i.test(raw)) return "cut";
        return raw;
      })()
    };
  }).filter((shot) => shot.title && shot.prompt) : [];
  if (!text(input.script) || shots.length === 0) throw new TypeError("script and at least one valid shot are required");
  return { script: text(input.script), shots, exportFormat: "mp4", canvas: normalizeCanvas(input.canvas) };
}

async function persistGeneratedVideo(deps: VideoAgentToolDependencies, url: string, shotIndex: number) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("BRAIN_VIDEO_MEDIA_URL_INVALID");
  const response = await fetchGeneratedMedia(deps, parsed);
  if (!response.ok) throw new Error(`BRAIN_VIDEO_MEDIA_DOWNLOAD_FAILED:${response.status}`);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > 512 * 1024 * 1024) throw new Error("BRAIN_VIDEO_MEDIA_TOO_LARGE");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 512 * 1024 * 1024) throw new Error("BRAIN_VIDEO_MEDIA_INVALID");
  const root = await realpath(deps.projectRoot);
  const relativePath = `media/clips/shot-${String(shotIndex + 1).padStart(3, "0")}-${Date.now()}.mp4`;
  const target = resolve(root, relativePath);
  const boundary = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!target.startsWith(boundary)) throw new Error("BRAIN_VIDEO_MEDIA_PATH_INVALID");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  const fileStat = await stat(target);
  const ownerId = await deps.ownerId();
  const file = deps.storage.registerFile({
    ownerId, projectId: deps.projectId, logicalName: basename(relativePath), mimeType: "video/mp4",
    sizeBytes: fileStat.size, contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, storageKey: relativePath
  });
  return { file, relativePath };
}

async function persistAudioBytes(deps: VideoAgentToolDependencies, bytes: Buffer, mimeType: string, logicalStem: string) {
  if (!bytes.length || bytes.length > 128 * 1024 * 1024) throw new Error("BRAIN_VIDEO_AUDIO_INVALID");
  const root = await realpath(deps.projectRoot);
  const extension = mimeType.includes("wav") ? "wav" : mimeType.includes("ogg") ? "ogg" : "mp3";
  const relativePath = `media/audio/${logicalStem}-${Date.now()}.${extension}`;
  const target = resolve(root, relativePath);
  const boundary = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!target.startsWith(boundary)) throw new Error("BRAIN_VIDEO_MEDIA_PATH_INVALID");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  const ownerId = await deps.ownerId();
  const file = deps.storage.registerFile({
    ownerId, projectId: deps.projectId, logicalName: basename(relativePath), mimeType, sizeBytes: bytes.length,
    contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, storageKey: relativePath
  });
  return { file, relativePath };
}

function createAmbientWav(durationMs: number) {
  const sampleRate = 32_000;
  const samples = Math.max(1, Math.round(sampleRate * durationMs / 1000));
  const pcm = Buffer.alloc(samples * 2);
  let noise = 0x13579bdf;
  for (let index = 0; index < samples; index += 1) {
    noise = (Math.imul(noise, 1_103_515_245) + 12_345) | 0;
    const time = index / sampleRate;
    const fade = Math.min(1, time / 0.8, (durationMs / 1000 - time) / 0.8);
    const pad = Math.sin(time * Math.PI * 2 * 220) * 0.09 + Math.sin(time * Math.PI * 2 * 329.63) * 0.045;
    const wind = ((noise >>> 16) / 32768 - 1) * 0.018;
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, (pad + wind) * Math.max(0, fade))) * 32767), index * 2);
  }
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
  return wav;
}

/** Register video-scene tools on the project-scoped Agent runtime. */
export function registerVideoAgentTools(runtime: ToolRuntime, deps: VideoAgentToolDependencies) {
  if (!deps.projectId.trim() || !deps.projectRoot.trim()) return;
  runtime.unregisterExternalTools("video");
  const binding = { projectId: deps.projectId, projectRoot: deps.projectRoot };

  runtime.registerExternalTool({
    name: "video.project.inspect", title: "读取视频工程", description: "读取右侧视频制作工程的真实 pipeline、时间线和文件记录。",
    namespace: "video", kind: "read", risk: "low", requiresApproval: false,
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  }, async () => {
    const ownerId = await deps.ownerId();
    const [pipeline, timeline] = await Promise.all([
      deps.videoRuntime.pipelineGet(binding),
      Promise.resolve().then(() => deps.timeline.getTimeline(ownerId, deps.projectId)).catch(() => null)
    ]);
    return { ok: true, output: JSON.stringify({ pipeline, timeline, files: deps.storage.listFiles(ownerId, deps.projectId) }) };
  });

  runtime.registerExternalTool({
    name: "video.pipeline.save", title: "保存视频脚本与分镜", description: "把脚本、分镜、旁白、提示词、转场和画幅适配器（canvas width/height/aspect）真实保存到右侧视频制作 Rust pipeline。",
    namespace: "video", kind: "write", risk: "medium", requiresApproval: true,
    inputSchema: { type: "object", properties: {
      script: { type: "string" },
      shots: { type: "array", items: { type: "object", properties: {
        title: { type: "string" }, line: { type: "string" }, prompt: { type: "string" }, clip: { type: "string" },
        audio: { type: "string" }, image: { type: "string" }, lastImage: { type: "string" },
        ready: { type: "boolean" }, transition: { type: "string" }
      }, required: ["title", "line", "prompt"], additionalProperties: false } },
      canvas: { type: "object", properties: {
        aspect: { type: "string" }, width: { type: "integer", minimum: 16 }, height: { type: "integer", minimum: 16 }, fps: { type: "integer", minimum: 1 }
      }, additionalProperties: false }
    }, required: ["script", "shots"], additionalProperties: false }
  }, async (input) => ({ ok: true, output: JSON.stringify(await deps.videoRuntime.pipelineSave(binding, normalizePipeline(input))) }));

  runtime.registerExternalTool({
    name: "video.timeline.configure", title: "配置视频时间线", description: "创建或更新右侧真实视频时间线的标题、分辨率和帧率。",
    namespace: "video", kind: "write", risk: "medium", requiresApproval: true,
    inputSchema: { type: "object", properties: { title: { type: "string" }, width: { type: "integer", minimum: 16, maximum: 7680 }, height: { type: "integer", minimum: 16, maximum: 4320 }, fps: { type: "integer", minimum: 1, maximum: 120 } }, required: ["title", "width", "height", "fps"], additionalProperties: false }
  }, async (input) => {
    const ownerId = await deps.ownerId();
    const timeline = deps.timeline.ensureTimeline(ownerId, deps.projectId, { title: text(input.title), width: Number(input.width), height: Number(input.height), fps: Number(input.fps) });
    return { ok: true, output: JSON.stringify(timeline) };
  });

  runtime.registerExternalTool({
    name: "video.subtitle.import", title: "写入视频字幕轨", description: "把 SRT 字幕真实写入右侧视频时间线字幕轨。",
    namespace: "video", kind: "write", risk: "medium", requiresApproval: true,
    inputSchema: { type: "object", properties: { srt: { type: "string" } }, required: ["srt"], additionalProperties: false }
  }, async (input) => {
    const timeline = deps.timeline.importSubtitlesFromSrt(await deps.ownerId(), deps.projectId, text(input.srt));
    return { ok: true, output: JSON.stringify(timeline) };
  });

  runtime.registerExternalTool({
    name: "video.timeline.add_clip", title: "添加工程素材到时间线", description: "将右侧工程中已登记的真实视频或音频文件挂入时间线；用于重启恢复或重排素材，不会伪造文件。",
    namespace: "video", kind: "write", risk: "medium", requiresApproval: true,
    inputSchema: { type: "object", properties: {
      fileId: { type: "string" }, trackType: { type: "string", enum: ["video", "audio"] },
      startMs: { type: "integer", minimum: 0 }, durationMs: { type: "integer", minimum: 1 },
      sourceInMs: { type: "integer", minimum: 0 }, volume: { type: "number", minimum: 0, maximum: 2 }
    }, required: ["fileId", "trackType", "startMs", "durationMs"], additionalProperties: false }
  }, async (input) => {
    const ownerId = await deps.ownerId();
    const file = deps.storage.getFile(ownerId, deps.projectId, text(input.fileId));
    const trackType = text(input.trackType) as "video" | "audio";
    const expectedMimePrefix = trackType === "video" ? "video/" : "audio/";
    if (!file.mimeType.toLowerCase().startsWith(expectedMimePrefix)) throw new Error("BRAIN_VIDEO_CLIP_MEDIA_TYPE_MISMATCH");
    deps.timeline.ensureTimeline(ownerId, deps.projectId, { title: "未命名时间线", width: 1920, height: 1080, fps: 30 });
    const timeline = deps.timeline.addClip(ownerId, deps.projectId, {
      trackType, sourceFileId: file.id, startMs: Number(input.startMs), durationMs: Number(input.durationMs),
      sourceInMs: Number(input.sourceInMs ?? 0), volume: Number(input.volume ?? 1)
    });
    return { ok: true, output: JSON.stringify({ file, timeline }) };
  });

  runtime.registerExternalTool({
    name: "video.audio.speech", title: "生成并加入真实配音", description: "通过 Spring 音频模型生成真实配音文件，登记到右侧工程并挂到指定分镜的 A 轨（shot.audio）。须传 shotIndex，避免无镜头归属的 narration-时间戳.wav 被回填到每一镜。",
    namespace: "video", kind: "write", risk: "medium", requiresApproval: true,
    inputSchema: { type: "object", properties: {
      text: { type: "string" },
      model: { type: "string" },
      voice: { type: "string" },
      shotIndex: { type: "integer", minimum: 0, maximum: 99 },
      startMs: { type: "integer", minimum: 0 },
      durationMs: { type: "integer", minimum: 1 },
      volume: { type: "number", minimum: 0, maximum: 2 }
    }, required: ["text", "startMs", "durationMs"], additionalProperties: false }
  }, async (input) => {
    if (!deps.generateSpeech) throw new Error("BRAIN_VIDEO_SPEECH_UNAVAILABLE");
    const generated = await deps.generateSpeech({ text: text(input.text), model: text(input.model) || undefined, voice: text(input.voice) || undefined });
    const shotIndex = Number.isFinite(Number(input.shotIndex)) ? Number(input.shotIndex) : -1;
    const stem = shotIndex >= 0 ? `narration-shot-${shotIndex + 1}` : "narration";
    const persisted = await persistAudioBytes(deps, generated.bytes, generated.mimeType, stem);
    const ownerId = await deps.ownerId();
    deps.timeline.ensureTimeline(ownerId, deps.projectId, { title: "未命名时间线", width: 1920, height: 1080, fps: 30 });
    const timeline = deps.timeline.addClip(ownerId, deps.projectId, { trackType: "audio", sourceFileId: persisted.file.id, startMs: Number(input.startMs), durationMs: Number(input.durationMs), sourceInMs: 0, volume: Number(input.volume ?? 1) });
    let pipelineShotId: string | undefined;
    if (shotIndex >= 0) {
      const current = record(await deps.videoRuntime.pipelineGet(binding));
      const state = normalizePipeline(current.state ?? current);
      if (!state.shots[shotIndex]) throw new Error("BRAIN_VIDEO_SHOT_NOT_FOUND");
      state.shots[shotIndex] = { ...state.shots[shotIndex]!, audio: persisted.relativePath };
      pipelineShotId = `shot-${shotIndex + 1}`;
      await deps.videoRuntime.pipelineSave(binding, state);
    }
    return { ok: true, output: JSON.stringify({ provider: generated.providerResult, file: persisted.file, timeline, shotIndex: shotIndex >= 0 ? shotIndex : undefined, shotId: pipelineShotId, relativePath: persisted.relativePath }) };
  });

  runtime.registerExternalTool({
    name: "video.audio.ambient", title: "生成并加入环境音乐", description: "生成真实 WAV 环境音文件（含淡入淡出），登记到右侧工程并加入音频轨。",
    namespace: "video", kind: "write", risk: "medium", requiresApproval: true,
    inputSchema: { type: "object", properties: { durationMs: { type: "integer", minimum: 500, maximum: 600000 }, startMs: { type: "integer", minimum: 0 }, volume: { type: "number", minimum: 0, maximum: 2 } }, required: ["durationMs", "startMs"], additionalProperties: false }
  }, async (input) => {
    const durationMs = Number(input.durationMs);
    const persisted = await persistAudioBytes(deps, createAmbientWav(durationMs), "audio/wav", "ambient");
    const ownerId = await deps.ownerId();
    deps.timeline.ensureTimeline(ownerId, deps.projectId, { title: "未命名时间线", width: 1920, height: 1080, fps: 30 });
    const timeline = deps.timeline.addClip(ownerId, deps.projectId, { trackType: "audio", sourceFileId: persisted.file.id, startMs: Number(input.startMs), durationMs, sourceInMs: 0, volume: Number(input.volume ?? 0.2) });
    return { ok: true, output: JSON.stringify({ file: persisted.file, timeline }) };
  });

  runtime.registerExternalTool({
    name: "video.shot.generate", title: "生成并登记真实视频镜头", description: "调用 Spring video_generate（带工程画幅 size），下载真实 MP4 到当前工程，登记文件、更新 Rust 分镜并加入右侧视频轨。不得使用模拟素材。",
    namespace: "video", kind: "write", risk: "medium", requiresApproval: true,
    inputSchema: { type: "object", properties: { shotIndex: { type: "integer", minimum: 0, maximum: 99 }, prompt: { type: "string" }, model: { type: "string" }, size: { type: "string" }, startMs: { type: "integer", minimum: 0 }, durationMs: { type: "integer", minimum: 1 } }, required: ["shotIndex", "prompt", "startMs", "durationMs"], additionalProperties: false }
  }, async (input) => {
    const shotIndex = Number(input.shotIndex);
    const current = record(await deps.videoRuntime.pipelineGet(binding));
    const state = normalizePipeline(current.state ?? current);
    const size = text(input.size) || brainVideoCanvasSize(state.canvas);
    const generated = await deps.generateVideo({ prompt: text(input.prompt), model: text(input.model) || undefined, size });
    const persisted = await persistGeneratedVideo(deps, generated.url, shotIndex);
    if (!state.shots[shotIndex]) throw new Error("BRAIN_VIDEO_SHOT_NOT_FOUND");
    state.shots[shotIndex] = { ...state.shots[shotIndex]!, clip: persisted.relativePath, ready: true };
    await deps.videoRuntime.pipelineSave(binding, state);
    const ownerId = await deps.ownerId();
    deps.timeline.ensureTimeline(ownerId, deps.projectId, {
      title: "视频工程时间线",
      width: state.canvas.width,
      height: state.canvas.height,
      fps: state.canvas.fps
    });
    const timeline = deps.timeline.addClip(ownerId, deps.projectId, { trackType: "video", sourceFileId: persisted.file.id, startMs: Number(input.startMs), durationMs: Number(input.durationMs), sourceInMs: 0, volume: 1 });
    return { ok: true, output: JSON.stringify({ generated: generated.providerResult, file: persisted.file, timeline, size }) };
  });

  runtime.registerExternalTool({
    name: "video.render.start", title: "渲染真实视频", description: "通过 Rust Core 与 FFmpeg 渲染当前右侧视频轨并登记真实 MP4；返回 renderId 后使用 video.render.status 查询。",
    namespace: "video", kind: "write", risk: "medium", requiresApproval: true,
    inputSchema: { type: "object", properties: { outputRelativePath: { type: "string", description: "例如 exports/final.mp4" } }, required: ["outputRelativePath"], additionalProperties: false }
  }, async (input) => {
    const ownerId = await deps.ownerId();
    const timeline = deps.timeline.getTimeline(ownerId, deps.projectId);
    const files = new Map(deps.storage.listFiles(ownerId, deps.projectId).map((file) => [file.id, file]));
    const mediaRelativePaths = timeline.clips.filter((clip) => clip.trackType === "video").map((clip) => files.get(clip.sourceFileId)?.storageKey || "").filter(Boolean);
    const audioClips = timeline.clips.filter((clip) => clip.trackType === "audio").map((clip) => ({ relativePath: files.get(clip.sourceFileId)?.storageKey || "", startMs: clip.startMs, volume: clip.volume })).filter((clip) => clip.relativePath);
    const result = await deps.render.start(ownerId, { projectId: deps.projectId, projectRoot: deps.projectRoot, timeline, outputRelativePath: text(input.outputRelativePath), mediaRelativePaths, audioClips });
    return { ok: true, output: JSON.stringify(result) };
  });

  runtime.registerExternalTool({
    name: "video.render.status", title: "查询视频渲染状态", description: "查询真实 FFmpeg 渲染任务；SUCCEEDED 时返回输出文件编号和路径。",
    namespace: "video", kind: "read", risk: "low", requiresApproval: false,
    inputSchema: { type: "object", properties: { renderId: { type: "string" } }, required: ["renderId"], additionalProperties: false }
  }, async (input) => ({ ok: true, output: JSON.stringify(deps.render.status(await deps.ownerId(), text(input.renderId))) }));
}
