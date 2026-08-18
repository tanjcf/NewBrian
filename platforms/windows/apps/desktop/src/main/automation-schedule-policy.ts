import type { AutomationSpec, FeatureItemInput } from "@codex-forge/protocol";

const isActiveStatus = (status: AutomationSpec["status"]) => status === "scheduled" || status === "running";
const parsePositiveInterval = (value?: string) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return parsed > 0 ? parsed : undefined;
};

export function computeNextAutomationRunAt(intervalMinutes?: number, nowMs = Date.now()) {
  return typeof intervalMinutes === "number" && intervalMinutes > 0
    ? new Date(nowMs + intervalMinutes * 60_000).toISOString()
    : undefined;
}

export function computeNextDailyRunAt(dailyTime?: string, nowMs = Date.now()) {
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(dailyTime ?? "");
  if (!match) return undefined;
  const [hour, minute] = match[0].split(":").map(Number);
  const next = new Date(nowMs);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= nowMs) next.setDate(next.getDate() + 1);
  return next.toISOString();
}

const nextRunAt = (item: Pick<AutomationSpec, "intervalMinutes" | "dailyTime">, nowMs: number) =>
  item.dailyTime ? computeNextDailyRunAt(item.dailyTime, nowMs) : computeNextAutomationRunAt(item.intervalMinutes, nowMs);

export function createAutomationSpec(
  input: FeatureItemInput,
  context: { makeId: () => string; activeWorkspaceId?: string; activeThreadId?: string; nowMs?: number }
): AutomationSpec {
  const intervalMinutes = parsePositiveInterval(input.intervalMinutes);
  const status: AutomationSpec["status"] = ["scheduled", "running", "paused"].includes(input.status ?? "")
    ? input.status as AutomationSpec["status"]
    : "idle";
  return {
    id: input.id?.trim() || context.makeId(),
    title: input.title?.trim() || "未命名自动化",
    status,
    trigger: input.trigger?.trim() || "待配置触发说明",
    workspaceId: input.workspaceId?.trim() || context.activeWorkspaceId || undefined,
    threadId: input.threadId?.trim() || context.activeThreadId || undefined,
    action: input.action === "git_status" || input.action === "error_remediation" ? input.action : "workspace_scan",
    intervalMinutes,
    dailyTime: /^\d{2}:\d{2}$/.test(input.dailyTime ?? "") ? input.dailyTime : undefined,
    nextRunAt: isActiveStatus(status) ? nextRunAt({ intervalMinutes, dailyTime: input.dailyTime }, context.nowMs ?? Date.now()) : undefined
  };
}

export function updateAutomationSpec(item: AutomationSpec, input: FeatureItemInput, nowMs = Date.now()) {
  const intervalMinutes = parsePositiveInterval(input.intervalMinutes) ?? item.intervalMinutes;
  const status: AutomationSpec["status"] = ["scheduled", "running", "paused", "idle"].includes(input.status ?? "")
    ? input.status as AutomationSpec["status"]
    : item.status;
  return {
    ...item,
    title: input.title?.trim() || item.title,
    trigger: input.trigger?.trim() || item.trigger,
    status,
    workspaceId: input.workspaceId?.trim() || item.workspaceId,
    threadId: input.threadId?.trim() || item.threadId,
    action: input.action === "git_status" || input.action === "workspace_scan" || input.action === "error_remediation" ? input.action : item.action,
    intervalMinutes,
    dailyTime: /^\d{2}:\d{2}$/.test(input.dailyTime ?? "") ? input.dailyTime : item.dailyTime,
    nextRunAt: isActiveStatus(status) ? nextRunAt({ intervalMinutes, dailyTime: input.dailyTime ?? item.dailyTime }, nowMs) : undefined
  };
}

export function selectDueAutomations(automations: AutomationSpec[], nowMs = Date.now()) {
  return automations.filter((item) => {
    if (item.status !== "scheduled" && item.status !== "running") return false;
    if (!item.nextRunAt || (!item.dailyTime && (!item.intervalMinutes || item.intervalMinutes <= 0))) return false;
    return new Date(item.nextRunAt).getTime() <= nowMs;
  });
}

export function markAutomationRunning(automations: AutomationSpec[], id: string, startedAt: string) {
  return automations.map((item) => item.id === id
    ? { ...item, status: "running" as const, lastRunAt: startedAt }
    : item);
}

export function markAutomationSucceeded(automations: AutomationSpec[], id: string, startedAt: string, nowMs = Date.now()) {
  return automations.map((item) => item.id === id
    ? { ...item, status: "scheduled" as const, lastRunAt: startedAt,
        nextRunAt: nextRunAt(item, nowMs), failureCount: 0, lastError: undefined }
    : item);
}

export function markAutomationFailed(automations: AutomationSpec[], id: string, error: unknown, nowMs = Date.now()) {
  return automations.map((item) => {
    if (item.id !== id) return item;
    const failureCount = (item.failureCount ?? 0) + 1;
    const paused = failureCount >= 3;
    const backoffMinutes = Math.min(60, 5 * 2 ** (failureCount - 1));
    return { ...item, status: paused ? "paused" as const : "scheduled" as const, failureCount,
      lastError: error instanceof Error ? error.message : String(error),
      nextRunAt: paused ? undefined : new Date(nowMs + backoffMinutes * 60_000).toISOString() };
  });
}
