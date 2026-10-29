/**
 * Normalize Electron IPC / auth errors for the login screen banner.
 * Never returns an empty string — an empty banner looks like "login failed with no prompt".
 */

const IPC_REMOTE_PREFIX =
  /^Error invoking remote method ['"][^'"]+['"]:\s*(?:Error:\s*)*/i;

export const LOGIN_FAILURE_FALLBACK = "登录失败，请检查账号、密码或验证码后重试。";

export function normalizeLoginErrorMessage(error: unknown): string {
  let message = "";
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else if (
    error
    && typeof error === "object"
    && "message" in error
    && typeof (error as { message?: unknown }).message === "string"
  ) {
    message = String((error as { message: string }).message);
  } else if (error != null) {
    message = String(error);
  }

  message = message.replace(IPC_REMOTE_PREFIX, "").replace(/^(?:Error:\s*)+/i, "").trim();
  if (!message || message === "[object Object]") {
    return LOGIN_FAILURE_FALLBACK;
  }
  return message;
}

/** Prefer explicit UI error, then auth status last_error, then a fixed fallback. */
export function resolveLoginFailureBannerMessage(
  errorMessage?: string | null,
  lastError?: string | null
): string {
  const primary = String(errorMessage || "").trim();
  if (primary) return primary;
  const secondary = String(lastError || "").trim();
  if (secondary) return secondary;
  return "";
}
