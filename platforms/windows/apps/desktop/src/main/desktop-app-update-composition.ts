import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { BrowserWindow, app, shell } from "electron";
import { desktopIpcChannels, type DesktopAppUpdateProgress } from "@codex-forge/protocol";
import {
  buildDeferredSilentNsisScript,
  controlPlaneCacheRelease,
  DesktopAppUpdateService,
  parseDesktopAppRelease
} from "./desktop-app-update-service.js";
import { buildDeferredUlitZipApplyScript } from "./desktop-app-update-patch.js";
import { registerDesktopAppUpdateIpc } from "./desktop-app-update-ipc.js";
import { buildMsiUpdateRunner } from "./desktop-app-update-runner.js";
import { resolveElectronAppVersion } from "./resolve-app-version.js";

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

async function scheduleDeferredSilentMsiexec(input: {
  expectedVersion?: string;
  fullMsi?: boolean;
  msiPath: string;
  args: string[];
  downloadDir: string;
}): Promise<{ exitCode: number | null; error?: string }> {
  const runId = `${Date.now()}-${process.pid}`;
  const scriptPath = join(input.downloadDir, `silent-upgrade-${runId}.ps1`);
  const executablePath = app.getPath("exe");
  const script = buildMsiUpdateRunner({
    msiPath: input.msiPath,
    expectedVersion: input.expectedVersion,
    fullMsi: input.fullMsi,
    args: input.args,
    executablePath,
    processId: process.pid,
    dataRoot: dirname(app.getPath("userData")),
    chatRoot: join(dirname(executablePath), "tmp"),
    downloadDir: input.downloadDir,
    backupRoot: join(app.getPath("appData"), "newbrain-update-backups", runId),
    resultPath: join(input.downloadDir, "last-msi-update.json")
  });
  try {
    await writeFile(scriptPath, script, "utf8");
  } catch (error) {
    return {
      exitCode: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
  return await spawnDetachedHiddenPowerShell(scriptPath);
}

async function scheduleDeferredSilentNsis(input: {
  setupPath: string;
  executablePath: string;
  downloadDir: string;
}): Promise<{ exitCode: number | null; error?: string }> {
  // Hidden PowerShell — never cmd.exe (avoids the black console flash after quit).
  const scriptPath = join(input.downloadDir, `nsis-upgrade-${Date.now()}.ps1`);
  const imageName = basename(input.executablePath) || "NewBrain.exe";
  const script = buildDeferredSilentNsisScript({
    setupPath: input.setupPath,
    executablePath: input.executablePath,
    processImageName: imageName,
    processId: process.pid,
    maxWaitSeconds: 90,
    resultPath: join(input.downloadDir, "last-nsis-update.json")
  });
  try {
    await writeFile(scriptPath, script, "utf8");
  } catch (error) {
    return {
      exitCode: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
  return await spawnDetachedHiddenPowerShell(scriptPath);
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
    processImageName: "NewBrain.exe",
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
  return await spawnDetachedHiddenCmd(scriptPath);
}

/**
 * Launch PowerShell with zero console flash.
 * Direct powershell.exe is a console subsystem app and can briefly flash a black
 * window even with -WindowStyle Hidden + windowsHide. wscript.exe is GUI-subsystem;
 * Run(..., 0, False) starts the script with window style Hidden and no wait.
 */
async function spawnDetachedHiddenPowerShell(
  scriptPath: string
): Promise<{ exitCode: number | null; error?: string }> {
  const vbsPath = join(dirname(scriptPath), `hidden-ps-${Date.now()}.vbs`);
  const psQuoted = String(scriptPath).replace(/"/g, '""');
  const vbs = [
    'Set sh = CreateObject("WScript.Shell")',
    `sh.Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""${psQuoted}""", 0, False`,
    ""
  ].join("\r\n");
  try {
    await writeFile(vbsPath, vbs, "utf8");
  } catch (error) {
    return {
      exitCode: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
  return new Promise((resolve) => {
    const child = spawn("wscript.exe", ["//B", "//Nologo", vbsPath], {
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

/**
 * Last-resort cmd launcher for legacy ulit apply scripts.
 * Starts cmd itself with a hidden PowerShell wrapper so the black console does not flash.
 */
function spawnDetachedHiddenCmd(scriptPath: string): Promise<{ exitCode: number | null; error?: string }> {
  const escaped = String(scriptPath).replace(/'/g, "''");
  const launcher = join(dirname(scriptPath), `hidden-cmd-${Date.now()}.ps1`);
  const body =
    `$p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d','/c', '${escaped}') `
    + `-WindowStyle Hidden -PassThru; if ($p) { exit 0 } else { exit 1 }\r\n`;
  return writeFile(launcher, body, "utf8")
    .then(() => spawnDetachedHiddenPowerShell(launcher))
    .catch((error) => ({
      exitCode: null,
      error: error instanceof Error ? error.message : String(error)
    }));
}

function skippedVersionPath() {
  return join(app.getPath("userData"), "updates", "skipped-version.txt");
}

let desktopUpdateExitPending = false;

/** True while a deferred MSI/NSIS apply is about to force-quit the process. */
export function isDesktopUpdateExitPending(): boolean {
  return desktopUpdateExitPending;
}

/** Wire cached/refreshed control-plane release offers into click-to-upgrade IPC. */
export function registerDesktopAppUpdateComposition(deps: DesktopAppUpdateCompositionDeps) {
  const downloadDir = () => join(app.getPath("userData"), "updates");
  const service = new DesktopAppUpdateService({
    getCurrentVersion: () => resolveElectronAppVersion(app),
    getExecutablePath: () => app.getPath("exe"),
    readCachedRelease: async () => {
      // Disk-only: never await the network here. Settings "软件版本" must render
      // currentVersion even when /api/desktop/v1/app-update hangs (e.g. Spring OOM).
      return controlPlaneCacheRelease(await deps.readControlPlaneState());
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
    runSilentInstall: async ({ msiPath, args, expectedVersion, fullMsi }) => scheduleDeferredSilentMsiexec({
      msiPath,
      args,
      expectedVersion,
      fullMsi,
      downloadDir: downloadDir()
    }),
    runSilentNsisInstall: async ({ setupPath, executablePath }) => scheduleDeferredSilentNsis({
      setupPath,
      executablePath,
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
      // Deferred MSI/NSIS scripts wait for this process to exit before installing.
      // Prefer a short graceful quit so will-quit can close SQLite; fall back to
      // app.exit because agent-host before-quit may preventDefault indefinitely.
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
    // Refresh from gateway with an 8s timeout inside getStatus. Settings / sidebar
    // polls must see newly promoted stable releases without requiring quit+reopen.
    // Disk cache remains the fallback when the network refresh times out.
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
