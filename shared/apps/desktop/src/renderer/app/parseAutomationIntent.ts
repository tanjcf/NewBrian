/**
 * Turn a Codex-style natural-language automation request into editable draft fields.
 * Keeps parsing local and deterministic so "新建" works without a round-trip model call.
 */

export type ParsedAutomationIntent = {
  title: string;
  prompt: string;
  trigger: string;
  schedule: "hourly" | "daily" | "weekly" | "custom";
  intervalMinutes: string;
  dailyTime?: string;
  action: "workspace_scan" | "git_status" | "thread_follow_up";
  template: string;
  rrule?: string;
};

const EXAMPLE_INTENTS = [
  "每天 18:00 检查当前项目最近变更，整理完成事项和下一步计划",
  "每小时检查一次 Git 状态，有未提交改动时提醒",
  "每周一汇总本周对话进度并给出跟进建议"
] as const;

const WEEKDAY_TO_RRULE: Array<{ pattern: RegExp; byday: string }> = [
  { pattern: /每周日|星期天|星期日|周日|Sunday/i, byday: "SU" },
  { pattern: /每周一|星期一|周一|Monday/i, byday: "MO" },
  { pattern: /每周二|星期二|周二|Tuesday/i, byday: "TU" },
  { pattern: /每周三|星期三|周三|Wednesday/i, byday: "WE" },
  { pattern: /每周四|星期四|周四|Thursday/i, byday: "TH" },
  { pattern: /每周五|星期五|周五|Friday/i, byday: "FR" },
  { pattern: /每周六|星期六|周六|Saturday/i, byday: "SA" }
];

/**
 * Example prompts shown in the automation create surface.
 */
export function automationIntentExamples(): readonly string[] {
  return EXAMPLE_INTENTS;
}

const AUTOMATION_CREATE_REQUEST = /(?:请帮我)?创建(?:一个)?自动化(?:任务|计划)?|新建(?:一个)?自动化(?:任务|计划)?|create an automation/i;

/**
 * True when the user is asking this turn to create an automation, including a short
 * follow-up such as "你来创建自动化任务". Edit requests stay on the update path.
 */
export function isAutomationCreationRequest(raw: string): boolean {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  if (!text || /修改自动化/.test(text)) return false;
  return AUTOMATION_CREATE_REQUEST.test(text);
}

function automationRequestHasSchedule(text: string): boolean {
  return /每天|每日|每周|每小时|每\s*\d+\s*(?:分钟|小时)|[:：]\d{2}|早上|上午|下午|晚上|工作日/.test(text);
}

/**
 * Text that should be stored as the automation. A short "please create it" nudge
 * keeps the earlier user message that actually describes the schedule and work.
 */
export function resolveAutomationCreationText(
  message: string,
  previousUserMessages: readonly string[] = []
): string | null {
  const text = String(message || "").trim();
  if (!isAutomationCreationRequest(text)) return null;
  if (automationRequestHasSchedule(text) || text.length >= 48) return text;
  const previous = [...previousUserMessages]
    .reverse()
    .map((item) => String(item || "").trim())
    .find((item) => item && item !== text);
  return previous ? `${text}\n${previous}` : text;
}

/**
 * Parse a free-form Chinese/English schedule description into automation draft fields.
 */
export function parseAutomationIntent(raw: string): ParsedAutomationIntent {
  const text = String(raw || "").trim().replace(/\s+/g, " ");
  if (!text) {
    return {
      title: "",
      prompt: "",
      trigger: "",
      schedule: "daily",
      intervalMinutes: "1440",
      action: "workspace_scan",
      template: ""
    };
  }

  const lower = text.toLowerCase();
  let schedule: ParsedAutomationIntent["schedule"] = "daily";
  let intervalMinutes = "1440";
  let rrule: string | undefined;

  const everyMinutes = text.match(/每(?:隔)?\s*(\d+)\s*分钟/) || lower.match(/every\s+(\d+)\s*(?:minutes?|mins?)/);
  const everyHours = text.match(/每(?:隔)?\s*(\d+)\s*(?:小时|钟头)/) || lower.match(/every\s+(\d+)\s*(?:hours?|hrs?)/);
  if (everyMinutes) {
    schedule = "custom";
    intervalMinutes = String(Math.max(1, Number(everyMinutes[1]) || 30));
  } else if (everyHours) {
    const hours = Math.max(1, Number(everyHours[1]) || 1);
    schedule = hours === 1 ? "hourly" : "custom";
    intervalMinutes = String(hours * 60);
  } else if (/每小时|hourly|每\s*1\s*小时/.test(text) || /every\s+hour/.test(lower)) {
    schedule = "hourly";
    intervalMinutes = "60";
  } else if (/每周|weekly|每星期/.test(text) || /every\s+(?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/.test(lower)) {
    schedule = "weekly";
    intervalMinutes = String(7 * 1440);
    const weekday = WEEKDAY_TO_RRULE.find((item) => item.pattern.test(text));
    const byday = weekday?.byday || "MO";
    rrule = `FREQ=WEEKLY;BYDAY=${byday}`;
  } else if (/每天|每日|daily|每天\s*\d{1,2}/.test(text) || /every\s+day/.test(lower)) {
    schedule = "daily";
    intervalMinutes = "1440";
  }

  const dailyTime = parseDailyTime(text);
  if (rrule && dailyTime) {
    const [hour, minute] = dailyTime.split(":");
    rrule = `${rrule};BYHOUR=${Number(hour)};BYMINUTE=${Number(minute)}`;
  }

  let action: ParsedAutomationIntent["action"] = "workspace_scan";
  let template = "每日进度汇总";
  if (/git|提交|分支|工作区变更|未提交/.test(lower) || /git/.test(lower)) {
    action = "git_status";
    template = "发布前检查";
  } else if (/线程|对话|跟进|提醒|待办/.test(text)) {
    action = "thread_follow_up";
    template = "";
  } else if (/sentry|崩溃/.test(lower)) {
    action = "workspace_scan";
    template = "Sentry 崩溃巡检";
  }

  const title = deriveTitle(text, schedule, action);
  const taskPrompt = isAutomationCreationRequest(text) ? automationTaskPrompt(text) : text;
  return {
    title,
    prompt: taskPrompt || text,
    trigger: taskPrompt || text,
    schedule,
    intervalMinutes,
    ...(dailyTime ? { dailyTime } : {}),
    ...(rrule ? { rrule } : {}),
    action,
    template
  };
}

function parseDailyTime(text: string): string | undefined {
  // Prefer meridiem forms so "6:30 PM" does not collapse to 06:30 via the 24h matcher.
  const english = text.match(/\b(?:at\s+)?(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (english) {
    let hour = Number(english[1]);
    if (hour >= 1 && hour <= 12) {
      const isPm = english[3].toLowerCase().startsWith("p");
      if (isPm && hour < 12) hour += 12;
      if (!isPm && hour === 12) hour = 0;
      return `${String(hour).padStart(2, "0")}:${english[2] ?? "00"}`;
    }
  }

  const numeric = text.match(/(?:^|[^\d])([01]?\d|2[0-3])[:：]([0-5]\d)(?!\d)/);
  if (numeric) return `${numeric[1].padStart(2, "0")}:${numeric[2]}`;

  const chinese = text.match(/(?:每天|每日|每周[一二三四五六日天]?|上午|下午|晚上|早上|中午)?\s*(\d{1,2})\s*(?:点|时)(?:\s*(\d{1,2})\s*分?)?/);
  if (chinese) {
    let hour = Number(chinese[1]);
    const minute = Number(chinese[2] ?? 0);
    const period = chinese[0];
    if (/下午|晚上/.test(period) && hour < 12) hour += 12;
    if (/中午/.test(period) && hour < 11) hour += 12;
    if (/早上|上午/.test(period) && hour === 12) hour = 0;
    if (hour <= 23 && minute <= 59) return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  return undefined;
}

const CREATION_PREFIX = /^(?:请帮我|请|帮我)?(?:创建|新建)(?:一个)?自动化(?:任务|计划)?\s*[：:]\s*/i;
const ENGLISH_CREATION_PREFIX = /^(?:please\s+)?create\s+an\s+automation(?:\s+task)?\s*[:：]\s*/i;
const ATTACHED_PATH = /(?:^|\s)(?:[A-Za-z]:\\(?:\\?\S)+|\/(?:\S+\/)+\S+\.(?:zip|tar|gz|tgz|skill))\b/gi;
const LEADING_SCHEDULE = /^(?:每天|每日|每个工作日|每周[一二三四五六日天]?|每小时|every\s+day|daily)\s*(?:早上|上午|下午|晚上|中午)?\s*(?:(?:[01]?\d|2[0-3])\s*[:：]\s*[0-5]\d|\d{1,2}\s*(?:点|时)(?:\s*\d{1,2}\s*分?)?)(?:\s*[（(][^）)]{0,20}[）)])?\s*/i;

/**
 * Instruction the scheduled run should execute. Drops the "please create an
 * automation" wrapper, the schedule already stored on the task, and attached
 * zip paths that are not part of the work.
 */
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

function deriveTitle(
  text: string,
  schedule: ParsedAutomationIntent["schedule"],
  action: ParsedAutomationIntent["action"]
): string {
  const clipped = text.length > 24 ? `${text.slice(0, 24)}…` : text;
  if (/巡检|运维/.test(text)) {
    if (schedule === "hourly") return "每小时巡检";
    if (schedule === "weekly") return "每周运维巡检";
    return "每日运维巡检";
  }
  if (/进度|汇总|整理/.test(text)) return "每日项目进度整理";
  if (action === "git_status") return "Git 状态巡检";
  if (action === "thread_follow_up") return "线程跟进提醒";
  if (schedule === "hourly") return "每小时巡检";
  if (schedule === "weekly") return "每周汇总";
  return clipped || "新自动化任务";
}
