import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BrainWorkspaceStorage } from "./brain-workspace-storage.ts";
import { MusicRenderService } from "./music-render-service.ts";

const timeline = { schemaVersion: 1 as const, projectId: "p1", title: "mix", sampleRate: 48_000, channels: 2 as const, durationMs: 2_000, clips: [], updatedAt: "2026-08-20T00:00:00Z" };

test("registers and starts an approved bounded music render with no deadline", async () => {
  const calls: any[] = []; let resolveProcess!: (value: any) => void;
  const service = new MusicRenderService({ platform: "win32", confirmRender: async () => true, acquireRustCore: async () => ({ request: async (input: any) => { calls.push(input); if (input.operation === "approval.register") return { status: "completed" } as any; return new Promise((resolve) => { resolveProcess = resolve; }); } }) });
  const state = await service.start("owner", { projectId: "p1", projectRoot: "C:/work", outputRelativePath: "out/mix.wav", mediaRelativePaths: ["audio/take.wav"], artifactType: "mix", timeline });
  assert.equal(state.status, "RUNNING");
  assert.equal(calls[0].payload.ttl_ms, 0);
  assert.equal(calls[0].resource_limits.timeout_ms, 0);
  assert.equal(calls[1].resource_limits.timeout_ms, 0);
  assert.deepEqual(calls[1].payload.args, ["-y", "-i", "audio/take.wav", "-t", "2", "out/mix.wav"]);
  resolveProcess({ status: "completed", result: { success: true } });
});

test("rejects music output path traversal before approval", async () => {
  const service = new MusicRenderService({ confirmRender: async () => true, acquireRustCore: async () => ({ request: async () => ({ status: "completed" } as any) }) });
  await assert.rejects(() => service.start("owner", { projectId: "p1", projectRoot: "C:/work", outputRelativePath: "../mix.wav", artifactType: "mix", timeline }), /BRAIN_MUSIC_OUTPUT_PATH_INVALID/);
});

test("music cancellation bumps generation and ignores late completion", async () => {
  let completeProcess!: (value: any) => void;
  const calls: any[] = [];
  const service = new MusicRenderService({ platform: "win32", confirmRender: async () => true, acquireRustCore: async () => ({ request: async (input: any) => { calls.push(input); if (input.operation === "process.run") return new Promise((resolve) => { completeProcess = resolve; }); return { protocol_version: "1", request_id: input.request_id, status: "completed", error_code: "", artifacts: [], result: {} }; } }) });
  const started = await service.start("owner", { projectId: "p1", projectRoot: "C:/work", outputRelativePath: "renders/mix.wav", mediaRelativePaths: ["audio/take.wav"], artifactType: "mix", timeline });
  const cancelled = await service.cancel("owner", started.renderId);
  assert.equal(cancelled.status, "CANCELLED");
  completeProcess({ protocol_version: "1", request_id: started.renderId, status: "completed", error_code: "", artifacts: [], result: { success: true } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(service.status("owner", started.renderId).status, "CANCELLED");
  assert.equal(calls.at(-1).operation, "request.cancel");
});

test("music render maps process failures to FAILED", async () => {
  let completeProcess!: (value: any) => void;
  const service = new MusicRenderService({ platform: "win32", confirmRender: async () => true, acquireRustCore: async () => ({ request: async (input: any) => { if (input.operation === "process.run") return new Promise((resolve) => { completeProcess = resolve; }); return { protocol_version: "1", request_id: input.request_id, status: "completed", error_code: "", artifacts: [], result: {} }; } }) });
  const started = await service.start("owner", { projectId: "p1", projectRoot: "C:/work", outputRelativePath: "renders/mix.wav", mediaRelativePaths: ["audio/take.wav"], artifactType: "mix", timeline });
  completeProcess({ protocol_version: "1", request_id: started.renderId, status: "failed", error_code: "BRAIN_CORE_PROCESS_FAILED", artifacts: [], result: { success: false } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const state = service.status("owner", started.renderId);
  assert.equal(state.status, "FAILED");
  assert.equal(state.errorCode, "BRAIN_CORE_PROCESS_FAILED");
});

test("music render only accepts a WAV output", async () => {
  const service = new MusicRenderService({ confirmRender: async () => true, acquireRustCore: async () => ({ request: async () => ({ status: "completed" } as any) }) });
  await assert.rejects(() => service.start("owner", { projectId: "p1", projectRoot: "C:/work", outputRelativePath: "renders/mix.mp3", artifactType: "mix", timeline }), /BRAIN_MUSIC_OUTPUT_FORMAT_UNSUPPORTED/u);
});

test("music render persists task and registers output artifact on success", async () => {
  const root = mkdtempSync(join(tmpdir(), "brain-music-persist-"));
  const storage = new BrainWorkspaceStorage(root);
  try {
    const project = storage.createProject({ ownerId: "owner", name: "音乐", primaryWorkspaceKey: "music", localWorkspaceId: "ws-1" });
    const projectRoot = join(root, "workspace");
    mkdirSync(join(projectRoot, "renders"), { recursive: true });
    writeFileSync(join(projectRoot, "renders", "mix.wav"), Buffer.from("RIFF....WAVE"));
    let completeProcess!: (value: any) => void;
    const service = new MusicRenderService({
      storage,
      platform: "win32",
      confirmRender: async () => true,
      acquireRustCore: async () => ({
        request: async (input: any) => {
          if (input.operation === "process.run") return new Promise((resolve) => { completeProcess = resolve; });
          return { protocol_version: "1", request_id: input.request_id, status: "completed", error_code: "", artifacts: [], result: {} };
        }
      })
    });
    const started = await service.start("owner", {
      projectId: project.id,
      projectRoot,
      outputRelativePath: "renders/mix.wav",
      mediaRelativePaths: ["audio/take.wav"],
      artifactType: "mix",
      timeline: { ...timeline, projectId: project.id }
    });
    assert.equal(storage.getTask("owner", started.taskId).taskType, "music_render");
    completeProcess({ protocol_version: "1", request_id: started.renderId, status: "completed", error_code: "", artifacts: [], result: { success: true } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const done = service.status("owner", started.renderId);
    assert.equal(done.status, "SUCCEEDED");
    assert.ok(done.outputFileId);
    assert.equal(storage.getTask("owner", started.taskId).status, "SUCCEEDED");
    assert.equal(storage.listArtifacts("owner", project.id)[0]?.artifactType, "music_render");
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});
