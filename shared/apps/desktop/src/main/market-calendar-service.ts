import type { ChinaExchange } from "./quant-strategy-scheduler.ts";

export interface TradingDayDecision {
  exchange: ChinaExchange;
  date: string;
  isTradingDay: boolean;
  source: string;
  fetchedAt: string;
}

function requireDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new TypeError("MARKET_CALENDAR_DATE_INVALID");
  return value;
}

function weekend(date: string): boolean {
  const day = new Date(`${requireDate(date)}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function parseDecision(value: unknown, exchange: ChinaExchange, date: string): TradingDayDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MARKET_CALENDAR_INVALID_RESPONSE");
  const item = value as Record<string, unknown>;
  if (item.exchange !== exchange || item.date !== date || typeof item.isTradingDay !== "boolean"
    || typeof item.source !== "string" || !item.source.trim()
    || typeof item.fetchedAt !== "string" || Number.isNaN(Date.parse(item.fetchedAt))) {
    throw new Error("MARKET_CALENDAR_INVALID_RESPONSE");
  }
  return item as unknown as TradingDayDecision;
}

export class ChinaMarketCalendarService {
  private readonly remoteUrl?: string;
  private readonly holidays: ReadonlySet<string>;
  private readonly cache = new Map<string, { expiresAt: number; decision: TradingDayDecision }>();
  private readonly now: () => number;

  constructor(options: { remoteUrl?: string; holidays?: ReadonlySet<string>; now?: () => number } = {}) {
    const value = options.remoteUrl?.trim();
    if (value) {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new TypeError("market calendar URL must use HTTP or HTTPS");
      this.remoteUrl = parsed.toString();
    }
    this.holidays = options.holidays ?? new Set();
    this.now = options.now ?? Date.now;
  }

  async decision(exchange: ChinaExchange, date: string): Promise<TradingDayDecision> {
    requireDate(date);
    if (weekend(date) || this.holidays.has(date)) {
      return { exchange, date, isTradingDay: false, source: weekend(date) ? "weekend-rule" : "configured-holiday", fetchedAt: new Date(this.now()).toISOString() };
    }
    if (!this.remoteUrl) return { exchange, date, isTradingDay: true, source: "weekday-fallback", fetchedAt: new Date(this.now()).toISOString() };
    const key = `${exchange}:${date}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.decision;
    const response = await fetch(this.remoteUrl, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ exchange, date })
    });
    if (!response.ok) throw new Error(`MARKET_CALENDAR_HTTP_${response.status}`);
    const decision = parseDecision(await response.json(), exchange, date);
    this.cache.set(key, { decision, expiresAt: this.now() + 6 * 60 * 60 * 1_000 });
    return decision;
  }

  async isTradingDay(exchange: ChinaExchange, date: string): Promise<boolean> {
    try { return (await this.decision(exchange, date)).isTradingDay; }
    catch { return false; }
  }
}

export function parseConfiguredMarketHolidays(value: string | undefined): ReadonlySet<string> {
  if (!value?.trim()) return new Set();
  const dates = value.split(",").map((item) => requireDate(item.trim()));
  return new Set(dates);
}
