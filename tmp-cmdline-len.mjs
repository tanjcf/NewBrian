import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const projectRoot = "I:\\py_workerposse\\aigc";
const pipelinePath = join(projectRoot, ".brain-video", "pipeline-editor.json");
const indexJs = "I:\\G盘迁移备份\\workrpase\\BRAIN\\.materialized\\windows\\apps\\desktop\\out\\main\\index.js";

// Extract buildLayeredVideoFfmpegArgs + helpers from the bundle by evaluating a slice is hard.
// Instead: spawn electron-mainless by importing via vm from a minimal reimplementation using
// the exact source files compiled with strip-types and fixing the .js import.

const volumePath = "I:\\G盘迁移备份\\workrpase\\BRAIN\\shared\\apps\\desktop\\src\\shared\\video-volume-envelope.ts";
const layeredPath = "I:\\G盘迁移备份\\workrpase\\BRAIN\\shared\\apps\\desktop\\src\\main\\video-layered-ffmpeg.ts";

const volumeSrc = readFileSync(volumePath, "utf8")
  .replace(/export /g, "")
  .replace(/: [A-Za-z0-9_<>|&\s.,\[\]"'?=]+(?=[,)=])/g, ""); // crude - better use strip-types file copy

// Simpler: use node --experimental-strip-types with a shim package
import { writeFileSync, mkdirSync } from "node:fs";
const shimDir = "I:\\G盘迁移备份\\workrpase\\BRAIN\\tmp-ffmpeg-shim";
mkdirSync(join(shimDir, "shared"), { recursive: true });
mkdirSync(join(shimDir, "main"), { recursive: true });
writeFileSync(join(shimDir, "shared", "video-volume-envelope.ts"), readFileSync(volumePath, "utf8"));
writeFileSync(
  join(shimDir, "main", "video-layered-ffmpeg.ts"),
  readFileSync(layeredPath, "utf8").replace(
    'from "../shared/video-volume-envelope.js"',
    'from "../shared/video-volume-envelope.ts"'
  )
);

const { buildLayeredVideoFfmpegArgs } = await import(
  pathToFileURL(join(shimDir, "main", "video-layered-ffmpeg.ts")).href
);

const state = JSON.parse(await readFile(pipelinePath, "utf8"));
const layerClips = [];
for (const instance of state.clipInstances || []) {
  if (!instance || (instance.kind !== "video" && instance.kind !== "audio")) continue;
  const relative = String(instance.relativePath || "").replaceAll("\\", "/");
  if (!relative) continue;
  try { await access(join(projectRoot, relative)); } catch { console.log("missing", relative); continue; }
  const kind = instance.kind === "audio" ? "audio" : "video";
  const shotIndex = instance.shotId ? Math.max(0, Number(String(instance.shotId).replace(/\D/g, "")) - 1) : -1;
  const shot = shotIndex >= 0 ? (state.shots || [])[shotIndex] : undefined;
  const transition = kind === "video" ? String(shot?.transition || "cut") : undefined;
  layerClips.push({
    relativePath: relative,
    trackId: String(instance.trackId || (kind === "video" ? "v1" : "a1")),
    trackType: kind,
    startMs: Math.round(Math.max(0, Number(instance.startSec) || 0) * 1000),
    durationMs: Math.round(Math.max(0.1, Number(instance.durationSec) || 4) * 1000),
    volume: Math.max(0, Math.min(2, Number(instance.volume) || 1)),
    volumeKeyframes: instance.volumeKeyframes,
    stackOrder: kind === "video" ? (instance.trackId === "v2" ? 0 : 1) : 0,
    transition,
    transitionMs: transition && !/cut|硬切/i.test(transition) ? 250 : 0,
    text: undefined,
  });
}
for (const text of state.textClips || []) {
  layerClips.push({
    trackId: String(text.trackId || "v1"),
    trackType: "text",
    startMs: Math.max(0, Math.round((Number(text.startSec) || 0) * 1000)),
    durationMs: Math.max(100, Math.round((Number(text.durationSec) || 3) * 1000)),
    volume: 1,
    text: String(text.text || ""),
    fontSize: Math.max(12, Math.round(Number(text.fontSize) || 48)),
    color: String(text.color || "#ffffff"),
    x: Number(text.x),
    y: Number(text.y),
    scale: Number(text.scale) || 1,
    stackOrder: 0,
  });
}

const output = "exports/diag-test.mp4";
const args = buildLayeredVideoFfmpegArgs(layerClips, output, {
  width: state.canvas.width,
  height: state.canvas.height,
  fps: state.canvas.fps,
});

function winCmdlineLen(executable, argv) {
  // Rough CreateProcess quoting length
  const quote = (s) => (/\s|"/.test(s) ? `"${s.replaceAll('"', '\\"')}"` : s);
  return [executable, ...argv].map(quote).join(" ").length;
}

const len = winCmdlineLen("ffmpeg.exe", args);
const filter = args[args.indexOf("-filter_complex") + 1] || "";
console.log(JSON.stringify({
  layerClips: layerClips.length,
  args: args.length,
  cmdlineLen: len,
  filterLen: filter.length,
  over8k: len > 8191,
  over32k: len > 32767,
}, null, 2));
console.log("first args", args.slice(0, 20));
console.log("filter head", filter.slice(0, 300));
