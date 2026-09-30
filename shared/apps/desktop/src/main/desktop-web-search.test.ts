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
  assert.equal(assertAnswerAllowsFreshnessClaims({ answer: "你好！我现在可以帮你。" }).ok, true);
  assert.equal(assertAnswerAllowsFreshnessClaims({ answer: "你好，当前项目是 ces。" }).ok, true);
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

test("paid search client maps Spring edition/cacheHit and payment error bodies", async () => {
  const okClient = new DesktopWebSearchClient({
    readGatewayOrigin: async () => "https://gateway.example",
    readAccessToken: async () => "token",
    createHeaders: ({ accessToken }) => ({ Authorization: `Bearer ${accessToken}` }),
    fetchImpl: (async () => new Response(JSON.stringify({
      ok: true,
      data: {
        query: "贵州茅台",
        provider: "baidu_qianfan",
        searchedAt: "2026-09-25T00:00:00.000Z",
        edition: "standard",
        cacheHit: true,
        items: [{
          title: "公告",
          url: "https://example.com/a",
          siteName: "上交所",
          snippet: "扩产",
          summary: "扩产",
          publishedAt: "2026-09-24"
        }]
      }
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch
  });
  const ok = await okClient.search({ query: "贵州茅台" });
  assert.equal(ok.provider, "baidu_qianfan");
  assert.equal(ok.edition, "standard");
  assert.equal(ok.cacheHit, true);
  assert.equal(ok.items[0]?.url, "https://example.com/a");

  const payClient = new DesktopWebSearchClient({
    readGatewayOrigin: async () => "https://gateway.example",
    readAccessToken: async () => "token",
    createHeaders: ({ accessToken }) => ({ Authorization: `Bearer ${accessToken}` }),
    fetchImpl: (async () => new Response(JSON.stringify({
      ok: false,
      code: "WEB_SEARCH_PAYMENT_REQUIRED",
      message: "WEB_SEARCH_PAYMENT_REQUIRED: daily cost quota exceeded"
    }), { status: 402, headers: { "Content-Type": "application/json" } })) as typeof fetch
  });
  await assert.rejects(
    () => payClient.search({ query: "贵州茅台" }),
    (error: unknown) => error instanceof DesktopWebSearchError
      && error.code === "WEB_SEARCH_PAYMENT_REQUIRED"
      && /daily cost quota exceeded/.test(error.message)
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
    search: async () => ({
      query: "q",
      provider: "bocha",
      searchedAt: "2026-08-20T00:00:00.000Z",
      edition: "",
      cacheHit: false,
      items: []
    }),
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
      items: [],
      fetches: [],
      fetchAttempted: false
    }),
    fetchPage: async () => ({ url: "https://example.com", title: "", text: "", status: "empty", statusCode: 0 })
  });
  assert.ok(tools.has("web.fetch_page"));
  const result = await tools.get("web.search_paid")!({ query: "q" }) as { details: { status: string; code: string }; isError?: boolean };
  assert.equal(result.details.status, "unavailable");
  assert.equal(result.details.code, "WEB_SEARCH_EMPTY");
  assert.equal(result.isError, true);
});

test("web.search_paid surfaces baidu edition and treats provider none as unavailable", async () => {
  const tools = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>();
  registerDesktopWebSearchTools({
    unregisterExternalTools: () => undefined,
    registerExternalTool: (definition, execute) => {
      tools.set(String(definition.name), execute);
    }
  }, {
    search: async () => ({
      query: "q",
      provider: "baidu_qianfan",
      searchedAt: "2026-09-25T00:00:00.000Z",
      edition: "enhanced",
      cacheHit: false,
      items: [{
        title: "新闻",
        url: "https://example.com/n",
        siteName: "财联社",
        snippet: "摘要",
        summary: "摘要",
        publishedAt: "2026-09-24"
      }]
    }),
    searchMarketNews: async () => ({
      query: "q",
      searchedAt: "2026-09-25T00:00:00.000Z",
      decision: "NONE",
      status: "unavailable",
      message: "",
      complete: false,
      paidAttempted: false,
      paidSucceeded: false,
      sourceTypesUsed: [],
      items: [],
      fetches: [],
      fetchAttempted: false
    }),
    fetchPage: async () => ({ url: "https://example.com", title: "", text: "", status: "empty", statusCode: 0 })
  });
  const ok = await tools.get("web.search_paid")!({ query: "q" }) as {
    ok: boolean;
    output: string;
    details: { status: string; provider: string; edition: string; cacheHit: boolean };
  };
  // The agent loop only sends ok/output to the model; without them every search
  // looks empty and the run stalls with "no tool progress".
  assert.equal(ok.ok, true);
  assert.match(ok.output, /https:\/\/example\.com\/n/);
  assert.equal(ok.details.status, "ok");
  assert.equal(ok.details.provider, "baidu_qianfan");
  assert.equal(ok.details.edition, "enhanced");
  assert.equal(ok.details.cacheHit, false);

  registerDesktopWebSearchTools({
    unregisterExternalTools: () => undefined,
    registerExternalTool: (definition, execute) => {
      tools.set(String(definition.name), execute);
    }
  }, {
    search: async () => ({
      query: "q",
      provider: "none",
      searchedAt: "2026-09-25T00:00:00.000Z",
      edition: "",
      cacheHit: false,
      items: []
    }),
    searchMarketNews: async () => ({
      query: "q",
      searchedAt: "2026-09-25T00:00:00.000Z",
      decision: "NONE",
      status: "unavailable",
      message: "",
      complete: false,
      paidAttempted: false,
      paidSucceeded: false,
      sourceTypesUsed: [],
      items: [],
      fetches: [],
      fetchAttempted: false
    }),
    fetchPage: async () => ({ url: "https://example.com", title: "", text: "", status: "empty", statusCode: 0 })
  });
  const empty = await tools.get("web.search_paid")!({ query: "q" }) as {
    ok: boolean;
    output: string;
    details: { status: string; code: string };
    isError?: boolean;
  };
  assert.equal(empty.ok, false);
  assert.match(empty.output, /WEB_SEARCH_UNAVAILABLE/);
  assert.equal(empty.details.status, "unavailable");
  assert.equal(empty.details.code, "WEB_SEARCH_UNAVAILABLE");
  assert.equal(empty.isError, true);
});

test("web.search_paid tells the user when the orchestrator reports insufficient balance", async () => {
  const client = new DesktopWebSearchClient({
    readGatewayOrigin: async () => "https://gateway.example",
    readAccessToken: async () => "token",
    createHeaders: ({ accessToken }) => ({ Authorization: `Bearer ${accessToken}` }),
    fetchImpl: (async () => new Response(JSON.stringify({
      ok: true,
      data: {
        query: "贵州茅台",
        provider: "none",
        searchedAt: "2026-09-27T00:00:00.000Z",
        edition: "",
        cacheHit: false,
        items: [],
        status: "unavailable",
        message: "WEB_SEARCH_PAYMENT_REQUIRED: insufficient balance"
      }
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch
  });
  const raw = await client.search({ query: "贵州茅台" });
  assert.equal(raw.status, "unavailable");
  assert.match(raw.message ?? "", /WEB_SEARCH_PAYMENT_REQUIRED/);

  const tools = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>();
  registerDesktopWebSearchTools({
    unregisterExternalTools: () => undefined,
    registerExternalTool: (definition, execute) => {
      tools.set(String(definition.name), execute);
    }
  }, {
    search: (input) => client.search(input),
    searchMarketNews: async () => { throw new Error("unused"); },
    fetchPage: async () => ({ url: "https://example.com", title: "", text: "", status: "empty", statusCode: 0 })
  });
  const result = await tools.get("web.search_paid")!({ query: "贵州茅台" }) as {
    details: { code: string; message: string };
    isError?: boolean;
  };
  assert.equal(result.details.code, "WEB_SEARCH_PAYMENT_REQUIRED");
  assert.match(result.details.message, /联网搜索余额不足/);
  assert.equal(result.isError, true);
});

test("a thrown budget error keeps its code and Chinese hint", async () => {
  const tools = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>();
  registerDesktopWebSearchTools({
    unregisterExternalTools: () => undefined,
    registerExternalTool: (definition, execute) => {
      tools.set(String(definition.name), execute);
    }
  }, {
    search: async () => { throw new DesktopWebSearchError("WEB_SEARCH_BUDGET_EXCEEDED", "daily paid search budget exhausted"); },
    searchMarketNews: async () => { throw new DesktopWebSearchError("WEB_SEARCH_BUDGET_EXCEEDED", "daily paid search budget exhausted"); },
    fetchPage: async () => ({ url: "https://example.com", title: "", text: "", status: "empty", statusCode: 0 })
  });
  for (const name of ["web.search_paid", "news_search_free"]) {
    const result = await tools.get(name)!({ query: "q" }) as { details: { code: string; message: string } };
    assert.equal(result.details.code, "WEB_SEARCH_BUDGET_EXCEEDED");
    assert.match(result.details.message, /今日联网搜索额度已用完/);
  }
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
          }],
          fetches: [{
            url: "https://example.com/news/1",
            title: "扩产公告",
            text: "公司宣布扩产全文",
            status: "ok",
            statusCode: 200
          }],
          fetchAttempted: true
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
  assert.equal(result.fetchAttempted, true);
  assert.equal(result.fetches[0]?.text, "公司宣布扩产全文");
});

test("news_search_free prefers free-first pack and surfaces unavailable guidance", async () => {
  const tools = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>();
  registerDesktopWebSearchTools({
    unregisterExternalTools: () => undefined,
    registerExternalTool: (definition, execute) => {
      tools.set(String(definition.name), execute);
    }
  }, {
    search: async () => ({
      query: "q",
      provider: "bocha",
      searchedAt: "2026-08-20T00:00:00.000Z",
      edition: "",
      cacheHit: false,
      items: []
    }),
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
      items: [],
      fetches: [],
      fetchAttempted: false
    }),
    fetchPage: async () => ({ url: "https://example.com", title: "", text: "", status: "empty", statusCode: 0 })
  });
  assert.ok(tools.has("news_search_free"));
  assert.ok(tools.has("web.fetch_page"));
  const result = await tools.get("news_search_free")!({ query: "最新利率" }) as {
    details: { status: string; code: string; message: string; searchedAt: string };
    isError?: boolean;
  };
  assert.equal(result.details.status, "unavailable");
  assert.equal(result.details.code, "WEB_SEARCH_DISABLED");
  assert.match(result.details.message, /WEB_SEARCH_DISABLED/);
  assert.match(result.details.message, /管理员已关闭联网搜索/);
  assert.equal(result.details.searchedAt, "2026-08-20T12:00:00.000Z");
  assert.equal(result.isError, true);
});

test("finalizes assistant answers by attaching citations only; never rewrites into WEB_SEARCH prompts", async () => {
  const { finalizeDesktopWebSearchAnswer } = await import("./desktop-web-search-policy.ts");
  // No search this turn — keep the model answer as-is (including casual 现在/当前).
  assert.equal(
    finalizeDesktopWebSearchAnswer({ answer: "你好！我现在可以帮你。", toolTexts: [] }),
    "你好！我现在可以帮你。"
  );
  assert.equal(
    finalizeDesktopWebSearchAnswer({ answer: "最新股价已经上涨", toolTexts: [] }),
    "最新股价已经上涨"
  );

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

test("does not treat local runtime handoff state as an external freshness claim", async () => {
  const { finalizeDesktopWebSearchAnswer } = await import("./desktop-web-search-policy.ts");
  const answer = "目标没有产生进度，可从当前持久化步骤继续。";
  assert.equal(finalizeDesktopWebSearchAnswer({ answer, toolTexts: [] }), answer);
});
