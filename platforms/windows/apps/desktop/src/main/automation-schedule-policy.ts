import type { AutomationSpec, FeatureItemInput } from "@codex-forge/protocol";

const isActiveStatus = (status: AutomationSpec["status"]) => status === "scheduled" || status === "running";
const parsePositiveInterval = (value?: string) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return parsed > 0 ? parsed : undefined;
};

const WEEKDAY_BY_RRULE: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6
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

/** Next weekly occurrence for a given weekday (0=Sun..6=Sat) and optional HH:mm. */
export function computeNextWeeklyRunAt(input: { weekday: number; dailyTime?: string }, nowMs = Date.now()) {
  const weekday = ((input.weekday % 7) + 7) % 7;
  const timeMatch = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(input.dailyTime ?? "");
  const hour = timeMatch ? Number(timeMatch[0].slice(0, 2)) : 9;
  const minute = timeMatch ? Number(timeMatch[0].slice(3, 5)) : 0;
  const next = new Date(nowMs);
  next.setSeconds(0, 0);
  next.setHours(hour, minute, 0, 0);
  const delta = (weekday - next.getDay() + 7) % 7;
  if (delta === 0 && next.getTime() <= nowMs) next.setDate(next.getDate() + 7);
  else next.setDate(next.getDate() + delta);
  return next.toISOString();
}

export function parseWeeklyWeekdayFromRrule(rrule?: string): number | undefined {
  const match = /BYDAY=([A-Z]{2})/i.exec(rrule ?? "");
  if (!match) return undefined;
  const key = match[1].toUpperCase();
  return Object.prototype.hasOwnProperty.call(WEEKDAY_BY_RRULE, key) ? WEEKDAY_BY_RRULE[key] : undefined;
}

const nextRunAt = (
  item: Pick<AutomationSpec, "intervalMinutes" | "dailyTime" | "schedule" | "rrule">,
  nowMs: number
) => {
  const weekday = parseWeeklyWeekdayFromRrule(item.rrule);
  if (item.schedule === "weekly" || weekday != null || /FREQ=WEEKLY/i.test(item.rrule ?? "")) {
    return computeNextWeeklyRunAt({ weekday: weekday ?? 1, dailyTime: item.dailyTime }, nowMs);
  }
  if (item.dailyTime) return computeNextDailyRunAt(item.dailyTime, nowMs);
  return computeNextAutomationRunAt(item.intervalMinutes, nowMs);
};

const CREATION_PREFIX = /^(?:请帮我|请|帮我)?(?:创建|新建)(?:一个)?自动化(?:任务|计划)?\s*[：:]\s*/i;
const ENGLISH_CREATION_PREFIX = /^(?:please\s+)?create\s+an\s+automation(?:\s+task)?\s*[:：]\s*/i;
const ATTACHED_PATH = /(?:^|\s)(?:[A-Za-z]:\\(?:\\?\S)+|\/(?:\S+\/)+\S+\.(?:zip|tar|gz|tgz|skill))\b/gi;
const LEADING_SCHEDULE = /^(?:每天|每日|每个工作日|每周[一二三四五六日天]?|每小时|every\s+day|daily)\s*(?:早上|上午|下午|晚上|中午)?\s*(?:(?:[01]?\d|2[0-3])\s*[:：]\s*[0-5]\d|\d{1,2}\s*(?:点|时)(?:\s*\d{1,2}\s*分?)?)(?:\s*[（(][^）)]{0,20}[）)])?\s*/i;

/** Same distillation as the renderer parser, so an already-saved raw prompt still runs as the task. */
export function automationTaskPrompt(raw: string): string {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const stripped = text
    .replace(CREATION_PREFIX, "")
    .replace(ENGLISH_CREATION_PREFIX, "")
    .replace(ATTACHED_PATH, " ")
    .replace(/\s+/g, " ")
    .trim();
  const withoutSchedule = stripped.replace(LEADING_SCHEDULE, "").trim();
  return withoutSchedule || stripped || text;
}

function optionalTrimmed(value?: string) {
  const text = value?.trim();
  return text ? text : undefined;
}

function resolveAction(value?: string): AutomationSpec["action"] {
  if (value === "git_status" || value === "error_remediation") return value;
  return "workspace_scan";
}

export function createAutomationSpec(
  input: FeatureItemInput,
  context: { makeId: () => string; activeWorkspaceId?: string; activeThreadId?: string; nowMs?: number }
): AutomationSpec {
  const intervalMinutes = parsePositiveInterval(input.intervalMinutes);
  const dailyTime = /^\d{2}:\d{2}$/.test(input.dailyTime ?? "") ? input.dailyTime : undefined;
  const schedule = optionalTrimmed(input.schedule);
  const rrule = optionalTrimmed(input.rrule);
  const hasTiming = Boolean(dailyTime) || typeof intervalMinutes === "number" || schedule === "weekly" || Boolean(rrule);
  const status: AutomationSpec["status"] = ["scheduled", "running", "paused", "idle"].includes(input.status ?? "")
    ? input.status as AutomationSpec["status"]
    : hasTiming
      ? "scheduled"
      : "idle";
  const prompt = optionalTrimmed(input.prompt);
  const trigger = optionalTrimmed(input.trigger) || prompt || "待配置触发说明";
  const permissionMode = input.permissionMode === "full" || input.permissionMode === "agent"
    ? input.permissionMode
    : undefined;
  const spec: AutomationSpec = {
    id: input.id?.trim() || context.makeId(),
    title: input.title?.trim() || "未命名自动化",
    status,
    trigger,
    prompt,
    schedule,
    runtime: optionalTrimmed(input.runtime),
    model: optionalTrimmed(input.model),
    reasoning: optionalTrimmed(input.reasoning),
    rrule,
    workspaceId: input.workspaceId?.trim() || context.activeWorkspaceId || undefined,
    threadId: input.threadId?.trim() || context.activeThreadId || undefined,
    action: resolveAction(input.action),
    intervalMinutes,
    dailyTime,
    ...(permissionMode ? { permissionMode } : {}),
    nextRunAt: undefined
  };
  if (isActiveStatus(status)) {
    spec.nextRunAt = nextRunAt(spec, context.nowMs ?? Date.now());
  }
  return spec;
}

export function updateAutomationSpec(item: AutomationSpec, input: FeatureItemInput, nowMs = Date.now()) {
  const intervalMinutes = parsePositiveInterval(input.intervalMinutes) ?? item.intervalMinutes;
  const dailyTime = /^\d{2}:\d{2}$/.test(input.dailyTime ?? "") ? input.dailyTime : item.dailyTime;
  const status: AutomationSpec["status"] = ["scheduled", "running", "paused", "idle"].includes(input.status ?? "")
    ? input.status as AutomationSpec["status"]
    : item.status;
  const prompt = input.prompt !== undefined ? optionalTrimmed(input.prompt) : item.prompt;
  const next: AutomationSpec = {
    ...item,
    title: input.title?.trim() || item.title,
    trigger: input.trigger?.trim() || item.trigger,
    prompt,
    schedule: input.schedule !== undefined ? optionalTrimmed(input.schedule) : item.schedule,
    runtime: input.runtime !== undefined ? optionalTrimmed(input.runtime) : item.runtime,
    model: input.model !== undefined ? optionalTrimmed(input.model) : item.model,
    reasoning: input.reasoning !== undefined ? optionalTrimmed(input.reasoning) : item.reasoning,
    rrule: input.rrule !== undefined ? optionalTrimmed(input.rrule) : item.rrule,
    status,
    workspaceId: input.workspaceId?.trim() || item.workspaceId,
    threadId: input.threadId?.trim() || item.threadId,
    action: input.action ? resolveAction(input.action) : item.action,
    intervalMinutes,
    dailyTime,
    permissionMode: input.permissionMode === "full" || input.permissionMode === "agent"
      ? input.permissionMode
      : item.permissionMode,
    nextRunAt: undefined
  };
  if (isActiveStatus(status)) {
    next.nextRunAt = nextRunAt(next, nowMs);
  }
  return next;
}

export function selectDueAutomations(automations: AutomationSpec[], nowMs = Date.now()) {
  return automations.filter((item) => {
    if (item.status !== "scheduled" && item.status !== "running") return false;
    const hasWeekly = item.schedule === "weekly" || Boolean(parseWeeklyWeekdayFromRrule(item.rrule)) || /FREQ=WEEKLY/i.test(item.rrule ?? "");
    if (!item.nextRunAt || (!item.dailyTime && !hasWeekly && (!item.intervalMinutes || item.intervalMinutes <= 0))) return false;
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
