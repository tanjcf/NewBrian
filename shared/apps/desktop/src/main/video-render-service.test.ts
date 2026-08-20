import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BrainWorkspaceStorage } from "./brain-workspace-storage.ts";
import { VideoRenderService } from "./video-render-service.ts";

const timeline: any = { schemaVersion: 1, projectId: "p1", title: "t", width: 1920, height: 1080, fps: 30, durationMs: 5000, clips: [], updatedAt: new Date().toISOString() };

test("video render requires approval and rejects traversal output", async () => {
  const service = new VideoRenderService({ acquireRustCore: async () => ({ request: async () => ({ status: "completed", result: {} } as any) }), confirmRender: async () => true, platform: "win32" });
  await assert.rejects(() => service.start("owner", { projectId: "p1", projectRoot: "C:/project", timeline, outputRelativePath: "../escape.mp4" }), /BRAIN_VIDEO_OUTPUT_PATH_INVALID/);
});

test("video render registers one-shot approval before process with no deadline", async () => {
  const calls: any[] = [];
  const service = new VideoRenderService({ acquireRustCore: async () => ({ request: async (input: any) => { calls.push(input); return { status: "completed", result: { success: true } } as any; } }), confirmRender: async () => true, platform: "win32" });
  const state = await service.start("owner", { projectId: "p1", projectRoot: "C:/project", timeline, outputRelativePath: "renders/out.mp4", mediaRelativePaths: ["media/input.mp4"] });
  assert.equal(state.status, "RUNNING");
  assert.deepEqual(calls.map((call) => call.operation), ["approval.register", "process.run"]);
  assert.equal(calls[0].payload.ttl_ms, 0);
  assert.equal(calls[0].resource_limits.timeout_ms, 0);
  assert.equal(calls[1].resource_limits.timeout_ms, 0);
  assert.equal(calls[1].payload.executable, "ffmpeg.exe");
  assert.deepEqual(calls[1].payload.args.slice(-1), ["renders/out.mp4"]);
  assert.ok(calls[1].payload.args.includes("media/input.mp4"));
});

test("video cancellation bumps generation and ignores late process completion", async () => {
  const calls: any[] = [];
  let completeProcess!: (value: any) => void;
  const service = new VideoRenderService({ acquireRustCore: async () => ({ request: async (input: any) => { calls.push(input); if (input.operation === "process.run") return new Promise((resolve) => { completeProcess = resolve; }); return { protocol_version: "1", request_id: input.request_id, status: "completed", error_code: "", artifacts: [], result: {} }; } }), confirmRender: async () => true, platform: "win32" });
  const started = await service.start("owner", { projectId: "p1", projectRoot: "C:/project", timeline, outputRelativePath: "renders/out.mp4", mediaRelativePaths: ["media/input.mp4"] });
  const cancelled = await service.cancel("owner", started.renderId);
  assert.equal(cancelled.status, "CANCELLED");
  completeProcess({ protocol_version: "1", request_id: started.renderId, status: "completed", error_code: "", artifacts: [], result: { success: true } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(service.status("owner", started.renderId).status, "CANCELLED");
  assert.equal(calls.at(-1).operation, "request.cancel");
});

test("video render maps legacy process timeout to FAILED instead of TIMED_OUT", async () => {
  let completeProcess!: (value: any) => void;
  const service = new VideoRenderService({ acquireRustCore: async () => ({ request: async (input: any) => { if (input.operation === "process.run") return new Promise((resolve) => { completeProcess = resolve; }); return { protocol_version: "1", request_id: input.request_id, status: "completed", error_code: "", artifacts: [], result: {} }; } }), confirmRender: async () => true, platform: "win32" });
  const started = await service.start("owner", { projectId: "p1", projectRoot: "C:/project", timeline, outputRelativePath: "renders/out.mp4", mediaRelativePaths: ["media/input.mp4"] });
  completeProcess({ protocol_version: "1", request_id: started.renderId, status: "failed", error_code: "BRAIN_CORE_PROCESS_TIMEOUT", artifacts: [], result: { success: false } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const state = service.status("owner", started.renderId);
  assert.equal(state.status, "FAILED");
  assert.equal(state.errorCode, "BRAIN_CORE_PROCESS_TIMEOUT");
});

test("video render defaults to process.platform executable naming", async () => {
  const calls: any[] = [];
  const service = new VideoRenderService({ acquireRustCore: async () => ({ request: async (input: any) => { calls.push(input); return { status: "completed", result: { success: true } } as any; } }), confirmRender: async () => true });
  await service.start("owner", { projectId: "p1", projectRoot: "C:/project", timeline, outputRelativePath: "renders/out.mp4", mediaRelativePaths: ["media/input.mp4"] });
  assert.equal(calls[1].payload.executable, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
});

test("video render only accepts an MP4 output", async () => {
  const service = new VideoRenderService({ acquireRustCore: async () => ({ request: async () => ({ status: "completed", result: {} } as any) }), confirmRender: async () => true });
  await assert.rejects(() => service.start("owner", { projectId: "p1", projectRoot: "C:/project", timeline, outputRelativePath: "renders/out.avi", mediaRelativePaths: ["media/input.mp4"] }), /BRAIN_VIDEO_OUTPUT_FORMAT_UNSUPPORTED/u);
});

test("video render refuses a timeline without a media input", async () => {
  let acquired = false;
  const service = new VideoRenderService({ acquireRustCore: async () => { acquired = true; return { request: async () => ({ status: "completed", result: {} } as any) }; }, confirmRender: async () => true, platform: "win32" });
  await assert.rejects(() => service.start("owner", { projectId: "p1", projectRoot: "C:/project", timeline, outputRelativePath: "renders/out.mp4" }), /BRAIN_VIDEO_MEDIA_NOT_FOUND/);
  assert.equal(acquired, false);
});

test("video render persists task and registers output artifact on success", async () => {
  const root = mkdtempSync(join(tmpdir(), "brain-video-persist-"));
  const storage = new BrainWorkspaceStorage(root);
  try {
    const project = storage.createProject({ ownerId: "owner", name: "视频", primaryWorkspaceKey: "video", localWorkspaceId: "ws-1" });
    const projectRoot = join(root, "workspace");
    mkdirSync(join(projectRoot, "renders"), { recursive: true });
    writeFileSync(join(projectRoot, "renders", "out.mp4"), Buffer.from("fake-mp4-bytes"));
    let completeProcess!: (value: any) => void;
    const service = new VideoRenderService({
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
      timeline: { ...timeline, projectId: project.id },
      outputRelativePath: "renders/out.mp4",
      mediaRelativePaths: ["media/input.mp4"]
    });
    const running = storage.getTask("owner", started.taskId);
    assert.equal(running.status, "RUNNING");
    assert.equal(running.taskType, "video_render");
    assert.equal(JSON.parse(running.resourceLimitsJson).timeoutMs, 0);
    completeProcess({ protocol_version: "1", request_id: started.renderId, status: "completed", error_code: "", artifacts: [], result: { success: true } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const done = service.status("owner", started.renderId);
    assert.equal(done.status, "SUCCEEDED");
    assert.ok(done.outputFileId);
    assert.equal(storage.getTask("owner", started.taskId).status, "SUCCEEDED");
    assert.equal(storage.listArtifacts("owner", project.id).length, 1);
    assert.equal(storage.listFiles("owner", project.id)[0]?.id, done.outputFileId);
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});
