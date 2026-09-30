export type MarketOverviewSection = {
  dataset: string;
  fetchedAt: string;
  items: Array<Record<string, unknown>>;
  error?: string;
};

export type MarketOverview = {
  indices: MarketOverviewSection;
  industries: MarketOverviewSection;
  concepts: MarketOverviewSection;
  fundFlows: MarketOverviewSection;
  limitUps: MarketOverviewSection;
};

export type MarketScreenerResult = {
  dataset: string;
  fetchedAt: string;
  criteria: Record<string, number>;
  items: Array<Record<string, unknown>>;
};

export interface DesktopMarketOverviewClientDependencies {
  readGatewayOrigin: () => Promise<string>;
  readAccessToken: () => Promise<string>;
  createHeaders: (input: { accessToken: string }) => Record<string, string>;
  fetchImpl?: typeof fetch;
}

export class DesktopMarketOverviewError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DesktopMarketOverviewError";
    this.code = code;
  }
}

const SECTION_KEYS = ["indices", "industries", "concepts", "fundFlows", "limitUps"] as const;

/** Calls the company Spring gateway; the desktop never connects to AKShare directly. */
export class DesktopMarketOverviewClient {
  private readonly dependencies: DesktopMarketOverviewClientDependencies;
  private readonly fetchImpl: typeof fetch;

  constructor(dependencies: DesktopMarketOverviewClientDependencies) {
    this.dependencies = dependencies;
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
  }

  async queryOverview(limit = 20): Promise<MarketOverview> {
    const accessToken = (await this.dependencies.readAccessToken()).trim();
    if (!accessToken) {
      throw new DesktopMarketOverviewError("MARKET_OVERVIEW_AUTH_REQUIRED", "Desktop session is required before market overview.");
    }
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const gatewayOrigin = (await this.dependencies.readGatewayOrigin()).replace(/\/+$/u, "");
    const response = await this.fetchImpl(`${gatewayOrigin}/api/desktop/v1/market-overview?limit=${boundedLimit}`, {
      headers: this.dependencies.createHeaders({ accessToken })
    });
    if (!response.ok) {
      const hint = response.status === 502
        ? " Spring 无法从 AKShare（app.akshare.base-url）拉取大盘数据，请确认适配器已启动。"
        : "";
      throw new DesktopMarketOverviewError(
        `MARKET_OVERVIEW_HTTP_${response.status}`,
        `Market overview failed with HTTP ${response.status}.${hint}`
      );
    }
    const payload = await response.json() as { ok?: boolean; data?: unknown; message?: string; code?: string };
    if (!payload.ok || !payload.data || typeof payload.data !== "object" || Array.isArray(payload.data)) {
      throw new DesktopMarketOverviewError(
        String(payload.code || "MARKET_OVERVIEW_UNAVAILABLE"),
        String(payload.message || "Market overview is unavailable.")
      );
    }
    const data = payload.data as Record<string, unknown>;
    for (const key of SECTION_KEYS) {
      const section = data[key];
      if (!section || typeof section !== "object" || Array.isArray(section) || !Array.isArray((section as Record<string, unknown>).items)) {
        throw new DesktopMarketOverviewError("MARKET_OVERVIEW_INVALID_RESPONSE", `Market overview section ${key} is invalid.`);
      }
    }
    return data as MarketOverview;
  }

  async queryScreener(criteria: Record<string, unknown>): Promise<MarketScreenerResult> {
    const accessToken = (await this.dependencies.readAccessToken()).trim();
    if (!accessToken) throw new DesktopMarketOverviewError("MARKET_SCREENER_AUTH_REQUIRED", "Desktop session is required before market screening.");
    const gatewayOrigin = (await this.dependencies.readGatewayOrigin()).replace(/\/+$/u, "");
    const response = await this.fetchImpl(`${gatewayOrigin}/api/desktop/v1/market-screener`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", ...this.dependencies.createHeaders({ accessToken }) },
      body: JSON.stringify(criteria)
    });
    if (!response.ok) throw new DesktopMarketOverviewError(`MARKET_SCREENER_HTTP_${response.status}`, `Market screener failed with HTTP ${response.status}.`);
    const payload = await response.json() as { ok?: boolean; data?: unknown; message?: string };
    const data = payload.data as Record<string, unknown> | undefined;
    if (!payload.ok || !data || typeof data.dataset !== "string" || !Array.isArray(data.items)) {
      throw new DesktopMarketOverviewError("MARKET_SCREENER_INVALID_RESPONSE", String(payload.message || "Market screener response is invalid."));
    }
    return data as MarketScreenerResult;
  }
}
