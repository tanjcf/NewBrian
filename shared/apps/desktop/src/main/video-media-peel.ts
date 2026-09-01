/**
 * Premiere-style A/V unlink: probe + FFmpeg peel into video-only / audio-only files.
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, stat, unlink } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";
import { createHash } from "node:crypto";

const execFileAsync = promisify(execFile);

export type VideoMediaPeelProbe = {
  hasVideo: boolean;
  hasAudio: boolean;
  durationSec: number;
};

export type VideoMediaPeelOutputs = {
  videoRelativePath?: string;
  audioRelativePath?: string;
  videoBytes?: Buffer;
  audioBytes?: Buffer;
  videoExt?: string;
  audioExt?: string;
};

export type VideoMediaPeelDeps = {
  ffmpegExecutable: string;
  ffprobeExecutable: string;
  /** Max seconds to wait per ffmpeg/ffprobe call. */
  timeoutMs?: number;
};

function safeStem(name: string) {
  return String(name || "media")
    .replace(/\.[^.]+$/, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .slice(0, 80) || "media";
}

async function runTool(
  executable: string,
  args: string[],
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const result = await execFileAsync(executable, args, {
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      encoding: "utf8"
    });
    return { stdout: String(result.stdout || ""), stderr: String(result.stderr || ""), code: 0 };
  } catch (error) {
    const err = error as { code?: number; stdout?: string; stderr?: string; message?: string };
    if (typeof err.code === "number") {
      return {
        stdout: String(err.stdout || ""),
        stderr: String(err.stderr || err.message || ""),
        code: err.code
      };
    }
    throw error;
  }
}

/** Probe whether a media file has video and/or audio streams. */
export async function probeMediaAv(
  absolutePath: string,
  deps: Pick<VideoMediaPeelDeps, "ffprobeExecutable" | "timeoutMs">
): Promise<VideoMediaPeelProbe> {
  const timeoutMs = deps.timeoutMs ?? 60_000;
  const streams = await runTool(
    deps.ffprobeExecutable,
    [
      "-v", "error",
      "-show_entries", "stream=codec_type",
      "-of", "csv=p=0",
      absolutePath
    ],
    timeoutMs
  );
  if (streams.code !== 0) {
    throw new Error(`BRAIN_MEDIA_PROBE_FAILED:${streams.stderr || streams.code}`);
  }
  const types = streams.stdout
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
  const hasVideo = types.some((line) => line === "video" || line.startsWith("video,"));
  const hasAudio = types.some((line) => line === "audio" || line.startsWith("audio,"));

  const durationResult = await runTool(
    deps.ffprobeExecutable,
    [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      absolutePath
    ],
    timeoutMs
  );
  const durationSec = Math.max(0, Number.parseFloat(String(durationResult.stdout || "").trim()) || 0);
  return { hasVideo, hasAudio, durationSec };
}

async function fileLooksLikeRealAudio(
  absolutePath: string,
  deps: VideoMediaPeelDeps
): Promise<boolean> {
  try {
    const st = await stat(absolutePath);
    // Empty / near-empty containers are never valid peels (silent mp4 stubs).
    if (st.size < 256) return false;
    const probe = await probeMediaAv(absolutePath, deps);
    return probe.hasAudio === true;
  } catch {
    return false;
  }
}

async function peelVideoOnly(
  source: string,
  dest: string,
  deps: VideoMediaPeelDeps
): Promise<void> {
  const timeoutMs = deps.timeoutMs ?? 180_000;
  const copy = await runTool(
    deps.ffmpegExecutable,
    ["-y", "-i", source, "-an", "-c:v", "copy", dest],
    timeoutMs
  );
  if (copy.code === 0) {
    try {
      const st = await stat(dest);
      if (st.size > 0) return;
    } catch { /* fall through */ }
  }
  const encoded = await runTool(
    deps.ffmpegExecutable,
    ["-y", "-i", source, "-an", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", dest],
    timeoutMs
  );
  if (encoded.code !== 0) {
    throw new Error(`BRAIN_MEDIA_PEEL_VIDEO_FAILED:${encoded.stderr || encoded.code}`);
  }
}

/**
 * Extract a real audio-only file (.m4a AAC or .wav PCM).
 * Never writes `*-audio-*.mp4` — that produced silent / video-container stubs.
 */
async function peelAudioOnly(
  source: string,
  destWav: string,
  destM4a: string,
  deps: VideoMediaPeelDeps
): Promise<{ path: string; ext: string }> {
  const timeoutMs = deps.timeoutMs ?? 180_000;
  const attempts: Array<{ dest: string; ext: string; args: string[] }> = [
    // Prefer stream copy into .m4a when source audio is already AAC.
    {
      dest: destM4a,
      ext: ".m4a",
      args: ["-y", "-i", source, "-vn", "-map", "0:a:0", "-c:a", "copy", destM4a]
    },
    // Re-encode AAC into .m4a (audio-only ISO BMFF).
    {
      dest: destM4a,
      ext: ".m4a",
      args: ["-y", "-i", source, "-vn", "-map", "0:a:0", "-c:a", "aac", "-b:a", "192k", destM4a]
    },
    // Broad timeline / WebAudio-friendly PCM fallback.
    {
      dest: destWav,
      ext: ".wav",
      args: ["-y", "-i", source, "-vn", "-map", "0:a:0", "-c:a", "pcm_s16le", destWav]
    }
  ];

  let lastErr = "";
  for (const attempt of attempts) {
    const result = await runTool(deps.ffmpegExecutable, attempt.args, timeoutMs);
    if (result.code !== 0) {
      lastErr = result.stderr || String(result.code);
      await unlink(attempt.dest).catch(() => undefined);
      continue;
    }
    if (await fileLooksLikeRealAudio(attempt.dest, deps)) {
      return { path: attempt.dest, ext: attempt.ext };
    }
    lastErr = `BRAIN_MEDIA_PEEL_AUDIO_EMPTY:${attempt.dest}`;
    await unlink(attempt.dest).catch(() => undefined);
  }
  throw new Error(`BRAIN_MEDIA_PEEL_AUDIO_FAILED:${lastErr || "no valid audio stream"}`);
}

/**
 * Split a muxed file into video-only + audio-only under project media/imports/.
 * Returns relative paths and raw bytes for registration.
 */
export async function peelMediaAv(
  input: {
    projectRoot: string;
    sourceAbsolutePath: string;
    sourceRelativePath?: string;
    logicalName?: string;
  },
  deps: VideoMediaPeelDeps
): Promise<VideoMediaPeelProbe & VideoMediaPeelOutputs> {
  const probe = await probeMediaAv(input.sourceAbsolutePath, deps);
  if (!probe.hasVideo && !probe.hasAudio) {
    throw new Error("BRAIN_MEDIA_PEEL_NO_STREAMS");
  }

  const stem = safeStem(input.logicalName || basename(input.sourceRelativePath || input.sourceAbsolutePath));
  const stamp = Date.now();
  const importsDir = join(input.projectRoot, "media", "imports");
  await mkdir(importsDir, { recursive: true });

  const result: VideoMediaPeelProbe & VideoMediaPeelOutputs = { ...probe };

  if (probe.hasVideo) {
    const videoName = `${stem}-video-${stamp}.mp4`;
    const videoAbs = join(importsDir, videoName);
    await peelVideoOnly(input.sourceAbsolutePath, videoAbs, deps);
    result.videoRelativePath = `media/imports/${videoName}`;
    result.videoBytes = await readFile(videoAbs);
    result.videoExt = ".mp4";
  }

  if (probe.hasAudio) {
    const wavAbs = join(importsDir, `${stem}-audio-${stamp}.wav`);
    const m4aAbs = join(importsDir, `${stem}-audio-${stamp}.m4a`);
    const audio = await peelAudioOnly(input.sourceAbsolutePath, wavAbs, m4aAbs, deps);
    const audioName = basename(audio.path);
    // Guard: never register a .mp4 as the peeled soundtrack.
    if (/\.mp4$/i.test(audioName)) {
      throw new Error(`BRAIN_MEDIA_PEEL_AUDIO_BAD_EXT:${audioName}`);
    }
    result.audioRelativePath = `media/imports/${audioName}`;
    result.audioBytes = await readFile(audio.path);
    result.audioExt = audio.ext;
    if (audio.ext === ".m4a") {
      await unlink(wavAbs).catch(() => undefined);
    } else {
      await unlink(m4aAbs).catch(() => undefined);
    }
  }

  return result;
}

export function contentHashHex(bytes: Buffer) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function peelOutputDir(projectRoot: string) {
  return join(projectRoot, "media", "imports");
}

export function peelSourceExtHint(pathOrName: string) {
  return extname(pathOrName || "").toLowerCase() || ".mp4";
}
