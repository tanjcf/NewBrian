import { createHash, randomBytes, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import type { BrainVideoRenderState, BrainVideoTimeline } from "@codex-forge/protocol";
import type { RustCoreRequest, RustCoreResponse } from "@codex-forge/protocol/rust-core";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.js";
import { buildLayeredVideoFfmpegArgs, type VideoRenderLayerClip } from "./video-layered-ffmpeg.js";

export { buildLayeredVideoFfmpegArgs, type VideoRenderLayerClip } from "./video-layered-ffmpeg.js";

/** Project-relative font for drawtext (avoids Windows `C:` filtergraph parse failures). */
async function ensureProjectDrawtextFont(projectRoot: string): Promise<string> {
  const relative = ".brain-video/fonts/export.ttf";
  const absolute = resolve(projectRoot, relative);
  if (!existsSync(absolute)) {
    await mkdir(dirname(absolute), { recursive: true });
    const sources = process.platform === "win32"
      ? ["C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/msyh.ttc"]
      : process.platform === "darwin"
        ? ["/Library/Fonts/Arial.ttf", "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"]
        : ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"];
    for (const source of sources) {
      if (!existsSync(source)) continue;
      try {
        await copyFile(source, absolute);
        break;
      } catch {
        /* try next */
      }
    }
  }
  return existsSync(absolute) ? relative.replaceAll("\\", "/") : "";
}

type RustRequestInput = Omit<RustCoreRequest, "protocol_version">;
export interface VideoRenderRustClient { request(input: RustRequestInput): Promise<RustCoreResponse> }

export interface VideoRenderOptions {
  projectId: string;
  projectRoot: string;
  timeline: BrainVideoTimeline;
  outputRelativePath: string;
  mediaRelativePaths?: string[];
  audioClips?: Array<{ relativePath: string; startMs: number; volume: number }>;
  /**
   * Multi-track layout from pipeline editor. When set, FFmpeg composites by track:
   * same video trackId → time-ordered overlays / xfade; higher V tracks over lower; audio amix; text drawtext.
   */
  layerClips?: VideoRenderLayerClip[];
  /** When true and no media clips exist, synthesize a short black MP4 via lavfi. */
  allowSyntheticMedia?: boolean;
  acquireRustCore: (binding: { projectId: string; projectRoot: string; workspaceType: "video" }) => Promise<VideoRenderRustClient>;
  confirmRender: (input: { projectId: string; command: string; outputRelativePath: string }) => Promise<boolean>;
  prepareOutput?: (projectRoot: string, outputRelativePath: string) => Promise<void>;
  validateOutput?: (projectRoot: string, outputRelativePath: string) => Promise<boolean>;
  resolveFfmpegExecutable?: () => Promise<string>;
  storage?: BrainWorkspaceStorage;
  platform?: NodeJS.Platform;
}
export type VideoRenderInput = Omit<VideoRenderOptions, "acquireRustCore" | "confirmRender" | "prepareOutput" | "validateOutput" | "resolveFfmpegExecutable" | "platform" | "storage">;

function buildVideoFfmpegArgs(media: string[], output: string, concatListRelative?: string, audioClips: Array<{ relativePath: string; startMs: number; volume: number }> = [], subtitleRelative?: string, videoSettings?: { width: number; height: number; fps: number }): string[] {
  if (!media.length) {
    return [
      "-y",
      "-f", "lavfi", "-i", "color=c=black:s=1280x720:d=2",
      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
      "-t", "2",
      "-c:v", "libx264",
      "-c:a", "aac",
      "-shortest",
      output
    ];
  }
  const args = media.length === 1
    ? ["-y", "-i", media[0]!]
    : ["-y", "-f", "concat", "-safe", "0", "-i", concatListRelative!];
  for (const clip of audioClips) args.push("-i", clip.relativePath);
  const videoFilters: string[] = [];
  if (videoSettings) {
    videoFilters.push(`scale=${videoSettings.width}:${videoSettings.height}:force_original_aspect_ratio=decrease`);
    videoFilters.push(`pad=${videoSettings.width}:${videoSettings.height}:(ow-iw)/2:(oh-ih)/2`);
    videoFilters.push(`fps=${videoSettings.fps}`);
  }
  if (subtitleRelative) videoFilters.push(`subtitles='${subtitleRelative.replaceAll("'", "\\'")}'`);
  if (videoFilters.length) args.push("-vf", videoFilters.join(","));
  if (audioClips.length) {
    const chains = audioClips.map((clip, index) => `[${index + 1}:a]adelay=${clip.startMs}|${clip.startMs},volume=${clip.volume}[audio${index}]`);
    const inputs = audioClips.map((_, index) => `[audio${index}]`).join("");
    chains.push(`${inputs}amix=inputs=${audioClips.length}:duration=longest:normalize=0[aout]`);
    args.push("-filter_complex", chains.join(";"), "-map", "0:v:0", "-map", "[aout]");
  }
  args.push("-c:v", "libx264", "-c:a", "aac", "-shortest", output);
  return args;
}

type Session = {
  ownerId: string;
  requestId: string;
  client: VideoRenderRustClient;
  state: BrainVideoRenderState;
  abortController: AbortController;
  generation: number;
  projectRoot: string;
};

const MAX_OUTPUT = 64 * 1024;
const now = () => new Date().toISOString();
const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const decode = (value: unknown) => typeof value === "string" ? Buffer.from(value, "base64").toString("utf8") : "";
const TERMINAL = new Set<BrainVideoRenderState["status"]>(["SUCCEEDED", "FAILED", "CANCELLED"]);
const srtTime = (milliseconds: number) => {
  const value = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor(value % 3_600_000 / 60_000);
  const seconds = Math.floor(value % 60_000 / 1_000);
  const millis = value % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
};
const renderSrt = (clips: Array<{ startMs: number; endMs: number; text: string }>) => clips.map((clip, index) => `${index + 1}\n${srtTime(clip.startMs)} --> ${srtTime(clip.endMs)}\n${clip.text.trim()}\n`).join("\n");

function safeRelativePath(value: string, code: string) {
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (!normalized || normalized.startsWith("/") || /^[a-z]:\//iu.test(normalized) || segments.some((segment) => segment === "..")) throw new Error(code);
  return normalized;
}

function mapProcessFailure(errorCode: string): { status: BrainVideoRenderState["status"]; errorCode: string } {
  return { status: "FAILED", errorCode: errorCode || "BRAIN_VIDEO_RENDER_FAILED" };
}

export class VideoRenderService {
  private readonly sessions = new Map<string, Session>();
  private readonly options: Pick<VideoRenderOptions, "acquireRustCore" | "confirmRender" | "prepareOutput" | "validateOutput" | "resolveFfmpegExecutable" | "storage" | "platform">;
  private readonly platform: NodeJS.Platform;

  constructor(options: Pick<VideoRenderOptions, "acquireRustCore" | "confirmRender" | "prepareOutput" | "validateOutput" | "resolveFfmpegExecutable" | "storage" | "platform">) {
    this.options = options;
    this.platform = options.platform ?? process.platform;
  }

  async start(ownerId: string, input: VideoRenderInput): Promise<BrainVideoRenderState> {
    const renderId = `video-render-${randomUUID()}`;
    const requestId = `${renderId}:process`;
    const executable = this.options.resolveFfmpegExecutable
      ? await this.options.resolveFfmpegExecutable()
      : (this.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    const output = safeRelativePath(input.outputRelativePath, "BRAIN_VIDEO_OUTPUT_PATH_INVALID");
    if (!/\.mp4$/iu.test(output)) throw new Error("BRAIN_VIDEO_OUTPUT_FORMAT_UNSUPPORTED");
    const layerClips = (input.layerClips || []).map((clip) => {
      const trackType = clip.trackType === "audio" ? "audio" as const : clip.trackType === "text" ? "text" as const : "video" as const;
      return {
        relativePath: trackType === "text"
          ? undefined
          : safeRelativePath(String(clip.relativePath || ""), trackType === "audio" ? "BRAIN_VIDEO_AUDIO_NOT_FOUND" : "BRAIN_VIDEO_MEDIA_NOT_FOUND"),
        trackId: String(clip.trackId || (trackType === "audio" ? "a1" : "v1")),
        trackType,
        startMs: Math.max(0, Math.round(Number(clip.startMs) || 0)),
        durationMs: clip.durationMs === undefined ? undefined : Math.max(100, Math.round(Number(clip.durationMs) || 0)),
        volume: Math.max(0, Math.min(2, Number(clip.volume) ?? 1)),
        transition: clip.transition ? String(clip.transition) : undefined,
        transitionMs: clip.transitionMs === undefined ? undefined : Math.max(0, Math.round(Number(clip.transitionMs) || 0)),
        text: clip.text ? String(clip.text) : undefined,
        fontSize: clip.fontSize === undefined ? undefined : Math.max(12, Math.round(Number(clip.fontSize) || 48)),
        color: clip.color ? String(clip.color) : undefined,
        x: clip.x === undefined ? undefined : Math.min(1, Math.max(0, Number(clip.x))),
        y: clip.y === undefined ? undefined : Math.min(1, Math.max(0, Number(clip.y))),
        scale: clip.scale === undefined ? undefined : Math.max(0.2, Math.min(5, Number(clip.scale) || 1))
      };
    });
    const useLayers = layerClips.some((clip) => clip.trackType === "video" || clip.trackType === "text");
    const media = useLayers
      ? layerClips.filter((clip) => clip.trackType === "video").map((clip) => String(clip.relativePath || ""))
      : (input.mediaRelativePaths || []).map((item) => safeRelativePath(item, "BRAIN_VIDEO_MEDIA_NOT_FOUND"));
    const audioClips = useLayers
      ? []
      : (input.audioClips || []).map((clip) => ({
        relativePath: safeRelativePath(clip.relativePath, "BRAIN_VIDEO_AUDIO_NOT_FOUND"),
        startMs: Math.max(0, Math.round(Number(clip.startMs) || 0)),
        volume: Math.max(0, Math.min(2, Number(clip.volume) || 0))
      }));
    if (!media.length && !layerClips.some((c) => c.trackType === "text") && !input.allowSyntheticMedia) {
      throw new Error("BRAIN_VIDEO_MEDIA_NOT_FOUND");
    }
    let concatListRelative: string | undefined;
    if (!useLayers && media.length > 1) {
      concatListRelative = `.brain-video/concat-${renderId}.txt`;
      const listAbsolute = resolve(input.projectRoot, concatListRelative);
      await mkdir(dirname(listAbsolute), { recursive: true });
      // FFmpeg resolves concat entries relative to the concat list itself,
      // which lives under .brain-video rather than the project root.
      const body = media.map((path) => `file '../${path.replaceAll("'", "'\\''")}'`).join("\n");
      await writeFile(listAbsolute, `${body}\n`, "utf8");
    }
    let subtitleRelative: string | undefined;
    const subtitleClips = input.timeline.clips.filter((clip) => clip.trackType === "subtitle" && String(clip.text || "").trim());
    if (subtitleClips.length) {
      subtitleRelative = `.brain-video/subtitles-${renderId}.srt`;
      const body = renderSrt(subtitleClips.map((clip) => ({ startMs: clip.startMs, endMs: clip.startMs + clip.durationMs, text: String(clip.text || "") })));
      await mkdir(dirname(resolve(input.projectRoot, subtitleRelative)), { recursive: true });
      await writeFile(resolve(input.projectRoot, subtitleRelative), body, "utf8");
    }
    const videoSettings = {
      width: input.timeline.width,
      height: input.timeline.height,
      fps: input.timeline.fps
    };
    const projectFont = useLayers ? await ensureProjectDrawtextFont(input.projectRoot) : "";
    const args = useLayers
      ? buildLayeredVideoFfmpegArgs(layerClips, output, videoSettings, subtitleRelative, { fontfile: projectFont })
      : buildVideoFfmpegArgs(media, output, concatListRelative, audioClips, subtitleRelative, videoSettings);
    const command = `${executable} ${args.join(" ")}`;
    if (!(await this.options.confirmRender({ projectId: input.projectId, command, outputRelativePath: output }))) throw new Error("BRAIN_VIDEO_RENDER_DECLINED");
    await this.options.prepareOutput?.(input.projectRoot, output);

    let taskId = `video-task-${randomUUID()}`;
    if (this.options.storage) {
      const task = this.options.storage.createTask({
        ownerId,
        projectId: input.projectId,
        workspaceKey: "video",
        taskType: "video_render",
        requestId,
        idempotencyKey: renderId,
        maxAttempts: 1,
        resourceLimitsJson: JSON.stringify({ timeoutMs: 0, maxOutputBytes: 1_048_576 })
      });
      taskId = task.id;
    }

    const client = await this.options.acquireRustCore({ projectId: input.projectId, projectRoot: input.projectRoot, workspaceType: "video" });
    const state: BrainVideoRenderState = {
      schemaVersion: 1,
      renderId,
      projectId: input.projectId,
      taskId,
      status: "STARTING",
      outputFileId: "",
      outputPath: output,
      errorCode: "",
      output: "",
      startedAt: now(),
      finishedAt: ""
    };
    const session: Session = { ownerId, requestId, client, state, abortController: new AbortController(), generation: 0, projectRoot: input.projectRoot };
    this.sessions.set(renderId, session);
    this.persistTask(session, "RUNNING", 0.1);

    const token = randomBytes(32).toString("base64url");
    const registration = await client.request({
      request_id: `${requestId}:approval`,
      project_id: input.projectId,
      workspace_type: "video",
      operation: "approval.register",
      approval_token: "",
      resource_limits: { timeout_ms: 0, max_output_bytes: 1_024 },
      payload: { token, operation: "process.run", ttl_ms: 0 }
    });
    if (registration.status !== "completed") return this.finish(session, "FAILED", registration.error_code || "BRAIN_CORE_APPROVAL_FAILED", "");

    state.status = "RUNNING";
    this.persistTask(session, "RUNNING", 0.2);
    const generation = session.generation;
    void client.request({
      request_id: requestId,
      project_id: input.projectId,
      workspace_type: "video",
      operation: "process.run",
      approval_token: token,
      resource_limits: { timeout_ms: 0, max_output_bytes: 1_048_576 },
      payload: { executable, args, cwd: "." }
    }).then(async (response) => {
      if (this.isStale(session, generation)) return;
      const result = record(response.result);
      const text = `${decode(result.stdout_base64)}\n${decode(result.stderr_base64)}`.trim().slice(-MAX_OUTPUT);
      if (response.status === "cancelled") {
        this.finish(session, "CANCELLED", response.error_code || "BRAIN_CORE_CANCELLED", text);
        return;
      }
      if (response.status !== "completed" || result.success === false) {
        const mapped = mapProcessFailure(response.error_code || "");
        this.finish(session, mapped.status, mapped.errorCode, text);
        return;
      }
      if (this.options.validateOutput && !(await this.options.validateOutput(input.projectRoot, output))) {
        if (this.isStale(session, generation)) return;
        this.finish(session, "FAILED", "BRAIN_VIDEO_OUTPUT_INVALID", text);
        return;
      }
      if (this.isStale(session, generation)) return;
      await this.registerSuccessArtifact(session, output);
      if (this.isStale(session, generation)) return;
      this.finish(session, "SUCCEEDED", "", text);
    }).catch((error: unknown) => {
      if (!this.isStale(session, generation)) this.finish(session, "FAILED", "BRAIN_VIDEO_RENDER_FAILED", String(error));
    });
    return { ...state };
  }

  status(ownerId: string, renderId: string) {
    const session = this.sessions.get(renderId);
    if (!session || session.ownerId !== ownerId) throw new Error("BRAIN_VIDEO_RENDER_NOT_FOUND");
    return { ...session.state };
  }

  async cancel(ownerId: string, renderId: string) {
    const session = this.sessions.get(renderId);
    if (!session || session.ownerId !== ownerId) throw new Error("BRAIN_VIDEO_RENDER_NOT_FOUND");
    if (TERMINAL.has(session.state.status)) return { ...session.state };
    session.abortController.abort(new Error("USER_CANCELLED"));
    session.generation += 1;
    try {
      const response = await session.client.request({
        request_id: `${session.requestId}:cancel:${randomUUID()}`,
        project_id: session.state.projectId,
        workspace_type: "video",
        operation: "request.cancel",
        approval_token: "",
        resource_limits: { timeout_ms: 0, max_output_bytes: 1_024 },
        payload: { target_request_id: session.requestId }
      });
      if (response.status !== "completed") return this.finish(session, "FAILED", response.error_code || "BRAIN_VIDEO_CANCEL_FAILED", "");
      return this.finish(session, "CANCELLED", "BRAIN_CORE_CANCELLED", "");
    } catch (error) {
      return this.finish(session, "FAILED", "BRAIN_VIDEO_CANCEL_FAILED", String(error));
    }
  }

  private isStale(session: Session, generation: number) {
    return session.abortController.signal.aborted || session.generation !== generation || TERMINAL.has(session.state.status);
  }

  private async registerSuccessArtifact(session: Session, output: string) {
    if (!this.options.storage) return;
    const absolute = resolve(session.projectRoot, output);
    const [bytes, fileStat] = await Promise.all([readFile(absolute), stat(absolute)]);
    const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const file = this.options.storage.registerFile({
      ownerId: session.ownerId,
      projectId: session.state.projectId,
      logicalName: basename(output),
      mimeType: "video/mp4",
      sizeBytes: fileStat.size,
      contentHash,
      storageKey: output
    });
    this.options.storage.registerArtifact({
      ownerId: session.ownerId,
      projectId: session.state.projectId,
      taskId: session.state.taskId,
      sourceFileId: file.id,
      artifactType: "video_render",
      storageKey: output,
      contentHash,
      validationStatus: "VALID"
    });
    session.state.outputFileId = file.id;
  }

  private persistTask(session: Session, status: "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED", progress: number, errorCode = "", errorDetail = "") {
    if (!this.options.storage) return;
    this.options.storage.updateTask({
      ownerId: session.ownerId,
      taskId: session.state.taskId,
      status,
      progress,
      errorCode,
      errorDetail: errorDetail.slice(0, 4_096),
      resultJson: JSON.stringify(session.state)
    });
  }

  private finish(session: Session, status: BrainVideoRenderState["status"], errorCode: string, output: string) {
    if (TERMINAL.has(session.state.status)) return { ...session.state };
    session.state.status = status;
    session.state.errorCode = errorCode;
    session.state.output = output.slice(-MAX_OUTPUT);
    session.state.finishedAt = now();
    if (status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED") {
      this.persistTask(session, status, status === "SUCCEEDED" ? 1 : 0.5, errorCode, session.state.output);
    }
    return { ...session.state };
  }
}
