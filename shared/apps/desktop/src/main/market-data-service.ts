import type { MarketDataQuery, QuantBar } from "@codex-forge/protocol/quant-types";

export type MarketBarsRemoteQuery = (input: MarketDataQuery) => Promise<QuantBar[]>;

export class MarketDataService {
  private readonly fixtures: QuantBar[];
  private readonly remoteUrl?: string;
  private readonly queryRemote?: MarketBarsRemoteQuery;

  constructor(
    fixtures: QuantBar[] = [],
    remote?: string | { remoteUrl?: string; queryRemote?: MarketBarsRemoteQuery }
  ) {
    this.fixtures = fixtures;
    if (typeof remote === "string") {
      const value = remote.trim();
      if (value) {
        const parsed = new URL(value);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new TypeError("market data URL must use HTTP or HTTPS");
        }
        this.remoteUrl = parsed.toString();
      }
      return;
    }
    if (remote?.queryRemote) {
      this.queryRemote = remote.queryRemote;
    }
    const value = remote?.remoteUrl?.trim();
    if (value) {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new TypeError("market data URL must use HTTP or HTTPS");
      }
      this.remoteUrl = parsed.toString();
    }
  }

  query(input: MarketDataQuery): QuantBar[] {
    if (!input.symbol.trim()) throw new TypeError("symbol is required");
    const start = input.startDate ? Date.parse(input.startDate) : -Infinity;
    const end = input.endDate ? Date.parse(input.endDate) : Infinity;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end) throw new RangeError("invalid date range");
    return this.fixtures.filter((bar) =>
      bar.symbol === input.symbol
      && bar.interval === input.interval
      && bar.adjustment === input.adjustment
      && Date.parse(bar.timestamp) >= start
      && Date.parse(bar.timestamp) <= end
    );
  }

  async queryAsync(input: MarketDataQuery): Promise<QuantBar[]> {
    const endDate = input.endDate?.trim() || formatIsoDate(new Date());
    const startFallback = new Date();
    startFallback.setFullYear(startFallback.getFullYear() - 1);
    const startDate = input.startDate?.trim() || formatIsoDate(startFallback);
    const request = { ...input, startDate, endDate };

    let bars: QuantBar[];
    if (this.queryRemote) {
      bars = (await this.queryRemote(request)).map(parseQuantBar);
    } else if (this.remoteUrl) {
      const response = await fetch(this.remoteUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request)
      });
      if (!response.ok) throw new Error(`MARKET_DATA_HTTP_${response.status}`);
      const payload = await response.json() as { bars?: unknown };
      if (!Array.isArray(payload.bars)) throw new Error("MARKET_DATA_INVALID_RESPONSE");
      bars = payload.bars.map(parseQuantBar);
    } else if (this.fixtures.length) {
      bars = this.query(request);
    } else {
      throw new Error("MARKET_DATA_GATEWAY_REQUIRED");
    }

    if (bars.some((bar) => bar.symbol !== input.symbol || bar.interval !== input.interval || bar.adjustment !== input.adjustment)) {
      throw new Error("MARKET_DATA_QUERY_MISMATCH");
    }
    return filterRemoteDateRange(bars, request);
  }
}

function filterRemoteDateRange(bars: QuantBar[], input: MarketDataQuery): QuantBar[] {
  const start = Date.parse(String(input.startDate));
  const end = Date.parse(String(input.endDate));
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) throw new RangeError("invalid date range");
  if (input.interval === "1mo") {
    const monthKey = (value: string | number) => {
      const date = new Date(value);
      return date.getUTCFullYear() * 12 + date.getUTCMonth();
    };
    const firstMonth = monthKey(start);
    const lastMonth = monthKey(end);
    return bars.filter((bar) => {
      const month = monthKey(bar.timestamp);
      return month >= firstMonth && month <= lastMonth;
    });
  }
  return bars.filter((bar) => {
    const timestamp = Date.parse(bar.timestamp);
    return timestamp >= start && timestamp <= end + 86_399_999;
  });
}

function formatIsoDate(value: Date): string {
  const yyyy = value.getFullYear();
  const mm = String(value.getMonth() + 1).padStart(2, "0");
  const dd = String(value.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseQuantBar(value: unknown): QuantBar {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MARKET_DATA_INVALID_BAR");
  const bar = value as Record<string, unknown>;
  const source = bar.source;
  const numericFields = ["open", "high", "low", "close", "volume", "turnover", "changePercent"] as const;
  if (
    typeof bar.symbol !== "string" || !bar.symbol.trim()
    || typeof bar.exchange !== "string" || !bar.exchange.trim()
    || typeof bar.timezone !== "string" || !bar.timezone.trim()
    || !["1d", "1w", "1mo"].includes(String(bar.interval))
    || !["forward", "backward", "none"].includes(String(bar.adjustment))
    || typeof bar.timestamp !== "string" || Number.isNaN(Date.parse(bar.timestamp))
    || numericFields.some((field) => typeof bar[field] !== "number" || !Number.isFinite(bar[field] as number))
    || !source || typeof source !== "object" || Array.isArray(source)
  ) throw new Error("MARKET_DATA_INVALID_BAR");
  const metadata = source as Record<string, unknown>;
  if (typeof metadata.provider !== "string" || !metadata.provider.trim()
    || typeof metadata.dataset !== "string" || !metadata.dataset.trim()
    || typeof metadata.fetchedAt !== "string" || Number.isNaN(Date.parse(metadata.fetchedAt))) {
    throw new Error("MARKET_DATA_INVALID_BAR");
  }
  const open = bar.open as number; const high = bar.high as number; const low = bar.low as number; const close = bar.close as number;
  if (low < 0 || high < Math.max(open, close) || low > Math.min(open, close) || (bar.volume as number) < 0 || (bar.turnover as number) < 0) {
    throw new Error("MARKET_DATA_INVALID_BAR");
  }
  return value as QuantBar;
}
