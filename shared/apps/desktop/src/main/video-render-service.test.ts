import assert from "node:assert/strict";
import test from "node:test";
import { VideoRenderService } from "./video-render-service.ts";

const timeline: any = { schemaVersion: 1, projectId: "p1", title: "t", width: 1920, height: 1080, fps: 30, durationMs: 5000, clips: [], updatedAt: new Date().toISOString() };

test("video render requires approval and rejects traversal output", async () => {
  const service = new VideoRenderService({ acquireRustCore: async () => ({ request: async () => ({ status: "completed", result: {} } as any) }), confirmRender: async () => true, platform: "win32" });
  await assert.rejects(() => service.start("owner", { projectId: "p1", projectRoot: "C:/project", timeline, outputRelativePath: "../escape.mp4" }), /BRAIN_VIDEO_OUTPUT_PATH_INVALID/);
});

test("video render registers one-shot approval before process", async () => {
  const calls: string[] = [];
  const service = new VideoRenderService({ acquireRustCore: async () => ({ request: async (input: any) => { calls.push(input.operation); return { status: "completed", result: { success: true } } as any; } }), confirmRender: async () => true, platform: "win32" });
  const state = await service.start("owner", { projectId: "p1", projectRoot: "C:/project", timeline, outputRelativePath: "renders/out.mp4" });
  assert.equal(state.status, "RUNNING");
  assert.deepEqual(calls, ["approval.register", "process.run"]);
});
