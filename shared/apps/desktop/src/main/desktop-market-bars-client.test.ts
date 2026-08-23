import assert from "node:assert/strict";
import test from "node:test";
import { DesktopMarketBarsClient } from "./desktop-market-bars-client.ts";

test("desktop market bars client posts to spring with session auth", async () => {
  const calls: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
  const client = new DesktopMarketBarsClient({
    readGatewayOrigin: async () => "https://gateway.test",
    readAccessToken: async () => "token-1",
    createHeaders: ({ accessToken }) => ({ Authorization: `Bearer ${accessToken}` }),
    fetchImpl: async (url, init) => {
      calls.push({
        url: String(url),
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body))
      });
      return new Response(JSON.stringify({
        ok: true,
        data: {
          bars: [{
            symbol: "600519",
            exchange: "XSHG",
            timezone: "Asia/Shanghai",
            interval: "1d",
            adjustment: "forward",
            timestamp: "2026-08-02",
            open: 2,
            high: 3,
            low: 2,
            close: 3,
            volume: 20,
            turnover: 60,
            changePercent: 2,
            source: { provider: "akshare-adapter", dataset: "daily", fetchedAt: "2026-08-02T08:00:00Z" }
          }]
        }
      }), { status: 200 });
    }
  });

  const bars = await client.queryBars({
    symbol: "600519",
    interval: "1d",
    adjustment: "forward",
    startDate: "2026-01-01",
    endDate: "2026-08-02"
  });

  assert.equal(bars[0]?.close, 3);
  assert.equal(calls[0]?.url, "https://gateway.test/api/desktop/v1/market-bars");
  assert.equal(calls[0]?.headers.Authorization, "Bearer token-1");
  assert.equal((calls[0]?.body as { symbol: string }).symbol, "600519");
});

test("desktop market bars client requires desktop session", async () => {
  const client = new DesktopMarketBarsClient({
    readGatewayOrigin: async () => "https://gateway.test",
    readAccessToken: async () => "",
    createHeaders: () => ({}),
    fetchImpl: async () => new Response("{}", { status: 200 })
  });
  await assert.rejects(
    client.queryBars({ symbol: "600519", interval: "1d", adjustment: "none" }),
    /MARKET_BARS_AUTH_REQUIRED|Desktop session/
  );
});
