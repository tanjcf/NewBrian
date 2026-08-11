/**
 * Chinese copy for the in-app update progress modal.
 * Happy path: 正在下载 → 正在安装 → 安装完成即将重启 (no Installation Scope wizard).
 */

export type AppUpdateProgressPhase =
  | "preparing"
  | "downloading"
  | "verifying"
  | "installing"
  | "opening"
  | "done"
  | "error"
  | string;

export interface AppUpdateProgressCopyInput {
  phase: AppUpdateProgressPhase;
  detail?: string;
  installMode?: "silent" | "wizard" | "patch";
}

function isSilentSuccess(input: AppUpdateProgressCopyInput): boolean {
  if (input.installMode === "silent" || input.installMode === "patch") return true;
  if (input.installMode === "wizard") return false;
  const detail = String(input.detail || "");
  return /静默安装|即将重启|安装完成即将重启|补丁已应用/.test(detail);
}

/** Dialog title for the current update phase. */
export function resolveAppUpdateProgressTitle(input: AppUpdateProgressCopyInput): string {
  if (input.phase === "error") return "更新失败";
  if (input.phase === "done") {
    return isSilentSuccess(input) ? "安装完成即将重启" : "更新包已就绪";
  }
  if (input.phase === "downloading") return "正在下载";
  if (input.phase === "verifying") return "正在校验";
  if (input.phase === "installing") {
    return input.installMode === "patch" ? "正在应用补丁" : "正在安装";
  }
  if (input.phase === "opening") return "正在打开安装程序";
  if (input.phase === "preparing") return "正在准备";
  return "正在更新";
}

/** Short status label beside the progress bar. */
export function resolveAppUpdateProgressLabel(input: AppUpdateProgressCopyInput): string {
  if (input.phase === "preparing") return "正在准备…";
  if (input.phase === "downloading") return "正在下载…";
  if (input.phase === "verifying") return "正在校验…";
  if (input.phase === "installing") {
    return input.installMode === "patch" ? "正在应用补丁…" : "正在安装…";
  }
  if (input.phase === "opening") return "正在打开安装程序…";
  if (input.phase === "done") {
    return isSilentSuccess(input) ? "安装完成即将重启…" : "已完成";
  }
  return "处理中…";
}

/** Whether the update-available auto-prompt should show (session dismiss + idle). */
export function shouldShowAppUpdateAutoPrompt(input: {
  available: boolean;
  latestVersion?: string;
  busy: boolean;
  dismissedVersion?: string | null;
  progressVisible: boolean;
}): boolean {
  if (!input.available || input.busy || input.progressVisible) return false;
  const version = String(input.latestVersion || "").trim();
  if (!version) return false;
  return input.dismissedVersion !== version;
}
