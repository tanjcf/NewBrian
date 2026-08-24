import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { BrainVideoRenderState, BrainVideoTimeline } from "@codex-forge/protocol";
import type { RustCoreRequest, RustCoreResponse } from "@codex-forge/protocol/rust-core";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.js";

type RustRequestInput = Omit<RustCoreRequest, "protocol_version">;
export interface VideoRenderRustClient { request(input: RustRequestInput): Promise<RustCoreResponse> }

export interface VideoRenderOptions {
  projectId: string;
  projectRoot: string;
  timeline: BrainVideoTimeline;
  outputRelativePath: string;
  mediaRelativePaths?: string[];
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

function buildVideoFfmpegArgs(media: string[], output: string, concatListRelative?: string): string[] {
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
  if (media.length === 1) {
    return ["-y", "-i", media[0]!, "-c:v", "libx264", "-c:a", "aac", output];
  }
  return ["-y", "-f", "concat", "-safe", "0", "-i", concatListRelative!, "-c:v", "libx264", "-c:a", "aac", output];
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
    const media = (input.mediaRelativePaths || []).map((item) => safeRelativePath(item, "BRAIN_VIDEO_MEDIA_NOT_FOUND"));
    if (!media.length && !input.allowSyntheticMedia) throw new Error("BRAIN_VIDEO_MEDIA_NOT_FOUND");
    let concatListRelative: string | undefined;
    if (media.length > 1) {
      concatListRelative = `.brain-video/concat-${renderId}.txt`;
      const listAbsolute = resolve(input.projectRoot, concatListRelative);
      await mkdir(dirname(listAbsolute), { recursive: true });
      // FFmpeg resolves concat entries relative to the concat list itself,
      // which lives under .brain-video rather than the project root.
      const body = media.map((path) => `file '../${path.replaceAll("'", "'\\''")}'`).join("\n");
      await writeFile(listAbsolute, `${body}\n`, "utf8");
    }
    const args = buildVideoFfmpegArgs(media, output, concatListRelative);
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
