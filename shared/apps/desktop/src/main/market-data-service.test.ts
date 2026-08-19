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

test("market data service normalizes a configured remote response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ bars: [{
    symbol: "A", exchange: "XSHG", timezone: "Asia/Shanghai", interval: "1d", adjustment: "none",
    timestamp: "2026-08-02", open: 2, high: 3, low: 2, close: 3, volume: 20, turnover: 60,
    changePercent: 2, source: { provider: "adapter", dataset: "daily", fetchedAt: "2026-08-02T08:00:00Z" }
  }] }), { status: 200 });
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

test("market data service rejects non-http URLs", () => {
  assert.throws(() => new MarketDataService([], "file:///etc/passwd"), /HTTP or HTTPS/);
});
