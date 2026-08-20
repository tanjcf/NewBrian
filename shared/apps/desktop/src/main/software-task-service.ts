import { randomBytes, randomUUID } from "node:crypto";
import type { BrainSoftwareScript, BrainSoftwareTaskState } from "@codex-forge/protocol/software-types";
import type { RustCoreRequest, RustCoreResponse } from "@codex-forge/protocol/rust-core";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.js";
import { discoverSoftwareScripts } from "./software-script-discovery.ts";

type RustRequestInput = Omit<RustCoreRequest, "protocol_version">;
export interface SoftwareTaskRustClient { request(input: RustRequestInput): Promise<RustCoreResponse> }
interface Options {
  storage: BrainWorkspaceStorage;
  resolveWorkspaceRoot: (workspaceId: string) => Promise<string>;
  acquireRustCore: (binding: { projectId: string; projectRoot: string; workspaceType: "software" }) => Promise<SoftwareTaskRustClient>;
  confirmRun: (input: { projectId: string; script: BrainSoftwareScript; projectRoot: string }) => Promise<boolean>;
  platform?: NodeJS.Platform;
}
interface Session { ownerId: string; requestId: string; client: SoftwareTaskRustClient; state: BrainSoftwareTaskState }
const MAX_OUTPUT = 64 * 1024;
const now = () => new Date().toISOString();
const record = (v: unknown) => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const decode = (v: unknown) => typeof v === "string" ? Buffer.from(v, "base64").toString("utf8") : "";

export class SoftwareTaskService {
  private readonly sessions = new Map<string, Session>();
  constructor(private readonly options: Options) {}

  async start(ownerId: string, input: { projectId: string; scriptId: string; conversationId?: string }) {
    const project = this.options.storage.getProject(ownerId, input.projectId);
    if (project.primaryWorkspaceKey !== "software") throw new Error("BRAIN_SOFTWARE_WORKSPACE_REQUIRED");
    if (!project.localWorkspaceId) throw new Error("BRAIN_LOCAL_WORKSPACE_REQUIRED");
    const projectRoot = await this.options.resolveWorkspaceRoot(project.localWorkspaceId);
    const scripts = await discoverSoftwareScripts(projectRoot);
    const script = scripts.find((candidate) => candidate.id === input.scriptId);
    if (!script) throw new Error("BRAIN_SOFTWARE_SCRIPT_NOT_APPROVED");
    if (!(await this.options.confirmRun({ projectId: input.projectId, script, projectRoot }))) throw new Error("BRAIN_SOFTWARE_RUN_DECLINED");
    const taskId = `software-task-${randomUUID()}`;
    const requestId = `${taskId}:process`;
    const client = await this.options.acquireRustCore({ projectId: input.projectId, projectRoot, workspaceType: "software" });
    const task = this.options.storage.createTask({ ownerId, projectId: input.projectId, conversationId: input.conversationId, workspaceKey: "software", taskType: `software.${script.operation}`, requestId, idempotencyKey: taskId, maxAttempts: 1, resourceLimitsJson: JSON.stringify({ timeoutMs: 900_000, maxOutputBytes: 1_048_576 }) });
    const state: BrainSoftwareTaskState = { schemaVersion: 1, id: taskId, projectId: input.projectId, operation: script.operation, scriptId: script.id, status: "AWAITING_APPROVAL", requestId, startedAt: now(), finishedAt: "", errorCode: "", output: "", artifactIds: [] };
    const session = { ownerId, requestId, client, state };
    this.sessions.set(taskId, session);
    this.options.storage.updateTask({ ownerId, taskId: task.id, status: "RUNNING", progress: 0.1 });
    const token = randomBytes(32).toString("base64url");
    try {
      const registration = await client.request({ request_id: `${requestId}:approval`, project_id: input.projectId, workspace_type: "software", operation: "approval.register", approval_token: "", resource_limits: { timeout_ms: 5_000, max_output_bytes: 1_024 }, payload: { token, operation: "process.run", ttl_ms: 30_000 } });
      if (registration.status !== "completed") return this.finish(session, "FAILED", registration.error_code || "BRAIN_CORE_APPROVAL_FAILED", "");
      state.status = "RUNNING";
      const executable = this.options.platform === "win32" && script.executable === "npm" ? "npm.cmd" : script.executable;
      void client.request({ request_id: requestId, project_id: input.projectId, workspace_type: "software", operation: "process.run", approval_token: token, resource_limits: { timeout_ms: 900_000, max_output_bytes: 1_048_576 }, payload: { executable, args: script.args, cwd: script.cwd } }).then((response) => this.accept(session, response)).catch((error: unknown) => this.finish(session, "FAILED", "BRAIN_SOFTWARE_PROCESS_FAILED", String(error)));
      return { ...state };
    } catch (error) { return this.finish(session, "FAILED", "BRAIN_CORE_APPROVAL_FAILED", String(error)); }
  }
  status(ownerId: string, taskId: string) { const s = this.sessions.get(taskId); if (!s || s.ownerId !== ownerId) throw new Error("BRAIN_SOFTWARE_TASK_NOT_FOUND"); return { ...s.state }; }
  async cancel(ownerId: string, taskId: string) { const s = this.sessions.get(taskId); if (!s || s.ownerId !== ownerId) throw new Error("BRAIN_SOFTWARE_TASK_NOT_FOUND"); if (["SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(s.state.status)) return { ...s.state }; await s.client.request({ request_id: `${s.requestId}:cancel:${randomUUID()}`, project_id: s.state.projectId, workspace_type: "software", operation: "request.cancel", approval_token: "", resource_limits: { timeout_ms: 5_000, max_output_bytes: 1_024 }, payload: { target_request_id: s.requestId } }); s.state.status = "CANCELLED"; s.state.finishedAt = now(); return { ...s.state }; }
  private accept(s: Session, response: RustCoreResponse) { const result = record(response.result); const output = `${decode(result.stdout_base64)}\n${decode(result.stderr_base64)}`.trim().slice(-MAX_OUTPUT); if (response.status === "cancelled") return this.finish(s, "CANCELLED", response.error_code || "BRAIN_CORE_CANCELLED", output); if (response.status !== "completed" || result.success === false) return this.finish(s, response.error_code === "BRAIN_CORE_PROCESS_TIMEOUT" ? "TIMED_OUT" : "FAILED", response.error_code || "BRAIN_SOFTWARE_PROCESS_FAILED", output); return this.finish(s, "SUCCEEDED", "", output); }
  private finish(s: Session, status: BrainSoftwareTaskState["status"], errorCode: string, output: string) { s.state.status = status; s.state.errorCode = errorCode; s.state.output = output.slice(-MAX_OUTPUT); s.state.finishedAt = now(); const task = this.options.storage.listTasks(s.ownerId, s.state.projectId).find((item) => item.requestId === s.requestId); if (task) this.options.storage.updateTask({ ownerId: s.ownerId, taskId: task.id, status: status === "SUCCEEDED" ? "SUCCEEDED" : status, progress: status === "SUCCEEDED" ? 1 : 0.5, errorCode, errorDetail: s.state.output.slice(-4_096), resultJson: JSON.stringify(s.state) }); return { ...s.state }; }
}
