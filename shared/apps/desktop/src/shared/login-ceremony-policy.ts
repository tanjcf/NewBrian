/** Login National Day tribute ceremony eligibility (shared, no Electron deps). */

export const LOGIN_CEREMONY_TIME_ZONE = "Asia/Shanghai";

/** Inclusive start of the annual tribute window (month, day) in Asia/Shanghai. */
export const LOGIN_CEREMONY_WINDOW_START = { month: 9, day: 29 } as const;
/** Inclusive end of the annual tribute window (month, day) in Asia/Shanghai. */
export const LOGIN_CEREMONY_WINDOW_END = { month: 10, day: 15 } as const;

export type LoginCeremonyClockInput = {
  /** Optional `yyyy-MM-dd` from spring-app (Asia/Shanghai preferred). */
  serverDate?: string | null;
  /** ISO-8601 instant from spring-app `server_time`. */
  serverTime?: string | null;
  timeZone?: string;
};

/**
 * Whether spring-app server clock falls in the annual National Day tribute window
 * (Sep 29–Oct 15 inclusive, Asia/Shanghai). Prefers explicit `serverDate`;
 * otherwise derives the calendar day from `serverTime`.
 */
export function isNationalDayFromServerClock(input: LoginCeremonyClockInput): boolean {
  const day = resolveLoginCeremonyCalendarDay(input);
  if (!day) return false;
  return isWithinNationalDayTributeWindow(day.month, day.day);
}

/** Sep 29–Oct 15 inclusive (month/day only; repeats every year). */
export function isWithinNationalDayTributeWindow(month: number, day: number): boolean {
  if (month === LOGIN_CEREMONY_WINDOW_START.month && day >= LOGIN_CEREMONY_WINDOW_START.day) {
    return true;
  }
  if (month === LOGIN_CEREMONY_WINDOW_END.month && day <= LOGIN_CEREMONY_WINDOW_END.day) {
    return true;
  }
  return false;
}

/**
 * Production packaged builds require the tribute window on the spring-app clock.
 * Local/unpacked builds stay always eligible so the ceremony can be previewed.
 */
export function shouldEnableLoginCeremony(input: LoginCeremonyClockInput & { isPackaged: boolean }): boolean {
  if (!input.isPackaged) return true;
  return isNationalDayFromServerClock(input);
}

/**
 * Asia/Shanghai midnight on Sep 29 of the given year (fixed UTC+8, no DST).
 * Local sessions synced before this instant are treated as pre-window logins.
 */
export function resolveLoginCeremonyWindowStartMs(year: number): number {
  const start = Date.parse(
    `${String(year).padStart(4, "0")}-${String(LOGIN_CEREMONY_WINDOW_START.month).padStart(2, "0")}-${String(LOGIN_CEREMONY_WINDOW_START.day).padStart(2, "0")}T00:00:00+08:00`
  );
  return Number.isFinite(start) ? start : Number.NaN;
}

/** Resolve calendar day used for tribute-window gating. */
export function resolveLoginCeremonyCalendarDay(
  input: LoginCeremonyClockInput
): { year: number; month: number; day: number } | null {
  const timeZone = input.timeZone || LOGIN_CEREMONY_TIME_ZONE;
  const fromDate = parseYearMonthDay(input.serverDate);
  if (fromDate) return fromDate;
  return calendarDayInTimeZone(input.serverTime, timeZone);
}

/**
 * Packaged builds: once the tribute window has started on the spring-app clock,
 * clear local sessions that were last synced before that year's Sep 29 00:00 Asia/Shanghai
 * so users re-login and see the ceremony. Unpacked / preview builds never force.
 */
export function shouldInvalidateLocalAuthForLoginCeremony(
  input: LoginCeremonyClockInput & {
    isPackaged: boolean;
    lastSyncedAt?: string | null;
  }
): boolean {
  if (!input.isPackaged) return false;
  const day = resolveLoginCeremonyCalendarDay(input);
  if (!day || !isWithinNationalDayTributeWindow(day.month, day.day)) return false;
  const windowStartMs = resolveLoginCeremonyWindowStartMs(day.year);
  if (!Number.isFinite(windowStartMs)) return false;
  const syncedMs = Date.parse(String(input.lastSyncedAt || "").trim());
  if (!Number.isFinite(syncedMs)) return true;
  return syncedMs < windowStartMs;
}

/** Fields the login UI reads from desktop auth status / spring-app auth config. */
export type LoginCeremonyAuthFields = {
  server_time: string | null;
  server_date: string | null;
  login_ceremony_enabled: boolean;
};

/**
 * Build ceremony auth fields for IPC/auth status from spring-app clock + package mode.
 */
export function resolveLoginCeremonyAuthFields(
  input: LoginCeremonyClockInput & { isPackaged: boolean }
): LoginCeremonyAuthFields {
  const serverTime = String(input.serverTime || "").trim() || null;
  const serverDate = String(input.serverDate || "").trim() || null;
  return {
    server_time: serverTime,
    server_date: serverDate,
    login_ceremony_enabled: shouldEnableLoginCeremony({
      isPackaged: input.isPackaged,
      serverTime,
      serverDate,
      timeZone: input.timeZone
    })
  };
}

function parseYearMonthDay(value: string | null | undefined): { year: number; month: number; day: number } | null {
  const raw = String(value || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function calendarDayInTimeZone(
  serverTime: string | null | undefined,
  timeZone: string
): { year: number; month: number; day: number } | null {
  const raw = String(serverTime || "").trim();
  if (!raw) return null;
  const instant = Date.parse(raw);
  if (!Number.isFinite(instant)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date(instant));
    const year = Number(parts.find((part) => part.type === "year")?.value);
    const month = Number(parts.find((part) => part.type === "month")?.value);
    const day = Number(parts.find((part) => part.type === "day")?.value);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    return { year, month, day };
  } catch {
    return null;
  }
}
