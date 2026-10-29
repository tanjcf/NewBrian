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
  /** Baidu standard/enhanced edition when provider is baidu_qianfan; otherwise empty. */
  edition: string;
  /** True when Spring/search-gateway served a cache hit (no paid charge). */
  cacheHit: boolean;
  /** Orchestrator status (ok / degraded / unavailable); older Spring builds omit it. */
  status?: string;
  /** Orchestrator failure reason such as "WEB_SEARCH_PAYMENT_REQUIRED: ...". */
  message?: string;
  items: DesktopWebSearchItem[];
}

export interface DesktopFetchedPage {
  url: string;
  title: string;
  text: string;
  status: string;
  statusCode: number;
  fetchedAt?: string;
  truncated?: boolean;
  charCount?: number;
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

/** Reads Spring desktop error JSON when HTTP status is non-2xx. */
async function throwDesktopWebSearchHttpError(
  response: Response,
  fallbackMessage: string,
  fallbackCodePrefix = "WEB_SEARCH_HTTP_"
): Promise<never> {
  let code = `${fallbackCodePrefix}${response.status}`;
  let message = fallbackMessage;
  try {
    const payload = await response.json() as { code?: string; message?: string };
    if (payload?.code) code = String(payload.code);
    if (payload?.message) message = String(payload.message);
  } catch {
    // Keep HTTP status fallback when the body is not JSON.
  }
  throw new DesktopWebSearchError(code, message);
}

/** Calls company Spring web-search (orchestrated); company keys stay server-side. */
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
      throw new DesktopWebSearchError("WEB_SEARCH_AUTH_REQUIRED", "Desktop session is required before web search.");
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
      await throwDesktopWebSearchHttpError(
        response,
        `Web search failed with HTTP ${response.status}.`
      );
    }

    const payload = await response.json() as {
      ok?: boolean;
      data?: {
        query?: string;
        provider?: string;
        searchedAt?: string;
        edition?: string;
        cacheHit?: boolean;
        status?: string;
        message?: string;
        items?: Array<Record<string, unknown>>;
      };
      message?: string;
      code?: string;
    };

    if (!payload?.ok || !payload.data) {
      throw new DesktopWebSearchError(
        String(payload?.code || "WEB_SEARCH_UNAVAILABLE"),
        String(payload?.message || "Web search is unavailable.")
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
      edition: String(payload.data.edition || ""),
      cacheHit: Boolean(payload.data.cacheHit),
      status: String(payload.data.status || (items.length ? "ok" : "")),
      message: String(payload.data.message || ""),
      items
    };
  }

  /** Fetch a single page body via Spring web-fetch. */
  async fetchPage(input: {
    url: string;
    maxChars?: number;
  }): Promise<DesktopFetchedPage> {
    const url = String(input.url || "").trim();
    if (!url || url.length > 2000) {
      throw new DesktopWebSearchError("WEB_FETCH_URL_INVALID", "URL must contain 1 to 2000 characters.");
    }
    if (!/^https?:\/\//iu.test(url)) {
      throw new DesktopWebSearchError("WEB_FETCH_URL_INVALID", "Only http(s) URLs are allowed.");
    }

    const accessToken = (await this.dependencies.readAccessToken()).trim();
    if (!accessToken) {
      throw new DesktopWebSearchError("WEB_SEARCH_AUTH_REQUIRED", "Desktop session is required before web fetch.");
    }

    const gatewayOrigin = (await this.dependencies.readGatewayOrigin()).replace(/\/+$/u, "");
    const body: Record<string, unknown> = { url };
    if (typeof input.maxChars === "number" && Number.isInteger(input.maxChars)) {
      body.maxChars = input.maxChars;
    }

    const response = await this.fetchImpl(`${gatewayOrigin}/api/desktop/v1/web-fetch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...this.dependencies.createHeaders({ accessToken })
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      await throwDesktopWebSearchHttpError(
        response,
        `Web fetch failed with HTTP ${response.status}.`,
        "WEB_FETCH_HTTP_"
      );
    }

    const payload = await response.json() as {
      ok?: boolean;
      data?: Record<string, unknown>;
      message?: string;
      code?: string;
    };

    if (!payload?.ok || !payload.data) {
      throw new DesktopWebSearchError(
        String(payload?.code || "WEB_FETCH_UNAVAILABLE"),
        String(payload?.message || "Web fetch is unavailable.")
      );
    }

    const data = payload.data;
    return {
      url: String(data.url || data.final_url || url),
      title: String(data.title || ""),
      text: String(data.text || ""),
      status: String(data.status || "empty"),
      statusCode: typeof data.status_code === "number" ? data.status_code : Number(data.statusCode || 0) || 0,
      fetchedAt: data.fetched_at == null ? undefined : String(data.fetched_at),
      truncated: Boolean(data.truncated),
      charCount: typeof data.char_count === "number" ? data.char_count : undefined
    };
  }
}
