import assert from "node:assert/strict";
import test from "node:test";
import type { RustCoreResponse } from "@codex-forge/protocol/rust-core";
import { GamePreviewService } from "./game-preview-service.ts";

function response(requestId: string, status: RustCoreResponse["status"], result?: unknown, errorCode = ""): RustCoreResponse {
  return { protocol_version: "1", request_id: requestId, status, error_code: errorCode, artifacts: [], ...(result === undefined ? {} : { result }) };
}

function fixture(options: { approved?: boolean; ready?: boolean } = {}) {
  const requests: any[] = [];
  const taskUpdates: any[] = [];
  let completeProcess!: (value: RustCoreResponse) => void;
  const processResult = new Promise<RustCoreResponse>((resolve) => { completeProcess = resolve; });
  const client = {
    request: async (input: any) => {
      requests.push(input);
      if (input.operation === "approval.register") return response(input.request_id, "completed", { registered: true });
      if (input.operation === "request.cancel") return response(input.request_id, "completed", { cancelled: input.payload.target_request_id });
      if (input.operation === "process.run") return processResult;
      throw new Error(`unexpected operation ${input.operation}`);
    }
  };
  const storage = {
    getProject: (ownerId: string, projectId: string) => {
      if (ownerId !== "owner-a") throw new Error("BRAIN_PROJECT_FORBIDDEN");
      return { id: projectId, localWorkspaceId: "workspace-a" };
    },
    listProjects: () => [{ id: "project-a" }],
    createTask: (input: any) => ({ ...input, id: "task-a", resultJson: "{}" }),
    updateTask: (input: any) => { taskUpdates.push(input); return input; }
  };
  let scheduled = 0;
  const service = new GamePreviewService({
    storage: storage as any,
    resolveWorkspaceRoot: async () => "C:\\authorized-game",
    inspectProject: async () => ({
      schemaVersion: 1, engine: "web", displayName: "Tiny Game", markers: ["package.json"],
      assets: { scripts: 1, scenes: 1, images: 0, audio: 0, video: 0, models: 0, other: 0 },
      preview: { supported: true, command: "npm", args: ["run", "dev"], url: "http://127.0.0.1:5173", requiresApproval: true },
      warnings: [], scannedEntries: 3, skippedEntries: 0, truncated: false
    }),
    confirmStart: async () => options.approved !== false,
    acquireRustCore: async () => client,
    readinessProbe: async () => options.ready !== false,
    platform: "win32",
    schedule: (callback) => { if (scheduled++ === 0) queueMicrotask(callback); return { unref() {} } as any; },
    clearSchedule: () => undefined
  });
  return { service, requests, taskUpdates, completeProcess };
}

test("does not register approval or start a process when native confirmation is denied", async () => {
  const { service, requests } = fixture({ approved: false });
  await assert.rejects(() => service.start("owner-a", { projectId: "project-a" }), /BRAIN_GAME_PREVIEW_DECLINED/);
  assert.equal(requests.length, 0);
});

test("starts only the inspected command with a one-time scoped approval and reaches ready", async () => {
  const { service, requests } = fixture();
  const started = await service.start("owner-a", { projectId: "project-a", conversationId: "conversation-a" });
  assert.equal(started.status, "RUNNING");
  assert.equal(requests[0]?.operation, "approval.register");
  assert.equal(requests[0]?.payload.ttl_ms, 0);
  assert.equal(requests[0]?.payload.operation, "process.run");
  assert.equal(requests[1]?.operation, "process.run");
  assert.equal(requests[1]?.payload.executable, "npm.cmd");
  assert.deepEqual(requests[1]?.payload.args, ["run", "dev"]);
  assert.equal(requests[1]?.payload.cwd, ".");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.status("owner-a", "project-a").status, "READY");
});

test("deduplicates an active preview and cancellation records bounded evidence", async () => {
  const { service, requests, taskUpdates, completeProcess } = fixture({ ready: false });
  const first = await service.start("owner-a", { projectId: "project-a" });
  const duplicate = await service.start("owner-a", { projectId: "project-a" });
  assert.equal(duplicate.sessionId, first.sessionId);
  assert.equal(requests.filter((item) => item.operation === "process.run").length, 1);

  const stopping = await service.stop("owner-a", "project-a");
  assert.equal(stopping.status, "STOPPING");
  assert.equal(requests.at(-1)?.operation, "request.cancel");
  completeProcess(response(requests[1].request_id, "cancelled", undefined, "BRAIN_CORE_CANCELLED"));
  await new Promise((resolve) => setImmediate(resolve));

  const cancelled = service.status("owner-a", "project-a");
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(cancelled.errorCode, "BRAIN_CORE_CANCELLED");
  assert.ok(taskUpdates.some((item) => item.status === "CANCELLED" && item.resultJson.includes("previewUrl")));
});

test("rejects status access from another owner", async () => {
  const { service } = fixture();
  await service.start("owner-a", { projectId: "project-a" });
  assert.throws(() => service.status("owner-b", "project-a"), /BRAIN_GAME_PREVIEW_NOT_FOUND/);
});

test("readiness probing has no fixed attempt or request deadline and stops through explicit cancellation", async () => {
  let readinessSignal: AbortSignal | undefined;
  const requests: any[] = [];
  const service = new GamePreviewService({
    storage: {
      getProject: () => ({ id: "project-a", localWorkspaceId: "workspace-a" }),
      listProjects: () => [{ id: "project-a" }],
      createTask: (input: any) => ({ ...input, id: "task-a" }),
      updateTask: (input: any) => input
    } as any,
    resolveWorkspaceRoot: async () => "C:\\authorized-game",
    inspectProject: async () => ({
      schemaVersion: 1, engine: "web", displayName: "Slow Game", markers: ["package.json"],
      assets: { scripts: 1, scenes: 1, images: 0, audio: 0, video: 0, models: 0, other: 0 },
      preview: { supported: true, command: "npm", args: ["run", "dev"], url: "http://127.0.0.1:5173", requiresApproval: true },
      warnings: [], scannedEntries: 3, skippedEntries: 0, truncated: false
    }),
    confirmStart: async () => true,
    acquireRustCore: async () => ({ request: async (input: any) => {
      requests.push(input);
      if (input.operation === "approval.register" || input.operation === "request.cancel") return response(input.request_id, "completed");
      return new Promise<RustCoreResponse>(() => undefined);
    } }),
    readinessProbe: async (_url, signal) => {
      readinessSignal = signal;
      return new Promise<boolean>(() => undefined);
    },
    schedule: (callback) => { queueMicrotask(callback); return { unref() {} } as any; },
    clearSchedule: () => undefined
  });

  await service.start("owner-a", { projectId: "project-a" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(readinessSignal?.aborted, false);
  await service.stop("owner-a", "project-a");
  assert.equal(readinessSignal?.aborted, true);
  assert.equal(requests.at(-1)?.operation, "request.cancel");
});
