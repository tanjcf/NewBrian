import {
  DesktopWebSearchClient,
  DesktopWebSearchError,
  type DesktopMarketNewsItem,
  type DesktopWebSearchFreshness,
  type DesktopWebSearchItem,
  type DesktopWebSearchResult
} from "./desktop-web-search-client.ts";
import {
  attachDesktopWebSearchCitations,
  describeDesktopWebSearchFailure,
  formatDesktopWebSearchUnavailable
} from "./desktop-web-search-policy.ts";

interface ExternalToolRuntime {
  unregisterExternalTools(namespace?: string): unknown;
  registerExternalTool(
    definition: Record<string, unknown>,
    execute: (input: Record<string, unknown>) => Promise<unknown>
  ): unknown;
}

const namespace = "web-search";
const FETCH_WARNING_WITHOUT_READ = 3;
const FETCH_BLOCK_WITHOUT_BODY = 5;
const IDENTICAL_URL_BLOCK = 3;

// The agent loop only forwards ok/output to the model and counts ok=true as
// progress; content/details stay for citation finalization.
function toolResult(payload: Record<string, unknown>, isError = false) {
  const text = JSON.stringify(payload);
  return {
    ok: !isError,
    exitCode: isError ? 1 : 0,
    output: text,
    content: [{ type: "text", text }],
    details: payload,
    ...(isError ? { isError: true } : {})
  };
}

function toCitationItems(items: DesktopMarketNewsItem[]): DesktopWebSearchItem[] {
  return items.map((item) => ({
    title: item.title,
    url: item.url,
    siteName: item.siteName || item.sourceType || "",
    snippet: item.snippet,
    summary: item.summary || item.snippet,
    publishedAt: item.publishedAt
  }));
}

/** Registers free-first market news search, paid fallback, and Search→Fetch page tool. */
export function registerDesktopWebSearchTools(
  runtime: ExternalToolRuntime,
  client: Pick<DesktopWebSearchClient, "search" | "searchMarketNews" | "fetchPage">
): void {
  runtime.unregisterExternalTools(namespace);
  runtime.unregisterExternalTools("web-paid");

  let searchCallsWithoutFetch = 0;
  let fetchCalls = 0;
  const urlCounts = new Map<string, number>();

  runtime.registerExternalTool(
    {
      name: "news_search_free",
      title: "市场新闻搜索",
      description: "Stock and finance news only: prices, announcements, earnings, indexes, and listed-company news. Free finance news first, then one finance search engine. Do not call for marketing plans, campaigns, copywriting, short-video cases, or general web questions. Never call for greetings.",
      kind: "read",
      risk: "medium",
      requiresApproval: false,
      namespace,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 1, maxLength: 200 },
          freshness: { type: "string", enum: ["noLimit", "oneDay", "oneWeek", "oneMonth", "oneYear"] },
          count: { type: "integer", minimum: 1, maximum: 10 }
        },
        required: ["query"],
        additionalProperties: false
      }
    },
    async (input) => {
      try {
        const result = await client.searchMarketNews({
          query: String(input.query || ""),
          freshness: input.freshness as DesktopWebSearchFreshness | undefined,
          count: typeof input.count === "number" ? input.count : undefined
        });
        if (result.status === "unavailable" || !result.items.length) {
          const failure = describeDesktopWebSearchFailure(result.message);
          return toolResult({
            status: "unavailable",
            code: failure.code,
            message: formatDesktopWebSearchUnavailable(result.message || "No usable news sources were returned."),
            searchedAt: result.searchedAt,
            decision: result.decision,
            query: result.query,
            items: [],
            fetches: [],
            fetchAttempted: result.fetchAttempted
          }, true);
        }
        searchCallsWithoutFetch += 1;
        const citationPreview = attachDesktopWebSearchCitations({
          answer: "",
          searchedAt: result.searchedAt,
          items: toCitationItems(result.items)
        }).trim();
        const guidanceParts = [
          "Cite returned URLs and searchedAt. Do not invent fresher facts than these sources support.",
          "If status is degraded, say free news was used after paid search failed.",
          result.fetches.length
            ? "Orchestrator already attached TopK fetches; prefer those bodies before calling web.fetch_page again."
            : "If snippets are thin, call web.fetch_page on the most relevant URLs (budget-limited)."
        ];
        return toolResult({
          status: result.status,
          query: result.query,
          searchedAt: result.searchedAt,
          decision: result.decision,
          complete: result.complete,
          paidAttempted: result.paidAttempted,
          paidSucceeded: result.paidSucceeded,
          sourceTypesUsed: result.sourceTypesUsed,
          message: result.message,
          items: result.items,
          fetches: result.fetches,
          fetchAttempted: result.fetchAttempted,
          citationBlock: citationPreview,
          guidance: guidanceParts.join(" ")
        }, result.status !== "ok" && result.status !== "degraded");
      } catch (error) {
        const code = error instanceof DesktopWebSearchError ? error.code : "WEB_SEARCH_UNAVAILABLE";
        const message = error instanceof Error ? error.message : String(error);
        return toolResult({
          status: "unavailable",
          code,
          message: formatDesktopWebSearchUnavailable(message, code),
          items: [],
          fetches: []
        }, true);
      }
    }
  );

  runtime.registerExternalTool(
    {
      name: "web.search_paid",
      title: "全网付费搜索",
      description: "Scene web search. Marketing plans, cases, copy, Xiaohongshu, Douyin, and campaigns use Baidu standard, then Quark only if Baidu returns fewer than two links. Policy uses Baidu then Zhipu search_pro. Open questions use Baidu then Bocha. Do not call news_search_free for these. Call this tool once. Never call for greetings.",
      kind: "read",
      risk: "medium",
      requiresApproval: false,
      namespace,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 1, maxLength: 200 },
          freshness: { type: "string", enum: ["noLimit", "oneDay", "oneWeek", "oneMonth", "oneYear"] },
          count: { type: "integer", minimum: 1, maximum: 10 }
        },
        required: ["query"],
        additionalProperties: false
      }
    },
    async (input) => {
      try {
        const result: DesktopWebSearchResult = await client.search({
          query: String(input.query || ""),
          freshness: input.freshness as DesktopWebSearchFreshness | undefined,
          count: typeof input.count === "number" ? input.count : undefined
        });
        if (!result.items.length) {
          const failure = describeDesktopWebSearchFailure(
            result.message || "",
            result.provider === "none" ? "WEB_SEARCH_UNAVAILABLE" : "WEB_SEARCH_EMPTY"
          );
          return toolResult({
            status: "unavailable",
            code: failure.code,
            message: formatDesktopWebSearchUnavailable(
              result.message || (result.provider === "none"
                ? "Web search returned no usable sources."
                : "Paid web search returned no source URLs."),
              failure.code
            ),
            searchedAt: result.searchedAt,
            provider: result.provider,
            edition: result.edition,
            cacheHit: result.cacheHit,
            query: result.query,
            items: []
          }, true);
        }
        searchCallsWithoutFetch += 1;
        const citationPreview = attachDesktopWebSearchCitations({
          answer: "",
          searchedAt: result.searchedAt,
          items: result.items
        }).trim();
        return toolResult({
          status: "ok",
          query: result.query,
          provider: result.provider,
          edition: result.edition,
          cacheHit: result.cacheHit,
          searchedAt: result.searchedAt,
          items: result.items,
          citationBlock: citationPreview,
          guidance: "Cite the returned URLs and searchedAt. Call web.fetch_page for TopK bodies before treating snippets as full evidence."
        });
      } catch (error) {
        const code = error instanceof DesktopWebSearchError ? error.code : "WEB_SEARCH_UNAVAILABLE";
        const message = error instanceof Error ? error.message : String(error);
        return toolResult({
          status: "unavailable",
          code,
          message: formatDesktopWebSearchUnavailable(message, code),
          items: []
        }, true);
      }
    }
  );

  runtime.registerExternalTool(
    {
      name: "web.fetch_page",
      title: "抓取网页正文",
      description: "Fetch visible page text for a search result URL via company Spring web-fetch. Does not consume paid search quota. Use after news_search_free/web.search_paid when snippets are insufficient. Never call for greetings.",
      kind: "read",
      risk: "medium",
      requiresApproval: false,
      namespace,
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", minLength: 1, maxLength: 2000 },
          maxChars: { type: "integer", minimum: 200, maximum: 80000 }
        },
        required: ["url"],
        additionalProperties: false
      }
    },
    async (input) => {
      const url = String(input.url || "").trim();
      if (!url) {
        return toolResult({
          status: "unavailable",
          code: "WEB_FETCH_URL_INVALID",
          message: "URL is required."
        }, true);
      }

      if (searchCallsWithoutFetch >= FETCH_BLOCK_WITHOUT_BODY && fetchCalls === 0) {
        return toolResult({
          status: "blocked",
          code: "WEB_FETCH_LOOP_BLOCKED",
          message: "CRITICAL: web.fetch_page blocked — too many searches without reading a page body. Fetch an existing URL or draft from current evidence."
        }, true);
      }

      const identicalCount = (urlCounts.get(url) ?? 0) + 1;
      if (identicalCount >= IDENTICAL_URL_BLOCK) {
        return toolResult({
          status: "blocked",
          code: "WEB_FETCH_LOOP_BLOCKED",
          message: `CRITICAL: web.fetch_page blocked after repeating URL ${identicalCount} times. Use existing body or continue drafting.`
        }, true);
      }

      try {
        const page = await client.fetchPage({
          url,
          maxChars: typeof input.maxChars === "number" ? input.maxChars : undefined
        });
        fetchCalls += 1;
        searchCallsWithoutFetch = 0;
        urlCounts.set(url, identicalCount);
        const warning = fetchCalls === 0 && searchCallsWithoutFetch >= FETCH_WARNING_WITHOUT_READ
          ? "Search budget pressure: prefer fetching existing URLs before more searches."
          : undefined;
        return toolResult({
          status: page.status,
          url: page.url,
          title: page.title,
          text: page.text,
          statusCode: page.statusCode,
          fetchedAt: page.fetchedAt,
          truncated: page.truncated,
          charCount: page.charCount,
          guidance: "Use this body as evidence. Cite the URL. Do not invent facts beyond the fetched text.",
          ...(warning ? { warning } : {})
        }, page.status === "blocked" || page.status === "error");
      } catch (error) {
        const code = error instanceof DesktopWebSearchError ? error.code : "WEB_FETCH_UNAVAILABLE";
        const message = error instanceof Error ? error.message : String(error);
        return toolResult({
          status: "unavailable",
          code,
          message,
          url
        }, true);
      }
    }
  );
}
