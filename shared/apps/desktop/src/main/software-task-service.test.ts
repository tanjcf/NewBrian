import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { RustCoreRequest, RustCoreResponse, RustCoreStatus } from "@codex-forge/protocol/rust-core";
import { BrainWorkspaceStorage } from "./brain-workspace-storage.ts";
import { SoftwareTaskService, type SoftwareTaskRustClient } from "./software-task-service.ts";

type RequestInput = Omit<RustCoreRequest, "protocol_version">;

function response(requestId: string, status: RustCoreStatus = "completed", result: unknown = {}, errorCode = ""): RustCoreResponse {
  return { protocol_version: "1", request_id: requestId, status, error_code: errorCode, artifacts: [], result };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for software task state");
}

function fixture(input: {
  confirmRun?: boolean;
  request: (request: RequestInput) => Promise<RustCoreResponse>;
}) {
  const root = mkdtempSync(join(tmpdir(), "brain-software-task-"));
  const projectRoot = join(root, "project");
  const storageRoot = join(root, "state");
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ scripts: { test: "node --test", deploy: "forbidden" } }), "utf8");
  const storage = new BrainWorkspaceStorage(storageRoot);
  const project = storage.createProject({ ownerId: "owner-a", name: "软件项目", primaryWorkspaceKey: "software", localWorkspaceId: "workspace-a" });
  let acquired = 0;
  const client: SoftwareTaskRustClient = { request: input.request };
  const service = new SoftwareTaskService({
    storage,
    resolveWorkspaceRoot: async (workspaceId) => {
      assert.equal(workspaceId, "workspace-a");
      return projectRoot;
    },
    acquireRustCore: async (binding) => {
      acquired += 1;
      assert.deepEqual(binding, { projectId: project.id, projectRoot, workspaceType: "software" });
      return client;
    },
    confirmRun: async () => input.confirmRun ?? true,
    platform: "win32"
  });
  return {
    storage,
    project,
    service,
    acquired: () => acquired,
    close: () => { storage.close(); rmSync(root, { recursive: true, force: true }); }
  };
}

test("runs an approved package script and persists bounded successful evidence", async () => {
  const calls: RequestInput[] = [];
  const context = fixture({
    request: async (request) => {
      calls.push(request);
      if (request.operation === "approval.register") return response(request.request_id);
      return response(request.request_id, "completed", {
        success: true,
        stdout_base64: Buffer.from(`discard-${"x".repeat(70_000)}-tail`).toString("base64"),
        stderr_base64: ""
      });
    }
  });
  try {
    const started = await context.service.start("owner-a", { projectId: context.project.id, scriptId: "test" });
    assert.equal(started.status, "RUNNING");
    await waitFor(() => context.service.status("owner-a", started.id).status === "SUCCEEDED");
    const state = context.service.status("owner-a", started.id);
    assert.equal(state.output.length, 64 * 1024);
    assert.match(state.output, /-tail$/u);
    assert.deepEqual(calls.map((call) => call.operation), ["approval.register", "process.run"]);
    assert.equal(calls[0]?.payload.ttl_ms, 0);
    assert.equal(calls[1]?.resource_limits.timeout_ms, 0);
    assert.equal(calls[1]?.payload.executable, "npm.cmd");
    assert.deepEqual(calls[1]?.payload.args, ["run", "test"]);
    assert.equal(calls[1]?.approval_token, calls[0]?.payload.token);
    const persisted = context.storage.listTasks("owner-a", context.project.id)[0]!;
    assert.equal(persisted.status, "SUCCEEDED");
    assert.equal(JSON.parse(persisted.resultJson).status, "SUCCEEDED");
  } finally { context.close(); }
});

test("declined approval performs no Rust Core call and creates no task", async () => {
  let calls = 0;
  const context = fixture({ confirmRun: false, request: async (request) => { calls += 1; return response(request.request_id); } });
  try {
    await assert.rejects(() => context.service.start("owner-a", { projectId: context.project.id, scriptId: "test" }), /BRAIN_SOFTWARE_RUN_DECLINED/u);
    assert.equal(context.acquired(), 0);
    assert.equal(calls, 0);
    assert.deepEqual(context.storage.listTasks("owner-a", context.project.id), []);
  } finally { context.close(); }
});

test("persists a Rust Core process failure as FAILED without manufacturing a timeout state", async () => {
  const context = fixture({
    request: async (request) => request.operation === "approval.register"
      ? response(request.request_id)
      : response(request.request_id, "failed", { success: false }, "BRAIN_CORE_PROCESS_FAILED")
  });
  try {
    const started = await context.service.start("owner-a", { projectId: context.project.id, scriptId: "test" });
    await waitFor(() => context.service.status("owner-a", started.id).status === "FAILED");
    const persisted = context.storage.listTasks("owner-a", context.project.id)[0]!;
    assert.equal(persisted.status, "FAILED");
    assert.equal(persisted.errorCode, "BRAIN_CORE_PROCESS_FAILED");
  } finally { context.close(); }
});

test("persists cancellation and ignores a late successful process response", async () => {
  const processResult = deferred<RustCoreResponse>();
  const calls: RequestInput[] = [];
  const context = fixture({
    request: async (request) => {
      calls.push(request);
      if (request.operation === "process.run") return processResult.promise;
      return response(request.request_id);
    }
  });
  try {
    const started = await context.service.start("owner-a", { projectId: context.project.id, scriptId: "test" });
    const cancelled = await context.service.cancel("owner-a", started.id);
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(calls.at(-1)?.operation, "request.cancel");
    assert.equal(calls.at(-1)?.payload.target_request_id, started.requestId);
    assert.equal(context.storage.listTasks("owner-a", context.project.id)[0]?.status, "CANCELLED");

    processResult.resolve(response(started.requestId, "completed", { success: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(context.service.status("owner-a", started.id).status, "CANCELLED");
    assert.equal(context.storage.listTasks("owner-a", context.project.id)[0]?.status, "CANCELLED");
  } finally { context.close(); }
});
