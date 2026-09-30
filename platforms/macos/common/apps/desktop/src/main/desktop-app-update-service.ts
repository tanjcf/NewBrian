import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  DesktopAppUpdateAppliedInfo,
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
  resolveMacAppBundlePath,
  safeMacZipFileName
  // @ts-ignore Node strip-types tests load helpers directly.
} from "./desktop-app-update-apply.ts";

export interface ResolvedDesktopAppRelease {
  latestVersion: string;
  downloadUrl: string;
  sha256: string;
  notes: string;
  releaseId: string;
  channel: string;
  mandatory: boolean;
  packageKind: string;
}

export interface DesktopAppUpdateStagedState {
  latestVersion: string;
  fromVersion: string;
  path: string;
  notes: string;
  releaseId: string;
  packageKind: string;
  sha256: string;
  stagedAt: string;
}

export interface DesktopAppUpdateServiceDependencies {
  getCurrentVersion: () => string;
  getExecutablePath: () => string;
  readCachedRelease: () => Promise<unknown>;
  refreshRelease?: () => Promise<unknown>;
  downloadDir: () => string;
  runZipApply: (input: {
    zipPath: string;
    appBundlePath: string;
    expectedVersion: string;
  }) => Promise<{ exitCode: number | null; error?: string }>;
  afterSilentSuccess?: () => void;
  onProgress?: (progress: DesktopAppUpdateProgress) => void;
  verifyUpdate?: (input: {
    releaseId: string;
    ok: boolean;
    appVersion: string;
  }) => Promise<Record<string, unknown>>;
  readSkippedVersion?: () => Promise<string | null>;
  writeSkippedVersion?: (version: string | null) => Promise<void>;
  fetchImpl?: typeof fetch;
}

const updateApplySessionId = `${Date.now()}-${process.pid}`;

function stagedStatePath(downloadDir: string) {
  return join(downloadDir, "staged-update.json");
}
function pendingApplyPath(downloadDir: string) {
  return join(downloadDir, "pending-apply.json");
}
function appliedUpdatePath(downloadDir: string) {
  return join(downloadDir, "applied-update.json");
}
function lastApplyResultPath(downloadDir: string) {
  return join(downloadDir, "last-mac-update.json");
}

export function normalizeDesktopUpdateVersionLabel(version: string): string {
  return String(version || "")
    .trim()
    .replace(/^v/i, "")
    .replace(/[^0-9A-Za-z.+_-]+/g, "");
}

export function parseDesktopAppRelease(payload: unknown): ResolvedDesktopAppRelease | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (record.available === false) return null;
  const latestVersion = String(record.latest_version ?? record.latestVersion ?? "").trim();
  const downloadUrl = String(record.download_url ?? record.downloadUrl ?? "").trim();
  if (!latestVersion || !downloadUrl) return null;
  return {
    latestVersion,
    downloadUrl,
    sha256: String(record.sha256 ?? "").trim().toLowerCase(),
    notes: String(record.notes ?? "").trim(),
    releaseId: String(record.release_id ?? record.releaseId ?? "").trim(),
    channel: String(record.channel ?? "").trim(),
    mandatory: record.mandatory === true,
    packageKind: String(record.package_kind ?? record.packageKind ?? "zip").trim().toLowerCase() || "zip"
  };
}

/** Prefer control-plane embedded app_update / appUpdate fields. */
export function controlPlaneCacheRelease(state: unknown): unknown {
  if (!state || typeof state !== "object") return null;
  const record = state as Record<string, unknown>;
  return record.app_update ?? record.appUpdate ?? record.release ?? state;
}

export function resolveDesktopAppUpdateStatus(input: {
  currentVersion: string;
  release: unknown;
}): DesktopAppUpdateStatus {
  const currentVersion = String(input.currentVersion || "").trim() || "0.0.0";
  const release = parseDesktopAppRelease(input.release);
  if (!release) {
    return {
      currentVersion,
      available: false,
      detail: "当前已是最新版本。"
    };
  }
  const current = normalizeDesktopUpdateVersionLabel(currentVersion);
  const latest = normalizeDesktopUpdateVersionLabel(release.latestVersion);
  if (current === latest) {
    return {
      currentVersion,
      available: false,
      latestVersion: release.latestVersion,
      releaseId: release.releaseId || undefined,
      channel: release.channel || undefined,
      notes: release.notes || undefined,
      detail: "当前已是最新版本。"
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
    detail: `发现新版本 ${release.latestVersion}。`
  };
}

function emitProgress(
  onProgress: ((progress: DesktopAppUpdateProgress) => void) | undefined,
  progress: Omit<DesktopAppUpdateProgress, "preservesUserData"> & { preservesUserData?: true }
) {
  onProgress?.({
    ...progress,
    preservesUserData: true
  });
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isZipPackage(kind: string, path: string, url = ""): boolean {
  const text = `${kind} ${path} ${url}`.toLowerCase();
  return text.includes("zip") || text.includes("darwin") || text.includes("mac");
}

/** Downloads the published Mac zip, stages it, and applies on explicit restart. */
export class DesktopAppUpdateService {
  private readonly dependencies: DesktopAppUpdateServiceDependencies;
  private activeDownload: Promise<DesktopAppUpdateStartResult> | null = null;
  private lastStatus: DesktopAppUpdateStatus | null = null;
  private staged: DesktopAppUpdateStagedState | null = null;

  constructor(dependencies: DesktopAppUpdateServiceDependencies) {
    this.dependencies = dependencies;
  }

  async getStatus(options?: { refresh?: boolean }): Promise<DesktopAppUpdateStatus> {
    let release = await this.dependencies.readCachedRelease();
    if (options?.refresh !== false && this.dependencies.refreshRelease) {
      try {
        release = await Promise.race([
          this.dependencies.refreshRelease(),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("app-update refresh timed out")), 8_000);
          })
        ]);
      } catch {
        // keep cache
      }
    }
    const status = resolveDesktopAppUpdateStatus({
      currentVersion: this.dependencies.getCurrentVersion(),
      release
    });
    const skippedVersion = (await this.dependencies.readSkippedVersion?.()) || null;
    const failedApplyDetail = await this.clearFailedPendingApply(status.currentVersion);
    if (failedApplyDetail) {
      status.staged = false;
      status.stagedPath = undefined;
      status.detail = failedApplyDetail;
    }
    const staged = await this.loadStagedState();
    if (!failedApplyDetail && staged && status.available && staged.latestVersion === status.latestVersion) {
      status.staged = true;
      status.stagedPath = staged.path;
      status.detail = `v${staged.latestVersion} 已就绪，重启后生效。`;
    }
    if (skippedVersion) status.skippedVersion = skippedVersion;
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

  async applyStagedUpdate(): Promise<DesktopAppUpdateStartResult> {
    let staged = await this.loadStagedState();
    if (!staged) {
      const redownload = await this.startUpdate();
      staged = await this.loadStagedState();
      if (!staged) {
        const detail =
          redownload.detail || "没有已下载的更新包。请先点击「立即更新」完成下载。";
        emitProgress(this.dependencies.onProgress, { phase: "error", percent: 0, detail });
        return { ok: false, detail };
      }
    }
    return this.applyPackage(staged);
  }

  async skipVersion(version?: string): Promise<{ ok: boolean; detail: string }> {
    const target = String(version || this.lastStatus?.latestVersion || "").trim();
    if (!target) return { ok: false, detail: "没有可跳过的版本。" };
    await this.dependencies.writeSkippedVersion?.(target);
    return { ok: true, detail: `已跳过版本 ${target}。` };
  }

  async getAppliedUpdate(): Promise<DesktopAppUpdateAppliedInfo | null> {
    const current = this.dependencies.getCurrentVersion();
    const pending = await readJsonFile<DesktopAppUpdateStagedState>(
      pendingApplyPath(this.dependencies.downloadDir())
    );
    const applied = await readJsonFile<DesktopAppUpdateAppliedInfo>(
      appliedUpdatePath(this.dependencies.downloadDir())
    );
    if (applied && applied.toVersion === current) return applied;
    if (
      pending
      && normalizeDesktopUpdateVersionLabel(pending.latestVersion)
        === normalizeDesktopUpdateVersionLabel(current)
    ) {
      const info: DesktopAppUpdateAppliedInfo = {
        fromVersion: pending.fromVersion || "",
        toVersion: pending.latestVersion,
        notes: pending.notes || "",
        appliedAt: new Date().toISOString()
      };
      await writeFile(appliedUpdatePath(this.dependencies.downloadDir()), JSON.stringify(info, null, 2), "utf8");
      await rm(pendingApplyPath(this.dependencies.downloadDir()), { force: true }).catch(() => undefined);
      await rm(stagedStatePath(this.dependencies.downloadDir()), { force: true }).catch(() => undefined);
      this.staged = null;
      return info;
    }
    return null;
  }

  async dismissAppliedUpdate(): Promise<void> {
    await rm(appliedUpdatePath(this.dependencies.downloadDir()), { force: true }).catch(() => undefined);
  }

  async verifyUpdate(input?: { releaseId?: string; ok?: boolean }): Promise<DesktopAppUpdateVerifyResult> {
    if (!this.dependencies.verifyUpdate) {
      return { ok: false, detail: "当前环境未接入更新验证回传。" };
    }
    const releaseId = String(input?.releaseId || this.lastStatus?.releaseId || "").trim();
    if (!releaseId) {
      return { ok: false, detail: "缺少 release_id，无法回传验证结果。" };
    }
    const payload = await this.dependencies.verifyUpdate({
      releaseId,
      ok: input?.ok !== false,
      appVersion: this.dependencies.getCurrentVersion()
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

  private async clearFailedPendingApply(currentVersion: string): Promise<string | null> {
    const pending = await readJsonFile<DesktopAppUpdateStagedState & { applySessionId?: string }>(
      pendingApplyPath(this.dependencies.downloadDir())
    );
    if (!pending?.latestVersion) return null;
    if (pending.applySessionId && pending.applySessionId === updateApplySessionId) return null;
    const current = normalizeDesktopUpdateVersionLabel(currentVersion);
    const target = normalizeDesktopUpdateVersionLabel(pending.latestVersion);
    const from = normalizeDesktopUpdateVersionLabel(pending.fromVersion || "");
    if (current === target) return null;
    if (from && current !== from) return null;
    const applyResult = await readJsonFile<{ status?: string; detail?: string }>(
      lastApplyResultPath(this.dependencies.downloadDir())
    );
    await rm(stagedStatePath(this.dependencies.downloadDir()), { force: true }).catch(() => undefined);
    await rm(pendingApplyPath(this.dependencies.downloadDir()), { force: true }).catch(() => undefined);
    this.staged = null;
    return applyResult?.status === "error"
      ? `更新未生效：${applyResult.detail || "安装失败"}。请重新点击「立即更新」。`
      : "上次更新未生效。请重新点击「立即更新」下载并安装。";
  }

  private async loadStagedState(): Promise<DesktopAppUpdateStagedState | null> {
    if (this.staged) {
      try {
        await readFile(this.staged.path);
        return this.staged;
      } catch {
        this.staged = null;
      }
    }
    const staged = await readJsonFile<DesktopAppUpdateStagedState>(
      stagedStatePath(this.dependencies.downloadDir())
    );
    if (!staged?.path || !staged.latestVersion) return null;
    try {
      await readFile(staged.path);
    } catch {
      await rm(stagedStatePath(this.dependencies.downloadDir()), { force: true }).catch(() => undefined);
      return null;
    }
    this.staged = staged;
    return staged;
  }

  private async writeStagedState(staged: DesktopAppUpdateStagedState): Promise<void> {
    this.staged = staged;
    await mkdir(this.dependencies.downloadDir(), { recursive: true });
    await writeFile(stagedStatePath(this.dependencies.downloadDir()), JSON.stringify(staged, null, 2), "utf8");
  }

  private async runUpdate(): Promise<DesktopAppUpdateStartResult> {
    const report = (
      phase: DesktopAppUpdateProgress["phase"],
      percent: number,
      detail: string,
      latestVersion?: string,
      extra?: Partial<DesktopAppUpdateProgress>
    ) => {
      emitProgress(this.dependencies.onProgress, {
        phase,
        percent,
        detail,
        latestVersion,
        currentVersion: this.dependencies.getCurrentVersion(),
        ...extra
      });
    };

    let releasePayload = await this.dependencies.readCachedRelease();
    if (this.dependencies.refreshRelease) {
      try {
        releasePayload = await this.dependencies.refreshRelease();
      } catch {
        // cached
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
    if (!isZipPackage(fresh.packageKind, "", fresh.downloadUrl)) {
      const detail = `当前 Mac 客户端仅支持 zip 更新包（收到 ${fresh.packageKind || "unknown"}）。`;
      report("error", 0, detail);
      return { ok: false, detail };
    }

    const existing = await this.loadStagedState();
    if (existing && existing.latestVersion === fresh.latestVersion && existing.sha256 === fresh.sha256) {
      const detail = `v${fresh.latestVersion} 已就绪，重启后生效。`;
      report("ready", 100, detail, fresh.latestVersion, { notes: fresh.notes, installMode: "silent" });
      return { ok: true, path: existing.path, detail, staged: true };
    }

    report(
      "preparing",
      2,
      "正在准备更新。聊天记录、项目与本地历史保存在用户数据目录，不会随安装包删除。",
      fresh.latestVersion,
      { notes: fresh.notes }
    );

    const targetDir = this.dependencies.downloadDir();
    await mkdir(targetDir, { recursive: true });
    const targetPath = join(targetDir, safeMacZipFileName(fresh.latestVersion, fresh.downloadUrl));
    const tempPath = `${targetPath}.partial`;

    report("downloading", 5, "正在连接更新服务器并开始下载…", fresh.latestVersion, { notes: fresh.notes });
    let lastReportedPercent = 5;
    await downloadResumableToFile({
      url: fresh.downloadUrl,
      partialPath: tempPath,
      fetchImpl: this.dependencies.fetchImpl,
      packagePreference: "zip",
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
          fresh.latestVersion,
          { notes: fresh.notes }
        );
      }
    });

    report("verifying", 92, "正在校验更新包完整性…", fresh.latestVersion, { notes: fresh.notes });
    const actual = await sha256FileStreaming(tempPath);
    if (actual !== fresh.sha256) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      const detail = "更新包校验失败，已取消安装。可重新点击更新重新下载。";
      report("error", 0, detail, fresh.latestVersion);
      return { ok: false, detail };
    }
    await rename(tempPath, targetPath);

    const staged: DesktopAppUpdateStagedState = {
      latestVersion: fresh.latestVersion,
      fromVersion: this.dependencies.getCurrentVersion(),
      path: targetPath,
      notes: fresh.notes,
      releaseId: fresh.releaseId,
      packageKind: fresh.packageKind || "zip",
      sha256: fresh.sha256,
      stagedAt: new Date().toISOString()
    };
    await this.writeStagedState(staged);

    const detail = `v${fresh.latestVersion} 已就绪，重启后生效。`;
    report("ready", 100, detail, fresh.latestVersion, { notes: fresh.notes, installMode: "silent" });
    return { ok: true, path: targetPath, detail, staged: true };
  }

  private async applyPackage(staged: DesktopAppUpdateStagedState): Promise<DesktopAppUpdateStartResult> {
    const appBundlePath = resolveMacAppBundlePath(this.dependencies.getExecutablePath());
    emitProgress(this.dependencies.onProgress, {
      phase: "installing",
      percent: 96,
      detail: "正在安装更新。完成后将自动重启；聊天与项目数据会保留。",
      latestVersion: staged.latestVersion,
      currentVersion: staged.fromVersion,
      notes: staged.notes,
      installMode: "silent"
    });

    await mkdir(this.dependencies.downloadDir(), { recursive: true });
    await writeFile(
      pendingApplyPath(this.dependencies.downloadDir()),
      JSON.stringify({ ...staged, applySessionId: updateApplySessionId }, null, 2),
      "utf8"
    );

    const result = await this.dependencies.runZipApply({
      zipPath: staged.path,
      appBundlePath,
      expectedVersion: staged.latestVersion
    });
    if (result.exitCode !== 0) {
      const detail = result.error || "无法启动更新安装程序。";
      emitProgress(this.dependencies.onProgress, {
        phase: "error",
        percent: 0,
        detail,
        latestVersion: staged.latestVersion,
        notes: staged.notes
      });
      return { ok: false, path: staged.path, detail };
    }

    emitProgress(this.dependencies.onProgress, {
      phase: "done",
      percent: 100,
      detail: "更新程序已启动，应用即将退出并完成安装。",
      latestVersion: staged.latestVersion,
      notes: staged.notes,
      installMode: "silent"
    });
    this.dependencies.afterSilentSuccess?.();
    return {
      ok: true,
      path: staged.path,
      detail: "更新程序已启动，应用即将退出并完成安装。"
    };
  }
}
