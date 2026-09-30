import { randomBytes, randomUUID } from "node:crypto";
import type { BrainSoftwareScript, BrainSoftwareTaskState } from "@codex-forge/protocol";
import type { RustCoreRequest, RustCoreResponse } from "@codex-forge/protocol/rust-core";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.js";
import { discoverSoftwareScripts } from "./software-script-discovery.ts";
import { boundSoftwareOutput, mapSoftwareResponse } from "./software-task-policy.ts";

type RustRequestInput = Omit<RustCoreRequest, "protocol_version">;
export interface SoftwareTaskRustClient { request(input: RustRequestInput): Promise<RustCoreResponse> }
interface Options {
  storage: BrainWorkspaceStorage;
  resolveWorkspaceRoot: (workspaceId: string) => Promise<string>;
  acquireRustCore: (binding: { projectId: string; projectRoot: string; workspaceType: "software" }) => Promise<SoftwareTaskRustClient>;
  confirmRun: (input: { projectId: string; script: BrainSoftwareScript; projectRoot: string }) => Promise<boolean>;
  platform?: NodeJS.Platform;
}
interface Session { ownerId: string; taskId: string; requestId: string; client: SoftwareTaskRustClient; state: BrainSoftwareTaskState }
const MAX_OUTPUT = 64 * 1024;
const TERMINAL = new Set<BrainSoftwareTaskState["status"]>(["SUCCEEDED", "FAILED", "CANCELLED"]);
const now = () => new Date().toISOString();
const record = (v: unknown) => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const decode = (v: unknown) => typeof v === "string" ? Buffer.from(v, "base64").toString("utf8") : "";

export class SoftwareTaskService {
  private readonly options: Options;
  private readonly sessions = new Map<string, Session>();

  constructor(options: Options) {
    this.options = options;
  }

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
    const task = this.options.storage.createTask({ ownerId, projectId: input.projectId, conversationId: input.conversationId, workspaceKey: "software", taskType: `software.${script.operation}`, requestId, idempotencyKey: taskId, maxAttempts: 1, resourceLimitsJson: JSON.stringify({ maxOutputBytes: 1_048_576 }) });
    const state: BrainSoftwareTaskState = { schemaVersion: 1, id: taskId, projectId: input.projectId, operation: script.operation, scriptId: script.id, status: "AWAITING_APPROVAL", requestId, startedAt: now(), finishedAt: "", errorCode: "", output: "", artifactIds: [] };
    const session = { ownerId, taskId: task.id, requestId, client, state };
    this.sessions.set(taskId, session);
    this.options.storage.updateTask({ ownerId, taskId: task.id, status: "RUNNING", progress: 0.1, resultJson: JSON.stringify(state) });
    const token = randomBytes(32).toString("base64url");
    try {
      const registration = await client.request({ request_id: `${requestId}:approval`, project_id: input.projectId, workspace_type: "software", operation: "approval.register", approval_token: "", resource_limits: { timeout_ms: 0, max_output_bytes: 1_024 }, payload: { token, operation: "process.run", ttl_ms: 0 } });
      if (registration.status !== "completed") return this.finish(session, "FAILED", registration.error_code || "BRAIN_CORE_APPROVAL_FAILED", "");
      state.status = "RUNNING";
      this.options.storage.updateTask({ ownerId, taskId: task.id, status: "RUNNING", progress: 0.2, resultJson: JSON.stringify(state) });
      const executable = this.options.platform === "win32" && script.executable === "npm" ? "npm.cmd" : script.executable;
      void client.request({ request_id: requestId, project_id: input.projectId, workspace_type: "software", operation: "process.run", approval_token: token, resource_limits: { timeout_ms: 0, max_output_bytes: 1_048_576 }, payload: { executable, args: script.args, cwd: script.cwd } }).then((response) => this.accept(session, response)).catch((error: unknown) => {
        if (!TERMINAL.has(session.state.status)) this.finish(session, "FAILED", "BRAIN_SOFTWARE_PROCESS_FAILED", String(error));
      });
      return { ...state };
    } catch (error) { return this.finish(session, "FAILED", "BRAIN_CORE_APPROVAL_FAILED", String(error)); }
  }
  status(ownerId: string, taskId: string) { const s = this.sessions.get(taskId); if (!s || s.ownerId !== ownerId) throw new Error("BRAIN_SOFTWARE_TASK_NOT_FOUND"); return { ...s.state }; }
  async cancel(ownerId: string, taskId: string) {
    const s = this.sessions.get(taskId);
    if (!s || s.ownerId !== ownerId) throw new Error("BRAIN_SOFTWARE_TASK_NOT_FOUND");
    if (TERMINAL.has(s.state.status)) return { ...s.state };
    try {
      const response = await s.client.request({ request_id: `${s.requestId}:cancel:${randomUUID()}`, project_id: s.state.projectId, workspace_type: "software", operation: "request.cancel", approval_token: "", resource_limits: { timeout_ms: 0, max_output_bytes: 1_024 }, payload: { target_request_id: s.requestId } });
      if (response.status !== "completed") return this.finish(s, "FAILED", response.error_code || "BRAIN_SOFTWARE_CANCEL_FAILED", "");
      return this.finish(s, "CANCELLED", "BRAIN_CORE_CANCELLED", "");
    } catch (error) {
      return this.finish(s, "FAILED", "BRAIN_SOFTWARE_CANCEL_FAILED", String(error));
    }
  }
  private accept(s: Session, response: RustCoreResponse) { if (TERMINAL.has(s.state.status)) return { ...s.state }; const result = record(response.result); const output = boundSoftwareOutput(decode(result.stdout_base64), decode(result.stderr_base64), MAX_OUTPUT); const status = mapSoftwareResponse(response.status, result.success, response.error_code); if (status === "CANCELLED") return this.finish(s, status, response.error_code || "BRAIN_CORE_CANCELLED", output); if (status !== "SUCCEEDED") return this.finish(s, status, response.error_code || "BRAIN_SOFTWARE_PROCESS_FAILED", output); return this.finish(s, status, "", output); }
  private finish(s: Session, status: BrainSoftwareTaskState["status"], errorCode: string, output: string) { if (TERMINAL.has(s.state.status)) return { ...s.state }; s.state.status = status; s.state.errorCode = errorCode; s.state.output = boundSoftwareOutput("", output, MAX_OUTPUT); s.state.finishedAt = now(); this.options.storage.updateTask({ ownerId: s.ownerId, taskId: s.taskId, status: status === "SUCCEEDED" ? "SUCCEEDED" : status, progress: status === "SUCCEEDED" ? 1 : 0.5, errorCode, errorDetail: boundSoftwareOutput("", s.state.output, 4_096), resultJson: JSON.stringify(s.state) }); return { ...s.state }; }
}
