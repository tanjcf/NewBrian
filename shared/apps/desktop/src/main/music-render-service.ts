import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { BrainMusicRenderRequest } from "@codex-forge/protocol/music-types";
import type { RustCoreRequest, RustCoreResponse } from "@codex-forge/protocol/rust-core";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.js";

type RequestInput = Omit<RustCoreRequest, "protocol_version">;
type MusicRenderStatus = "STARTING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
type MusicRenderState = {
  schemaVersion: 1;
  renderId: string;
  projectId: string;
  taskId: string;
  status: MusicRenderStatus;
  outputFileId: string;
  outputPath: string;
  errorCode: string;
  output: string;
  startedAt: string;
  finishedAt: string;
};

export interface MusicRenderRustClient { request(input: RequestInput): Promise<RustCoreResponse> }
export interface MusicRenderOptions {
  acquireRustCore: (binding: { projectId: string; projectRoot: string; workspaceType: "music" }) => Promise<MusicRenderRustClient>;
  confirmRender: (input: { projectId: string; command: string }) => Promise<boolean>;
  prepareOutput?: (root: string, output: string) => Promise<void>;
  validateOutput?: (root: string, output: string) => Promise<boolean>;
  resolveFfmpegExecutable?: () => Promise<string>;
  storage?: BrainWorkspaceStorage;
  platform?: NodeJS.Platform;
}
export type MusicRenderInput = BrainMusicRenderRequest & { projectRoot: string; mediaRelativePaths?: string[] };
type Session = {
  ownerId: string;
  requestId: string;
  client: MusicRenderRustClient;
  state: MusicRenderState;
  abortController: AbortController;
  generation: number;
  projectRoot: string;
};

const TERMINAL = new Set<MusicRenderStatus>(["SUCCEEDED", "FAILED", "CANCELLED"]);
const MAX_OUTPUT = 64 * 1024;
const now = () => new Date().toISOString();
const rec = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const dec = (value: unknown) => typeof value === "string" ? Buffer.from(value, "base64").toString("utf8") : "";

function safeRelativePath(value: string, code: string) {
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (!normalized || normalized.startsWith("/") || /^[a-z]:\//iu.test(normalized) || segments.some((segment) => segment === "..")) throw new Error(code);
  return normalized;
}

function mapProcessFailure(errorCode: string): { status: MusicRenderStatus; errorCode: string } {
  return { status: "FAILED", errorCode: errorCode || "BRAIN_MUSIC_RENDER_FAILED" };
}

export class MusicRenderService {
  private readonly options: MusicRenderOptions;
  private readonly sessions = new Map<string, Session>();
  private readonly platform: NodeJS.Platform;

  constructor(options: MusicRenderOptions) {
    this.options = options;
    this.platform = options.platform ?? process.platform;
  }

  async start(ownerId: string, input: MusicRenderInput) {
    const output = safeRelativePath(input.outputRelativePath, "BRAIN_MUSIC_OUTPUT_PATH_INVALID");
    if (!/\.wav$/iu.test(output)) throw new Error("BRAIN_MUSIC_OUTPUT_FORMAT_UNSUPPORTED");
    const media = (input.mediaRelativePaths || []).map((item) => safeRelativePath(item, "BRAIN_MUSIC_MEDIA_PATH_INVALID"));
    const renderId = `music-render-${randomUUID()}`;
    const requestId = `${renderId}:process`;
    const executable = this.options.resolveFfmpegExecutable
      ? await this.options.resolveFfmpegExecutable()
      : (this.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    const duration = String(Math.max(0.1, input.timeline.durationMs / 1000));
    const inputArgs = media.length
      ? ["-i", media[0]!]
      : ["-f", "lavfi", "-i", `anullsrc=r=${input.timeline.sampleRate}:cl=${input.timeline.channels === 1 ? "mono" : "stereo"}`];
    const args = ["-y", ...inputArgs, "-t", duration, output];
    const command = `${executable} ${args.join(" ")}`;
    if (!(await this.options.confirmRender({ projectId: input.projectId, command }))) throw new Error("BRAIN_MUSIC_RENDER_DECLINED");
    await this.options.prepareOutput?.(input.projectRoot, output);

    let taskId = `music-task-${randomUUID()}`;
    if (this.options.storage) {
      const task = this.options.storage.createTask({
        ownerId,
        projectId: input.projectId,
        workspaceKey: "music",
        taskType: "music_render",
        requestId,
        idempotencyKey: renderId,
        maxAttempts: 1,
        resourceLimitsJson: JSON.stringify({ timeoutMs: 0, maxOutputBytes: 1_048_576 })
      });
      taskId = task.id;
    }

    const client = await this.options.acquireRustCore({ projectId: input.projectId, projectRoot: input.projectRoot, workspaceType: "music" });
    const state: MusicRenderState = {
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
    const approval = await client.request({
      request_id: `${requestId}:approval`,
      project_id: input.projectId,
      workspace_type: "music",
      operation: "approval.register",
      approval_token: "",
      resource_limits: { timeout_ms: 0, max_output_bytes: 1_024 },
      payload: { token, operation: "process.run", ttl_ms: 0 }
    });
    if (approval.status !== "completed") return this.finish(session, "FAILED", approval.error_code || "BRAIN_CORE_APPROVAL_FAILED", "");

    state.status = "RUNNING";
    this.persistTask(session, "RUNNING", 0.2);
    const generation = session.generation;
    void client.request({
      request_id: requestId,
      project_id: input.projectId,
      workspace_type: "music",
      operation: "process.run",
      approval_token: token,
      resource_limits: { timeout_ms: 0, max_output_bytes: 1_048_576 },
      payload: { executable, args, cwd: "." }
    })
      .then((response) => this.complete(session, response, generation))
      .catch((error: unknown) => {
        if (!this.isStale(session, generation)) this.finish(session, "FAILED", "BRAIN_MUSIC_RENDER_FAILED", String(error));
      });
    return { ...state };
  }

  status(ownerId: string, id: string) {
    const session = this.require(ownerId, id);
    return { ...session.state };
  }

  async cancel(ownerId: string, id: string) {
    const session = this.require(ownerId, id);
    if (TERMINAL.has(session.state.status)) return { ...session.state };
    session.abortController.abort(new Error("USER_CANCELLED"));
    session.generation += 1;
    try {
      const response = await session.client.request({
        request_id: `${session.requestId}:cancel:${randomUUID()}`,
        project_id: session.state.projectId,
        workspace_type: "music",
        operation: "request.cancel",
        approval_token: "",
        resource_limits: { timeout_ms: 0, max_output_bytes: 1_024 },
        payload: { target_request_id: session.requestId }
      });
      if (response.status !== "completed") return this.finish(session, "FAILED", response.error_code || "BRAIN_MUSIC_CANCEL_FAILED", "");
      return this.finish(session, "CANCELLED", "BRAIN_CORE_CANCELLED", "");
    } catch (error) {
      return this.finish(session, "FAILED", "BRAIN_MUSIC_CANCEL_FAILED", String(error));
    }
  }

  private require(ownerId: string, id: string) {
    const session = this.sessions.get(id);
    if (!session || session.ownerId !== ownerId) throw new Error("BRAIN_MUSIC_RENDER_NOT_FOUND");
    return session;
  }

  private isStale(session: Session, generation: number) {
    return session.abortController.signal.aborted || session.generation !== generation || TERMINAL.has(session.state.status);
  }

  private async complete(session: Session, response: RustCoreResponse, generation: number) {
    if (this.isStale(session, generation)) return { ...session.state };
    const result = rec(response.result);
    const output = `${dec(result.stdout_base64)}\n${dec(result.stderr_base64)}`.trim();
    if (response.status === "cancelled") return this.finish(session, "CANCELLED", response.error_code || "BRAIN_CORE_CANCELLED", output);
    if (response.status !== "completed" || result.success === false) {
      const mapped = mapProcessFailure(response.error_code || "");
      return this.finish(session, mapped.status, mapped.errorCode, output);
    }
    if (this.options.validateOutput) {
      try {
        const valid = await this.options.validateOutput(session.projectRoot, session.state.outputPath);
        if (this.isStale(session, generation)) return { ...session.state };
        if (!valid) return this.finish(session, "FAILED", "BRAIN_MUSIC_OUTPUT_INVALID", output);
      } catch {
        if (!this.isStale(session, generation)) return this.finish(session, "FAILED", "BRAIN_MUSIC_OUTPUT_INVALID", output);
        return { ...session.state };
      }
    }
    if (this.isStale(session, generation)) return { ...session.state };
    await this.registerSuccessArtifact(session);
    if (this.isStale(session, generation)) return { ...session.state };
    return this.finish(session, "SUCCEEDED", "", output);
  }

  private async registerSuccessArtifact(session: Session) {
    if (!this.options.storage) return;
    const absolute = resolve(session.projectRoot, session.state.outputPath);
    const [bytes, fileStat] = await Promise.all([readFile(absolute), stat(absolute)]);
    const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const file = this.options.storage.registerFile({
      ownerId: session.ownerId,
      projectId: session.state.projectId,
      logicalName: basename(session.state.outputPath),
      mimeType: "audio/wav",
      sizeBytes: fileStat.size,
      contentHash,
      storageKey: session.state.outputPath
    });
    this.options.storage.registerArtifact({
      ownerId: session.ownerId,
      projectId: session.state.projectId,
      taskId: session.state.taskId,
      sourceFileId: file.id,
      artifactType: "music_render",
      storageKey: session.state.outputPath,
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

  private finish(session: Session, status: MusicRenderStatus, errorCode: string, output: string) {
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
