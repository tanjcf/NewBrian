import { spawn } from "node:child_process";
import { access, mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = "I:\\py_workerposse\\aigc";
const { buildLayeredVideoFfmpegArgs, resolveDrawtextFontfile } = await import(
  pathToFileURL("I:\\G盘迁移备份\\workrpase\\BRAIN\\tmp-ffmpeg-shim\\main\\video-layered-ffmpeg.ts").href
);

console.log("font candidate", resolveDrawtextFontfile());

const state = JSON.parse(await readFile(join(projectRoot, ".brain-video", "pipeline-editor.json"), "utf8"));

async function buildClips(includeText, forceCut) {
  const layerClips = [];
  for (const instance of state.clipInstances || []) {
    if (!instance || (instance.kind !== "video" && instance.kind !== "audio")) continue;
    const relative = String(instance.relativePath || "").replaceAll("\\", "/");
    if (!relative) continue;
    try { await access(join(projectRoot, relative)); } catch { continue; }
    const kind = instance.kind === "audio" ? "audio" : "video";
    const shotIndex = instance.shotId ? Math.max(0, Number(String(instance.shotId).replace(/\D/g, "")) - 1) : -1;
    const shot = shotIndex >= 0 ? (state.shots || [])[shotIndex] : undefined;
    const transition = forceCut ? "cut" : (kind === "video" ? String(shot?.transition || "cut") : undefined);
    layerClips.push({
      relativePath: relative,
      trackId: String(instance.trackId || (kind === "video" ? "v1" : "a1")),
      trackType: kind,
      startMs: Math.round(Math.max(0, Number(instance.startSec) || 0) * 1000),
      durationMs: Math.round(Math.max(0.1, Number(instance.durationSec) || 4) * 1000),
      volume: Math.max(0, Math.min(2, Number(instance.volume) || 1)),
      volumeKeyframes: instance.volumeKeyframes,
      stackOrder: 0,
      transition,
      transitionMs: transition && !/cut|硬切/i.test(transition) ? 250 : 0,
    });
  }
  if (includeText) {
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
  }
  return layerClips;
}

async function run(label, includeText, forceCut) {
  const output = `exports/${label}-${Date.now()}.mp4`;
  await mkdir(join(projectRoot, "exports"), { recursive: true });
  const args = buildLayeredVideoFfmpegArgs(await buildClips(includeText, forceCut), output, {
    width: 1920, height: 1080, fps: 30,
  });
  const filter = args[args.indexOf("-filter_complex") + 1] || "";
  const drawIdx = filter.indexOf("drawtext");
  if (drawIdx >= 0) console.log(label, "drawtext snippet", filter.slice(drawIdx, drawIdx + 220));
  const child = spawn("ffmpeg.exe", args, { cwd: projectRoot, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (c) => { stderr += c.toString("utf8"); });
  const code = await new Promise((resolve) => child.on("close", resolve));
  let size = 0;
  try { size = (await stat(join(projectRoot, output))).size; } catch { /* */ }
  console.log(label, JSON.stringify({
    exit: code,
    size,
    ok: code === 0 && size > 0,
    err: stderr.match(/Error[^\n]{0,120}|Invalid argument|timebase|Fontconfig|Conversion failed/g)?.slice(0, 6),
  }));
}

await run("cut-notext", false, true);
await run("xfade-notext", false, false);
await run("cut-text", true, true);
