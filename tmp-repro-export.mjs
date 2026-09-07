import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir, readFile, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const accessAsync = promisify(access);
const mkdirAsync = promisify(mkdir);
const readFileAsync = promisify(readFile);

const projectRoot = "I:\\py_workerposse\\aigc";
const bin = "I:\\G盘迁移备份\\workrpase\\BRAIN\\.materialized\\windows\\rust\\brain-core\\target\\debug\\brain-core.exe";
const pipelinePath = join(projectRoot, ".brain-video", "pipeline-editor.json");
const shimDir = "I:\\G盘迁移备份\\workrpase\\BRAIN\\tmp-ffmpeg-shim";
mkdirSync(join(shimDir, "shared"), { recursive: true });
mkdirSync(join(shimDir, "main"), { recursive: true });
const volumePath = "I:\\G盘迁移备份\\workrpase\\BRAIN\\shared\\apps\\desktop\\src\\shared\\video-volume-envelope.ts";
const layeredPath = "I:\\G盘迁移备份\\workrpase\\BRAIN\\shared\\apps\\desktop\\src\\main\\video-layered-ffmpeg.ts";
writeFileSync(join(shimDir, "shared", "video-volume-envelope.ts"), readFileSync(volumePath, "utf8"));
writeFileSync(
  join(shimDir, "main", "video-layered-ffmpeg.ts"),
  readFileSync(layeredPath, "utf8").replace(
    'from "../shared/video-volume-envelope.js"',
    'from "../shared/video-volume-envelope.ts"'
  )
);
const { buildLayeredVideoFfmpegArgs } = await import(pathToFileURL(join(shimDir, "main", "video-layered-ffmpeg.ts")).href);

async function request(child, payload) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: child.stdout });
    const timer = setTimeout(() => { rl.close(); reject(new Error("timeout " + payload.request_id)); }, 180_000);
    rl.once("line", (line) => { clearTimeout(timer); rl.close(); resolve(JSON.parse(line)); });
    child.stdin.write(JSON.stringify(payload) + "\n");
  });
}

async function runApproved(child, executable, args) {
  const token = randomBytes(32).toString("base64url");
  const approval = await request(child, {
    protocol_version: "1", request_id: "a-" + Date.now(), project_id: "p1", workspace_type: "video",
    operation: "approval.register", approval_token: "", resource_limits: { timeout_ms: 0, max_output_bytes: 1024 },
    payload: { token, operation: "process.run", ttl_ms: 0 }
  });
  if (approval.status !== "completed") return { phase: "approval", approval };
  const result = await request(child, {
    protocol_version: "1", request_id: "r-" + Date.now(), project_id: "p1", workspace_type: "video",
    operation: "process.run", approval_token: token, resource_limits: { timeout_ms: 0, max_output_bytes: 1_048_576 },
    payload: { executable, args, cwd: "." }
  });
  return { phase: "process", result };
}

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
for (const text of state.textClips || []) {
  layerClips.push({
    trackId: String(text.trackId || "v1"), trackType: "text",
    startMs: Math.max(0, Math.round((Number(text.startSec) || 0) * 1000)),
    durationMs: Math.max(100, Math.round((Number(text.durationSec) || 3) * 1000)),
    volume: 1, text: String(text.text || ""), fontSize: Math.max(12, Math.round(Number(text.fontSize) || 48)),
    color: String(text.color || "#ffffff"), x: Number(text.x), y: Number(text.y), scale: Number(text.scale) || 1, stackOrder: 0
  });
}

const output = `exports/diag-${Date.now()}.mp4`;
await mkdirAsync(join(projectRoot, "exports"), { recursive: true });
const args = buildLayeredVideoFfmpegArgs(layerClips, output, { width: state.canvas.width, height: state.canvas.height, fps: state.canvas.fps });
console.log("built args", args.length, "clips", layerClips.length);

const filteredEnv = Object.fromEntries(Object.entries(process.env).filter(([k, v]) =>
  ["PATH","Path","SystemRoot","WINDIR","HOME","USERPROFILE","TMP","TEMP"].includes(k) && typeof v === "string"));

const child = spawn(bin, ["--project-root", projectRoot], { cwd: projectRoot, windowsHide: true, stdio: ["pipe","pipe","pipe"], env: filteredEnv });
child.stderr.on("data", (c) => process.stderr.write(`[stderr] ${c}`));

try {
  console.log("HEALTH", (await request(child, {
    protocol_version: "1", request_id: "h1", project_id: "p1", workspace_type: "video",
    operation: "health.check", approval_token: "", resource_limits: { timeout_ms: 0, max_output_bytes: 4096 }, payload: {}
  })).status);

  const version = await runApproved(child, "ffmpeg.exe", ["-version"]);
  console.log("VERSION", version.result?.status, version.result?.error_code || "", version.result?.result?.success);

  const render = await runApproved(child, "ffmpeg.exe", args);
  const stderr = render.result?.result?.stderr_base64 ? Buffer.from(render.result.result.stderr_base64, "base64").toString("utf8").slice(-800) : "";
  console.log("RENDER", render.result?.status, render.result?.error_code || "", {
    success: render.result?.result?.success,
    exit: render.result?.result?.exit_code
  });
  console.log("STDERR_TAIL", stderr);
} finally {
  child.kill();
}
