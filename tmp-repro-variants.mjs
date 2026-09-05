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
const { buildLayeredVideoFfmpegArgs } = await import(pathToFileURL(join(shimDir, "main", "video-layered-ffmpeg.ts")).href);

async function request(child, payload) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: child.stdout });
    const timer = setTimeout(() => { rl.close(); reject(new Error("timeout")); }, 180_000);
    rl.once("line", (line) => { clearTimeout(timer); rl.close(); resolve(JSON.parse(line)); });
    child.stdin.write(JSON.stringify(payload) + "\n");
  });
}
async function runApproved(child, executable, args) {
  const token = randomBytes(32).toString("base64url");
  await request(child, {
    protocol_version: "1", request_id: "a-" + Date.now(), project_id: "p1", workspace_type: "video",
    operation: "approval.register", approval_token: "", resource_limits: { timeout_ms: 0, max_output_bytes: 1024 },
    payload: { token, operation: "process.run", ttl_ms: 0 }
  });
  return request(child, {
    protocol_version: "1", request_id: "r-" + Date.now(), project_id: "p1", workspace_type: "video",
    operation: "process.run", approval_token: token, resource_limits: { timeout_ms: 0, max_output_bytes: 1_048_576 },
    payload: { executable, args, cwd: "." }
  });
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
// NO text clips on purpose
const output = `exports/diag-notext-${Date.now()}.mp4`;
await mkdirAsync(join(projectRoot, "exports"), { recursive: true });
const args = buildLayeredVideoFfmpegArgs(layerClips, output, { width: state.canvas.width, height: state.canvas.height, fps: state.canvas.fps });

const baseKeys = ["PATH","Path","SystemRoot","WINDIR","HOME","USERPROFILE","TMP","TEMP"];
const withAppData = [...baseKeys, "APPDATA", "LOCALAPPDATA", "FONTCONFIG_PATH", "FONTCONFIG_FILE"];

async function trial(label, envKeys, useText) {
  const clips = useText ? [...layerClips, {
    trackId: "v2", trackType: "text", startMs: 0, durationMs: 17440, volume: 1,
    text: "dome", fontSize: 26, color: "#ffffff", x: 0.37, y: 0.81, scale: 1, stackOrder: 0
  }] : layerClips;
  const out = `exports/diag-${label}-${Date.now()}.mp4`;
  const a = buildLayeredVideoFfmpegArgs(clips, out, { width: 1920, height: 1080, fps: 30 });
  const env = Object.fromEntries(Object.entries(process.env).filter(([k,v]) => envKeys.includes(k) && typeof v === "string"));
  const child = spawn(bin, ["--project-root", projectRoot], { cwd: projectRoot, windowsHide: true, stdio: ["pipe","pipe","pipe"], env });
  try {
    await request(child, { protocol_version:"1", request_id:"h", project_id:"p1", workspace_type:"video", operation:"health.check", approval_token:"", resource_limits:{timeout_ms:0,max_output_bytes:4096}, payload:{} });
    const result = await runApproved(child, "ffmpeg.exe", a);
    const stderr = result.result?.stderr_base64 ? Buffer.from(result.result.stderr_base64,"base64").toString("utf8") : "";
    console.log(label, result.status, result.error_code || "", { success: result.result?.success, exit: result.result?.exit_code }, stderr.includes("Fontconfig") ? "FONTCONFIG_ERR" : "no-fontconfig-msg");
  } finally { child.kill(); }
}

await trial("notext-minenv", baseKeys, false);
await trial("text-minenv", baseKeys, true);
await trial("text-appdata", withAppData, true);
