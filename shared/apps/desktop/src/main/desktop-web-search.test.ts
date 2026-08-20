import assert from "node:assert/strict";
import test from "node:test";
import { DesktopWebSearchClient, DesktopWebSearchError } from "./desktop-web-search-client.ts";
import {
  assertAnswerAllowsFreshnessClaims,
  attachDesktopWebSearchCitations,
  formatDesktopWebSearchUnavailable
} from "./desktop-web-search-policy.ts";
import { registerDesktopWebSearchTools } from "./desktop-web-search-tools.ts";

test("formats explicit unavailable guidance without freshness invention", () => {
  const text = formatDesktopWebSearchUnavailable("gateway down");
  assert.match(text, /WEB_SEARCH_UNAVAILABLE/);
  assert.match(text, /gateway down/);
  assert.match(text, /Do not invent current facts/);
});

test("blocks freshness claims without searchedAt and source URLs", () => {
  assert.equal(assertAnswerAllowsFreshnessClaims({ answer: "普通知识回答" }).ok, true);
  assert.equal(assertAnswerAllowsFreshnessClaims({
    answer: "最新股价已经上涨",
    searchedAt: "",
    sourceUrls: []
  }).ok, false);
  assert.equal(assertAnswerAllowsFreshnessClaims({
    answer: "最新公告显示扩产",
    searchedAt: "2026-08-20T00:00:00.000Z",
    sourceUrls: ["https://example.com/news"]
  }).ok, true);
});

test("attaches source URLs and searchedAt citation block", () => {
  const text = attachDesktopWebSearchCitations({
    answer: "市场情绪偏暖。",
    searchedAt: "2026-08-20T12:00:00.000Z",
    items: [{ title: "示例新闻", url: "https://example.com/a", publishedAt: "2026-08-19" }]
  });
  assert.match(text, /检索时间 2026-08-20T12:00:00.000Z/);
  assert.match(text, /https:\/\/example\.com\/a/);
});

test("paid search client never accepts empty auth and maps HTTP failures", async () => {
  await assert.rejects(
    () => new DesktopWebSearchClient({
      readGatewayOrigin: async () => "https://gateway.example",
      readAccessToken: async () => "",
      createHeaders: () => ({})
    }).search({ query: "最新利率" }),
    (error: unknown) => error instanceof DesktopWebSearchError && error.code === "WEB_SEARCH_AUTH_REQUIRED"
  );

  const client = new DesktopWebSearchClient({
    readGatewayOrigin: async () => "https://gateway.example",
    readAccessToken: async () => "token",
    createHeaders: ({ accessToken }) => ({ Authorization: `Bearer ${accessToken}` }),
    fetchImpl: (async () => new Response("nope", { status: 503 })) as typeof fetch
  });
  await assert.rejects(
    () => client.search({ query: "最新利率" }),
    (error: unknown) => error instanceof DesktopWebSearchError && error.code === "WEB_SEARCH_HTTP_503"
  );
});

test("registers web.search_paid tool and returns unavailable payload on empty results", async () => {
  const tools = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>();
  registerDesktopWebSearchTools({
    unregisterExternalTools: () => undefined,
    registerExternalTool: (definition, execute) => {
      tools.set(String(definition.name), execute);
    }
  }, {
    search: async () => ({ query: "q", provider: "bocha", searchedAt: "2026-08-20T00:00:00.000Z", items: [] }),
    searchMarketNews: async () => ({
      query: "q",
      searchedAt: "2026-08-20T00:00:00.000Z",
      decision: "NONE",
      status: "unavailable",
      message: "",
      complete: false,
      paidAttempted: false,
      paidSucceeded: false,
      sourceTypesUsed: [],
      items: []
    })
  });
  const result = await tools.get("web.search_paid")!({ query: "q" }) as { details: { status: string; code: string }; isError?: boolean };
  assert.equal(result.details.status, "unavailable");
  assert.equal(result.details.code, "WEB_SEARCH_EMPTY");
  assert.equal(result.isError, true);
});

test("market news client maps orchestrator evidence pack and never logs tokens", async () => {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const client = new DesktopWebSearchClient({
    readGatewayOrigin: async () => "https://gateway.example/",
    readAccessToken: async () => "secret-token",
    createHeaders: ({ accessToken }) => ({ Authorization: `Bearer ${accessToken}` }),
    fetchImpl: (async (url, init) => {
      calls.push({
        url: String(url),
        headers: Object.fromEntries(Object.entries((init?.headers || {}) as Record<string, string>))
      });
      return new Response(JSON.stringify({
        ok: true,
        data: {
          query: "贵州茅台最新公告",
          searchedAt: "2026-08-20T12:00:00.000Z",
          decision: "FREE_ONLY",
          status: "ok",
          message: "",
          complete: true,
          paidAttempted: false,
          paidSucceeded: false,
          sourceTypesUsed: ["akshare"],
          items: [{
            evidenceId: "e1",
            title: "扩产公告",
            url: "https://example.com/news/1",
            source: "财联社",
            publishedAt: "2026-08-19",
            snippet: "公司宣布扩产",
            sourceType: "akshare"
          }]
        }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch
  });

  const result = await client.searchMarketNews({ query: "贵州茅台最新公告" });
  assert.equal(calls[0]?.url, "https://gateway.example/api/desktop/v1/market-news-search");
  assert.equal(calls[0]?.headers.Authorization, "Bearer secret-token");
  assert.equal(result.decision, "FREE_ONLY");
  assert.equal(result.items[0]?.url, "https://example.com/news/1");
  assert.equal(result.items[0]?.siteName, "财联社");
  assert.equal(result.sourceTypesUsed[0], "akshare");
});

test("news_search_free prefers free-first pack and surfaces unavailable guidance", async () => {
  const tools = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>();
  registerDesktopWebSearchTools({
    unregisterExternalTools: () => undefined,
    registerExternalTool: (definition, execute) => {
      tools.set(String(definition.name), execute);
    }
  }, {
    search: async () => ({ query: "q", provider: "bocha", searchedAt: "2026-08-20T00:00:00.000Z", items: [] }),
    searchMarketNews: async () => ({
      query: "最新利率",
      searchedAt: "2026-08-20T12:00:00.000Z",
      decision: "NONE",
      status: "unavailable",
      message: "WEB_SEARCH_DISABLED: administrator disabled web search",
      complete: false,
      paidAttempted: false,
      paidSucceeded: false,
      sourceTypesUsed: [],
      items: []
    })
  });
  assert.ok(tools.has("news_search_free"));
  const result = await tools.get("news_search_free")!({ query: "最新利率" }) as {
    details: { status: string; code: string; message: string; searchedAt: string };
    isError?: boolean;
  };
  assert.equal(result.details.status, "unavailable");
  assert.equal(result.details.code, "WEB_SEARCH_UNAVAILABLE");
  assert.match(result.details.message, /WEB_SEARCH_DISABLED/);
  assert.equal(result.details.searchedAt, "2026-08-20T12:00:00.000Z");
  assert.equal(result.isError, true);
});

test("finalizes assistant answers with search citations or blocks unsupported freshness", async () => {
  const { finalizeDesktopWebSearchAnswer } = await import("./desktop-web-search-policy.ts");
  const blocked = finalizeDesktopWebSearchAnswer({
    answer: "最新股价已经上涨",
    toolTexts: []
  });
  assert.match(blocked, /WEB_SEARCH_UNAVAILABLE/);

  const cited = finalizeDesktopWebSearchAnswer({
    answer: "市场情绪偏暖。",
    toolTexts: [JSON.stringify({
      status: "ok",
      searchedAt: "2026-08-20T12:00:00.000Z",
      items: [{ title: "示例", url: "https://example.com/a", publishedAt: "2026-08-19" }]
    })]
  });
  assert.match(cited, /来源（检索时间 2026-08-20T12:00:00.000Z）/);
  assert.match(cited, /https:\/\/example\.com\/a/);
});
