import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type {
  DesktopAppUpdateProgress,
  DesktopAppUpdateStartResult,
  DesktopAppUpdateStatus,
  DesktopAppUpdateVerifyResult
} from "@codex-forge/protocol";
import {
  downloadResumableToFile,
  sha256FileStreaming
  // @ts-ignore Node strip-types tests load the TypeScript download helper directly.
} from "./desktop-app-update-download.ts";
import {
  buildDeferredProcessExitWaitPowerShell,
  normalizeDesktopUpdateVersionLabel,
  resolveDesktopUpdatePackageKind,
  safeDesktopUpdateFileName
  // @ts-ignore Node strip-types tests load the TypeScript patch helper directly.
} from "./desktop-app-update-patch.ts";

/** Resolve whether the running binary is a per-user or per-machine install. */
export type DesktopMsiInstallScope = "per-user" | "per-machine";

/** Detect install scope from the current executable path. */
export function resolveDesktopMsiInstallScope(executablePath: string): DesktopMsiInstallScope {
  const normalized = String(executablePath || "")
    .replace(/\//g, "\\")
    .toLowerCase();
  if (
    normalized.includes("\\program files\\")
    || normalized.includes("\\program files (x86)\\")
  ) {
    return "per-machine";
  }
  return "per-user";
}

/**
 * Build silent msiexec upgrade args matching the existing install scope.
 * Packaged installs default to LocalAppData/.newbrain (per-user).
 * Dual-purpose MSIs (WixUI Install Scope) need MSIINSTALLPERUSER=1 + ALLUSERS=
 * so /qn never surfaces the Installation Scope wizard.
 */
export function buildSilentDesktopMsiUpgradeArgs(
  msiPath: string,
  scope: DesktopMsiInstallScope = "per-user",
  options?: { applicationFolder?: string }
): string[] {
  const args = ["/i", msiPath, "/qn", "/norestart", "REBOOT=ReallySuppress"];
  if (scope === "per-machine") {
    args.push("ALLUSERS=1");
  } else {
    args.push("MSIINSTALLPERUSER=1");
  }
  const applicationFolder = String(options?.applicationFolder || "")
    .trim()
    .replace(/[\\/]+$/, "");
  if (applicationFolder) {
    // No trailing slash — msiexec/cmd quoting breaks on `...\path\"`.
    // Must appear BEFORE a bare ALLUSERS= token: msiexec treats the next
    // Property=Value after empty ALLUSERS= as the ALLUSERS value (seen as
    // ALLUSERS=APPLICATIONFOLDER=... in MSI logs, ROOT=. in the ulit CA).
    args.push(`APPLICATIONFOLDER=${applicationFolder}`);
  }
  if (scope === "per-user") {
    // Empty ALLUSERS forces per-user for dual-purpose packages under /qn.
    // Keep this LAST so it cannot steal APPLICATIONFOLDER.
    args.push("ALLUSERS=");
  }
  return args;
}

/** Quote a single msiexec / cmd argument for a deferred .cmd script. */
export function quoteCmdArgument(value: string): string {
  const text = String(value ?? "");
  if (!/[ \t&<>|^"%]/.test(text) && text !== "") {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Build a deferred silent-upgrade .cmd that waits for NewBrain.exe to exit,
 * then runs msiexec /qn. On msiexec failure it opens the MSI as a last resort.
 * Quitting the app before msiexec avoids locked-file races with StopRunningNewbrain.
 * Never uses `tasklist | find /I` (blank console titled find /I).
 */
export function buildDeferredSilentMsiexecScript(input: {
  msiPath: string;
  args: string[];
  processImageName?: string;
  maxWaitSeconds?: number;
}): string {
  const msiexecLine = ["msiexec.exe", ...input.args].map(quoteCmdArgument).join(" ");
  const openLine = `start "" ${quoteCmdArgument(input.msiPath)}`;
  const waitLine = buildDeferredProcessExitWaitPowerShell({
    processImageName: input.processImageName,
    maxWaitSeconds: input.maxWaitSeconds
  });
  return [
    "@echo off",
    "setlocal EnableExtensions",
    "title NewBrain update",
    "echo NewBrain update: waiting for app exit...",
    waitLine,
    "title NewBrain update: installing",
    msiexecLine,
    `if errorlevel 1 (`,
    `  echo msiexec failed; opening installer as fallback.`,
    `  ${openLine}`,
    `)`,
    "exit /B 0",
    ""
  ].join("\r\n");
}

/** Treat success and reboot-required as successful silent upgrades. */
export function isSilentDesktopMsiSuccess(exitCode: number | null | undefined): boolean {
  return exitCode === 0 || exitCode === 3010;
}

/** Map msiexec failures to a clear Chinese message. */
export function describeSilentDesktopMsiFailure(input: {
  exitCode: number | null | undefined;
  scope: DesktopMsiInstallScope;
  spawnError?: string;
}): string {
  const spawnError = String(input.spawnError || "").trim();
  if (spawnError) {
    return `无法启动静默安装：${spawnError}`;
  }
  const code = input.exitCode;
  if (code === 1625 || code === 1603 || code === 1925) {
    if (input.scope === "per-machine") {
      return "当前为所有用户安装，静默升级需要管理员权限。将打开安装包作为后备；请选择与现有安装相同的范围（所有用户）。";
    }
    return "静默安装被系统策略或权限阻止。将打开安装包作为后备；请选择“仅为当前用户”，以匹配现有安装。";
  }
  if (code === 1618) {
    return "另一安装程序正在运行，无法静默升级。请稍后重试，或手动打开已下载的安装包。";
  }
  if (typeof code === "number") {
    return `静默安装失败（msiexec 退出码 ${code}）。将打开安装包作为后备。`;
  }
  return "静默安装失败。将打开安装包作为后备。";
}

function versionParts(value: string) {
  // Normalize `1.2.9.ulit` → `1.2.9` before numeric compare.
  const normalized = normalizeDesktopUpdateVersionLabel(value).split("-", 1)[0];
  const parts = normalized.split(".").map((part) => Number.parseInt(part, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function compareVersions(left: string, right: string) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

export interface ResolvedDesktopAppRelease {
  latestVersion: string;
  downloadUrl: string;
  sha256: string;
  notes: string;
  mandatory: boolean;
  releaseId: string;
  channel: string;
  /** full | patch | ulit — server may omit; inferred from URL when absent. */
  packageKind: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Normalize app-update API / bootstrap.app_release payloads into a typed release offer. */
export function parseDesktopAppRelease(payload: unknown): ResolvedDesktopAppRelease | null {
  if (!isRecord(payload)) return null;
  if (payload.available === false) return null;
  const latestVersion = String(payload.latest_version ?? "").trim();
  const downloadUrl = String(payload.download_url ?? "").trim();
  if (!latestVersion || !downloadUrl) return null;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(downloadUrl);
  } catch {
    return null;
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") return null;
  return {
    latestVersion,
    downloadUrl,
    sha256: String(payload.sha256 ?? "").trim().toLowerCase(),
    notes: String(payload.notes ?? "").trim(),
    mandatory: payload.mandatory === true || payload.mandatory === "true",
    releaseId: String(payload.release_id ?? "").trim(),
    channel: String(payload.channel ?? "").trim(),
    packageKind: String(payload.package_kind ?? payload.packageKind ?? "").trim().toLowerCase()
  };
}

/** Decide whether the local client should offer a click-to-upgrade action. */
export function resolveDesktopAppUpdateStatus(input: {
  currentVersion: string;
  release: unknown;
}): DesktopAppUpdateStatus {
  const currentVersion = String(input.currentVersion ?? "").trim() || "0.0.0";
  const release = parseDesktopAppRelease(input.release);
  if (!release) {
    return {
      currentVersion,
      available: false,
      detail: "当前已是可用版本，或服务端尚未发布更新包。"
    };
  }
  if (compareVersions(currentVersion, release.latestVersion) >= 0) {
    return {
      currentVersion,
      available: false,
      latestVersion: release.latestVersion,
      releaseId: release.releaseId || undefined,
      channel: release.channel || undefined,
      notes: release.notes || undefined,
      mandatory: release.mandatory,
      downloadUrl: release.downloadUrl,
      detail: `当前版本 ${currentVersion} 已是最新。`
    };
  }
  return {
    currentVersion,
    available: true,
    latestVersion: release.latestVersion,
    releaseId: release.releaseId || undefined,
    channel: release.channel || undefined,
    notes: release.notes || undefined,
    mandatory: release.mandatory,
    downloadUrl: release.downloadUrl,
    detail: `发现新版本 ${release.latestVersion}。更新仅替换程序文件，不会删除聊天记录、项目与本地历史。`
  };
}

function safeReleaseFileName(version: string, release?: ResolvedDesktopAppRelease | null) {
  return safeDesktopUpdateFileName({
    version,
    packageKind: release?.packageKind,
    downloadUrl: release?.downloadUrl
  });
}

function resolveReleasePackageKind(
  release: ResolvedDesktopAppRelease,
  localPath?: string
): ReturnType<typeof resolveDesktopUpdatePackageKind> {
  return resolveDesktopUpdatePackageKind({
    packageKind: release.packageKind,
    downloadUrl: release.downloadUrl,
    localPath,
    version: release.latestVersion
  });
}

export function controlPlaneCacheRelease(state: unknown): unknown {
  if (!isRecord(state) || !isRecord(state.bootstrap)) return null;
  return state.bootstrap.app_release ?? null;
}

export interface DesktopAppUpdateSilentInstallResult {
  exitCode: number | null;
  error?: string;
}

export interface DesktopAppUpdateServiceDependencies {
  getCurrentVersion: () => string;
  readCachedRelease: () => Promise<unknown>;
  refreshRelease?: () => Promise<unknown>;
  downloadDir: () => string;
  fetchImpl?: typeof fetch;
  /** Preferred path: silent msiexec upgrade matching current install scope. */
  runSilentInstall: (input: {
    expectedVersion?: string;
    fullMsi?: boolean;
    msiPath: string;
    args: string[];
    scope: DesktopMsiInstallScope;
  }) => Promise<DesktopAppUpdateSilentInstallResult>;
  /** Apply a downloaded ulit.zip patch after the app exits. */
  runUlitZipApply?: (input: {
    zipPath: string;
    installRoot: string;
  }) => Promise<DesktopAppUpdateSilentInstallResult>;
  /** Fallback only when silent install fails: open the MSI wizard. */
  openInstallerFallback: (path: string) => Promise<string>;
  resolveInstallScope?: () => DesktopMsiInstallScope;
  getExecutablePath?: () => string;
  onProgress?: (progress: DesktopAppUpdateProgress) => void;
  afterSilentSuccess?: () => void;
  verifyUpdate?: (input: {
    releaseId: string;
    ok: boolean;
    appVersion: string;
  }) => Promise<Record<string, unknown>>;
}

function emitProgress(
  onProgress: DesktopAppUpdateServiceDependencies["onProgress"],
  progress: Omit<DesktopAppUpdateProgress, "preservesUserData">
) {
  onProgress?.({ ...progress, preservesUserData: true });
}

function dirnameOfExecutable(executablePath: string): string {
  const normalized = String(executablePath || "").replace(/\//g, "\\").replace(/\\+$/, "");
  const index = normalized.lastIndexOf("\\");
  if (index <= 0) return "";
  return normalized.slice(0, index + 1);
}

/** Downloads the published MSI and runs a silent upgrade, with manual installer fallback. */
export class DesktopAppUpdateService {
  private readonly dependencies: DesktopAppUpdateServiceDependencies;
  private activeDownload: Promise<DesktopAppUpdateStartResult> | null = null;
  private lastStatus: DesktopAppUpdateStatus | null = null;

  constructor(dependencies: DesktopAppUpdateServiceDependencies) {
    this.dependencies = dependencies;
  }

  async getStatus(options?: { refresh?: boolean }): Promise<DesktopAppUpdateStatus> {
    let release = await this.dependencies.readCachedRelease();
    if (options?.refresh !== false && this.dependencies.refreshRelease) {
      try {
        release = await this.dependencies.refreshRelease();
      } catch {
        // Keep cached release so offline users can still install a previously advertised package.
      }
    }
    const status = resolveDesktopAppUpdateStatus({
      currentVersion: this.dependencies.getCurrentVersion(),
      release
    });
    this.lastStatus = status;
    return status;
  }

  async startUpdate(): Promise<DesktopAppUpdateStartResult> {
    if (this.activeDownload) return this.activeDownload;
    this.activeDownload = this.runUpdate().finally(() => {
      this.activeDownload = null;
    });
    return this.activeDownload;
  }

  async verifyUpdate(input?: { releaseId?: string; ok?: boolean }): Promise<DesktopAppUpdateVerifyResult> {
    if (!this.dependencies.verifyUpdate) {
      return { ok: false, detail: "当前环境未接入更新验证回传。" };
    }
    const releaseId = String(input?.releaseId || this.lastStatus?.releaseId || "").trim();
    if (!releaseId) {
      return { ok: false, detail: "缺少 release_id，无法回传验证结果。" };
    }
    const appVersion = this.dependencies.getCurrentVersion();
    const payload = await this.dependencies.verifyUpdate({
      releaseId,
      ok: input?.ok !== false,
      appVersion
    });
    return {
      ok: payload.ok !== false,
      releaseId: String(payload.release_id ?? releaseId),
      verificationCount: Number(payload.verification_count ?? 0) || undefined,
      threshold: Number(payload.threshold ?? 0) || undefined,
      promotedToStable: payload.promoted_to_stable === true,
      detail: payload.promoted_to_stable === true
        ? "验证已提交，服务端已放行全员更新。"
        : "验证已提交，感谢反馈。"
    };
  }

  private resolveScope(): DesktopMsiInstallScope {
    if (this.dependencies.resolveInstallScope) {
      return this.dependencies.resolveInstallScope();
    }
    const exePath = this.dependencies.getExecutablePath?.() || "";
    return resolveDesktopMsiInstallScope(exePath);
  }

  private async runUpdate(): Promise<DesktopAppUpdateStartResult> {
    try {
      return await this.runUpdateInner();
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const detail = /下载|更新|校验|安装/.test(raw) ? raw : `更新失败：${raw}`;
      try {
        emitProgress(this.dependencies.onProgress, {
          phase: "error",
          percent: 0,
          detail
        });
      } catch {
        // ignore progress failures
      }
      return { ok: false, detail };
    }
  }

  private async runUpdateInner(): Promise<DesktopAppUpdateStartResult> {
    const report = (
      phase: DesktopAppUpdateProgress["phase"],
      percent: number,
      detail: string,
      latestVersion?: string
    ) => {
      try {
        emitProgress(this.dependencies.onProgress, { phase, percent, detail, latestVersion });
      } catch {
        // Progress callbacks must not abort download/install.
      }
    };

    let releasePayload = await this.dependencies.readCachedRelease();
    if (this.dependencies.refreshRelease) {
      try {
        releasePayload = await this.dependencies.refreshRelease();
      } catch {
        // fall through to cached payload
      }
    }
    const status = resolveDesktopAppUpdateStatus({
      currentVersion: this.dependencies.getCurrentVersion(),
      release: releasePayload
    });
    this.lastStatus = status;
    const fresh = parseDesktopAppRelease(releasePayload);
    if (!status.available || !fresh) {
      report("error", 0, status.detail || "没有可安装的更新。");
      return { ok: false, detail: status.detail || "没有可安装的更新。" };
    }
    if (!fresh.sha256) {
      const detail = "更新包缺少 SHA-256 校验值，已阻止下载和安装。";
      report("error", 0, detail);
      return { ok: false, detail };
    }

    report(
      "preparing",
      2,
      "正在准备更新。聊天记录、项目与本地历史保存在用户数据目录，不会随安装包删除。",
      fresh.latestVersion
    );

    const targetDir = this.dependencies.downloadDir();
    await mkdir(targetDir, { recursive: true });
    const targetPath = join(targetDir, safeReleaseFileName(fresh.latestVersion, fresh));
    const tempPath = `${targetPath}.partial`;
    // Keep `.partial` across retries/crashes so Range resume can continue.

    // Leave「正在准备」immediately so a slow/hung HTTP connect is not mistaken for a freeze.
    report("downloading", 5, "正在连接更新服务器并开始下载…", fresh.latestVersion);

    let lastReportedPercent = 5;
    const download = await downloadResumableToFile({
      url: fresh.downloadUrl,
      partialPath: tempPath,
      fetchImpl: this.dependencies.fetchImpl,
      onProgress: ({ receivedBytes, totalBytes, resumedFrom }) => {
        const percent = totalBytes > 0
          ? Math.min(90, Math.max(5, Math.round((receivedBytes / totalBytes) * 85) + 5))
          : Math.min(90, 5 + Math.floor(receivedBytes / (1024 * 1024)) * 3);
        if (percent === lastReportedPercent) return;
        lastReportedPercent = percent;
        const resumeHint = resumedFrom > 0 ? "（断点续传）" : "";
        report(
          "downloading",
          percent,
          totalBytes > 0
            ? `正在下载更新包${resumeHint} ${Math.round(receivedBytes / (1024 * 1024))} / ${Math.round(totalBytes / (1024 * 1024))} MB`
            : `正在下载更新包${resumeHint} ${Math.round(receivedBytes / (1024 * 1024))} MB`,
          fresh.latestVersion
        );
      }
    });
    if (download.resumedFrom > 0) {
      report(
        "downloading",
        lastReportedPercent > 0 ? lastReportedPercent : 5,
        `已从 ${Math.round(download.resumedFrom / (1024 * 1024))} MB 断点续传完成下载。`,
        fresh.latestVersion
      );
    }

    report("verifying", 92, "正在校验更新包完整性…", fresh.latestVersion);
    if (fresh.sha256) {
      const actual = await sha256FileStreaming(tempPath);
      if (actual !== fresh.sha256) {
        await rm(tempPath, { force: true }).catch(() => undefined);
        const detail = "更新包校验失败，已取消安装。可重新点击更新重新下载。";
        report("error", 0, detail, fresh.latestVersion);
        return { ok: false, detail };
      }
    }
    await rename(tempPath, targetPath);

    const packageKind = resolveReleasePackageKind(fresh, targetPath);
    const scope = this.resolveScope();
    const applicationFolder = dirnameOfExecutable(this.dependencies.getExecutablePath?.() || "");
    const reportWithMode = (
      phase: DesktopAppUpdateProgress["phase"],
      percent: number,
      detail: string,
      installMode?: DesktopAppUpdateProgress["installMode"]
    ) => {
      try {
        emitProgress(this.dependencies.onProgress, {
          phase,
          percent,
          detail,
          latestVersion: fresh.latestVersion,
          installMode
        });
      } catch {
        // ignore
      }
    };

    if (packageKind === "ulit-zip") {
      if (!this.dependencies.runUlitZipApply) {
        const detail =
          "当前客户端尚未接入 ulit.zip 补丁应用；请改用 ulit.msi 补丁安装器，或手动运行包内 apply.cmd。";
        reportWithMode("error", 0, detail, "patch");
        return { ok: false, path: targetPath, detail };
      }
      const installRoot = applicationFolder.replace(/[\\/]+$/, "");
      reportWithMode(
        "installing",
        96,
        "正在应用升级补丁（仅替换 app.asar）。安装完成后将自动重启；聊天与项目数据会保留。",
        "patch"
      );
      const patchResult = await this.dependencies.runUlitZipApply({
        zipPath: targetPath,
        installRoot
      });
      if (isSilentDesktopMsiSuccess(patchResult.exitCode) && !patchResult.error) {
        const detail = `补丁已就绪，即将退出并应用更新（${fresh.latestVersion}）。`;
        reportWithMode("done", 100, detail, "patch");
        try {
          this.dependencies.afterSilentSuccess?.();
        } catch {
          // ignore
        }
        return { ok: true, path: targetPath, detail };
      }
      const detail = `补丁应用失败：${patchResult.error || `exit ${patchResult.exitCode}`}。可手动解压后运行 apply.cmd。`;
      reportWithMode("error", 0, detail, "patch");
      return { ok: false, path: targetPath, detail };
    }

    const silentArgs = buildSilentDesktopMsiUpgradeArgs(targetPath, scope, {
      applicationFolder: applicationFolder || undefined
    });

    reportWithMode(
      "installing",
      96,
      packageKind === "ulit-msi"
        ? "正在安装升级补丁。安装完成后将自动重启；聊天、项目与历史数据会保留。"
        : "正在安装更新。安装完成后将自动重启；聊天、项目与历史数据会保留。",
      "silent"
    );

    const silentResult = await this.dependencies.runSilentInstall({
      expectedVersion: normalizeDesktopUpdateVersionLabel(fresh.latestVersion),
      fullMsi: packageKind === "full-msi",
      msiPath: targetPath,
      args: silentArgs,
      scope
    });
    if (isSilentDesktopMsiSuccess(silentResult.exitCode) && !silentResult.error) {
      const detail = `更新包已就绪，即将退出并安装（${fresh.latestVersion}）。安装前会备份用户数据。`;
      reportWithMode("done", 100, detail, "silent");
      try {
        this.dependencies.afterSilentSuccess?.();
      } catch {
        // Quit/relaunch is best-effort; MSI LaunchNewbrainAfterInstall may restart the app.
      }
      return {
        ok: true,
        path: targetPath,
        detail
      };
    }

    const silentFailure = describeSilentDesktopMsiFailure({
      exitCode: silentResult.exitCode,
      scope,
      spawnError: silentResult.error
    });
    reportWithMode(
      "opening",
      97,
      `${silentFailure}正在打开安装程序作为后备…`,
      "wizard"
    );
    const openError = await this.dependencies.openInstallerFallback(targetPath);
    if (openError) {
      const detail = `${silentFailure}更新包已下载，但打开安装程序失败：${openError}`;
      reportWithMode("error", 0, detail, "wizard");
      return {
        ok: false,
        path: targetPath,
        detail
      };
    }

    const detail = `${silentFailure}已打开 ${fresh.latestVersion} 安装程序。请选择与现有安装相同的范围完成升级；不会删除聊天记录、项目与本地历史。`;
    reportWithMode("done", 100, detail, "wizard");
    return {
      ok: true,
      path: targetPath,
      detail
    };
  }
}
