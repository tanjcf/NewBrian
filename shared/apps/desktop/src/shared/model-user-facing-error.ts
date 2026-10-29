/** User-facing copy for subscription / billing gateway refusals. */
export const SUBSCRIPTION_INACTIVE_USER_MESSAGE =
  "当前订阅未激活，或已过期/失效。请重新购买订阅；如果你已购买，请联系管理员检查状态。";

export const WALLET_OVERAGE_DISABLED_USER_MESSAGE =
  "套餐额度已用尽。请在钱包设置中开启「超出额度用钱包余额扣款」，或充值/升级套餐后再试。";

export const WALLET_BALANCE_INSUFFICIENT_USER_MESSAGE =
  "钱包余额不足，请先充值。";

const SUBSCRIPTION_INACTIVE_RE =
  /subscription\s+inactive\s+or\s+expired|subscription\s+(?:is\s+)?(?:inactive|expired)|订阅(?:未激活|已?过期|已?失效)|套餐(?:未激活|已?过期|已?失效)/i;

const WALLET_OVERAGE_DISABLED_RE =
  /wallet overage debit is disabled|enable wallet overage debit|超额扣款.*未开启|未开启.*钱包.*扣款/i;

const WALLET_BALANCE_INSUFFICIENT_RE =
  /insufficient wallet balance|钱包余额不足/i;

/** True when the gateway/account layer reports an inactive or expired subscription. */
export function isSubscriptionInactiveError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return SUBSCRIPTION_INACTIVE_RE.test(message);
}

/**
 * Map known gateway billing refusals to a clear Chinese guidance message.
 * Returns null when the error is not a recognized subscription refusal.
 */
export function mapSubscriptionInactiveUserMessage(error: unknown): string | null {
  return isSubscriptionInactiveError(error) ? SUBSCRIPTION_INACTIVE_USER_MESSAGE : null;
}

export function mapWalletBillingUserMessage(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (WALLET_BALANCE_INSUFFICIENT_RE.test(message)) return WALLET_BALANCE_INSUFFICIENT_USER_MESSAGE;
  if (WALLET_OVERAGE_DISABLED_RE.test(message)) return WALLET_OVERAGE_DISABLED_USER_MESSAGE;
  return null;
}

/**
 * Cloudflare/origin gateway wait timeout (524) or upstream gateway timeout (504).
 * Common on long media jobs (video/music); not a local crash and not a manual cancel.
 */
export const MODEL_GATEWAY_TIMEOUT_USER_MESSAGE =
  "模型网关等待上游响应超时（HTTP 超时，常见于视频等长任务）。当前进度已保存，可安全重试；若仍失败，请拆分步骤或稍后重试。";

const MODEL_GATEWAY_TIMEOUT_RE =
  /HTTP\s*(?:504|524)\b|模型网关请求失败\s*[（(]\s*HTTP\s*(?:504|524)\s*[）)]|cloudflare.*524|a timeout occurred|gateway.?timeout|连接模型网关超时/i;

/** True when the gateway/proxy timed out waiting for the upstream model/media job. */
export function isModelGatewayTimeoutError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return MODEL_GATEWAY_TIMEOUT_RE.test(message);
}

export function mapModelGatewayTimeoutUserMessage(error: unknown): string | null {
  return isModelGatewayTimeoutError(error) ? MODEL_GATEWAY_TIMEOUT_USER_MESSAGE : null;
}

/** Prefer a user-facing subscription message when applicable; otherwise return the original text. */
export function toUserFacingModelFailureMessage(error: unknown) {
  const walletMapped = mapWalletBillingUserMessage(error);
  if (walletMapped) return walletMapped;
  const mapped = mapSubscriptionInactiveUserMessage(error);
  if (mapped) return mapped;
  const gatewayTimeoutMapped = mapModelGatewayTimeoutUserMessage(error);
  if (gatewayTimeoutMapped) return gatewayTimeoutMapped;
  return error instanceof Error ? error.message : String(error ?? "");
}

const USER_CANCELLED_MODEL_RE =
  /this operation was aborted|aborterror|model request aborted|agent loop was cancelled|user requested cancellation|cancelled_by_user|the user cancelled the current task|user_stop|当前任务已停止|用户已请求停止|上一轮请求已被新消息取代或手动停止/i;

/** Manual stop or a newer turn replacing the previous request — not an abnormal failure. */
export function isUserCancelledModelError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return USER_CANCELLED_MODEL_RE.test(message);
}
