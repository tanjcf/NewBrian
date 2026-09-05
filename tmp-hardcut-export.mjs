import { spawn } from "node:child_process";
import { access, mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = "I:\\py_workerposse\\aigc";
const { buildLayeredVideoFfmpegArgs } = await import(
  pathToFileURL("I:\\G盘迁移备份\\workrpase\\BRAIN\\tmp-ffmpeg-shim\\main\\video-layered-ffmpeg.ts").href
);
const state = JSON.parse(await readFile(join(projectRoot, ".brain-video", "pipeline-editor.json"), "utf8"));
const layerClips = [];
for (const instance of state.clipInstances || []) {
  if (!instance || (instance.kind !== "video" && instance.kind !== "audio")) continue;
  const relative = String(instance.relativePath || "").replaceAll("\\", "/");
  if (!relative) continue;
  try { await access(join(projectRoot, relative)); } catch { continue; }
  const kind = instance.kind === "audio" ? "audio" : "video";
  layerClips.push({
    relativePath: relative,
    trackId: String(instance.trackId || (kind === "video" ? "v1" : "a1")),
    trackType: kind,
    startMs: Math.round(Math.max(0, Number(instance.startSec) || 0) * 1000),
    durationMs: Math.round(Math.max(0.1, Number(instance.durationSec) || 4) * 1000),
    volume: Math.max(0, Math.min(2, Number(instance.volume) || 1)),
    volumeKeyframes: instance.volumeKeyframes,
    stackOrder: 0,
    transition: "cut",
    transitionMs: 0,
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

const output = `exports/hardcut-${Date.now()}.mp4`;
await mkdir(join(projectRoot, "exports"), { recursive: true });
const args = buildLayeredVideoFfmpegArgs(layerClips, output, { width: 1920, height: 1080, fps: 30 });
console.log("drawtext", args.some((a) => String(a).includes("drawtext")));
console.log("fontfile", String(args.find((a) => String(a).includes("fontfile")) || "").slice(0, 200));

const child = spawn("ffmpeg.exe", args, { cwd: projectRoot, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
let stderr = "";
child.stderr.on("data", (c) => { stderr += c.toString("utf8"); });
const code = await new Promise((resolve) => child.on("close", resolve));
let size = 0;
try { size = (await stat(join(projectRoot, output))).size; } catch { /* missing */ }
console.log(JSON.stringify({ exit: code, size, fontconfig: /Fontconfig error/i.test(stderr) }));
console.log(stderr.slice(-800));
