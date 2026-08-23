import { randomBytes, randomUUID } from "node:crypto";
import type { BrainGamePreviewState, BrainGameProjectInspection } from "@codex-forge/protocol";
import type { RustCoreRequest, RustCoreResponse } from "@codex-forge/protocol/rust-core";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.js";

type RustRequestInput = Omit<RustCoreRequest, "protocol_version">;

export interface GamePreviewRustClient { request(input: RustRequestInput): Promise<RustCoreResponse> }

interface GamePreviewServiceOptions {
  storage: BrainWorkspaceStorage;
  resolveWorkspaceRoot: (workspaceId: string) => Promise<string>;
  acquireRustCore: (binding: { projectId: string; projectRoot: string; workspaceType: "game" }) => Promise<GamePreviewRustClient>;
  confirmStart: (input: { projectName: string; projectRoot: string; command: string }) => Promise<boolean>;
  inspectProject: (projectRoot: string) => Promise<BrainGameProjectInspection>;
  readinessProbe?: (url: string, signal?: AbortSignal) => Promise<boolean>;
  platform?: NodeJS.Platform;
  schedule?: (callback: () => void, delayMs: number) => NodeJS.Timeout;
  clearSchedule?: (timer: NodeJS.Timeout) => void;
}

interface InternalPreview {
  ownerId: string;
  requestId: string;
  client: GamePreviewRustClient;
  timer?: NodeJS.Timeout;
  readinessController?: AbortController;
  state: BrainGamePreviewState;
}

const ACTIVE = new Set<BrainGamePreviewState["status"]>(["STARTING", "RUNNING", "READY", "STOPPING"]);
const MAX_EVIDENCE_CHARS = 64 * 1024;

function now() { return new Date().toISOString(); }

function resultRecord(response: RustCoreResponse) {
  return response.result && typeof response.result === "object" && !Array.isArray(response.result)
    ? response.result as Record<string, unknown>
    : {};
}

function decode(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  try { return Buffer.from(value, "base64").toString("utf8"); } catch { return ""; }
}

export class GamePreviewService {
  private readonly options: GamePreviewServiceOptions;
  private readonly sessions = new Map<string, InternalPreview>();
  private readonly inspectProject: GamePreviewServiceOptions["inspectProject"];
  private readonly readinessProbe: NonNullable<GamePreviewServiceOptions["readinessProbe"]>;
  private readonly schedule: NonNullable<GamePreviewServiceOptions["schedule"]>;
  private readonly clearSchedule: NonNullable<GamePreviewServiceOptions["clearSchedule"]>;

  constructor(options: GamePreviewServiceOptions) {
    this.options = options;
    this.inspectProject = options.inspectProject;
    this.readinessProbe = options.readinessProbe ?? (async (url, signal) => {
      try {
        const response = await fetch(url, { signal, redirect: "manual" });
        return response.status >= 200 && response.status < 500;
      } catch { return false; }
    });
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearSchedule = options.clearSchedule ?? ((timer) => clearTimeout(timer));
  }

  async start(ownerId: string, input: { projectId: string; conversationId?: string }) {
    const current = this.sessions.get(input.projectId);
    if (current?.ownerId === ownerId && ACTIVE.has(current.state.status)) return { ...current.state };
    const project = this.requireGameProject(ownerId, input.projectId);
    if (!project.localWorkspaceId) throw new Error("BRAIN_LOCAL_WORKSPACE_REQUIRED");
    const projectRoot = await this.options.resolveWorkspaceRoot(project.localWorkspaceId);
    const inspection = await this.inspectProject(projectRoot);
    if (!inspection.preview.supported || !inspection.preview.command || !inspection.preview.args?.length) {
      throw new Error("BRAIN_GAME_PREVIEW_UNAVAILABLE");
    }
    const command = [inspection.preview.command, ...inspection.preview.args].join(" ");
    if (!(await this.options.confirmStart({ projectName: inspection.displayName, projectRoot, command }))) {
      throw new Error("BRAIN_GAME_PREVIEW_DECLINED");
    }
    const sessionId = `game-preview-${randomUUID()}`;
    const requestId = `${sessionId}:process`;
    const client = await this.options.acquireRustCore({ projectId: input.projectId, projectRoot, workspaceType: "game" });
    const task = this.options.storage.createTask({
      ownerId, projectId: input.projectId, conversationId: input.conversationId,
      workspaceKey: "game", taskType: "game.preview", requestId,
      idempotencyKey: sessionId, maxAttempts: 1,
      resourceLimitsJson: JSON.stringify({ maxOutputBytes: 1_048_576 })
    });
    const state: BrainGamePreviewState = {
      schemaVersion: 1, sessionId, projectId: input.projectId, taskId: task.id, status: "STARTING",
      command, previewUrl: inspection.preview.url || "", startedAt: now(), readyAt: "", finishedAt: "", errorCode: "", output: ""
    };
    const internal: InternalPreview = { ownerId, requestId, client, state };
    this.sessions.set(input.projectId, internal);
    this.options.storage.updateTask({ ownerId, taskId: task.id, status: "RUNNING", progress: 0.1 });

    const token = randomBytes(32).toString("base64url");
    let registration: RustCoreResponse;
    try {
      registration = await client.request({
        request_id: `${requestId}:approval`, project_id: input.projectId, workspace_type: "game",
        operation: "approval.register", approval_token: "",
        resource_limits: { timeout_ms: 0, max_output_bytes: 1_024 },
        payload: { token, operation: "process.run", ttl_ms: 0 }
      });
    } catch (error) {
      this.finish(internal, "FAILED", "BRAIN_CORE_APPROVAL_FAILED", error instanceof Error ? error.message : String(error));
      return { ...internal.state };
    }
    if (registration.status !== "completed") {
      this.finish(internal, "FAILED", registration.error_code || "BRAIN_CORE_APPROVAL_FAILED", "");
      return { ...internal.state };
    }
    internal.state.status = "RUNNING";
    const executable = this.options.platform === "win32" && inspection.preview.command === "npm" ? "npm.cmd" : inspection.preview.command;
    void client.request({
      request_id: requestId, project_id: input.projectId, workspace_type: "game", operation: "process.run", approval_token: token,
      resource_limits: { timeout_ms: 0, max_output_bytes: 1_048_576 },
      payload: { executable, args: inspection.preview.args, cwd: "." }
    }).then((response) => this.acceptCompletion(internal, response)).catch((error: unknown) => {
      this.finish(internal, "FAILED", "BRAIN_GAME_PREVIEW_PROCESS_FAILED", error instanceof Error ? error.message : String(error));
    });
    if (state.previewUrl) this.scheduleReadiness(internal, true);
    return { ...state };
  }

  status(ownerId: string, projectId: string) {
    const session = this.sessions.get(projectId);
    if (!session || session.ownerId !== ownerId) throw new Error("BRAIN_GAME_PREVIEW_NOT_FOUND");
    return { ...session.state };
  }

  async stop(ownerId: string, projectId: string) {
    const session = this.sessions.get(projectId);
    if (!session || session.ownerId !== ownerId) throw new Error("BRAIN_GAME_PREVIEW_NOT_FOUND");
    if (!ACTIVE.has(session.state.status)) return { ...session.state };
    session.state.status = "STOPPING";
    if (session.timer) { this.clearSchedule(session.timer); session.timer = undefined; }
    session.readinessController?.abort(new Error("Game preview readiness check cancelled."));
    session.readinessController = undefined;
    try {
      const response = await session.client.request({
        request_id: `${session.requestId}:cancel:${randomUUID()}`, project_id: projectId, workspace_type: "game",
        operation: "request.cancel", approval_token: "",
        resource_limits: { timeout_ms: 0, max_output_bytes: 1_024 }, payload: { target_request_id: session.requestId }
      });
      if (response.status !== "completed") {
        this.finish(session, "FAILED", response.error_code || "BRAIN_GAME_PREVIEW_CANCEL_FAILED", "");
      }
    } catch (error) {
      this.finish(session, "FAILED", "BRAIN_GAME_PREVIEW_CANCEL_FAILED", error instanceof Error ? error.message : String(error));
    }
    return { ...session.state };
  }

  private requireGameProject(ownerId: string, projectId: string) {
    const project = this.options.storage.getProject(ownerId, projectId);
    const gameProjects = this.options.storage.listProjects({ ownerId, workspaceKey: "game", includeArchived: false });
    if (!gameProjects.some((candidate) => candidate.id === project.id)) throw new Error("BRAIN_GAME_WORKSPACE_REQUIRED");
    return project;
  }

  private scheduleReadiness(session: InternalPreview, immediate = false) {
    if (!ACTIVE.has(session.state.status) || session.state.status === "STOPPING" || !session.state.previewUrl) return;
    session.timer = this.schedule(() => {
      const controller = new AbortController();
      session.readinessController = controller;
      void this.readinessProbe(session.state.previewUrl, controller.signal).then((ready) => {
        if (session.readinessController === controller) session.readinessController = undefined;
        if (!ACTIVE.has(session.state.status) || session.state.status === "STOPPING") return;
        if (ready) {
          session.state.status = "READY";
          session.state.readyAt = now();
          this.options.storage.updateTask({ ownerId: session.ownerId, taskId: session.state.taskId, status: "RUNNING", progress: 0.5, resultJson: this.evidence(session.state) });
        } else this.scheduleReadiness(session);
      }).catch(() => {
        if (session.readinessController === controller) session.readinessController = undefined;
        if (ACTIVE.has(session.state.status) && session.state.status !== "STOPPING") this.scheduleReadiness(session);
      });
    }, immediate ? 0 : 500);
    session.timer.unref?.();
  }

  private acceptCompletion(session: InternalPreview, response: RustCoreResponse) {
    const result = resultRecord(response);
    const output = [decode(result.stdout_base64), decode(result.stderr_base64)].filter(Boolean).join("\n").slice(-MAX_EVIDENCE_CHARS);
    if (response.status === "cancelled") this.finish(session, "CANCELLED", response.error_code || "BRAIN_CORE_CANCELLED", output);
    else if (response.status !== "completed") {
      this.finish(session, "FAILED", response.error_code || "BRAIN_GAME_PREVIEW_FAILED", output);
    } else if (result.success === false) this.finish(session, "FAILED", "BRAIN_GAME_PREVIEW_EXIT_NONZERO", output);
    else this.finish(session, "SUCCEEDED", "", output);
  }

  private finish(session: InternalPreview, status: Extract<BrainGamePreviewState["status"], "SUCCEEDED" | "FAILED" | "CANCELLED">, errorCode: string, output: string) {
    if (session.timer) { this.clearSchedule(session.timer); session.timer = undefined; }
    session.readinessController?.abort(new Error("Game preview process finished."));
    session.readinessController = undefined;
    session.state.status = status;
    session.state.finishedAt = now();
    session.state.errorCode = errorCode;
    session.state.output = output.slice(-MAX_EVIDENCE_CHARS);
    const taskStatus = status === "SUCCEEDED" ? "SUCCEEDED" : status;
    this.options.storage.updateTask({
      ownerId: session.ownerId, taskId: session.state.taskId, status: taskStatus,
      progress: status === "SUCCEEDED" ? 1 : 0.5, errorCode, errorDetail: output.slice(-4_096), resultJson: this.evidence(session.state)
    });
  }

  private evidence(state: BrainGamePreviewState) {
    return JSON.stringify({ schemaVersion: 1, sessionId: state.sessionId, command: state.command, previewUrl: state.previewUrl, startedAt: state.startedAt, readyAt: state.readyAt, finishedAt: state.finishedAt, status: state.status, output: state.output });
  }
}
