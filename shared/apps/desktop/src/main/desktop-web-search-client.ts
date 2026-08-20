export type DesktopWebSearchFreshness = "noLimit" | "oneDay" | "oneWeek" | "oneMonth" | "oneYear";

export interface DesktopWebSearchItem {
  title: string;
  url: string;
  siteName: string;
  snippet: string;
  summary: string;
  publishedAt: string;
}

export interface DesktopWebSearchResult {
  query: string;
  provider: string;
  searchedAt: string;
  items: DesktopWebSearchItem[];
}

export interface DesktopMarketNewsItem extends DesktopWebSearchItem {
  evidenceId?: string;
  sourceType?: string;
}

export interface DesktopMarketNewsResult {
  query: string;
  searchedAt: string;
  decision: string;
  status: string;
  message: string;
  complete: boolean;
  paidAttempted: boolean;
  paidSucceeded: boolean;
  sourceTypesUsed: string[];
  items: DesktopMarketNewsItem[];
}

export interface DesktopWebSearchClientDependencies {
  readGatewayOrigin: () => Promise<string>;
  readAccessToken: () => Promise<string>;
  createHeaders: (input: { accessToken: string }) => Record<string, string>;
  fetchImpl?: typeof fetch;
}

export class DesktopWebSearchError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DesktopWebSearchError";
    this.code = code;
  }
}

/** Calls company Spring paid web-search; company keys stay server-side. */
export class DesktopWebSearchClient {
  private readonly dependencies: DesktopWebSearchClientDependencies;
  private readonly fetchImpl: typeof fetch;

  constructor(dependencies: DesktopWebSearchClientDependencies) {
    this.dependencies = dependencies;
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
  }

  async search(input: {
    query: string;
    freshness?: DesktopWebSearchFreshness;
    count?: number;
    summary?: boolean;
  }): Promise<DesktopWebSearchResult> {
    const query = String(input.query || "").trim();
    if (!query || query.length > 200) {
      throw new DesktopWebSearchError("WEB_SEARCH_QUERY_INVALID", "Query must contain 1 to 200 characters.");
    }
    const freshness = input.freshness || "noLimit";
    const allowed: DesktopWebSearchFreshness[] = ["noLimit", "oneDay", "oneWeek", "oneMonth", "oneYear"];
    if (!allowed.includes(freshness)) {
      throw new DesktopWebSearchError("WEB_SEARCH_FRESHNESS_INVALID", "Freshness value is unsupported.");
    }
    const count = input.count ?? 5;
    if (!Number.isInteger(count) || count < 1 || count > 10) {
      throw new DesktopWebSearchError("WEB_SEARCH_COUNT_INVALID", "Count must be an integer from 1 to 10.");
    }

    const accessToken = (await this.dependencies.readAccessToken()).trim();
    if (!accessToken) {
      throw new DesktopWebSearchError("WEB_SEARCH_AUTH_REQUIRED", "Desktop session is required before paid web search.");
    }

    const gatewayOrigin = (await this.dependencies.readGatewayOrigin()).replace(/\/+$/u, "");
    const response = await this.fetchImpl(`${gatewayOrigin}/api/desktop/v1/web-search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...this.dependencies.createHeaders({ accessToken })
      },
      body: JSON.stringify({
        query,
        freshness,
        count,
        summary: input.summary !== false
      })
    });

    if (!response.ok) {
      throw new DesktopWebSearchError(
        `WEB_SEARCH_HTTP_${response.status}`,
        `Paid web search failed with HTTP ${response.status}.`
      );
    }

    const payload = await response.json() as {
      ok?: boolean;
      data?: {
        query?: string;
        provider?: string;
        searchedAt?: string;
        items?: Array<Record<string, unknown>>;
      };
      message?: string;
      code?: string;
    };

    if (!payload?.ok || !payload.data) {
      throw new DesktopWebSearchError(
        String(payload?.code || "WEB_SEARCH_UNAVAILABLE"),
        String(payload?.message || "Paid web search is unavailable.")
      );
    }

    const items = Array.isArray(payload.data.items)
      ? payload.data.items.map((item) => ({
        title: String(item.title || ""),
        url: String(item.url || ""),
        siteName: String(item.siteName || ""),
        snippet: String(item.snippet || ""),
        summary: String(item.summary || ""),
        publishedAt: String(item.publishedAt || "")
      })).filter((item) => item.url)
      : [];

    return {
      query: String(payload.data.query || query),
      provider: String(payload.data.provider || "unknown"),
      searchedAt: String(payload.data.searchedAt || new Date().toISOString()),
      items
    };
  }

  /** Free-news-first market search via Spring orchestrator; paid Bocha stays server-side. */
  async searchMarketNews(input: {
    query: string;
    freshness?: DesktopWebSearchFreshness;
    count?: number;
  }): Promise<DesktopMarketNewsResult> {
    const query = String(input.query || "").trim();
    if (!query || query.length > 200) {
      throw new DesktopWebSearchError("WEB_SEARCH_QUERY_INVALID", "Query must contain 1 to 200 characters.");
    }
    const freshness = input.freshness || "noLimit";
    const allowed: DesktopWebSearchFreshness[] = ["noLimit", "oneDay", "oneWeek", "oneMonth", "oneYear"];
    if (!allowed.includes(freshness)) {
      throw new DesktopWebSearchError("WEB_SEARCH_FRESHNESS_INVALID", "Freshness value is unsupported.");
    }
    const count = input.count ?? 5;
    if (!Number.isInteger(count) || count < 1 || count > 10) {
      throw new DesktopWebSearchError("WEB_SEARCH_COUNT_INVALID", "Count must be an integer from 1 to 10.");
    }

    const accessToken = (await this.dependencies.readAccessToken()).trim();
    if (!accessToken) {
      throw new DesktopWebSearchError("WEB_SEARCH_AUTH_REQUIRED", "Desktop session is required before market news search.");
    }

    const gatewayOrigin = (await this.dependencies.readGatewayOrigin()).replace(/\/+$/u, "");
    const response = await this.fetchImpl(`${gatewayOrigin}/api/desktop/v1/market-news-search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...this.dependencies.createHeaders({ accessToken })
      },
      body: JSON.stringify({
        query,
        freshness,
        count
      })
    });

    if (!response.ok) {
      throw new DesktopWebSearchError(
        `WEB_SEARCH_HTTP_${response.status}`,
        `Market news search failed with HTTP ${response.status}.`
      );
    }

    const payload = await response.json() as {
      ok?: boolean;
      data?: {
        query?: string;
        searchedAt?: string;
        decision?: string;
        status?: string;
        message?: string;
        complete?: boolean;
        paidAttempted?: boolean;
        paidSucceeded?: boolean;
        sourceTypesUsed?: unknown;
        items?: Array<Record<string, unknown>>;
      };
      message?: string;
      code?: string;
    };

    if (!payload?.ok || !payload.data) {
      throw new DesktopWebSearchError(
        String(payload?.code || "WEB_SEARCH_UNAVAILABLE"),
        String(payload?.message || "Market news search is unavailable.")
      );
    }

    const items: DesktopMarketNewsItem[] = Array.isArray(payload.data.items)
      ? payload.data.items.map((item) => ({
        evidenceId: item.evidenceId == null ? undefined : String(item.evidenceId),
        title: String(item.title || ""),
        url: String(item.url || ""),
        siteName: String(item.source || item.siteName || ""),
        snippet: String(item.snippet || ""),
        summary: String(item.snippet || ""),
        publishedAt: String(item.publishedAt || ""),
        sourceType: item.sourceType == null ? undefined : String(item.sourceType)
      })).filter((item) => item.url)
      : [];

    return {
      query: String(payload.data.query || query),
      searchedAt: String(payload.data.searchedAt || new Date().toISOString()),
      decision: String(payload.data.decision || "NONE"),
      status: String(payload.data.status || (items.length ? "ok" : "unavailable")),
      message: String(payload.data.message || ""),
      complete: payload.data.complete !== false,
      paidAttempted: Boolean(payload.data.paidAttempted),
      paidSucceeded: Boolean(payload.data.paidSucceeded),
      sourceTypesUsed: Array.isArray(payload.data.sourceTypesUsed)
        ? payload.data.sourceTypesUsed.map((value) => String(value))
        : [],
      items
    };
  }
}
