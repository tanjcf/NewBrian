import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import test from "node:test";
import type { RustCoreRequest, RustCoreResponse } from "@codex-forge/protocol/rust-core";
import { MusicRenderService } from "./music-render-service.ts";
import { VideoRenderService } from "./video-render-service.ts";

const execFileAsync = promisify(execFile);
const binaryCandidates = [
  ...(process.env.BRAIN_RUST_CORE_BINARY ? [pathToFileURL(process.env.BRAIN_RUST_CORE_BINARY)] : []),
  new URL("../../../../../rust/brain-core/target/debug/brain-core.exe", import.meta.url),
  new URL("../../../../../rust/brain-core/target/release/brain-core.exe", import.meta.url),
  new URL("../../../../../rust/brain-core/target/debug/brain-core", import.meta.url),
  new URL("../../../../../rust/brain-core/target/release/brain-core", import.meta.url)
];
const ffmpeg = process.env.BRAIN_FFMPEG_BINARY || (process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const ffprobe = process.env.BRAIN_FFPROBE_BINARY || (process.platform === "win32" ? "ffprobe.exe" : "ffprobe");

async function waitForStatus(read: () => { status: string }) {
  for (;;) {
    const state = read();
    if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(state.status)) return state;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
}

async function prepareOutput(root: string, output: string) {
  await mkdir(dirname(resolve(root, output)), { recursive: true });
}

async function validateOutput(root: string, output: string) {
  const rootReal = await realpath(root);
  const targetReal = await realpath(resolve(rootReal, output));
  const boundary = rootReal.endsWith(sep) ? rootReal : `${rootReal}${sep}`;
  const metadata = await stat(targetReal);
  return targetReal.startsWith(boundary) && metadata.isFile() && metadata.size > 0;
}

function createRustClient(child: ChildProcessWithoutNullStreams) {
  const pending = new Map<string, { resolve: (value: RustCoreResponse) => void; reject: (reason: unknown) => void }>();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const value = JSON.parse(line) as RustCoreResponse;
    const waiting = pending.get(value.request_id);
    if (!waiting) return;
    pending.delete(value.request_id);
    waiting.resolve(value);
  });
  return {
    request(input: Omit<RustCoreRequest, "protocol_version">) {
      return new Promise<RustCoreResponse>((resolveRequest, reject) => {
        pending.set(input.request_id, { resolve: resolveRequest, reject });
        child.stdin.write(`${JSON.stringify({ ...input, protocol_version: "1" })}\n`);
      });
    },
    async shutdown() {
      lines.close();
      child.stdin.end();
      if (child.exitCode === null) {
        const exited = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
        child.kill();
        await exited;
      }
    }
  };
}

test("real Rust Core produces probeable MP4 and WAV outputs through the media services", async (context) => {
  const binary = binaryCandidates.find((candidate) => existsSync(candidate));
  if (!binary) return context.skip("Rust Core debug/release binary is unavailable.");
  try {
    await execFileAsync(ffmpeg, ["-version"], { windowsHide: true });
    await execFileAsync(ffprobe, ["-version"], { windowsHide: true });
  } catch { return context.skip("FFmpeg and FFprobe are unavailable."); }

  const root = await mkdtemp(join(tmpdir(), "brain-media-real-"));
  await mkdir(join(root, "media"), { recursive: true });
  const inputVideo = join(root, "media", "input.mp4");
  const inputAudio = join(root, "media", "take.wav");
  await execFileAsync(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=10", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000", "-t", "0.5", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-c:a", "aac", inputVideo], { windowsHide: true, maxBuffer: 1_048_576 });
  await execFileAsync(ffmpeg, ["-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "0.5", inputAudio], { windowsHide: true, maxBuffer: 1_048_576 });

  const child = spawn(fileURLToPath(binary), ["--project-root", root], { cwd: root, env: process.env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const client = createRustClient(child);
  try {
    const video = new VideoRenderService({ platform: process.platform, acquireRustCore: async () => client, confirmRender: async () => true, prepareOutput, validateOutput });
    const videoStart = await video.start("owner", { projectId: "video-real", projectRoot: root, outputRelativePath: "renders/output.mp4", mediaRelativePaths: ["media/input.mp4"], timeline: { schemaVersion: 1, projectId: "video-real", title: "fixture", width: 160, height: 90, fps: 10, durationMs: 500, clips: [], updatedAt: new Date().toISOString() } });
    const videoDone = await waitForStatus(() => video.status("owner", videoStart.renderId));
    assert.equal(videoDone.status, "SUCCEEDED", videoDone.output || videoDone.errorCode);

    const music = new MusicRenderService({ platform: process.platform, acquireRustCore: async () => client, confirmRender: async () => true, prepareOutput, validateOutput });
    const musicStart = await music.start("owner", { projectId: "music-real", projectRoot: root, outputRelativePath: "renders/output.wav", mediaRelativePaths: ["media/take.wav"], artifactType: "mix", timeline: { schemaVersion: 1, projectId: "music-real", title: "fixture", sampleRate: 48_000, channels: 2, durationMs: 500, clips: [], updatedAt: new Date().toISOString() } });
    const musicDone = await waitForStatus(() => music.status("owner", musicStart.renderId));
    assert.equal(musicDone.status, "SUCCEEDED", musicDone.output || musicDone.errorCode);

    for (const output of [join(root, "renders", "output.mp4"), join(root, "renders", "output.wav")]) {
      const { stdout } = await execFileAsync(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "json", output], { windowsHide: true });
      const duration = Number(JSON.parse(stdout).format?.duration);
      assert.ok(duration > 0, `Expected probeable duration for ${output}`);
      assert.ok((await stat(output)).size > 0);
    }
  } finally {
    await client.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

test("real Rust Core cancels a long media encode without resurrecting success", async (context) => {
  const binary = binaryCandidates.find((candidate) => existsSync(candidate));
  if (!binary) return context.skip("Rust Core debug/release binary is unavailable.");
  try {
    await execFileAsync(ffmpeg, ["-version"], { windowsHide: true });
  } catch { return context.skip("FFmpeg is unavailable."); }

  const root = await mkdtemp(join(tmpdir(), "brain-media-cancel-"));
  await mkdir(join(root, "media"), { recursive: true });
  const inputVideo = join(root, "media", "input.mp4");
  // Heavy enough that encode cannot finish before cancel races the process.
  await execFileAsync(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "30", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", inputVideo], { windowsHide: true, maxBuffer: 1_048_576 });

  const child = spawn(fileURLToPath(binary), ["--project-root", root], { cwd: root, env: process.env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const client = createRustClient(child);
  try {
    const video = new VideoRenderService({ platform: process.platform, acquireRustCore: async () => client, confirmRender: async () => true, prepareOutput, validateOutput });
    const started = await video.start("owner", {
      projectId: "video-cancel",
      projectRoot: root,
      outputRelativePath: "renders/long.mp4",
      mediaRelativePaths: ["media/input.mp4"],
      timeline: { schemaVersion: 1, projectId: "video-cancel", title: "cancel", width: 1280, height: 720, fps: 30, durationMs: 30_000, clips: [], updatedAt: new Date().toISOString() }
    });
    assert.equal(started.status, "RUNNING");
    const cancelled = await video.cancel("owner", started.renderId);
    assert.equal(cancelled.status, "CANCELLED");
    const settled = await waitForStatus(() => video.status("owner", started.renderId));
    assert.equal(settled.status, "CANCELLED");
    assert.equal(settled.errorCode, "BRAIN_CORE_CANCELLED");
  } finally {
    await client.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});
