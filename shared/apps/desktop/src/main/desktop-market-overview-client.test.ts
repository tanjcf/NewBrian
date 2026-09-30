import assert from "node:assert/strict";
import test from "node:test";
import { DesktopMarketOverviewClient } from "./desktop-market-overview-client.ts";

const overview = Object.fromEntries(
  ["indices", "industries", "concepts", "fundFlows", "limitUps"].map((key) => [key, { dataset: key, fetchedAt: "2026-08-24T09:30:00+08:00", items: [] }])
);

test("market overview uses the authenticated Spring endpoint and clamps limit", async () => {
  let requestedUrl = "";
  let requestedHeaders: HeadersInit | undefined;
  const client = new DesktopMarketOverviewClient({
    readGatewayOrigin: async () => "http://127.0.0.1:8790/",
    readAccessToken: async () => "desktop-token",
    createHeaders: ({ accessToken }) => ({ Authorization: `Bearer ${accessToken}`, "X-Desktop": "1" }),
    fetchImpl: async (input, init) => {
      requestedUrl = String(input);
      requestedHeaders = init?.headers;
      return new Response(JSON.stringify({ ok: true, data: overview }), { status: 200 });
    }
  });
  const result = await client.queryOverview(500);
  assert.equal(requestedUrl, "http://127.0.0.1:8790/api/desktop/v1/market-overview?limit=100");
  assert.deepEqual(requestedHeaders, { Authorization: "Bearer desktop-token", "X-Desktop": "1" });
  assert.deepEqual(result.indices.items, []);
});

test("market overview requires a desktop session before fetching", async () => {
  let fetched = false;
  const client = new DesktopMarketOverviewClient({
    readGatewayOrigin: async () => "http://127.0.0.1:8790",
    readAccessToken: async () => "",
    createHeaders: () => ({}),
    fetchImpl: async () => { fetched = true; return new Response(); }
  });
  await assert.rejects(() => client.queryOverview(), /Desktop session is required/u);
  assert.equal(fetched, false);
});

test("market overview rejects incomplete section payloads", async () => {
  const client = new DesktopMarketOverviewClient({
    readGatewayOrigin: async () => "http://127.0.0.1:8790",
    readAccessToken: async () => "desktop-token",
    createHeaders: () => ({}),
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, data: { indices: { items: [] } } }), { status: 200 })
  });
  await assert.rejects(() => client.queryOverview(), /section industries is invalid/u);
});

test("market screener posts criteria to the authenticated Spring endpoint", async () => {
  let body = "";
  const client = new DesktopMarketOverviewClient({
    readGatewayOrigin: async () => "http://127.0.0.1:8790",
    readAccessToken: async () => "desktop-token",
    createHeaders: () => ({ Authorization: "Bearer desktop-token" }),
    fetchImpl: async (_input, init) => {
      body = String(init?.body || "");
      return new Response(JSON.stringify({ ok: true, data: { dataset: "stock_zh_a_spot_em", fetchedAt: "2026-08-24T10:00:00+08:00", criteria: {}, items: [{ code: "600519" }] } }), { status: 200 });
    }
  });
  const result = await client.queryScreener({ maxPe: 25, limit: 30 });
  assert.deepEqual(JSON.parse(body), { maxPe: 25, limit: 30 });
  assert.equal(result.items[0]?.code, "600519");
});
