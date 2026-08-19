import type { MarketDataQuery, QuantBar } from "@codex-forge/protocol/quant-types";

export class MarketDataService {
  private readonly fixtures: QuantBar[];
  private readonly remoteUrl?: string;

  constructor(fixtures: QuantBar[] = [], remoteUrl?: string) { this.fixtures = fixtures; this.remoteUrl = remoteUrl?.trim() || undefined; }

  query(input: MarketDataQuery): QuantBar[] {
    if (!input.symbol.trim()) throw new TypeError("symbol is required");
    const start = input.startDate ? Date.parse(input.startDate) : -Infinity;
    const end = input.endDate ? Date.parse(input.endDate) : Infinity;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end) throw new RangeError("invalid date range");
    return this.fixtures.filter((bar) => bar.symbol === input.symbol && Date.parse(bar.timestamp) >= start && Date.parse(bar.timestamp) <= end);
  }

  async queryAsync(input: MarketDataQuery): Promise<QuantBar[]> {
    if (!this.remoteUrl) return this.query(input);
    const response = await fetch(this.remoteUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`MARKET_DATA_HTTP_${response.status}`);
    const payload = await response.json() as { bars?: unknown };
    if (!Array.isArray(payload.bars)) throw new Error("MARKET_DATA_INVALID_RESPONSE");
    return payload.bars.filter((bar): bar is QuantBar => Boolean(bar && typeof bar === "object" && typeof (bar as QuantBar).symbol === "string" && typeof (bar as QuantBar).close === "number"));
  }
}
