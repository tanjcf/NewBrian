import { spawn } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

const projectRoot = join(homedir(), ".codecn", ".codecn", "projects", "区域季度经营分析-E2E-1787622968401自动化");
const bin = "I:\\G盘迁移备份\\workrpase\\BRAIN\\.materialized\\windows\\rust\\brain-core\\target\\debug\\brain-core.exe";
const state = JSON.parse(readFileSync(join(projectRoot, ".brain-data", "analysis-editor.json"), "utf8"));
const projectId = "project_f59555cd-15b0-4bea-bb71-2ee2e48b7969";
const token = randomBytes(32).toString("base64url");

const child = spawn(bin, ["--project-root", projectRoot], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const waitLine = () => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("timeout waiting line")), 20_000);
  const onData = (d) => {
    buf += d.toString("utf8");
    const i = buf.indexOf("\n");
    if (i >= 0) {
      clearTimeout(timer);
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      child.stdout.off("data", onData);
      resolve(line);
    }
  };
  child.stdout.on("data", onData);
});
async function send(req) {
  child.stdin.write(JSON.stringify(req) + "\n");
  return JSON.parse(await waitLine());
}

const r1 = await send({
  protocol_version: "1",
  request_id: "reg-2",
  project_id: projectId,
  workspace_type: "data",
  operation: "approval.register",
  approval_token: "",
  resource_limits: { timeout_ms: 0, max_output_bytes: 1024 },
  payload: { token, operation: "data.cook", ttl_ms: 0 }
});
console.log("register", r1.status, r1.error_code || "");
const r2 = await send({
  protocol_version: "1",
  request_id: "cook-1",
  project_id: projectId,
  workspace_type: "data",
  operation: "data.cook",
  approval_token: token,
  resource_limits: { timeout_ms: 0, max_output_bytes: 1048576 },
  payload: { state }
});
console.log("cook", JSON.stringify(r2, null, 2));
child.kill();

for (const rel of ["Docs/BRAIN/analysis.json", ".brain-data/manifest.json", ".brain-data/analysis-editor.json"]) {
  const p = join(projectRoot, rel);
  console.log(rel, existsSync(p) ? statSync(p).size : "MISSING");
}
