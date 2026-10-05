import assert from "node:assert/strict";
import test from "node:test";
import type { QuantBar } from "@codex-forge/protocol/quant-types";
import { quantStrategySignal, validateQuantStrategyRules } from "./quant-strategy-rules.ts";

function bars(closes: number[]): QuantBar[] {
  return closes.map((close, index) => ({ symbol: "600519", exchange: "SSE", timezone: "Asia/Shanghai", interval: "1d", adjustment: "forward",
    timestamp: `2026-06-${String(index + 1).padStart(2, "0")}T15:00:00+08:00`, open: close, high: close + 1, low: close - 1,
    close, volume: 1_000 + index, turnover: 10_000, changePercent: 0, source: { provider: "fixture", dataset: "test", fetchedAt: "2026-08-23T00:00:00Z" } }));
}

test("custom declarative strategy detects buy and sell crossings", () => {
  const rules = validateQuantStrategyRules({
    buy: { all: [{ left: { metric: "close" }, comparison: "crosses_above", right: { metric: "sma", period: 3 } }] },
    sell: { all: [{ left: { metric: "close" }, comparison: "crosses_below", right: { metric: "sma", period: 3 } }] },
    tracking: { any: [{ left: { metric: "volume" }, comparison: "above", right: { value: 1_005 } }] }
  });
  assert.equal(quantStrategySignal(rules, bars([10, 10, 10, 10, 11])), "buy");
  assert.equal(quantStrategySignal(rules, bars([10, 10, 10, 10, 9])), "sell");
});

test("custom rules reject unsafe operators, metrics, and unbounded moving averages", () => {
  const base = { buy: { all: [{ left: { metric: "close" }, comparison: "above", right: { value: 1 } }] }, sell: { all: [{ left: { metric: "close" }, comparison: "below", right: { value: 1 } }] } };
  assert.throws(() => validateQuantStrategyRules({ ...base, buy: { all: [{ left: { metric: "close" }, comparison: "eval", right: { value: 1 } }] } }), /condition is invalid/);
  assert.throws(() => validateQuantStrategyRules({ ...base, buy: { all: [{ left: { metric: "sma", period: 100_000 }, comparison: "above", right: { value: 1 } }] } }), /condition is invalid/);
});
