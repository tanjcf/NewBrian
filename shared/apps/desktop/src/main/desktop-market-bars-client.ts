import type { MarketDataQuery, QuantBar } from "@codex-forge/protocol/quant-types";

export interface DesktopMarketBarsClientDependencies {
  readGatewayOrigin: () => Promise<string>;
  readAccessToken: () => Promise<string>;
  refreshAccessToken: () => Promise<string>;
  createHeaders: (input: { accessToken: string }) => Record<string, string>;
  fetchImpl?: typeof fetch;
}

export class DesktopMarketBarsError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DesktopMarketBarsError";
    this.code = code;
  }
}

/** Calls company Spring market-bars; AKShare stays server-side only. */
export class DesktopMarketBarsClient {
  private readonly dependencies: DesktopMarketBarsClientDependencies;
  private readonly fetchImpl: typeof fetch;

  constructor(dependencies: DesktopMarketBarsClientDependencies) {
    this.dependencies = dependencies;
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
  }

  async queryBars(input: MarketDataQuery): Promise<QuantBar[]> {
    const symbol = String(input.symbol || "").trim();
    if (!symbol) {
      throw new DesktopMarketBarsError("MARKET_BARS_SYMBOL_REQUIRED", "Symbol is required.");
    }

    const refreshAccessToken = async () => {
      try {
        return (await this.dependencies.refreshAccessToken()).trim();
      } catch {
        return "";
      }
    };

    let accessToken = (await this.dependencies.readAccessToken()).trim();
    if (!accessToken) {
      accessToken = await refreshAccessToken();
    }
    if (!accessToken) {
      throw new DesktopMarketBarsError(
        "MARKET_BARS_AUTH_REQUIRED",
        "Desktop session is required before market bars."
      );
    }

    const gatewayOrigin = (await this.dependencies.readGatewayOrigin()).replace(/\/+$/u, "");
    const requestBars = (activeAccessToken: string) => this.fetchImpl(
      `${gatewayOrigin}/api/desktop/v1/market-bars`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...this.dependencies.createHeaders({ accessToken: activeAccessToken })
        },
        body: JSON.stringify({
          symbol,
          interval: input.interval,
          startDate: input.startDate,
          endDate: input.endDate,
          adjustment: input.adjustment
        })
      }
    );

    let response = await requestBars(accessToken);
    if (response.status === 401 || response.status === 403) {
      const refreshedAccessToken = await refreshAccessToken();
      if (refreshedAccessToken) {
        accessToken = refreshedAccessToken;
        response = await requestBars(accessToken);
      }
    }

    if (!response.ok) {
      const errorPayload = await response.clone().json().catch(() => null) as {
        code?: unknown;
        message?: unknown;
        request_id?: unknown;
      } | null;
      const upstreamMessage = typeof errorPayload?.message === "string"
        ? errorPayload.message.trim()
        : "";
      const requestId = typeof errorPayload?.request_id === "string" && errorPayload.request_id.trim()
        ? ` (request_id: ${errorPayload.request_id.trim()})`
        : "";
      const message = upstreamMessage
        ? `Market bars failed with HTTP ${response.status}: ${upstreamMessage}${requestId}`
        : `Market bars failed with HTTP ${response.status}.`;
      throw new DesktopMarketBarsError(
        typeof errorPayload?.code === "string" && errorPayload.code.trim()
          ? errorPayload.code.trim()
          : `MARKET_BARS_HTTP_${response.status}`,
        message
      );
    }

    const payload = await response.json() as {
      ok?: boolean;
      data?: { bars?: unknown };
      message?: string;
      code?: string;
    };

    if (!payload?.ok || !payload.data) {
      throw new DesktopMarketBarsError(
        String(payload?.code || "MARKET_BARS_UNAVAILABLE"),
        String(payload?.message || "Market bars are unavailable.")
      );
    }

    if (!Array.isArray(payload.data.bars)) {
      throw new DesktopMarketBarsError("MARKET_BARS_INVALID_RESPONSE", "Market bars response is invalid.");
    }

    return payload.data.bars as QuantBar[];
  }
}
