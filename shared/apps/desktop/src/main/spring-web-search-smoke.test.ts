/**
 * SPRING-WEB-SEARCH-SMOKE-001
 * Packaging must run this case and stop when it fails.
 * Brain may expose only Spring POST /api/desktop/v1/web-search.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildAutoModeOrchestratorInstruction } from "./auto-orchestrator-policy.ts";
import { DesktopWebSearchClient } from "./desktop-web-search-client.ts";
import { registerDesktopWebSearchTools } from "./desktop-web-search-tools.ts";
import { buildResearchLeadInstruction, buildResearchPlan } from "./research-plan-policy.ts";

const CASE_ID = "SPRING-WEB-SEARCH-SMOKE-001";
const SPRING_SEARCH_PATH = "/api/desktop/v1/web-search";
const SPRING_SEARCH_PATTERN = /\/api\/desktop\/v1\/web-search/;
const FORBIDDEN_SEARCH = /news_search_free|web\.search_paid|market-news-search|searchMarketNews/;
const here = dirname(fileURLToPath(import.meta.url));

function readProductSource(relativePath: string): string {
  return readFileSync(join(here, relativePath), "utf8");
}

test(`${CASE_ID} registers only Spring web.search for news and the open web`, async () => {
  const calls: string[] = [];
  const tools = new Map<string, { description: string; execute: (input: Record<string, unknown>) => Promise<unknown> }>();
  registerDesktopWebSearchTools({
    unregisterExternalTools: () => undefined,
    registerExternalTool: (definition, execute) => {
      tools.set(String(definition.name), {
        description: String(definition.description || ""),
        execute
      });
    }
  }, {
    search: async (input) => {
      calls.push(String(input.query || ""));
      return {
        query: String(input.query || ""),
        provider: "spring",
        searchedAt: "2026-10-05T08:00:00.000Z",
        edition: "",
        cacheHit: false,
        items: [{
          title: "今日要闻",
          url: "https://example.com/news/today",
          siteName: "示例",
          snippet: "摘要",
          summary: "摘要",
          publishedAt: "2026-10-05"
        }]
      };
    },
    fetchPage: async () => ({ url: "https://example.com/news/today", title: "", text: "", status: "empty", statusCode: 0 })
  });

  assert.deepEqual([...tools.keys()].sort(), ["web.fetch_page", "web.search"]);
  const search = tools.get("web.search");
  assert.ok(search);
  assert.match(search.description, SPRING_SEARCH_PATTERN);
  assert.doesNotMatch(search.description, FORBIDDEN_SEARCH);
  assert.equal(search.description.includes("付费"), false);
  assert.equal(search.description.includes("财经"), false);

  const result = await search.execute({ query: "今天有哪些新闻" }) as { ok?: boolean; output?: string };
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["今天有哪些新闻"]);
  assert.match(String(result.output), /https:\/\/example\.com\/news\/today/);
});

test(`${CASE_ID} posts today's news only to the Spring web-search API`, async () => {
  const calls: Array<{ url: string; body: string }> = [];
  const client = new DesktopWebSearchClient({
    readGatewayOrigin: async () => "https://api.sinnauze.cn",
    readAccessToken: async () => "desktop-token",
    createHeaders: ({ accessToken }) => ({ Authorization: `Bearer ${accessToken}` }),
    fetchImpl: (async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body || "") });
      return new Response(JSON.stringify({
        ok: true,
        data: {
          query: "今天有哪些新闻",
          provider: "spring",
          searchedAt: "2026-10-05T08:00:00.000Z",
          items: [{
            title: "今日要闻",
            url: "https://example.com/news/today",
            siteName: "示例",
            snippet: "摘要",
            summary: "摘要",
            publishedAt: "2026-10-05"
          }]
        }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch
  });

  const result = await client.search({ query: "今天有哪些新闻" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, `https://api.sinnauze.cn${SPRING_SEARCH_PATH}`);
  assert.match(calls[0]?.body || "", /今天有哪些新闻/);
  assert.equal(result.items[0]?.url, "https://example.com/news/today");
  assert.equal("searchMarketNews" in client, false);
});

test(`${CASE_ID} keeps paid and finance search out of model-facing search instructions`, () => {
  const productSources = [
    "./desktop-web-search-tools.ts",
    "./desktop-web-search-client.ts",
    "./desktop-web-search-policy.ts",
    "./research-plan-policy.ts",
    "./auto-orchestrator-policy.ts",
    "../../resources/experts/deep-research/skills/deep-research/SKILL.md"
  ];
  for (const relativePath of productSources) {
    assert.doesNotMatch(readProductSource(relativePath), FORBIDDEN_SEARCH, relativePath);
  }

  for (const request of ["今天有哪些新闻", "深入分析今日新闻对市场的影响机制", "对比三家公司近期公告"]) {
    const plan = buildResearchPlan({ request, maxChildren: 3 });
    const instruction = buildResearchLeadInstruction(plan);
    assert.match(instruction, SPRING_SEARCH_PATTERN);
    assert.doesNotMatch(instruction, FORBIDDEN_SEARCH);
    for (const step of plan.steps) {
      for (const tool of step.tools) {
        assert.ok(tool === "web.search" || tool === "web.fetch_page", `${request} step ${step.id} tool ${tool}`);
      }
    }
  }

  const orchestrator = buildAutoModeOrchestratorInstruction({
    taskClass: "research",
    latestUserText: "今天有哪些新闻"
  });
  assert.match(orchestrator, SPRING_SEARCH_PATTERN);
  assert.doesNotMatch(orchestrator, FORBIDDEN_SEARCH);
});
