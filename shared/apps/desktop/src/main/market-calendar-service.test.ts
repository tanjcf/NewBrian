import assert from "node:assert/strict";
import test from "node:test";
import { ChinaMarketCalendarService, parseConfiguredMarketHolidays } from "./market-calendar-service.ts";

test("rejects weekends and configured holidays before contacting a provider", async () => {
  const originalFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("unexpected"); };
  try {
    const service = new ChinaMarketCalendarService({ remoteUrl: "https://calendar.test", holidays: new Set(["2026-10-01"]) });
    assert.equal(await service.isTradingDay("SSE", "2026-08-22"), false);
    assert.equal(await service.isTradingDay("SSE", "2026-10-01"), false);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("uses a strict exchange calendar response and caches the decision", async () => {
  const originalFetch = globalThis.fetch; let calls = 0; let now = 1_000;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    assert.equal(init?.signal, undefined);
    assert.deepEqual(JSON.parse(String(init?.body)), { exchange: "SSE", date: "2026-08-20" });
    return new Response(JSON.stringify({ exchange: "SSE", date: "2026-08-20", isTradingDay: true, source: "exchange-calendar", fetchedAt: "2026-08-20T00:00:00Z" }), { status: 200 });
  };
  try {
    const service = new ChinaMarketCalendarService({ remoteUrl: "https://calendar.test", now: () => now });
    assert.equal(await service.isTradingDay("SSE", "2026-08-20"), true);
    now += 1_000;
    assert.equal(await service.isTradingDay("SSE", "2026-08-20"), true);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("fails closed when a configured provider is unavailable or mismatched", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("unavailable", { status: 503 });
    assert.equal(await new ChinaMarketCalendarService({ remoteUrl: "https://calendar.test" }).isTradingDay("SSE", "2026-08-20"), false);
    globalThis.fetch = async () => new Response(JSON.stringify({ exchange: "SZSE", date: "2026-08-20", isTradingDay: true, source: "bad", fetchedAt: "2026-08-20T00:00:00Z" }), { status: 200 });
    assert.equal(await new ChinaMarketCalendarService({ remoteUrl: "https://calendar.test" }).isTradingDay("SSE", "2026-08-20"), false);
  } finally { globalThis.fetch = originalFetch; }
});

test("parses administrator-provided holiday dates strictly", () => {
  assert.deepEqual([...parseConfiguredMarketHolidays("2026-10-01,2026-10-02")], ["2026-10-01", "2026-10-02"]);
  assert.throws(() => parseConfiguredMarketHolidays("10/01/2026"), /MARKET_CALENDAR_DATE_INVALID/);
});
