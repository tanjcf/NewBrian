import assert from "node:assert/strict";
import test from "node:test";
import { MarketDataService } from "./market-data-service.ts";

test("market data query filters the local fixture by symbol and date", () => {
  const metadata = { exchange: "XSHG", timezone: "Asia/Shanghai", interval: "1d" as const, adjustment: "none" as const, source: { provider: "fixture", dataset: "daily", fetchedAt: "2026-08-02T00:00:00Z" } };
  const service = new MarketDataService([
    { ...metadata, symbol: "A", timestamp: "2026-08-01", open: 1, high: 2, low: 1, close: 2, volume: 10, turnover: 20, changePercent: 1 },
    { ...metadata, symbol: "A", timestamp: "2026-08-02", open: 2, high: 3, low: 2, close: 3, volume: 20, turnover: 60, changePercent: 2 },
    { ...metadata, symbol: "B", timestamp: "2026-08-02", open: 2, high: 3, low: 2, close: 3, volume: 20, turnover: 60, changePercent: 2 }
  ]);
  assert.equal(service.query({ symbol: "A", interval: "1d", adjustment: "none", startDate: "2026-08-02", endDate: "2026-08-02" }).length, 1);
});

test("market data service normalizes a configured remote response without a fixed execution deadline", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.equal(init?.signal, undefined);
    return new Response(JSON.stringify({ bars: [{
    symbol: "A", exchange: "XSHG", timezone: "Asia/Shanghai", interval: "1d", adjustment: "none",
    timestamp: "2026-08-02", open: 2, high: 3, low: 2, close: 3, volume: 20, turnover: 60,
    changePercent: 2, source: { provider: "adapter", dataset: "daily", fetchedAt: "2026-08-02T08:00:00Z" }
    }] }), { status: 200 });
  };
  try {
    const bars = await new MarketDataService([], "http://market.test").queryAsync({ symbol: "A", interval: "1d", adjustment: "none" });
    assert.equal(bars[0].close, 3);
  } finally { globalThis.fetch = originalFetch; }
});

test("market data service rejects incomplete or impossible remote bars", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ bars: [{ symbol: "A", timestamp: "2026-08-02", open: 4, high: 3, low: 2, close: 3 }] }), { status: 200 });
  try {
    await assert.rejects(
      new MarketDataService([], "http://market.test").queryAsync({ symbol: "A", interval: "1d", adjustment: "none" }),
      /MARKET_DATA_INVALID_BAR/
    );
  } finally { globalThis.fetch = originalFetch; }
});

test("market data service requires a real gateway when fixtures are empty", async () => {
  await assert.rejects(
    new MarketDataService([]).queryAsync({ symbol: "600519", interval: "1d", adjustment: "forward" }),
    /MARKET_DATA_GATEWAY_REQUIRED/
  );
});

test("market data service uses authenticated spring queryRemote before raw URL", async () => {
  const bars = await new MarketDataService([], {
    queryRemote: async (query) => [{
      symbol: query.symbol, exchange: "XSHG", timezone: "Asia/Shanghai", interval: query.interval, adjustment: query.adjustment,
      timestamp: "2026-08-02", open: 2, high: 3, low: 2, close: 3, volume: 20, turnover: 60,
      changePercent: 2, source: { provider: "spring", dataset: "daily", fetchedAt: "2026-08-02T08:00:00Z" }
    }]
  }).queryAsync({ symbol: "A", interval: "1d", adjustment: "none" });
  assert.equal(bars[0].close, 3);
});

test("market data service trims an over-broad monthly provider response to the requested months", async () => {
  const monthly = (timestamp: string) => ({
    symbol: "000001", exchange: "XSHE", timezone: "Asia/Shanghai", interval: "1mo" as const, adjustment: "none" as const,
    timestamp, open: 10, high: 12, low: 9, close: 11, volume: 100, turnover: 1_100,
    changePercent: 1, source: { provider: "adapter", dataset: "monthly", fetchedAt: "2026-08-20T08:00:00Z" }
  });
  const bars = await new MarketDataService([], {
    queryRemote: async () => [monthly("2025-12-31T15:00:00+08:00"), monthly("2026-02-28T15:00:00+08:00"), monthly("2026-08-31T15:00:00+08:00")]
  }).queryAsync({ symbol: "000001", interval: "1mo", adjustment: "none", startDate: "2026-02-01", endDate: "2026-08-23" });
  assert.deepEqual(bars.map((bar) => bar.timestamp.slice(0, 7)), ["2026-02", "2026-08"]);
});

test("market data service rejects non-http URLs", () => {
  assert.throws(() => new MarketDataService([], "file:///etc/passwd"), /HTTP or HTTPS/);
});

test("provider contract preserves daily weekly monthly range and every adjustment mode", async () => {
  const originalFetch = globalThis.fetch;
  const requests: unknown[] = [];
  globalThis.fetch = async (_url, init) => {
    const query = JSON.parse(String(init?.body)) as { symbol: string; interval: "1d" | "1w" | "1mo"; adjustment: "forward" | "backward" | "none"; startDate: string; endDate: string };
    requests.push(query);
    return new Response(JSON.stringify({ bars: [{
      symbol: query.symbol, exchange: "XSHG", timezone: "Asia/Shanghai", interval: query.interval, adjustment: query.adjustment,
      timestamp: `${query.endDate}T15:00:00+08:00`, open: 10, high: 12, low: 9, close: 11, volume: 100, turnover: 1_100,
      changePercent: 1, source: { provider: "adapter", dataset: `${query.interval}-${query.adjustment}`, fetchedAt: "2026-08-20T08:00:00Z" }
    }] }), { status: 200 });
  };
  try {
    const service = new MarketDataService([], "http://market.test/query");
    for (const interval of ["1d", "1w", "1mo"] as const) {
      for (const adjustment of ["forward", "backward", "none"] as const) {
        const result = await service.queryAsync({ symbol: "600519", interval, adjustment, startDate: "2026-01-01", endDate: "2026-08-20" });
        assert.equal(result[0]?.interval, interval);
        assert.equal(result[0]?.adjustment, adjustment);
        assert.equal(result[0]?.source.dataset, `${interval}-${adjustment}`);
      }
    }
    assert.equal(requests.length, 9);
    assert.ok(requests.every((request: any) => request.startDate === "2026-01-01" && request.endDate === "2026-08-20"));
  } finally { globalThis.fetch = originalFetch; }
});
