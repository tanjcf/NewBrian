export type ChinaExchange = "SSE" | "SZSE" | "BSE";

export interface QuantStrategySchedule {
  id: string;
  projectId: string;
  skillId: string;
  strategyId: "trend-following" | "mean-reversion";
  exchange: ChinaExchange;
  timezone: "Asia/Shanghai";
  runAt: string;
  enabled: boolean;
  symbol: string;
  quantity: number;
}

export interface QuantStrategyExecution {
  scheduleId: string;
  projectId: string;
  skillId: string;
  strategyId: "trend-following" | "mean-reversion";
  exchange: ChinaExchange;
  tradingDate: string;
  idempotencyKey: string;
  symbol: string;
  quantity: number;
}

export interface QuantStrategyRun {
  scheduleId: string;
  tradingDate: string;
  idempotencyKey: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  attempt: number;
  errorCode: string;
  errorDetail: string;
  startedAt: string;
  finishedAt: string;
}

export interface QuantStrategyScheduleStore {
  listEnabled(ownerId: string): QuantStrategySchedule[];
  claim(scheduleId: string, tradingDate: string, idempotencyKey: string): boolean;
  complete(scheduleId: string, tradingDate: string, idempotencyKey: string): void;
  fail(scheduleId: string, tradingDate: string, idempotencyKey: string, errorCode: string, errorDetail: string): void;
}

function localClock(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`,
    weekday: value("weekday")
  };
}

function validRunAt(value: string) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value)) throw new TypeError("QUANT_SCHEDULE_TIME_INVALID");
  return value;
}

export class QuantStrategyScheduler {
  private readonly store: QuantStrategyScheduleStore;
  private readonly execute: (input: QuantStrategyExecution) => Promise<void>;
  private readonly holidays: ReadonlySet<string>;
  private readonly resolveOwnerId: () => Promise<string> | string;
  private readonly resolveTradingDay?: (exchange: ChinaExchange, date: string) => Promise<boolean> | boolean;

  constructor(options: {
    store: QuantStrategyScheduleStore;
    execute: (input: QuantStrategyExecution) => Promise<void>;
    resolveOwnerId: () => Promise<string> | string;
    holidays?: ReadonlySet<string>;
    isTradingDay?: (exchange: ChinaExchange, date: string) => Promise<boolean> | boolean;
  }) {
    this.store = options.store;
    this.execute = options.execute;
    this.resolveOwnerId = options.resolveOwnerId;
    this.holidays = options.holidays ?? new Set();
    this.resolveTradingDay = options.isTradingDay;
  }

  async tick(now = new Date()): Promise<void> {
    const ownerId = (await this.resolveOwnerId()).trim();
    if (!ownerId) return;
    for (const schedule of this.store.listEnabled(ownerId)) {
      if (!schedule.enabled) continue;
      const clock = localClock(now, schedule.timezone);
      const defaultTradingDay = clock.weekday !== "Sat" && clock.weekday !== "Sun" && !this.holidays.has(clock.date);
      const tradingDay = this.resolveTradingDay ? await this.resolveTradingDay(schedule.exchange, clock.date) : defaultTradingDay;
      if (!tradingDay) continue;
      if (clock.time < validRunAt(schedule.runAt)) continue;
      const idempotencyKey = `quant-strategy:${schedule.id}:${clock.date}`;
      if (!this.store.claim(schedule.id, clock.date, idempotencyKey)) continue;
      const execution: QuantStrategyExecution = {
        scheduleId: schedule.id, projectId: schedule.projectId, skillId: schedule.skillId, strategyId: schedule.strategyId,
        exchange: schedule.exchange, tradingDate: clock.date, idempotencyKey,
        symbol: schedule.symbol, quantity: schedule.quantity
      };
      try {
        await this.execute(execution);
        this.store.complete(schedule.id, clock.date, idempotencyKey);
      } catch (error) {
        this.store.fail(schedule.id, clock.date, idempotencyKey, "QUANT_STRATEGY_EXECUTION_FAILED", error instanceof Error ? error.message : String(error));
      }
    }
  }
}
