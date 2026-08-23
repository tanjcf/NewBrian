import assert from "node:assert/strict";
import test from "node:test";
import { QuantStrategyScheduler, type QuantStrategySchedule, type QuantStrategyScheduleStore } from "./quant-strategy-scheduler.ts";

function schedule(overrides: Partial<QuantStrategySchedule> = {}): QuantStrategySchedule {
  return {
    id: "schedule-1", projectId: "project-1", skillId: "trend", strategyId: "trend-following", exchange: "SSE",
    timezone: "Asia/Shanghai", runAt: "15:10", enabled: true,
    symbol: "600519", quantity: 100, ...overrides
  };
}

function memoryStore(items: QuantStrategySchedule[]): QuantStrategyScheduleStore & { completed: string[] } {
  const claimed = new Set<string>();
  const completed: string[] = [];
  return {
    completed,
    listEnabled: (ownerId) => ownerId === "owner-a" ? items : [],
    claim: (_scheduleId, tradingDate, idempotencyKey) => {
      const key = `${tradingDate}:${idempotencyKey}`;
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    },
    complete: (_scheduleId, tradingDate) => { completed.push(tradingDate); },
    fail: () => undefined
  };
}

test("runs a due strategy once with a stable trading-date idempotency key", async () => {
  const store = memoryStore([schedule()]);
  const calls: Array<Record<string, string>> = [];
  const scheduler = new QuantStrategyScheduler({ store, resolveOwnerId: () => "owner-a", execute: async (input) => { calls.push(input); } });
  const now = new Date("2026-08-20T07:11:00.000Z"); // Thursday 15:11 Asia/Shanghai
  await scheduler.tick(now);
  await scheduler.tick(now);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.tradingDate, "2026-08-20");
  assert.equal(calls[0]?.idempotencyKey, "quant-strategy:schedule-1:2026-08-20");
});

test("does not run before the due time, on weekends, or on configured holidays", async () => {
  const store = memoryStore([schedule()]);
  let calls = 0;
  const scheduler = new QuantStrategyScheduler({
    store,
    resolveOwnerId: () => "owner-a",
    holidays: new Set(["2026-08-21"]),
    execute: async () => { calls += 1; }
  });
  await scheduler.tick(new Date("2026-08-20T07:09:00.000Z"));
  await scheduler.tick(new Date("2026-08-21T07:11:00.000Z"));
  await scheduler.tick(new Date("2026-08-22T07:11:00.000Z"));
  assert.equal(calls, 0);
});

test("records failure without marking a strategy run complete", async () => {
  const failures: string[] = [];
  const store = memoryStore([schedule()]);
  store.fail = (_scheduleId, _date, _key, errorCode) => { failures.push(errorCode); };
  const scheduler = new QuantStrategyScheduler({ store, resolveOwnerId: () => "owner-a", execute: async () => { throw new Error("provider unavailable"); } });
  await scheduler.tick(new Date("2026-08-20T07:11:00.000Z"));
  assert.deepEqual(store.completed, []);
  assert.deepEqual(failures, ["QUANT_STRATEGY_EXECUTION_FAILED"]);
});

test("does not inspect or execute schedules for another local owner", async () => {
  const store = memoryStore([schedule()]);
  let calls = 0;
  const scheduler = new QuantStrategyScheduler({ store, resolveOwnerId: () => "owner-b", execute: async () => { calls += 1; } });
  await scheduler.tick(new Date("2026-08-20T07:11:00.000Z"));
  assert.equal(calls, 0);
});

test("uses the exchange calendar decision before claiming a due run", async () => {
  const store = memoryStore([schedule()]);
  const decisions: string[] = []; let calls = 0;
  const scheduler = new QuantStrategyScheduler({
    store, resolveOwnerId: () => "owner-a",
    isTradingDay: async (exchange, date) => { decisions.push(`${exchange}:${date}`); return false; },
    execute: async () => { calls += 1; }
  });
  await scheduler.tick(new Date("2026-08-20T07:11:00.000Z"));
  assert.deepEqual(decisions, ["SSE:2026-08-20"]);
  assert.equal(calls, 0);
});
