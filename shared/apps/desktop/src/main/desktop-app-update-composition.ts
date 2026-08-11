import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BrowserWindow, app, shell } from "electron";
import { desktopIpcChannels, type DesktopAppUpdateProgress } from "@codex-forge/protocol";
import {
  buildDeferredSilentMsiexecScript,
  controlPlaneCacheRelease,
  DesktopAppUpdateService,
  parseDesktopAppRelease
} from "./desktop-app-update-service.js";
import { buildDeferredUlitZipApplyScript } from "./desktop-app-update-patch.js";
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
      // Destroyed/crashed renderers must not abort the download in main.
    }
  }
}

/**
 * Schedule silent msiexec after the app exits so LocalAppData/.codecn files unlock.
 * Returns immediately so the UI can show「安装完成即将重启」and quit.
 */
async function scheduleDeferredSilentMsiexec(input: {
  msiPath: string;
  args: string[];
  downloadDir: string;
}): Promise<{ exitCode: number | null; error?: string }> {
  const scriptPath = join(input.downloadDir, `silent-upgrade-${Date.now()}.cmd`);
  const script = buildDeferredSilentMsiexecScript({
    msiPath: input.msiPath,
    args: input.args,
    processImageName: "codeCN.exe",
    maxWaitSeconds: 90
  });
  try {
    await writeFile(scriptPath, script, "utf8");
  } catch (error) {
    return {
      exitCode: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
  return await spawnDetachedCmd(scriptPath);
}

async function scheduleDeferredUlitZipApply(input: {
  zipPath: string;
  installRoot: string;
  downloadDir: string;
}): Promise<{ exitCode: number | null; error?: string }> {
  const stagingDir = join(input.downloadDir, `ulit-stage-${Date.now()}`);
  const scriptPath = join(input.downloadDir, `ulit-apply-${Date.now()}.cmd`);
  const script = buildDeferredUlitZipApplyScript({
    zipPath: input.zipPath,
    installRoot: input.installRoot,
    stagingDir,
    processImageName: "codeCN.exe",
    maxWaitSeconds: 90
  });
  try {
    await writeFile(scriptPath, script, "utf8");
  } catch (error) {
    return {
      exitCode: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
  return await spawnDetachedCmd(scriptPath);
}

function spawnDetachedCmd(scriptPath: string): Promise<{ exitCode: number | null; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn("cmd.exe", ["/c", scriptPath], {
      windowsHide: true,
      detached: true,
      stdio: "ignore"
    });
    let settled = false;
    const finish = (result: { exitCode: number | null; error?: string }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.once("error", (error) => {
      finish({ exitCode: null, error: error.message || String(error) });
    });
    child.once("spawn", () => {
      try {
        child.unref();
      } catch {
        // ignore
      }
      finish({ exitCode: 0 });
    });
    setTimeout(() => {
      if (settled) return;
      try {
        child.unref();
      } catch {
        // ignore
      }
      finish({ exitCode: 0 });
    }, 250);
  });
}

/** Wire cached/refreshed control-plane release offers into click-to-upgrade IPC. */
export function registerDesktopAppUpdateComposition(deps: DesktopAppUpdateCompositionDeps) {
  const downloadDir = () => join(app.getPath("userData"), "updates");
  const service = new DesktopAppUpdateService({
    getCurrentVersion: () => app.getVersion(),
    getExecutablePath: () => app.getPath("exe"),
    readCachedRelease: async () => {
      const cached = controlPlaneCacheRelease(await deps.readControlPlaneState());
      if (!deps.fetchAppUpdate) return cached;
      try {
        return preferAppUpdatePayload(await deps.fetchAppUpdate(), cached);
      } catch {
        return cached;
      }
    },
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
    runSilentInstall: async ({ msiPath, args }) => scheduleDeferredSilentMsiexec({
      msiPath,
      args,
      downloadDir: downloadDir()
    }),
    runUlitZipApply: async ({ zipPath, installRoot }) => scheduleDeferredUlitZipApply({
      zipPath,
      installRoot,
      downloadDir: downloadDir()
    }),
    openInstallerFallback: async (path) => {
      const error = await shell.openPath(path);
      return error || "";
    },
    afterSilentSuccess: () => {
      // Detached msiexec waits for exit; quit so files unlock and LaunchCodecnAfterInstall can relaunch.
      setTimeout(() => {
        try {
          app.quit();
        } catch {
          // ignore
        }
      }, 600);
    },
    onProgress: broadcastAppUpdateProgress,
    verifyUpdate: deps.verifyAppUpdate
  });
  registerDesktopAppUpdateIpc({
    getStatus: () => service.getStatus({ refresh: true }),
    start: () => service.startUpdate(),
    verify: (input) => service.verifyUpdate(input)
  });
  return service;
}
