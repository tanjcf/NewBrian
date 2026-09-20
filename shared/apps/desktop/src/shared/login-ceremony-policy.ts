/** Login National Day ceremony eligibility (shared, no Electron deps). */

export const LOGIN_CEREMONY_TIME_ZONE = "Asia/Shanghai";

export type LoginCeremonyClockInput = {
  /** Optional `yyyy-MM-dd` from spring-app (Asia/Shanghai preferred). */
  serverDate?: string | null;
  /** ISO-8601 instant from spring-app `server_time`. */
  serverTime?: string | null;
  timeZone?: string;
};

/**
 * Whether spring-app server clock falls on October 1 in Asia/Shanghai.
 * Prefers explicit `serverDate`; otherwise derives the calendar day from `serverTime`.
 */
export function isNationalDayFromServerClock(input: LoginCeremonyClockInput): boolean {
  const timeZone = input.timeZone || LOGIN_CEREMONY_TIME_ZONE;
  const fromDate = parseYearMonthDay(input.serverDate);
  if (fromDate) {
    return fromDate.month === 10 && fromDate.day === 1;
  }
  const fromTime = calendarDayInTimeZone(input.serverTime, timeZone);
  if (!fromTime) return false;
  return fromTime.month === 10 && fromTime.day === 1;
}

/**
 * Production packaged builds require National Day on the spring-app clock.
 * Local/unpacked builds stay always eligible so the ceremony can be previewed.
 */
export function shouldEnableLoginCeremony(input: LoginCeremonyClockInput & { isPackaged: boolean }): boolean {
  if (!input.isPackaged) return true;
  return isNationalDayFromServerClock(input);
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
