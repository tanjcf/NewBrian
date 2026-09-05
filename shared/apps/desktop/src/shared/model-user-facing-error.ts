/** User-facing copy for subscription / billing gateway refusals. */
export const SUBSCRIPTION_INACTIVE_USER_MESSAGE =
  "当前订阅未激活，或已过期/失效。请重新购买订阅；如果你已购买，请联系管理员检查状态。";

const SUBSCRIPTION_INACTIVE_RE =
  /subscription\s+inactive\s+or\s+expired|subscription\s+(?:is\s+)?(?:inactive|expired)|订阅(?:未激活|已?过期|已?失效)|套餐(?:未激活|已?过期|已?失效)/i;

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

/** Prefer a user-facing subscription message when applicable; otherwise return the original text. */
export function toUserFacingModelFailureMessage(error: unknown) {
  const mapped = mapSubscriptionInactiveUserMessage(error);
  if (mapped) return mapped;
  return error instanceof Error ? error.message : String(error ?? "");
}
