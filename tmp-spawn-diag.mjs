import { spawn } from "node:child_process";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";

const bin = "I:\\G盘迁移备份\\workrpase\\BRAIN\\rust\\brain-core\\target\\debug\\brain-core.exe";
const projectRoot = await mkdtemp(join(tmpdir(), "brain-core-spawn-"));
const ffmpegAbs = await realpath("C:\\Users\\Administrator\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe");

function request(child, payload) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: child.stdout });
    const timer = setTimeout(() => {
      rl.close();
      reject(new Error("timeout waiting for response"));
    }, 60_000);
    rl.once("line", (line) => {
      clearTimeout(timer);
      rl.close();
      try { resolve(JSON.parse(line)); } catch (error) { reject(error); }
    });
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  });
}

async function register(child, token) {
  return request(child, {
    protocol_version: "1",
    request_id: `a-${Date.now()}`,
    project_id: "p1",
    workspace_type: "video",
    operation: "approval.register",
    approval_token: "",
    resource_limits: { timeout_ms: 0, max_output_bytes: 1024 },
    payload: { token, operation: "process.run", ttl_ms: 0 },
  });
}

async function runProcess(child, executable, token, args = ["-version"]) {
  return request(child, {
    protocol_version: "1",
    request_id: `r-${Date.now()}-${Math.random()}`,
    project_id: "p1",
    workspace_type: "video",
    operation: "process.run",
    approval_token: token,
    resource_limits: { timeout_ms: 0, max_output_bytes: 1_048_576 },
    payload: { executable, args, cwd: "." },
  });
}

console.log("ffmpegAbs", ffmpegAbs);

const child = spawn(bin, ["--project-root", projectRoot], {
  cwd: projectRoot,
  windowsHide: true,
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    PATH: process.env.PATH,
    Path: process.env.Path,
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    USERPROFILE: process.env.USERPROFILE,
    TMP: process.env.TMP,
    TEMP: process.env.TEMP,
  },
});

child.stderr.on("data", (chunk) => process.stderr.write(`[stderr] ${chunk}`));
child.on("error", (err) => console.error("child error", err));

try {
  const health = await request(child, {
    protocol_version: "1",
    request_id: "h1",
    project_id: "p1",
    workspace_type: "video",
    operation: "health.check",
    approval_token: "",
    resource_limits: { timeout_ms: 0, max_output_bytes: 4096 },
    payload: {},
  });
  console.log("HEALTH", health.status, health.error_code || "", JSON.stringify(health.result || {}));

  for (const executable of ["ffmpeg.exe", ffmpegAbs, "cmd.exe"]) {
    const token = randomBytes(32).toString("base64url");
    const approval = await register(child, token);
    console.log("APPROVAL", executable, approval.status, approval.error_code || "");
    const args = executable === "cmd.exe" ? ["/c", "echo", "ok"] : ["-version"];
    const processResult = await runProcess(child, executable, token, args);
    const stdout = processResult.result?.stdout_base64
      ? Buffer.from(processResult.result.stdout_base64, "base64").toString("utf8").slice(0, 120)
      : "";
    const stderr = processResult.result?.stderr_base64
      ? Buffer.from(processResult.result.stderr_base64, "base64").toString("utf8").slice(0, 120)
      : "";
    console.log(
      "PROCESS",
      executable,
      processResult.status,
      processResult.error_code || "",
      JSON.stringify({ success: processResult.result?.success, exit: processResult.result?.exit_code, stdout, stderr })
    );
  }
} finally {
  child.kill();
  await rm(projectRoot, { recursive: true, force: true });
}
