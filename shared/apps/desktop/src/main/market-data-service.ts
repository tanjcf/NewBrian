import type { MarketDataQuery, QuantBar } from "@codex-forge/protocol/quant-types";

export class MarketDataService {
  private readonly fixtures: QuantBar[];

  constructor(fixtures: QuantBar[] = []) { this.fixtures = fixtures; }

  query(input: MarketDataQuery): QuantBar[] {
    if (!input.symbol.trim()) throw new TypeError("symbol is required");
    const start = input.startDate ? Date.parse(input.startDate) : -Infinity;
    const end = input.endDate ? Date.parse(input.endDate) : Infinity;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end) throw new RangeError("invalid date range");
    return this.fixtures.filter((bar) => bar.symbol === input.symbol && Date.parse(bar.timestamp) >= start && Date.parse(bar.timestamp) <= end);
  }
}
