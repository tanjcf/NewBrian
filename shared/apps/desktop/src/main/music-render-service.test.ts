import assert from "node:assert/strict";
import test from "node:test";
import { MusicRenderService } from "./music-render-service.ts";

const timeline = { schemaVersion: 1 as const, projectId: "p1", title: "mix", sampleRate: 48_000, channels: 2 as const, durationMs: 2_000, clips: [], updatedAt: "2026-08-20T00:00:00Z" };
test("registers and starts an approved bounded music render", async () => {
  const calls: any[] = []; let resolveProcess!: (value: any) => void;
  const service = new MusicRenderService({ platform: "win32", confirmRender: async () => true, acquireRustCore: async () => ({ request: async (input: any) => { calls.push(input); if (input.operation === "approval.register") return { status: "completed" } as any; return new Promise((resolve) => { resolveProcess = resolve; }); } }) });
  const state = await service.start("owner", { projectId: "p1", projectRoot: "C:/work", outputRelativePath: "out/mix.wav", mediaRelativePaths: ["audio/take.wav"], artifactType: "mix", timeline });
  assert.equal(state.status, "RUNNING"); assert.deepEqual(calls[1].payload.args, ["-y", "-i", "audio/take.wav", "-t", "2", "out/mix.wav"]);
  resolveProcess({ status: "completed", result: { success: true } });
});

test("rejects music output path traversal before approval", async () => {
  const service = new MusicRenderService({ confirmRender: async () => true, acquireRustCore: async () => ({ request: async () => ({ status: "completed" } as any) }) });
  await assert.rejects(() => service.start("owner", { projectId: "p1", projectRoot: "C:/work", outputRelativePath: "../mix.wav", artifactType: "mix", timeline }), /BRAIN_MUSIC_OUTPUT_PATH_INVALID/);
});
