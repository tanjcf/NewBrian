import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const stateRoot = process.env.NEWBRAIN_WORKSPACE_PATH || resolve(homedir(), ".newbrain");
const config = JSON.parse(readFileSync(resolve(stateRoot, "newbrain.config.json"), "utf8"));
const baseUrl = String(process.env.NEWBRAIN_MODEL_BASE_URL || config?.llm?.baseUrl || "").trim();
if (!baseUrl) throw new Error("A configured model base URL is required for visible E2E authentication bypass.");

const appDirectory = resolve(import.meta.dirname, "..");
const executable = resolve(appDirectory, "node_modules", "electron", "dist", "electron.exe");
const child = spawn(executable, ["."], {
  cwd: appDirectory,
  detached: true,
  stdio: "ignore",
  windowsHide: false,
  env: {
    ...process.env,
    NEWBRAIN_WORKSPACE_PATH: stateRoot,
    NEWBRAIN_MODEL_BASE_URL: baseUrl,
    NEWBRAIN_E2E_AUTH_BYPASS: "1",
    NEWBRAIN_E2E_REMOTE_DEBUG_PORT: process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || "9555"
  }
});
child.unref();
console.log(JSON.stringify({ pid: child.pid, stateRoot, baseUrl, debugPort: process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || "9555" }));
