/**
 * Integration proof: FFmpeg peel yields real audio-only (not silent mp4).
 * Run: node --experimental-strip-types shared/apps/desktop/src/main/video-media-peel.integration.test.ts
 * Skips when ffmpeg/ffprobe or fixture missing.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { peelMediaAv, probeMediaAv } from "./video-media-peel.ts";

function which(bin: string): string {
  const probe = spawnSync(process.platform === "win32" ? "where.exe" : "which", [bin], {
    encoding: "utf8",
    windowsHide: true
  });
  const line = String(probe.stdout || "").split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  return line || bin;
}

const FIXTURE = "i:/py_workerposse/aigc/media/clips/shot-002-1788030801524.mp4";

test("peelMediaAv extracts real audio-only m4a/wav from muxed mp4", async (t) => {
  const ffmpeg = which("ffmpeg");
  const ffprobe = which("ffprobe");
  const check = spawnSync(ffprobe, ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", FIXTURE], {
    encoding: "utf8",
    windowsHide: true
  });
  if (check.status !== 0) {
    t.skip(`fixture or ffprobe unavailable: ${FIXTURE}`);
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "brain-peel-"));
  try {
    const deps = { ffmpegExecutable: ffmpeg, ffprobeExecutable: ffprobe, timeoutMs: 120_000 };
    const sourceProbe = await probeMediaAv(FIXTURE, deps);
    assert.equal(sourceProbe.hasVideo, true);
    assert.equal(sourceProbe.hasAudio, true);

    const peeled = await peelMediaAv({
      projectRoot: root,
      sourceAbsolutePath: FIXTURE,
      sourceRelativePath: "media/clips/shot-002-1788030801524.mp4",
      logicalName: "shot-002-1788030801524.mp4"
    }, deps);

    assert.equal(peeled.hasAudio, true);
    assert.ok(peeled.audioRelativePath, "audio relative path required");
    assert.ok(peeled.videoRelativePath, "video relative path required");
    assert.match(String(peeled.audioRelativePath), /-audio-\d+\.(m4a|wav)$/i);
    assert.doesNotMatch(String(peeled.audioRelativePath), /\.mp4$/i);
    assert.ok((peeled.audioBytes?.length || 0) > 1000, "audio bytes must be non-trivial");

    const audioAbs = join(root, String(peeled.audioRelativePath).replaceAll("/", "\\"));
    const audioProbe = await probeMediaAv(audioAbs, deps);
    assert.equal(audioProbe.hasAudio, true, "peeled file must contain an audio stream");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
