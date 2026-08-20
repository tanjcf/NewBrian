import { randomBytes, randomUUID } from "node:crypto";
import type { BrainVideoRenderState, BrainVideoTimeline } from "@codex-forge/protocol";
import type { RustCoreRequest, RustCoreResponse } from "@codex-forge/protocol/rust-core";

type RustRequestInput = Omit<RustCoreRequest, "protocol_version">;
export interface VideoRenderRustClient { request(input: RustRequestInput): Promise<RustCoreResponse> }

export interface VideoRenderOptions {
  projectId: string;
  projectRoot: string;
  timeline: BrainVideoTimeline;
  outputRelativePath: string;
  acquireRustCore: (binding: { projectId: string; projectRoot: string; workspaceType: "video" }) => Promise<VideoRenderRustClient>;
  confirmRender: (input: { projectId: string; command: string; outputRelativePath: string }) => Promise<boolean>;
  validateOutput?: (projectRoot: string, outputRelativePath: string) => Promise<boolean>;
  platform?: NodeJS.Platform;
}

const MAX_OUTPUT = 64 * 1024;
const now = () => new Date().toISOString();
const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const decode = (value: unknown) => typeof value === "string" ? Buffer.from(value, "base64").toString("utf8") : "";

export class VideoRenderService {
  private readonly sessions = new Map<string, { ownerId: string; requestId: string; client: VideoRenderRustClient; state: BrainVideoRenderState }>();
  constructor(private readonly options: Pick<VideoRenderOptions, "acquireRustCore" | "confirmRender" | "validateOutput" | "platform">) {}

  async start(ownerId: string, input: VideoRenderOptions): Promise<BrainVideoRenderState> {
    const renderId = `video-render-${randomUUID()}`;
    const requestId = `${renderId}:process`;
    const executable = input.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
    const output = input.outputRelativePath.replaceAll("\\", "/");
    if (!output || output.startsWith("/") || output.includes("..")) throw new Error("BRAIN_VIDEO_OUTPUT_PATH_INVALID");
    const command = `${executable} -y -i <approved-project-media> -c:v libx264 -c:a aac ${output}`;
    if (!(await this.options.confirmRender({ projectId: input.projectId, command, outputRelativePath: output }))) throw new Error("BRAIN_VIDEO_RENDER_DECLINED");
    const client = await this.options.acquireRustCore({ projectId: input.projectId, projectRoot: input.projectRoot, workspaceType: "video" });
    const state: BrainVideoRenderState = { schemaVersion: 1, renderId, projectId: input.projectId, taskId: `video-task-${randomUUID()}`, status: "STARTING", outputFileId: "", outputPath: output, errorCode: "", output: "", startedAt: now(), finishedAt: "" };
    const session = { ownerId, requestId, client, state };
    this.sessions.set(renderId, session);
    const token = randomBytes(32).toString("base64url");
    const registration = await client.request({ request_id: `${requestId}:approval`, project_id: input.projectId, workspace_type: "video", operation: "approval.register", approval_token: "", resource_limits: { timeout_ms: 5_000, max_output_bytes: 1_024 }, payload: { token, operation: "process.run", ttl_ms: 30_000 } });
    if (registration.status !== "completed") return this.finish(session, "FAILED", registration.error_code || "BRAIN_CORE_APPROVAL_FAILED", "");
    state.status = "RUNNING";
    const args = ["-y", "-i", "<approved-project-media>", "-c:v", "libx264", "-c:a", "aac", output];
    void client.request({ request_id: requestId, project_id: input.projectId, workspace_type: "video", operation: "process.run", approval_token: token, resource_limits: { timeout_ms: 1_800_000, max_output_bytes: 1_048_576 }, payload: { executable, args, cwd: "." } }).then(async (response) => {
      const result = record(response.result); const text = `${decode(result.stdout_base64)}\n${decode(result.stderr_base64)}`.trim().slice(-MAX_OUTPUT);
      if (response.status === "cancelled") this.finish(session, "CANCELLED", response.error_code || "BRAIN_CORE_CANCELLED", text);
      else if (response.status !== "completed" || result.success === false) this.finish(session, response.error_code === "BRAIN_CORE_PROCESS_TIMEOUT" ? "TIMED_OUT" : "FAILED", response.error_code || "BRAIN_VIDEO_RENDER_FAILED", text);
      else if (this.options.validateOutput && !(await this.options.validateOutput(input.projectRoot, output))) this.finish(session, "FAILED", "BRAIN_VIDEO_OUTPUT_INVALID", text);
      else this.finish(session, "SUCCEEDED", "", text);
    }).catch((error: unknown) => this.finish(session, "FAILED", "BRAIN_VIDEO_RENDER_FAILED", String(error)));
    return { ...state };
  }

  status(ownerId: string, renderId: string) { const session = this.sessions.get(renderId); if (!session || session.ownerId !== ownerId) throw new Error("BRAIN_VIDEO_RENDER_NOT_FOUND"); return { ...session.state }; }
  async cancel(ownerId: string, renderId: string) { const session = this.sessions.get(renderId); if (!session || session.ownerId !== ownerId) throw new Error("BRAIN_VIDEO_RENDER_NOT_FOUND"); await session.client.request({ request_id: `${session.requestId}:cancel:${randomUUID()}`, project_id: session.state.projectId, workspace_type: "video", operation: "request.cancel", approval_token: "", resource_limits: { timeout_ms: 5_000, max_output_bytes: 1_024 }, payload: { target_request_id: session.requestId } }); return { ...session.state, status: "CANCELLED" as const }; }
  private finish(session: { state: BrainVideoRenderState }, status: BrainVideoRenderState["status"], errorCode: string, output: string) { session.state.status = status; session.state.errorCode = errorCode; session.state.output = output.slice(-MAX_OUTPUT); session.state.finishedAt = now(); return { ...session.state }; }
}
