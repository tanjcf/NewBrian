import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const stateRoot = process.env.CODECN_WORKSPACE_PATH || resolve(homedir(), ".codecn");
const config = JSON.parse(readFileSync(resolve(stateRoot, "codecn.config.json"), "utf8"));
const baseUrl = String(process.env.CODECN_MODEL_BASE_URL || config?.llm?.baseUrl || "").trim();
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
    CODECN_WORKSPACE_PATH: stateRoot,
    CODECN_MODEL_BASE_URL: baseUrl,
    CODECN_E2E_AUTH_BYPASS: "1",
    CODECN_E2E_REMOTE_DEBUG_PORT: process.env.CODECN_E2E_REMOTE_DEBUG_PORT || "9555"
  }
});
child.unref();
console.log(JSON.stringify({ pid: child.pid, stateRoot, baseUrl, debugPort: process.env.CODECN_E2E_REMOTE_DEBUG_PORT || "9555" }));
