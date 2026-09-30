import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const requireFromApp = createRequire(join(appDirectory, "package.json"));
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function readPages(debugPort) {
  try {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

function resolveElectronExecutable() {
  const packagedApp = join(
    appDirectory,
    "release",
    "mac-arm64",
    "newbrain-mac.app",
    "Contents",
    "MacOS",
    "newbrain-mac"
  );
  if (process.env.NEWBRAIN_E2E_USE_PACKAGED === "1" && existsSync(packagedApp)) {
    return packagedApp;
  }
  if (process.platform === "win32") {
    const windowsCandidate = join(appDirectory, "node_modules", "electron", "dist", "electron.exe");
    if (existsSync(windowsCandidate)) return windowsCandidate;
  } else {
    try {
      const resolved = requireFromApp("electron");
      if (typeof resolved === "string" && existsSync(resolved)) return resolved;
    } catch {
      // Fall through to packaged paths.
    }
    const macCandidate = join(
      appDirectory,
      "node_modules",
      "electron",
      "dist",
      "Electron.app",
      "Contents",
      "MacOS",
      "Electron"
    );
    if (existsSync(macCandidate)) return macCandidate;
  }
  if (existsSync(packagedApp)) return packagedApp;
  const shim = join(appDirectory, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
  if (existsSync(shim)) return shim;
  throw new Error(`Electron executable is missing under ${appDirectory}`);
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
      workspacePath: process.env.NEWBRAIN_WORKSPACE_PATH?.trim() || undefined
    };
  }

  const executable = resolveElectronExecutable();
  const usingPackagedApp = /newbrain-mac(?:\.exe)?$/i.test(executable) || executable.includes("newbrain-mac.app");
  const launchArgs = usingPackagedApp ? [] : ["."];

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
  // Cursor/agent shells often set ELECTRON_RUN_AS_NODE=1. If inherited, Electron
  // runs as plain Node (REPL / "bad option: --remote-debugging-port") and never starts Chromium.
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  delete childEnv.ELECTRON_NO_ASAR;
  Object.assign(childEnv, {
    NEWBRAIN_E2E_REMOTE_DEBUG_PORT: String(debugPort),
    NEWBRAIN_E2E_AUTH_BYPASS: "1",
    NEWBRAIN_WORKSPACE_PATH: isolatedWorkspacePath,
    // Optional Finder/Dock-like PATH for the app process only (parent keeps a full PATH to spawn Electron).
    ...(process.env.NEWBRAIN_E2E_CHILD_PATH?.trim()
      ? { PATH: process.env.NEWBRAIN_E2E_CHILD_PATH.trim() }
      : {})
  });
  const child = spawn(executable, launchArgs, {
    cwd: usingPackagedApp ? dirname(executable) : appDirectory,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false
  });
  let launchStderr = "";
  child.stderr?.on("data", (chunk) => {
    launchStderr += String(chunk);
    if (launchStderr.length > 8_000) launchStderr = launchStderr.slice(-8_000);
  });
  child.stdout?.on("data", (chunk) => {
    launchStderr += String(chunk);
    if (launchStderr.length > 8_000) launchStderr = launchStderr.slice(-8_000);
  });
  let closed = false;
  let preserveWorkspace = false;
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
    if (child.exitCode !== null) {
      throw new Error(
        `Electron E2E instance exited early with code ${child.exitCode}.${launchStderr ? ` Output:\n${launchStderr}` : ""}`
      );
    }
    const pages = await readPages(debugPort);
    if (pages?.some((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl)) {
      return { pages, started: true, close, workspacePath: isolatedWorkspacePath, processId: child.pid };
    }
    await sleep(200);
  }
  close();
  throw new Error(`Electron E2E debug endpoint did not become ready on local port ${debugPort}.`);
}
