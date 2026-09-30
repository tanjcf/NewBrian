/**
 * Scene UI media generation: call spring-app video_generate / image_generate / music_generate,
 * then for video shots download the clip into media/clips/ and update Rust pipeline-editor.json.
 *
 * Synthesis (FFmpeg concat) is a separate step — it does NOT use a generative video model.
 */
import { createHash } from "node:crypto";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";
import type { BrainVideoPipelineState, BrainVideoShot } from "@codex-forge/protocol/brain-video-runtime";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.js";
import { extractMediaUrlsFromResult, type GenerationJobSnapshot } from "./media-generation-gateway.js";
import type { VideoRuntimeService } from "./video-runtime-service.js";

export type SceneMediaGenerationKind = "video" | "music" | "image";

export type SceneMediaGenerationResult = {
  content: string;
  kind: SceneMediaGenerationKind;
  clipRelativePath?: string;
  fileId?: string;
  ready?: boolean;
  jobId?: string;
};

type PersistDeps = {
  ownerId: () => Promise<string>;
  projectId: string;
  projectRoot: string;
  storage: BrainWorkspaceStorage;
  videoRuntime: VideoRuntimeService;
  fetchImpl?: typeof fetch;
};

const TRUSTED_COS_HOST = /(?:^|\.)(?:cos\.[a-z0-9-]+\.myqcloud\.com|cos\.[a-z0-9-]+\.tencentcos\.cn)$/i;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function asShot(row: unknown): BrainVideoShot {
  const item = record(row);
  const image = text(item.image) || text(item.firstFrameImage) || text(item.first_frame);
  const lastImage = text(item.lastImage) || text(item.lastFrameImage) || text(item.last_frame);
  const audio = text(item.audio);
  return {
    title: text(item.title) || "未命名镜头",
    line: text(item.line),
    prompt: text(item.prompt),
    clip: text(item.clip),
    ...(audio ? { audio } : {}),
    ...(image ? { image } : {}),
    ...(lastImage ? { lastImage } : {}),
    ready: item.ready === true,
    transition: (() => {
      const raw = text(item.transition);
      if (!raw || /^(none|cut|硬切)$/i.test(raw)) return "cut";
      return raw;
    })()
  };
}

function normalizePipelineState(value: unknown): BrainVideoPipelineState {
  const input = record(value);
  const shots = Array.isArray(input.shots) ? input.shots.map(asShot) : [];
  const canvasRaw = record(input.canvas);
  const width = Math.max(16, Math.round(Number(canvasRaw.width) || 1920));
  const height = Math.max(16, Math.round(Number(canvasRaw.height) || 1080));
  const fps = Math.max(1, Math.round(Number(canvasRaw.fps) || 30));
  const aspect = text(canvasRaw.aspect) || "16:9";
  return {
    schemaVersion: typeof input.schemaVersion === "number" ? input.schemaVersion : 1,
    pipeline: "brain-video-runtime-v1",
    script: text(input.script) || "一段等待创作的故事。",
    shots,
    exportFormat: text(input.exportFormat) || "mp4",
    canvas: { aspect, width, height, fps }
  };
}

async function fetchGeneratedMedia(fetchImpl: typeof fetch, parsed: URL): Promise<Response> {
  try {
    return await fetchImpl(parsed);
  } catch (error) {
    if (parsed.protocol !== "https:" || !TRUSTED_COS_HOST.test(parsed.hostname)) throw error;
    const fallback = new URL(parsed);
    fallback.protocol = "http:";
    return fetchImpl(fallback);
  }
}

/** Download a generated MP4 into media/clips/ and register it on the BRAIN project. */
export async function persistSceneVideoClip(
  deps: PersistDeps,
  url: string,
  shotIndex: number
): Promise<{ fileId: string; relativePath: string }> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("BRAIN_VIDEO_MEDIA_URL_INVALID");
  }
  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await fetchGeneratedMedia(fetchImpl, parsed);
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
    ownerId,
    projectId: deps.projectId,
    logicalName: basename(relativePath),
    mimeType: "video/mp4",
    sizeBytes: fileStat.size,
    contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    storageKey: relativePath
  });
  return { fileId: file.id, relativePath };
}

/** Update Rust pipeline shot clip + ready after a successful video_generate. */
export async function bindClipToPipelineShot(
  deps: Pick<PersistDeps, "projectId" | "projectRoot" | "videoRuntime">,
  shotIndex: number,
  relativePath: string
): Promise<BrainVideoPipelineState> {
  const binding = { projectId: deps.projectId, projectRoot: deps.projectRoot };
  const current = record(await deps.videoRuntime.pipelineGet(binding));
  const state = normalizePipelineState(current.state ?? current);
  if (!state.shots[shotIndex]) throw new Error("BRAIN_VIDEO_SHOT_NOT_FOUND");
  state.shots[shotIndex] = {
    ...state.shots[shotIndex]!,
    clip: relativePath,
    ready: true
  };
  await deps.videoRuntime.pipelineSave(binding, state);
  return state;
}

/**
 * After executeMediaGenerationTurn succeeds for a video shot, download + bind clip.
 * Throws with a clear TokenHub / missing-URL message when generation did not yield media.
 */
export async function finalizeSceneVideoShot(input: {
  deps: PersistDeps;
  shotIndex: number;
  content: string;
  job: GenerationJobSnapshot;
}): Promise<SceneMediaGenerationResult> {
  const url = extractMediaUrlsFromResult(input.job.resultJson)[0];
  if (!url) {
    const detail = input.job.errorMessage || input.job.errorCode || input.content || "未返回可下载视频地址";
    const lowered = detail.toLowerCase();
    if (/401008|额度已耗尽|quota exhausted|余额不足|额度不足|daily quota|monthly quota/i.test(detail)
      || /quota|exceed/i.test(lowered)) {
      throw new Error(`额度限制：${detail}`);
    }
    if (/credential authentication failed|凭证解密|密文无法解密/i.test(detail)) {
      throw new Error(`网关凭证异常：${detail}`);
    }
    if (/400004|服务 ID.*不存在|is not available/i.test(detail)) {
      throw new Error(`模型/服务不可用：${detail}`);
    }
    if (/500001|发生未知错误|unknown error/i.test(detail)) {
      throw new Error(`TokenHub 上游未知错误（非额度）：${detail}`);
    }
    throw new Error(`video_generate 未产出可下载地址：${detail}`);
  }
  const persisted = await persistSceneVideoClip(input.deps, url, input.shotIndex);
  await bindClipToPipelineShot(input.deps, input.shotIndex, persisted.relativePath);
  return {
    content: input.content,
    kind: "video",
    clipRelativePath: persisted.relativePath,
    fileId: persisted.fileId,
    ready: true,
    jobId: String(input.job.id || "")
  };
}
