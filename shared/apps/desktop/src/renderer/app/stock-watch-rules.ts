export type StockWatchRule =
  | { type: "ma_cross_up"; value?: never }
  | { type: "ma_cross_down"; value?: never }
  | { type: "price_above" | "price_below"; value: number };

export type StockWatchBar = {
  symbol?: string;
  timestamp?: string;
  close?: number;
  closed?: boolean;
  source?: { provider?: string };
};

export type StockWatchEvaluation = {
  active: boolean;
  price: number;
  timestamp: string;
  provider: string;
  ma5?: number;
  ma20?: number;
};

/** Evaluate reference-only daily rules using real, closed market bars. */
export function evaluateStockWatchRule(rule: StockWatchRule, bars: StockWatchBar[]): StockWatchEvaluation {
  const points = bars
    .filter((bar) => bar.closed !== false && typeof bar.close === "number" && Number.isFinite(bar.close) && bar.close > 0 && typeof bar.timestamp === "string")
    .sort((left, right) => Date.parse(left.timestamp!) - Date.parse(right.timestamp!));
  const latest = points.at(-1);
  if (!latest || !latest.timestamp || !latest.source?.provider) throw new Error("NO_VALID_CLOSED_MARKET_BAR");

  if (rule.type === "price_above" || rule.type === "price_below") {
    if (!Number.isFinite(rule.value) || rule.value <= 0) throw new Error("INVALID_PRICE_THRESHOLD");
    return {
      active: rule.type === "price_above" ? latest.close! >= rule.value : latest.close! <= rule.value,
      price: latest.close!, timestamp: latest.timestamp, provider: latest.source.provider
    };
  }

  if (points.length < 20) throw new Error("INSUFFICIENT_CLOSED_BARS");
  const ma5 = points.slice(-5).reduce((total, bar) => total + bar.close!, 0) / 5;
  const ma20 = points.slice(-20).reduce((total, bar) => total + bar.close!, 0) / 20;
  return {
    active: rule.type === "ma_cross_up" ? ma5 > ma20 : ma5 < ma20,
    price: latest.close!, timestamp: latest.timestamp, provider: latest.source.provider, ma5, ma20
  };
}
