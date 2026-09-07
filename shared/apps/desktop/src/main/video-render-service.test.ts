import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("video render maps process failures to FAILED", async () => {
  let completeProcess!: (value: any) => void;
  const service = new VideoRenderService({ acquireRustCore: async () => ({ request: async (input: any) => { if (input.operation === "process.run") return new Promise((resolve) => { completeProcess = resolve; }); return { protocol_version: "1", request_id: input.request_id, status: "completed", error_code: "", artifacts: [], result: {} }; } }), confirmRender: async () => true, platform: "win32" });
  const started = await service.start("owner", { projectId: "p1", projectRoot: "C:/project", timeline, outputRelativePath: "renders/out.mp4", mediaRelativePaths: ["media/input.mp4"] });
  completeProcess({ protocol_version: "1", request_id: started.renderId, status: "failed", error_code: "BRAIN_CORE_PROCESS_FAILED", artifacts: [], result: { success: false } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const state = service.status("owner", started.renderId);
  assert.equal(state.status, "FAILED");
  assert.equal(state.errorCode, "BRAIN_CORE_PROCESS_FAILED");
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

test("video render layers tracks with xfade and drawtext", async () => {
  const calls: any[] = [];
  const service = new VideoRenderService({
    acquireRustCore: async () => ({ request: async (input: any) => { calls.push(input); return { status: "completed", result: { success: true } } as any; } }),
    confirmRender: async () => true,
    platform: "win32"
  });
  await service.start("owner", {
    projectId: "p1",
    projectRoot: "C:/project",
    timeline,
    outputRelativePath: "renders/out.mp4",
    layerClips: [
      { relativePath: "media/a.mp4", trackId: "v1", trackType: "video", startMs: 0, durationMs: 2000, transition: "dissolve", transitionMs: 250 },
      { relativePath: "media/b.mp4", trackId: "v1", trackType: "video", startMs: 2000, durationMs: 2000 },
      { relativePath: "media/c.mp4", trackId: "v2", trackType: "video", startMs: 500, durationMs: 1500 },
      { trackId: "v2", trackType: "text", startMs: 800, durationMs: 1200, text: "标题", fontSize: 42, color: "#ffcc00" }
    ]
  });
  const args = calls[1].payload.args as string[];
  const filter = args[args.indexOf("-filter_complex") + 1]!;
  assert.match(filter, /xfade=transition=dissolve/);
  assert.match(filter, /drawtext=fontfile=[^:]+:text='标题'/);
  assert.match(filter, /overlay=eof_action=pass/);
});

test("video render maps blur transition to xfade hblur", async () => {
  const calls: any[] = [];
  const service = new VideoRenderService({
    acquireRustCore: async () => ({ request: async (input: any) => { calls.push(input); return { status: "completed", result: { success: true } } as any; } }),
    confirmRender: async () => true,
    platform: "win32"
  });
  await service.start("owner", {
    projectId: "p1",
    projectRoot: "C:/project",
    timeline,
    outputRelativePath: "renders/out.mp4",
    layerClips: [
      { relativePath: "media/a.mp4", trackId: "v1", trackType: "video", startMs: 0, durationMs: 2000, transition: "blur", transitionMs: 250 },
      { relativePath: "media/b.mp4", trackId: "v1", trackType: "video", startMs: 2000, durationMs: 2000 }
    ]
  });
  const args = calls[1].payload.args as string[];
  const filter = args[args.indexOf("-filter_complex") + 1]!;
  assert.match(filter, /xfade=transition=hblur/);
  assert.doesNotMatch(filter, /concat=n=2:v=1:a=0/);
});

test("video render defaults missing transition to hard cut (concat, no xfade)", async () => {
  const calls: any[] = [];
  const service = new VideoRenderService({
    acquireRustCore: async () => ({ request: async (input: any) => { calls.push(input); return { status: "completed", result: { success: true } } as any; } }),
    confirmRender: async () => true,
    platform: "win32"
  });
  await service.start("owner", {
    projectId: "p1",
    projectRoot: "C:/project",
    timeline,
    outputRelativePath: "renders/out.mp4",
    layerClips: [
      { relativePath: "media/a.mp4", trackId: "v1", trackType: "video", startMs: 0, durationMs: 2000 },
      { relativePath: "media/b.mp4", trackId: "v1", trackType: "video", startMs: 2000, durationMs: 2000 },
      { relativePath: "media/c.mp4", trackId: "v1", trackType: "video", startMs: 4000, durationMs: 2000, transition: "cut" },
      { relativePath: "media/d.mp4", trackId: "v1", trackType: "video", startMs: 6000, durationMs: 2000, transition: "none" }
    ]
  });
  const args = calls[1].payload.args as string[];
  const filter = args[args.indexOf("-filter_complex") + 1]!;
  assert.doesNotMatch(filter, /xfade=/);
  assert.match(filter, /concat=n=2:v=1:a=0/);
});

test("video render supports multi-clip concat demuxer", async () => {
  const calls: any[] = [];
  const root = mkdtempSync(join(tmpdir(), "brain-video-concat-"));
  try {
    const service = new VideoRenderService({
      acquireRustCore: async () => ({
        request: async (input: any) => {
          calls.push(input);
          return { status: "completed", result: { success: true } } as any;
        }
      }),
      confirmRender: async () => true,
      platform: "win32"
    });
    await service.start("owner", {
      projectId: "p1",
      projectRoot: root,
      timeline,
      outputRelativePath: "renders/out.mp4",
      mediaRelativePaths: ["media/clips/a.mp4", "media/clips/b.mp4"]
    });
    assert.equal(calls[1].payload.args[2], "concat");
    const concatRelative = String(calls[1].payload.args[6]);
    assert.ok(concatRelative.includes(".brain-video/concat-"));
    assert.equal(
      readFileSync(join(root, concatRelative), "utf8"),
      "file '../media/clips/a.mp4'\nfile '../media/clips/b.mp4'\n"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("video render mixes delayed audio and burns persisted subtitles", async () => {
  const calls: any[] = [];
  const root = mkdtempSync(join(tmpdir(), "brain-video-audio-"));
  try {
    const service = new VideoRenderService({
      acquireRustCore: async () => ({ request: async (input: any) => { calls.push(input); return { status: "completed", result: { success: true } } as any; } }),
      confirmRender: async () => true,
      platform: "win32"
    });
    await service.start("owner", {
      projectId: "p1", projectRoot: root,
      timeline: { ...timeline, clips: [{ id: "s1", trackType: "subtitle", sourceFileId: "", startMs: 0, durationMs: 2_000, sourceInMs: 0, volume: 1, text: "青石谷清晨" }] },
      outputRelativePath: "renders/out.mp4", mediaRelativePaths: ["media/input.mp4"],
      audioClips: [{ relativePath: "media/narration.mp3", startMs: 500, volume: 0.8 }]
    });
    const args = calls[1].payload.args as string[];
    assert.ok(args.includes("media/narration.mp3"));
    assert.match(args[args.indexOf("-filter_complex") + 1]!, /adelay=500\|500,volume=0\.8/);
    const subtitleFilter = args[args.indexOf("-vf") + 1]!;
    assert.match(subtitleFilter, /scale=1920:1080/);
    assert.match(subtitleFilter, /fps=30/);
    assert.match(subtitleFilter, /subtitles=/);
    const subtitlePath = subtitleFilter.match(/'([^']+)'/)?.[1];
    assert.ok(subtitlePath);
    assert.match(readFileSync(join(root, subtitlePath!), "utf8"), /青石谷清晨/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("video render can synthesize lavfi media when allowed", async () => {
  const calls: any[] = [];
  const service = new VideoRenderService({
    acquireRustCore: async () => ({
      request: async (input: any) => {
        calls.push(input);
        return { status: "completed", result: { success: true } } as any;
      }
    }),
    confirmRender: async () => true,
    platform: "win32"
  });
  await service.start("owner", {
    projectId: "p1",
    projectRoot: "C:/project",
    timeline,
    outputRelativePath: "renders/out.mp4",
    mediaRelativePaths: [],
    allowSyntheticMedia: true
  });
  assert.ok(calls[1].payload.args.includes("lavfi"));
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
