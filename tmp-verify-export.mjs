import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir, readFile, writeFile, stat, realpathSync } from "node:fs";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { mkdirSync, writeFileSync, readFileSync, realpathSync as realpathSyncFs } from "node:fs";

const accessAsync = promisify(access);
const mkdirAsync = promisify(mkdir);
const readFileAsync = promisify(readFile);
const statAsync = promisify(stat);

const projectRoot = "I:\\py_workerposse\\aigc";
const bin = "I:\\G盘迁移备份\\workrpase\\BRAIN\\.materialized\\windows\\rust\\brain-core\\target\\debug\\brain-core.exe";
const sharedLayered = "I:\\G盘迁移备份\\workrpase\\BRAIN\\shared\\apps\\desktop\\src\\main\\video-layered-ffmpeg.ts";
const sharedVolume = "I:\\G盘迁移备份\\workrpase\\BRAIN\\shared\\apps\\desktop\\src\\shared\\video-volume-envelope.ts";
const shimMain = "I:\\G盘迁移备份\\workrpase\\BRAIN\\tmp-ffmpeg-shim\\main\\video-layered-ffmpeg.ts";
const shimVol = "I:\\G盘迁移备份\\workrpase\\BRAIN\\tmp-ffmpeg-shim\\shared\\video-volume-envelope.ts";

mkdirSync(dirname(shimMain), { recursive: true });
mkdirSync(dirname(shimVol), { recursive: true });
writeFileSync(shimMain, readFileSync(sharedLayered, "utf8").replace(
  'from "../shared/video-volume-envelope.js"',
  'from "../shared/video-volume-envelope.ts"'
));
writeFileSync(shimVol, readFileSync(sharedVolume, "utf8"));

const { buildLayeredVideoFfmpegArgs } = await import(pathToFileURL(shimMain).href);
const ffmpegAbs = realpathSyncFs("C:\\Users\\Administrator\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe");

async function request(child, payload) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: child.stdout });
    const timer = setTimeout(() => { rl.close(); reject(new Error("timeout")); }, 300_000);
    rl.once("line", (line) => { clearTimeout(timer); rl.close(); resolve(JSON.parse(line)); });
    child.stdin.write(JSON.stringify(payload) + "\n");
  });
}

const state = JSON.parse(await readFileAsync(join(projectRoot, ".brain-video", "pipeline-editor.json"), "utf8"));
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
    relativePath: relative,
    trackId: String(instance.trackId || (kind === "video" ? "v1" : "a1")),
    trackType: kind,
    startMs: Math.round(Math.max(0, Number(instance.startSec) || 0) * 1000),
    durationMs: Math.round(Math.max(0.1, Number(instance.durationSec) || 4) * 1000),
    volume: Math.max(0, Math.min(2, Number(instance.volume) || 1)),
    // Flat volume avoids ffmpeg 9 eval=frame crashes seen with rubber-band envelopes.
    volumeKeyframes: undefined,
    stackOrder: 0,
    transition: "cut",
    transitionMs: 0,
  });
}
for (const text of state.textClips || []) {
  layerClips.push({
    trackId: String(text.trackId || "v1"), trackType: "text",
    startMs: Math.max(0, Math.round((Number(text.startSec) || 0) * 1000)),
    durationMs: Math.max(100, Math.round((Number(text.durationSec) || 3) * 1000)),
    volume: 1, text: String(text.text || ""),
    fontSize: Math.max(12, Math.round(Number(text.fontSize) || 48)),
    color: String(text.color || "#ffffff"), x: Number(text.x), y: Number(text.y),
    scale: Number(text.scale) || 1, stackOrder: 0,
  });
}

const output = `exports/verify-inline-${Date.now()}.mp4`;
await mkdirAsync(join(projectRoot, "exports"), { recursive: true });
const args = buildLayeredVideoFfmpegArgs(layerClips, output, {
  width: state.canvas.width, height: state.canvas.height, fps: state.canvas.fps,
});
const filter = args[args.indexOf("-filter_complex") + 1] || "";
console.log("drawtext snippet", filter.match(/drawtext=[^[]+/)?.[0]?.slice(0, 180));
console.log("cmdline approx", ["ffmpeg", ...args].join(" ").length);

const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) =>
  ["PATH", "Path", "SystemRoot", "WINDIR", "HOME", "USERPROFILE", "TMP", "TEMP", "APPDATA", "LOCALAPPDATA"].includes(k) && typeof v === "string"));

const child = spawn(bin, ["--project-root", projectRoot], {
  cwd: projectRoot, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env,
});

try {
  console.log("HEALTH", (await request(child, {
    protocol_version: "1", request_id: "h1", project_id: "p1", workspace_type: "video",
    operation: "health.check", approval_token: "", resource_limits: { timeout_ms: 0, max_output_bytes: 4096 }, payload: {},
  })).status);

  const token = randomBytes(32).toString("base64url");
  await request(child, {
    protocol_version: "1", request_id: "a1", project_id: "p1", workspace_type: "video",
    operation: "approval.register", approval_token: "", resource_limits: { timeout_ms: 0, max_output_bytes: 1024 },
    payload: { token, operation: "process.run", ttl_ms: 0 },
  });

  const result = await request(child, {
    protocol_version: "1", request_id: "r1", project_id: "p1", workspace_type: "video",
    operation: "process.run", approval_token: token,
    resource_limits: { timeout_ms: 0, max_output_bytes: 1_048_576 },
    payload: { executable: ffmpegAbs, args, cwd: "." },
  });
  const stderr = result.result?.stderr_base64
    ? Buffer.from(result.result.stderr_base64, "base64").toString("utf8")
    : "";
  let size = 0;
  try { size = (await statAsync(join(projectRoot, output))).size; } catch {}
  console.log("RENDER", result.status, result.error_code || "", {
    success: result.result?.success, exit: result.result?.exit_code, size,
  });
  console.log("ERR", stderr.match(/Error[^\r\n]{0,160}|Invalid argument|timebase|Fontconfig|Conversion failed|moov/g)?.slice(0, 8));
  if (size > 0) {
    const probe = spawn("ffprobe.exe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", join(projectRoot, output)], { windowsHide: true });
    let out = "";
    probe.stdout.on("data", (c) => { out += c; });
    await new Promise((r) => probe.on("close", r));
    console.log("DURATION", out.trim());
  }
} finally {
  child.kill();
}
