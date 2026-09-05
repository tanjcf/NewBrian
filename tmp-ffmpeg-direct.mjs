import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const accessAsync = promisify(access);
const mkdirAsync = promisify(mkdir);
const readFileAsync = promisify(readFile);

const projectRoot = "I:\\py_workerposse\\aigc";
const pipelinePath = join(projectRoot, ".brain-video", "pipeline-editor.json");
const shimDir = "I:\\G盘迁移备份\\workrpase\\BRAIN\\tmp-ffmpeg-shim";
const { buildLayeredVideoFfmpegArgs } = await import(pathToFileURL(join(shimDir, "main", "video-layered-ffmpeg.ts")).href);

const state = JSON.parse(await readFileAsync(pipelinePath, "utf8"));
const layerClips = [];
for (const instance of state.clipInstances || []) {
  if (!instance || (instance.kind !== "video" && instance.kind !== "audio")) continue;
  const relative = String(instance.relativePath || "").replaceAll("\\", "/");
  if (!relative) continue;
  try { await accessAsync(join(projectRoot, relative)); } catch { continue; }
  const kind = instance.kind === "audio" ? "audio" : "video";
  const shotIndex = instance.shotId ? Math.max(0, Number(String(instance.shotId).replace(/\D/g, "")) - 1) : -1;
  const shot = shotIndex >= 0 ? (state.shots || [])[shotIndex] : undefined;
  const transition = kind === "video" ? String(shot?.transition || "cut") : undefined;
  layerClips.push({
    relativePath: relative, trackId: String(instance.trackId || (kind === "video" ? "v1" : "a1")), trackType: kind,
    startMs: Math.round(Math.max(0, Number(instance.startSec) || 0) * 1000),
    durationMs: Math.round(Math.max(0.1, Number(instance.durationSec) || 4) * 1000),
    volume: Math.max(0, Math.min(2, Number(instance.volume) || 1)), volumeKeyframes: instance.volumeKeyframes,
    stackOrder: 0, transition, transitionMs: transition && !/cut|硬切/i.test(transition) ? 250 : 0
  });
}

const output = `exports/direct-${Date.now()}.mp4`;
await mkdirAsync(join(projectRoot, "exports"), { recursive: true });
const args = buildLayeredVideoFfmpegArgs(layerClips, output, { width: 1920, height: 1080, fps: 30 });

const child = spawn("ffmpeg.exe", args, { cwd: projectRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let stderr = "";
child.stderr.on("data", (c) => { stderr += c.toString("utf8"); });
const code = await new Promise((resolve) => child.on("close", resolve));
console.log("exit", code);
console.log(stderr.slice(-1500));
