import {
  DesktopWebSearchClient,
  DesktopWebSearchError,
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

const namespace = "web-paid";

function toolResult(payload: Record<string, unknown>, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    details: payload,
    ...(isError ? { isError: true } : {})
  };
}

/** Registers paid Spring web search. Free market-news routing remains server-side. */
export function registerDesktopWebSearchTools(
  runtime: ExternalToolRuntime,
  client: Pick<DesktopWebSearchClient, "search">
): void {
  runtime.unregisterExternalTools(namespace);
  runtime.registerExternalTool(
    {
      name: "web.search_paid",
      title: "联网搜索",
      description: "Search the live web through the company Spring gateway. Use only when free official sources are insufficient or the user needs broader timely web evidence. Returns source URLs and searchedAt.",
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
          freshness: input.freshness as any,
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
