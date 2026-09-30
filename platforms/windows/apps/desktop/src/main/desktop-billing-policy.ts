export function normalizeDesktopBillingPayload(payloadRecord: Record<string, unknown>) {
  const bootstrap = payloadRecord.bootstrap && typeof payloadRecord.bootstrap === "object"
    ? payloadRecord.bootstrap as Record<string, unknown>
    : {};
  const subscription = payloadRecord.subscription && typeof payloadRecord.subscription === "object"
    ? payloadRecord.subscription as Record<string, unknown>
    : {};
  const bootstrapEntitlements = bootstrap.entitlements && typeof bootstrap.entitlements === "object"
    ? bootstrap.entitlements as Record<string, unknown>
    : {};
  const summary = subscription.summary && typeof subscription.summary === "object"
    ? subscription.summary as Record<string, unknown>
    : bootstrapEntitlements;
  const usage = payloadRecord.usage && typeof payloadRecord.usage === "object"
    ? payloadRecord.usage as Record<string, unknown>
    : {};
  const usageSummary = usage.summary && typeof usage.summary === "object"
    ? usage.summary as Record<string, unknown>
    : {};
  const usageItems = Array.isArray(usage.items)
    ? usage.items as Array<Record<string, unknown>>
    : Array.isArray(usage.records)
      ? usage.records as Array<Record<string, unknown>>
      : [];
  const tokenUsed = usageItems.reduce((total, item) => total
    + Number(item.input_tokens ?? item.prompt_tokens ?? 0)
    + Number(item.output_tokens ?? item.completion_tokens ?? 0), 0);
  const taskUsed = Number((usageSummary.total ?? usageSummary.total_requests ?? usageItems.length) || usageItems.length);
  const directSubscriptions = Array.isArray(subscription.subscriptions)
    ? subscription.subscriptions as Record<string, unknown>[]
    : Array.isArray(payloadRecord.subscriptions)
      ? payloadRecord.subscriptions as Record<string, unknown>[]
      : [];
  const activeSubscription = directSubscriptions.find((item) => ["active", "valid"].includes(String(item.status || "").toLowerCase()))
    ?? directSubscriptions[0]
    ?? summary;
  const hasSubscriptionSource =
    directSubscriptions.length > 0 ||
    Object.keys(summary).some((key) => !["daily_used", "monthly_used", "monthly_tokens_used", "monthly_tasks_used"].includes(key) && summary[key] != null && String(summary[key]).trim() !== "");
  const normalizedSubscription = {
    ...activeSubscription,
    id: activeSubscription.id ?? "omniroute-current",
    plan_name: String(activeSubscription.plan_name ?? summary.plan_name ?? "Unavailable"),
    plan_code: String(activeSubscription.plan_code ?? summary.plan_code ?? "unknown"),
    provider_name: String(activeSubscription.provider_name ?? activeSubscription.vendor_name ?? summary.provider_name ?? summary.vendor_name ?? "Unknown"),
    status: String(activeSubscription.status ?? summary.status ?? "unknown"),
    expires_at: activeSubscription.expires_at ?? summary.expires_at ?? summary.expire_at ?? "",
    balance: Number(activeSubscription.balance ?? summary.balance ?? 0),
    wallet_overage_enabled: Boolean(
      activeSubscription.wallet_overage_enabled
        ?? activeSubscription.walletOverageEnabled
        ?? summary.wallet_overage_enabled
        ?? summary.walletOverageEnabled
        ?? false
    ),
    daily_used: Number(activeSubscription.daily_used ?? summary.daily_used ?? 0),
    daily_quota: Number(activeSubscription.daily_quota ?? summary.daily_quota ?? 0),
    monthly_used: Number(activeSubscription.monthly_used ?? summary.monthly_used ?? 0),
    monthly_quota: Number(activeSubscription.monthly_quota ?? summary.monthly_quota ?? 0),
    monthly_tokens_used: Number(activeSubscription.monthly_tokens_used ?? summary.monthly_tokens_used ?? tokenUsed),
    monthly_tokens_quota: Number(activeSubscription.monthly_tokens_quota ?? summary.monthly_tokens_quota ?? 0),
    monthly_tasks_used: Number(activeSubscription.monthly_tasks_used ?? summary.monthly_tasks_used ?? taskUsed),
    monthly_task_quota: Number(activeSubscription.monthly_task_quota ?? summary.monthly_task_quota ?? 0)
  };
  const billingHistory = [
    subscription.billing_history, subscription.activities, subscription.invoices, subscription.payments, subscription.orders, subscription.transactions,
    payloadRecord.billing_history, payloadRecord.invoices, payloadRecord.payments, payloadRecord.orders, payloadRecord.transactions
  ].find(Array.isArray) ?? [];
  return {
    ...subscription,
    summary: { ...summary, ...normalizedSubscription },
    subscriptions: directSubscriptions.length
      ? directSubscriptions.map((item) => item.id === activeSubscription.id ? { ...item, ...normalizedSubscription } : item)
      : hasSubscriptionSource
        ? [normalizedSubscription]
        : [],
    billing_history: billingHistory,
    usage,
    bootstrap,
    source_error: payloadRecord.source_error
  };
}
