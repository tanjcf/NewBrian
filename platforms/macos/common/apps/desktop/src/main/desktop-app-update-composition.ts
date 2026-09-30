import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BrowserWindow, app } from "electron";
import { resolveElectronAppVersion } from "./resolve-app-version.js";
import { desktopIpcChannels, type DesktopAppUpdateProgress } from "@codex-forge/protocol";
import {
  buildDeferredMacZipApplyScript,
  resolveMacAppBundlePath
} from "./desktop-app-update-apply.js";
import {
  controlPlaneCacheRelease,
  DesktopAppUpdateService,
  parseDesktopAppRelease
} from "./desktop-app-update-service.js";
import { registerDesktopAppUpdateIpc } from "./desktop-app-update-ipc.js";

interface DesktopAppUpdateCompositionDeps {
  readControlPlaneState: () => Promise<unknown>;
  syncControlPlane: () => Promise<unknown>;
  fetchAppUpdate?: () => Promise<unknown>;
  verifyAppUpdate?: (input: {
    releaseId: string;
    ok: boolean;
    appVersion: string;
  }) => Promise<Record<string, unknown>>;
}

function preferAppUpdatePayload(primary: unknown, fallback: unknown): unknown {
  return parseDesktopAppRelease(primary) ? primary : fallback;
}

function broadcastAppUpdateProgress(progress: DesktopAppUpdateProgress) {
  for (const window of BrowserWindow.getAllWindows()) {
    try {
      if (window.isDestroyed()) continue;
      window.webContents.send(desktopIpcChannels.appUpdate.progress, progress);
    } catch {
      // ignore
    }
  }
}

async function scheduleDeferredMacZipApply(input: {
  zipPath: string;
  appBundlePath: string;
  expectedVersion: string;
  downloadDir: string;
}): Promise<{ exitCode: number | null; error?: string }> {
  const runId = `${Date.now()}-${process.pid}`;
  const scriptPath = join(input.downloadDir, `mac-upgrade-${runId}.sh`);
  const resultPath = join(input.downloadDir, "last-mac-update.json");
  const script = buildDeferredMacZipApplyScript({
    zipPath: input.zipPath,
    appBundlePath: input.appBundlePath,
    processId: process.pid,
    maxWaitSeconds: 90,
    resultPath,
    expectedVersion: input.expectedVersion
  });
  try {
    await writeFile(scriptPath, script, { encoding: "utf8", mode: 0o755 });
    await chmod(scriptPath, 0o755);
  } catch (error) {
    return {
      exitCode: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
  return await new Promise((resolve) => {
    const child = spawn("/bin/bash", [scriptPath], {
      detached: true,
      stdio: "ignore",
      env: process.env
    });
    child.once("error", (error) => resolve({ exitCode: null, error: error.message }));
    child.once("spawn", () => {
      child.unref();
      resolve({ exitCode: 0 });
    });
  });
}

function skippedVersionPath() {
  return join(app.getPath("userData"), "updates", "skipped-version.txt");
}

let desktopUpdateExitPending = false;

/** True while a deferred Mac zip apply is about to force-quit the process. */
export function isDesktopUpdateExitPending(): boolean {
  return desktopUpdateExitPending;
}

/** Wire Spring/control-plane release offers into Cockpit-style Mac zip update IPC. */
export function registerDesktopAppUpdateComposition(deps: DesktopAppUpdateCompositionDeps) {
  const downloadDir = () => join(app.getPath("userData"), "updates");
  const service = new DesktopAppUpdateService({
    getCurrentVersion: () => resolveElectronAppVersion(app),
    getExecutablePath: () => app.getPath("exe"),
    readCachedRelease: async () => controlPlaneCacheRelease(await deps.readControlPlaneState()),
    refreshRelease: async () => {
      const synced = controlPlaneCacheRelease(await deps.syncControlPlane());
      if (!deps.fetchAppUpdate) return synced;
      try {
        return preferAppUpdatePayload(await deps.fetchAppUpdate(), synced);
      } catch {
        return synced;
      }
    },
    downloadDir,
    runZipApply: async ({ zipPath, appBundlePath, expectedVersion }) =>
      scheduleDeferredMacZipApply({
        zipPath,
        appBundlePath: appBundlePath || resolveMacAppBundlePath(app.getPath("exe")),
        expectedVersion,
        downloadDir: downloadDir()
      }),
    afterSilentSuccess: () => {
      desktopUpdateExitPending = true;
      setTimeout(() => {
        try {
          app.quit();
        } catch {
          // ignore
        }
      }, 200);
      setTimeout(() => {
        try {
          app.exit(0);
        } catch {
          // ignore
        }
      }, 3500);
    },
    onProgress: broadcastAppUpdateProgress,
    verifyUpdate: deps.verifyAppUpdate,
    readSkippedVersion: async () => {
      try {
        const text = (await readFile(skippedVersionPath(), "utf8")).trim();
        return text || null;
      } catch {
        return null;
      }
    },
    writeSkippedVersion: async (version) => {
      await mkdir(downloadDir(), { recursive: true });
      if (!version) {
        await rm(skippedVersionPath(), { force: true }).catch(() => undefined);
        return;
      }
      await writeFile(skippedVersionPath(), version, "utf8");
    }
  });
  registerDesktopAppUpdateIpc({
    getStatus: () => service.getStatus({ refresh: true }),
    start: () => service.startUpdate(),
    apply: () => service.applyStagedUpdate(),
    getApplied: () => service.getAppliedUpdate(),
    dismissApplied: () => service.dismissAppliedUpdate(),
    skipVersion: (version) => service.skipVersion(version),
    verify: (input) => service.verifyUpdate(input)
  });
  return service;
}
