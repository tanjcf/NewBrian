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

/** Normalize release labels so `v1.4.42` and `1.4.42` compare equal. */
export function normalizeAppUpdateVersionLabel(version: string): string {
  return String(version || "")
    .trim()
    .replace(/^v/i, "")
    .replace(/\.ulit$/i, "")
    .replace(/[-_]?ulit$/i, "");
}

/** True when two update version labels refer to the same release. */
export function isSameAppUpdateVersion(
  left?: string | null,
  right?: string | null
): boolean {
  const a = normalizeAppUpdateVersionLabel(String(left || ""));
  const b = normalizeAppUpdateVersionLabel(String(right || ""));
  return Boolean(a && b && a === b);
}

function appUpdateVersionParts(value: string): [number, number, number] {
  const normalized = normalizeAppUpdateVersionLabel(value).split("-", 1)[0];
  const parts = normalized.split(".").map((part) => Number.parseInt(part, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/** Semver-ish compare for update labels (`1.4.43` vs `v1.4.34`). */
export function compareAppUpdateVersions(
  left?: string | null,
  right?: string | null
): number {
  const leftParts = appUpdateVersionParts(String(left || ""));
  const rightParts = appUpdateVersionParts(String(right || ""));
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

/** True when offered latest is strictly newer than the running build. */
export function isNewerAppUpdateVersion(
  latestVersion?: string | null,
  currentVersion?: string | null
): boolean {
  const latest = normalizeAppUpdateVersionLabel(String(latestVersion || ""));
  const current = normalizeAppUpdateVersionLabel(String(currentVersion || ""));
  if (!latest) return false;
  if (!current) return true;
  return compareAppUpdateVersions(latest, current) > 0;
}

/**
 * Whether the full discover/ready dialog should auto-open.
 * Honors persisted skip and same-session cancel/skip before status refresh lands.
 */
export function shouldAutoOpenAppUpdateDiscover(input: {
  available: boolean;
  latestVersion?: string | null;
  currentVersion?: string | null;
  skippedVersion?: string | null;
  suppressedVersion?: string | null;
  appliedVisible?: boolean;
}): boolean {
  if (!input.available || input.appliedVisible) return false;
  const version = String(input.latestVersion || "").trim();
  if (!version) return false;
  if (!isNewerAppUpdateVersion(version, input.currentVersion)) return false;
  if (isSameAppUpdateVersion(input.skippedVersion, version)) return false;
  if (isSameAppUpdateVersion(input.suppressedVersion, version)) return false;
  return true;
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
  if (isSameAppUpdateVersion(input.skippedVersion, version)) return false;
  if (isSameAppUpdateVersion(input.dismissedVersion, version)) return false;
  return true;
}

export function formatAppUpdateVersionLine(input: {
  currentVersion?: string;
  latestVersion?: string;
  phase?: AppUpdateProgressPhase;
  detail?: string;
}): string {
  const current = String(input.currentVersion || "").trim();
  const latest = String(input.latestVersion || "").trim();
  const detail = String(input.detail || "").trim();
  const alreadyLatest = input.phase === "error"
    && (/已是最新|没有可安装的更新|尚未发布更新包/.test(detail)
      || (Boolean(current) && Boolean(latest) && !isNewerAppUpdateVersion(latest, current)));
  if (alreadyLatest) {
    return current ? `当前版本 v${current} 已是最新。` : "当前已是最新版本。";
  }
  if (current && latest && isNewerAppUpdateVersion(latest, current)) {
    return `当前版本 v${current}，新版本已可用。`;
  }
  if (current && latest && !isNewerAppUpdateVersion(latest, current)) {
    return current ? `当前版本 v${current} 已是最新。` : "当前已是最新版本。";
  }
  if (latest && !current) return `新版本 v${latest} 已可用。`;
  if (current && !latest) return `当前版本 v${current}`;
  return "新版本已可用。";
}

/**
 * Hero version on the dialog: never advertise an older/stale target on error
 * when the running build is already current (regression: v1.4.34 over 1.4.43).
 */
export function resolveAppUpdateDialogHeroVersion(input: {
  phase?: AppUpdateProgressPhase;
  detail?: string;
  latestVersion?: string;
  currentVersion?: string;
}): string {
  const latest = String(input.latestVersion || "").trim();
  const current = String(input.currentVersion || "").trim();
  const detail = String(input.detail || "").trim();
  if (input.phase === "error") {
    if (/已是最新|没有可安装的更新|尚未发布更新包/.test(detail)
      || (latest && current && !isNewerAppUpdateVersion(latest, current))) {
      return current;
    }
  }
  if (latest && current && !isNewerAppUpdateVersion(latest, current)) {
    return current;
  }
  return latest || current;
}

/** Normalize error progress so stale older targets (e.g. 1.4.34) are not kept. */
export function buildAppUpdateErrorProgress(input: {
  detail?: string | null;
  latestVersion?: string | null;
  currentVersion?: string | null;
  notes?: string | null;
  preservesUserData?: boolean;
}): {
  phase: "error";
  percent: number;
  detail: string;
  latestVersion?: string;
  currentVersion?: string;
  notes?: string;
  preservesUserData?: boolean;
} {
  const detail = String(input.detail || "").trim() || "更新失败";
  const current = String(input.currentVersion || "").trim();
  const latest = String(input.latestVersion || "").trim();
  const alreadyLatest = /已是最新|没有可安装的更新|尚未发布更新包/.test(detail)
    || (Boolean(latest) && Boolean(current) && !isNewerAppUpdateVersion(latest, current));
  return {
    phase: "error",
    percent: 0,
    detail,
    currentVersion: current || undefined,
    latestVersion: alreadyLatest ? undefined : (isNewerAppUpdateVersion(latest, current) ? latest : undefined),
    notes: alreadyLatest ? undefined : (String(input.notes || "").trim() || undefined),
    preservesUserData: input.preservesUserData
  };
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

const APP_UPDATE_IPC_PREFIX =
  /^Error invoking remote method ['"][^'"]+['"]:\s*(?:Error:\s*)*/i;

/** Strip Electron IPC wrappers from update-related errors. */
export function normalizeAppUpdateIpcError(error: unknown): string {
  let message = "";
  if (error instanceof Error) message = error.message;
  else if (typeof error === "string") message = error;
  else if (error != null) message = String(error);
  return message
    .replace(APP_UPDATE_IPC_PREFIX, "")
    .replace(/^(?:Error:\s*)+/i, "")
    .trim();
}

/** Map gateway verify failures to short Chinese copy (never mixed into update notes). */
export function mapAppUpdateVerifyError(error: unknown): string {
  const raw = normalizeAppUpdateIpcError(error);
  if (/desktop app release was not found/i.test(raw)) {
    return "服务端未找到对应更新记录，无法提交验证。若软件已升级成功，可忽略此提示。";
  }
  if (/desktop session required|unauthorized|401/i.test(raw)) {
    return "登录状态已失效，请重新登录后再提交验证。";
  }
  if (!raw || raw === "[object Object]") {
    return "提交更新验证失败，请稍后重试。";
  }
  return raw;
}

/**
 * Account settings “软件版本”说明行。
 * Errors must not append the data-preservation sentence or look like release notes.
 */
function looksLikeAppUpdateErrorNotice(text: string): boolean {
  const value = String(text || "").trim();
  if (!value) return false;
  return /失败|无法|缺少|not found|Error|HTTP\s*\d|未找到|失效/i.test(value)
    || APP_UPDATE_IPC_PREFIX.test(value);
}

export function formatAccountAppUpdateNotice(input: {
  message?: string | null;
  detail?: string | null;
  channel?: string | null;
  isError?: boolean;
}): string {
  const message = String(input.message || "").trim();
  const detail = String(input.detail || "").trim();
  const primary = message || detail;
  const isError = input.isError === true
    || looksLikeAppUpdateErrorNotice(message)
    || (!message && looksLikeAppUpdateErrorNotice(detail));
  if (!primary) {
    return "更新仅替换程序文件，不会删除聊天记录、项目与本地历史。";
  }
  if (isError) {
    return mapAppUpdateVerifyError(primary);
  }
  const channel = String(input.channel || "").trim();
  const withChannel = channel && !primary.includes(`（${channel}）`)
    ? `${primary}${/[。.!？?]$/.test(primary) ? "" : "。"}（${channel}）`
    : primary;
  if (withChannel.includes("不会删除")) return withChannel;
  return `${withChannel}${/[。.!？?]$/.test(withChannel) ? "" : "。"} 更新仅替换程序文件，不会删除聊天记录、项目与本地历史。`;
}
