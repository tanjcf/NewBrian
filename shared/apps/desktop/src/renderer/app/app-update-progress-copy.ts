/**
 * Chinese copy for the Cockpit-style in-app update dialog.
 */

export type AppUpdateProgressPhase =
  | "preparing"
  | "downloading"
  | "verifying"
  | "ready"
  | "installing"
  | "opening"
  | "done"
  | "success"
  | "error"
  | string;

export interface AppUpdateProgressCopyInput {
  phase: AppUpdateProgressPhase;
  detail?: string;
  installMode?: "silent" | "wizard" | "patch" | "nsis";
  latestVersion?: string;
  currentVersion?: string;
}

function isSilentSuccess(input: AppUpdateProgressCopyInput): boolean {
  if (input.installMode === "silent" || input.installMode === "patch" || input.installMode === "nsis") {
    return true;
  }
  if (input.installMode === "wizard") return false;
  const detail = String(input.detail || "");
  return /静默安装|即将重启|安装完成即将重启|补丁已应用|重启后生效/.test(detail);
}

/** Dialog title for the current update phase. */
export function resolveAppUpdateProgressTitle(input: AppUpdateProgressCopyInput): string {
  if (input.phase === "error") return "更新失败";
  if (input.phase === "success") return "更新成功!";
  if (input.phase === "ready") return "发现新版本";
  if (input.phase === "done") {
    return isSilentSuccess(input) ? "即将退出并更新" : "更新包已就绪";
  }
  if (input.phase === "downloading" || input.phase === "preparing" || input.phase === "verifying") {
    return "发现新版本";
  }
  if (input.phase === "installing") {
    return input.installMode === "patch" ? "正在应用补丁" : "正在安装";
  }
  if (input.phase === "opening") return "正在打开安装程序";
  return "发现新版本";
}

/** Short status label beside the progress bar. */
export function resolveAppUpdateProgressLabel(input: AppUpdateProgressCopyInput): string {
  if (input.phase === "preparing") return "正在准备…";
  if (input.phase === "downloading") {
    const detail = String(input.detail || "");
    const match = detail.match(/(\d+)\s*%/);
    if (match) return `下载中... ${match[1]}%`;
    return "下载中...";
  }
  if (input.phase === "verifying") return "正在校验…";
  if (input.phase === "ready") {
    const version = String(input.latestVersion || "").trim();
    return version ? `v${version} 已就绪，重启后生效。` : "已就绪，重启后生效。";
  }
  if (input.phase === "installing") {
    return input.installMode === "patch" ? "正在应用补丁…" : "正在安装…";
  }
  if (input.phase === "opening") return "正在打开安装程序…";
  if (input.phase === "done") {
    return isSilentSuccess(input) ? "准备退出应用…" : "更新包已就绪";
  }
  if (input.phase === "success") return "更新已完成";
  return "处理中…";
}

/** Whether the update-available auto-prompt should show (session dismiss + idle). */
export function shouldShowAppUpdateAutoPrompt(input: {
  available: boolean;
  latestVersion?: string;
  busy: boolean;
  dismissedVersion?: string | null;
  skippedVersion?: string | null;
  progressVisible: boolean;
  staged?: boolean;
}): boolean {
  if (!input.available || input.busy || input.progressVisible) return false;
  const version = String(input.latestVersion || "").trim();
  if (!version) return false;
  if (input.skippedVersion && input.skippedVersion === version) return false;
  if (input.dismissedVersion === version) return false;
  return true;
}

export function formatAppUpdateVersionLine(input: {
  currentVersion?: string;
  latestVersion?: string;
}): string {
  const current = String(input.currentVersion || "").trim();
  const latest = String(input.latestVersion || "").trim();
  if (current && latest) return `当前版本 v${current}，新版本已可用。`;
  if (latest) return `新版本 v${latest} 已可用。`;
  return "新版本已可用。";
}

export function formatAppUpdateSuccessLine(input: {
  fromVersion?: string;
  toVersion?: string;
}): string {
  const from = String(input.fromVersion || "").trim();
  const to = String(input.toVersion || "").trim();
  if (from && to) return `已从 v${from} 更新到 v${to}`;
  if (to) return `已更新到 v${to}`;
  return "更新已完成";
}
