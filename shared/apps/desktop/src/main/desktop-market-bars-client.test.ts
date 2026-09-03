import assert from "node:assert/strict";
import test from "node:test";
import { DesktopMarketBarsClient } from "./desktop-market-bars-client.ts";

test("desktop market bars client posts to spring with session auth", async () => {
  const calls: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
  const client = new DesktopMarketBarsClient({
    readGatewayOrigin: async () => "https://gateway.test",
    readAccessToken: async () => "token-1",
    refreshAccessToken: async () => "token-2",
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
    refreshAccessToken: async () => "",
    createHeaders: () => ({}),
    fetchImpl: async () => new Response("{}", { status: 200 })
  });
  await assert.rejects(
    client.queryBars({ symbol: "600519", interval: "1d", adjustment: "none" }),
    /MARKET_BARS_AUTH_REQUIRED|Desktop session/
  );
});

test("desktop market bars client refreshes a missing access token before the first request", async () => {
  const authorizationHeaders: string[] = [];
  const client = new DesktopMarketBarsClient({
    readGatewayOrigin: async () => "https://gateway.test",
    readAccessToken: async () => "",
    refreshAccessToken: async () => "refreshed-token",
    createHeaders: ({ accessToken }) => ({ Authorization: `Bearer ${accessToken}` }),
    fetchImpl: async (_url, init) => {
      authorizationHeaders.push((init?.headers as Record<string, string>).Authorization);
      return new Response(JSON.stringify({ ok: true, data: { bars: [] } }), { status: 200 });
    }
  });

  const bars = await client.queryBars({ symbol: "600519", interval: "1d", adjustment: "none" });

  assert.deepEqual(bars, []);
  assert.deepEqual(authorizationHeaders, ["Bearer refreshed-token"]);
});

test("desktop market bars client refreshes rejected session auth and retries once", async () => {
  const authorizationHeaders: string[] = [];
  let refreshCount = 0;
  const client = new DesktopMarketBarsClient({
    readGatewayOrigin: async () => "https://gateway.test",
    readAccessToken: async () => "expired-token",
    refreshAccessToken: async () => {
      refreshCount += 1;
      return "refreshed-token";
    },
    createHeaders: ({ accessToken }) => ({ Authorization: `Bearer ${accessToken}` }),
    fetchImpl: async (_url, init) => {
      authorizationHeaders.push((init?.headers as Record<string, string>).Authorization);
      if (authorizationHeaders.length === 1) {
        return new Response(JSON.stringify({ ok: false }), { status: 401 });
      }
      return new Response(JSON.stringify({ ok: true, data: { bars: [] } }), { status: 200 });
    }
  });

  const bars = await client.queryBars({ symbol: "600519", interval: "1d", adjustment: "none" });

  assert.deepEqual(bars, []);
  assert.equal(refreshCount, 1);
  assert.deepEqual(authorizationHeaders, ["Bearer expired-token", "Bearer refreshed-token"]);
});

test("desktop market bars client does not retry more than once after refreshed auth is rejected", async () => {
  let requestCount = 0;
  const client = new DesktopMarketBarsClient({
    readGatewayOrigin: async () => "https://gateway.test",
    readAccessToken: async () => "expired-token",
    refreshAccessToken: async () => "still-rejected-token",
    createHeaders: ({ accessToken }) => ({ Authorization: `Bearer ${accessToken}` }),
    fetchImpl: async () => {
      requestCount += 1;
      return new Response(JSON.stringify({ ok: false }), { status: 401 });
    }
  });

  await assert.rejects(
    client.queryBars({ symbol: "600519", interval: "1d", adjustment: "none" }),
    /MARKET_BARS_HTTP_401|HTTP 401/
  );
  assert.equal(requestCount, 2);
});

test("desktop market bars client preserves spring upstream error details", async () => {
  const client = new DesktopMarketBarsClient({
    readGatewayOrigin: async () => "https://gateway.test",
    readAccessToken: async () => "token-1",
    refreshAccessToken: async () => "token-2",
    createHeaders: ({ accessToken }) => ({ Authorization: `Bearer ${accessToken}` }),
    fetchImpl: async () => new Response(JSON.stringify({
      ok: false,
      code: "MARKET_UPSTREAM_BAD_GATEWAY",
      message: "market data response missing bars",
      request_id: "req_market_1"
    }), { status: 502, headers: { "Content-Type": "application/json" } })
  });

  await assert.rejects(
    client.queryBars({ symbol: "600519", interval: "1d", adjustment: "none" }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "MARKET_UPSTREAM_BAD_GATEWAY");
      assert.match(String((error as Error).message), /market data response missing bars/);
      assert.match(String((error as Error).message), /req_market_1/);
      return true;
    }
  );
});
