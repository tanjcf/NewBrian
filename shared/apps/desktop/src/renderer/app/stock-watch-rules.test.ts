import assert from "node:assert/strict";
import test from "node:test";
import { evaluateStockWatchRule, type StockWatchBar } from "./stock-watch-rules.ts";

const bars = (values: number[]): StockWatchBar[] => values.map((close, index) => ({
  symbol: "510300", timestamp: new Date(Date.UTC(2026, 0, index + 1)).toISOString(), close,
  source: { provider: "fixture-market" }
}));

test("price rules evaluate the latest real closed bar", () => {
  assert.equal(evaluateStockWatchRule({ type: "price_above", value: 4 }, bars([4.2])).active, true);
  assert.equal(evaluateStockWatchRule({ type: "price_below", value: 4 }, bars([4.2])).active, false);
});

test("MA rules use the latest 5 and 20 closed bars", () => {
  const rising = bars(Array.from({ length: 20 }, (_, index) => index + 1));
  assert.equal(evaluateStockWatchRule({ type: "ma_cross_up" }, rising).active, true);
  assert.equal(evaluateStockWatchRule({ type: "ma_cross_down" }, rising).active, false);
});

test("partial bars are excluded and insufficient baselines are explicit", () => {
  assert.throws(() => evaluateStockWatchRule({ type: "ma_cross_up" }, bars([1, 2, 3])), /INSUFFICIENT_CLOSED_BARS/);
  const points = bars(Array.from({ length: 20 }, (_, index) => index + 1));
  points[19].closed = false;
  assert.equal(evaluateStockWatchRule({ type: "price_above", value: 1 }, points).timestamp, points[18].timestamp);
});
