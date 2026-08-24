import { createHash } from "node:crypto";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.js";
import type { VideoRenderService } from "./video-render-service.js";
import type { VideoRuntimeService } from "./video-runtime-service.js";
import type { VideoTimelineService } from "./video-timeline-service.js";

type ToolRuntime = {
  unregisterExternalTools(namespace?: string): unknown;
  registerExternalTool(definition: Record<string, unknown>, execute: (input: Record<string, unknown>) => Promise<{ ok: boolean; output: string }>): unknown;
};

export type VideoGenerationResult = { url: string; providerResult: unknown };

type VideoPipelineState = {
  script: string;
  shots: Array<{
    title: string;
    line: string;
    prompt: string;
    clip: string;
    ready: boolean;
    transition: string;
  }>;
  exportFormat: "mp4";
};

export type VideoAgentToolDependencies = {
  ownerId: () => Promise<string>;
  projectId: string;
  projectRoot: string;
  storage: BrainWorkspaceStorage;
  videoRuntime: VideoRuntimeService;
  timeline: VideoTimelineService;
  render: VideoRenderService;
  generateVideo: (input: { prompt: string; model?: string }) => Promise<VideoGenerationResult>;
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

function normalizePipeline(value: unknown): VideoPipelineState {
  const input = record(value);
  const shots = Array.isArray(input.shots) ? input.shots.map((item) => {
    const row = record(item);
    return {
      title: text(row.title), line: text(row.line), prompt: text(row.prompt), clip: text(row.clip),
      ready: row.ready === true, transition: text(row.transition) || "cut"
    };
  }).filter((shot) => shot.title && shot.prompt) : [];
  if (!text(input.script) || shots.length === 0) throw new TypeError("script and at least one valid shot are required");
  return { script: text(input.script), shots, exportFormat: "mp4" };
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
    name: "video.pipeline.save", title: "保存视频脚本与分镜", description: "把脚本、分镜、旁白、提示词和转场真实保存到右侧视频制作 Rust pipeline。",
    namespace: "video", kind: "write", risk: "medium", requiresApproval: true,
    inputSchema: { type: "object", properties: { script: { type: "string" }, shots: { type: "array", items: { type: "object", properties: {
      title: { type: "string" }, line: { type: "string" }, prompt: { type: "string" }, clip: { type: "string" }, ready: { type: "boolean" }, transition: { type: "string" }
    }, required: ["title", "line", "prompt"], additionalProperties: false } } }, required: ["script", "shots"], additionalProperties: false }
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
    name: "video.shot.generate", title: "生成并登记真实视频镜头", description: "调用 Spring video_generate，下载真实 MP4 到当前工程，登记文件、更新 Rust 分镜并加入右侧视频轨。不得使用模拟素材。",
    namespace: "video", kind: "write", risk: "medium", requiresApproval: true,
    inputSchema: { type: "object", properties: { shotIndex: { type: "integer", minimum: 0, maximum: 99 }, prompt: { type: "string" }, model: { type: "string" }, startMs: { type: "integer", minimum: 0 }, durationMs: { type: "integer", minimum: 1 } }, required: ["shotIndex", "prompt", "startMs", "durationMs"], additionalProperties: false }
  }, async (input) => {
    const shotIndex = Number(input.shotIndex);
    const generated = await deps.generateVideo({ prompt: text(input.prompt), model: text(input.model) || undefined });
    const persisted = await persistGeneratedVideo(deps, generated.url, shotIndex);
    const current = record(await deps.videoRuntime.pipelineGet(binding));
    const state = normalizePipeline(current.state ?? current);
    if (!state.shots[shotIndex]) throw new Error("BRAIN_VIDEO_SHOT_NOT_FOUND");
    state.shots[shotIndex] = { ...state.shots[shotIndex]!, clip: persisted.relativePath, ready: true };
    await deps.videoRuntime.pipelineSave(binding, state);
    const ownerId = await deps.ownerId();
    deps.timeline.ensureTimeline(ownerId, deps.projectId, { title: "青石谷清晨入口宣传片", width: 1920, height: 1080, fps: 30 });
    const timeline = deps.timeline.addClip(ownerId, deps.projectId, { trackType: "video", sourceFileId: persisted.file.id, startMs: Number(input.startMs), durationMs: Number(input.durationMs), sourceInMs: 0, volume: 1 });
    return { ok: true, output: JSON.stringify({ generated: generated.providerResult, file: persisted.file, timeline }) };
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
    const result = await deps.render.start(ownerId, { projectId: deps.projectId, projectRoot: deps.projectRoot, timeline, outputRelativePath: text(input.outputRelativePath), mediaRelativePaths });
    return { ok: true, output: JSON.stringify(result) };
  });

  runtime.registerExternalTool({
    name: "video.render.status", title: "查询视频渲染状态", description: "查询真实 FFmpeg 渲染任务；SUCCEEDED 时返回输出文件编号和路径。",
    namespace: "video", kind: "read", risk: "low", requiresApproval: false,
    inputSchema: { type: "object", properties: { renderId: { type: "string" } }, required: ["renderId"], additionalProperties: false }
  }, async (input) => ({ ok: true, output: JSON.stringify(deps.render.status(await deps.ownerId(), text(input.renderId))) }));
}
