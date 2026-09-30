export const DEFAULT_MODEL_RUNTIME_TIMEZONE = "Asia/Shanghai";

export interface ModelRuntimeDateContextOptions {
  now?: Date;
  timezone?: string;
}

function localClockParts(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: get("weekday"),
    time: `${get("hour")}:${get("minute")}`,
    year: get("year")
  };
}

/** Authoritative calendar context injected into every model chat system prompt. */
export function formatModelRuntimeDateContext(options: ModelRuntimeDateContextOptions = {}): string {
  const now = options.now ?? new Date();
  const timezone = options.timezone ?? DEFAULT_MODEL_RUNTIME_TIMEZONE;
  const local = localClockParts(now, timezone);
  return [
    `Current date and time (${timezone}): ${local.date} (${local.weekday}), ${local.time}. Current year: ${local.year}.`,
    "Treat this as authoritative for today's date, the current year, and relative periods such as 上半年/下半年 when writing reports, statistics, and time-sensitive answers, unless the user explicitly specifies a different reference date."
  ].join(" ");
}
