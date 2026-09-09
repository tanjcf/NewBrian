import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = process.env.NEWBRAIN_E2E_APP_DIRECTORY?.trim()
  ? process.env.NEWBRAIN_E2E_APP_DIRECTORY.trim()
  : join(dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function readPages(debugPort) {
  try {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

/** Starts an isolated local Electron test instance when no CDP endpoint is already available. */
export async function ensureElectronE2ESession(debugPort) {
  const forceFresh = process.env.NEWBRAIN_E2E_FORCE_FRESH === "1";
  const existingPages = forceFresh ? null : await readPages(debugPort);
  if (existingPages) {
    return {
      pages: existingPages,
      started: false,
      close: () => undefined,
      workspacePath: process.env.NEWBRAIN_WORKSPACE_PATH?.trim() || undefined,
      readProcessOutput: () => ({ stdout: "", stderr: "", existingSession: true })
    };
  }

  const executable = process.env.NEWBRAIN_E2E_ELECTRON_EXECUTABLE?.trim() || (process.platform === "win32"
    ? join(appDirectory, "node_modules", "electron", "dist", "electron.exe")
    : join(appDirectory, "node_modules", ".bin", "electron"));
  if (!existsSync(executable)) throw new Error(`Electron executable is missing: ${executable}`);

  const sourceModelConfigPath = process.env.NEWBRAIN_E2E_MODEL_CONFIG_PATH?.trim();
  const useLiveWorkspace = process.env.NEWBRAIN_E2E_USE_LIVE_WORKSPACE === "1";
  const isolatedWorkspacePath = useLiveWorkspace && sourceModelConfigPath
    ? dirname(sourceModelConfigPath)
    : mkdtempSync(join(tmpdir(), "newbrain-e2e-"));
  if (!useLiveWorkspace && sourceModelConfigPath && existsSync(sourceModelConfigPath)) {
    copyFileSync(sourceModelConfigPath, join(isolatedWorkspacePath, "newbrain.config.json"));
    if (process.env.NEWBRAIN_E2E_COPY_LIVE_AUTH === "1") {
      const sourceStateRoot = join(dirname(sourceModelConfigPath), ".newbrain");
      const isolatedStateRoot = join(isolatedWorkspacePath, ".newbrain");
      mkdirSync(isolatedStateRoot, { recursive: true });
      for (const name of ["desktop-auth.json", "authorized-models.json", "desktop-bootstrap.json"]) {
        const sourcePath = join(sourceStateRoot, name);
        if (existsSync(sourcePath)) copyFileSync(sourcePath, join(isolatedStateRoot, name));
      }
      const sourceLocalState = join(dirname(sourceModelConfigPath), ".desktop-profile", "session", "Local State");
      if (existsSync(sourceLocalState)) {
        const isolatedSessionRoot = join(isolatedWorkspacePath, ".desktop-profile", "session");
        mkdirSync(isolatedSessionRoot, { recursive: true });
        copyFileSync(sourceLocalState, join(isolatedSessionRoot, "Local State"));
      }
    }
  }
  if (!useLiveWorkspace && process.env.NEWBRAIN_MODEL_BASE_URL) {
    const model = process.env.NEWBRAIN_E2E_MODEL_ID?.trim() || "newbrain-e2e-model";
    const modelConfigPath = join(isolatedWorkspacePath, "newbrain.config.json");
    writeFileSync(modelConfigPath, `${JSON.stringify({
      llm: {
        provider: "newbrain",
        baseUrl: process.env.NEWBRAIN_MODEL_BASE_URL,
        apiKey: "newbrain-e2e",
        wireApi: "responses",
        model,
        reviewModel: model,
        reasoningEffort: "medium",
        disableResponseStorage: true,
        systemPrompt: "You are the deterministic NewBrain Electron E2E model."
      }
    }, null, 2)}\n`, "utf8");
    const stateRoot = join(isolatedWorkspacePath, ".newbrain");
    mkdirSync(stateRoot, { recursive: true });
    writeFileSync(join(stateRoot, "authorized-models.json"), `${JSON.stringify([{
      id: model,
      model,
      label: "NewBrain E2E Model",
      provider: "newbrain"
    }], null, 2)}\n`, "utf8");
  }
  let stdout = "";
  let stderr = "";
  const appendOutput = (current, chunk) => `${current}${chunk}`.slice(-24_000);
  const child = spawn(executable, ["."], {
    cwd: appDirectory,
    env: {
      ...process.env,
      NEWBRAIN_E2E_REMOTE_DEBUG_PORT: String(debugPort),
      NEWBRAIN_E2E_AUTH_BYPASS: "1",
      NEWBRAIN_WORKSPACE_PATH: isolatedWorkspacePath
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false
  });
  child.stdout?.on("data", (chunk) => { stdout = appendOutput(stdout, chunk); });
  child.stderr?.on("data", (chunk) => { stderr = appendOutput(stderr, chunk); });
  const readProcessOutput = () => ({ stdout, stderr, exitCode: child.exitCode, processId: child.pid });
  let closed = false;
  let preserveWorkspace = false;
  const keepWorkspace = () => {
    preserveWorkspace = true;
  };
  const removeIsolatedWorkspace = () => {
    if (useLiveWorkspace || preserveWorkspace) return;
    try {
      rmSync(isolatedWorkspacePath, { recursive: true, force: true });
    } catch {
      // Electron can briefly retain profile handles while exiting; the OS temp root remains isolated.
    }
  };
  child.once("exit", removeIsolatedWorkspace);
  const close = (options = {}) => {
    if (closed) return;
    closed = true;
    preserveWorkspace = options.preserveWorkspace === true;
    child.kill();
  };
  process.once("exit", close);

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Electron E2E instance exited early with code ${child.exitCode}. Output: ${JSON.stringify(readProcessOutput())}`);
    const pages = await readPages(debugPort);
    if (pages?.some((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl)) {
      return { pages, started: true, close, preserveWorkspace: keepWorkspace, workspacePath: isolatedWorkspacePath, processId: child.pid, readProcessOutput };
    }
    await sleep(200);
  }
  close();
  throw new Error(`Electron E2E debug endpoint did not become ready on local port ${debugPort}. Output: ${JSON.stringify(readProcessOutput())}`);
}
