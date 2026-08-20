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
    search: async () => ({ query: "q", provider: "bocha", searchedAt: "2026-08-20T00:00:00.000Z", items: [] })
  });
  const result = await tools.get("web.search_paid")!({ query: "q" }) as { details: { status: string; code: string }; isError?: boolean };
  assert.equal(result.details.status, "unavailable");
  assert.equal(result.details.code, "WEB_SEARCH_EMPTY");
  assert.equal(result.isError, true);
});
