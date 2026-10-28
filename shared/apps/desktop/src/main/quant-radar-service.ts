import type { MarketDataQuery, QuantBar } from "@codex-forge/protocol/quant-types";
import { quantSkillSignal } from "./quant-skill-signal.ts";
import { quantRuleGroupMatches, type QuantStrategyRules } from "./quant-strategy-rules.ts";

export type QuantRadarCandidate = { symbol: string; signal: "buy_candidate" | "tracking"; latest: QuantBar; market: Record<string, unknown> };
export type QuantRadarScanResult = {
  simulationOnly: true;
  ordersCreated: 0;
  strategyId: string;
  scannedCount: number;
  matches: QuantRadarCandidate[];
};

export class QuantRadarService {
  private readonly queryScreener: (criteria: Record<string, unknown>) => Promise<{ items: Array<Record<string, unknown>> }>;
  private readonly queryBars: (query: MarketDataQuery) => Promise<QuantBar[]>;

  constructor(input: {
    queryScreener: (criteria: Record<string, unknown>) => Promise<{ items: Array<Record<string, unknown>> }>;
    queryBars: (query: MarketDataQuery) => Promise<QuantBar[]>;
  }) {
    this.queryScreener = input.queryScreener;
    this.queryBars = input.queryBars;
  }

  async scan(input: { strategyId: string; rules?: QuantStrategyRules; criteria: Record<string, unknown>; limit?: number }): Promise<QuantRadarScanResult> {
    const limit = Number.isInteger(input.limit) ? Math.max(1, Math.min(100, Number(input.limit))) : 100;
    const screened = await this.queryScreener({ ...input.criteria, limit });
    const candidates = screened.items.slice(0, limit).map((market) => ({
      market,
      symbol: String(market.symbol || market.code || market.stockCode || market.stock_code || "").trim()
    })).filter((candidate) => /^[0-9A-Za-z._-]{1,32}$/.test(candidate.symbol));
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 90);
    const startDate = start.toISOString().slice(0, 10);
    const endDate = end.toISOString().slice(0, 10);
    const matches: QuantRadarCandidate[] = [];
    for (let offset = 0; offset < candidates.length; offset += 10) {
      const batch = candidates.slice(offset, offset + 10);
      const results = await Promise.all(batch.map(async (candidate) => {
        const bars = await this.queryBars({ symbol: candidate.symbol, interval: "1d", adjustment: "forward", startDate, endDate });
        if (bars.length < 20) return null;
        const signal = quantSkillSignal(input.strategyId, bars, input.rules);
        const tracking = input.rules?.tracking ? quantRuleGroupMatches(bars, input.rules.tracking) : false;
        if (signal !== "buy" && !tracking) return null;
        return { symbol: candidate.symbol, signal: signal === "buy" ? "buy_candidate" as const : "tracking" as const, latest: bars.at(-1)!, market: candidate.market };
      }));
      matches.push(...results.filter((result): result is QuantRadarCandidate => result !== null));
    }
    return { simulationOnly: true, ordersCreated: 0, strategyId: input.strategyId, scannedCount: candidates.length, matches };
  }
}
