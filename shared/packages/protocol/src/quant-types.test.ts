import assert from "node:assert/strict";
import test from "node:test";
import type { QuantBar } from "./quant-types.js";

test("quant protocol exposes bar fields needed by the chart", () => {
  const bar: QuantBar = { symbol: "600519", timestamp: "2026-08-19", open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, turnover: 15, changePercent: 1.2 };
  assert.equal(bar.close, 1.5);
  assert.equal(bar.turnover, 15);
});
