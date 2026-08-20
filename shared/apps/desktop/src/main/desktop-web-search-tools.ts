import {
  DesktopWebSearchClient,
  DesktopWebSearchError,
  type DesktopMarketNewsItem,
  type DesktopWebSearchFreshness,
  type DesktopWebSearchItem,
  type DesktopWebSearchResult
} from "./desktop-web-search-client.ts";
import { attachDesktopWebSearchCitations, formatDesktopWebSearchUnavailable } from "./desktop-web-search-policy.ts";

interface ExternalToolRuntime {
  unregisterExternalTools(namespace?: string): unknown;
  registerExternalTool(
    definition: Record<string, unknown>,
    execute: (input: Record<string, unknown>) => Promise<unknown>
  ): unknown;
}

const namespace = "web-search";

function toolResult(payload: Record<string, unknown>, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
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

/** Registers free-first market news search and explicit paid fallback tools. */
export function registerDesktopWebSearchTools(
  runtime: ExternalToolRuntime,
  client: Pick<DesktopWebSearchClient, "search" | "searchMarketNews">
): void {
  runtime.unregisterExternalTools(namespace);
  runtime.unregisterExternalTools("web-paid");

  runtime.registerExternalTool(
    {
      name: "news_search_free",
      title: "市场新闻搜索",
      description: "Search market/finance news with free sources first through the company Spring orchestrator. Automatically upgrades to one paid web search only when free news is insufficient. Returns source URLs, searchedAt, and routing decision. Prefer this for latest stock news, announcements, and prices.",
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
          return toolResult({
            status: "unavailable",
            code: "WEB_SEARCH_UNAVAILABLE",
            message: formatDesktopWebSearchUnavailable(result.message || "No usable news sources were returned."),
            searchedAt: result.searchedAt,
            decision: result.decision,
            query: result.query,
            items: []
          }, true);
        }
        const citationPreview = attachDesktopWebSearchCitations({
          answer: "",
          searchedAt: result.searchedAt,
          items: toCitationItems(result.items)
        }).trim();
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
          citationBlock: citationPreview,
          guidance: "Cite returned URLs and searchedAt. Do not invent fresher facts than these sources support. If status is degraded, say free news was used after paid search failed."
        }, result.status !== "ok" && result.status !== "degraded");
      } catch (error) {
        const code = error instanceof DesktopWebSearchError ? error.code : "WEB_SEARCH_UNAVAILABLE";
        const message = error instanceof Error ? error.message : String(error);
        return toolResult({
          status: "unavailable",
          code,
          message: formatDesktopWebSearchUnavailable(message),
          items: []
        }, true);
      }
    }
  );

  runtime.registerExternalTool(
    {
      name: "web.search_paid",
      title: "全网付费搜索",
      description: "Paid company web search via Spring. Use only when the user explicitly asks for full-web search or news_search_free is insufficient. Company API keys stay server-side.",
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
          return toolResult({
            status: "unavailable",
            code: "WEB_SEARCH_EMPTY",
            message: formatDesktopWebSearchUnavailable("Paid web search returned no source URLs."),
            searchedAt: result.searchedAt,
            provider: result.provider,
            query: result.query,
            items: []
          }, true);
        }
        const citationPreview = attachDesktopWebSearchCitations({
          answer: "",
          searchedAt: result.searchedAt,
          items: result.items
        }).trim();
        return toolResult({
          status: "ok",
          query: result.query,
          provider: result.provider,
          searchedAt: result.searchedAt,
          items: result.items,
          citationBlock: citationPreview,
          guidance: "Cite the returned URLs and searchedAt. Do not invent fresher facts than these sources support."
        });
      } catch (error) {
        const code = error instanceof DesktopWebSearchError ? error.code : "WEB_SEARCH_UNAVAILABLE";
        const message = error instanceof Error ? error.message : String(error);
        return toolResult({
          status: "unavailable",
          code,
          message: formatDesktopWebSearchUnavailable(message),
          items: []
        }, true);
      }
    }
  );
}
