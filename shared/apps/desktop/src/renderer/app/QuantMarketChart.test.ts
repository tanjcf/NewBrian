import assert from "node:assert/strict";
import test from "node:test";
import { drillTargetForBar, movingAverage } from "./QuantMarketChart.logic.ts";

const sample = {
  timestamp: "2026-05-15T00:00:00+08:00",
  open: 10,
  high: 12,
  low: 9,
  close: 11,
  volume: 1000
};

test("monthly bar drills into weekly range for that calendar month", () => {
  const target = drillTargetForBar("月线", sample);
  assert.equal(target.interval, "周线");
  assert.equal(target.startDate, "2026-05-01");
  assert.equal(target.endDate, "2026-05-31");
  assert.equal(target.dayPath, undefined);
});

test("weekly bar drills into daily range for that ISO week", () => {
  const target = drillTargetForBar("周线", sample);
  assert.equal(target.interval, "日线");
  assert.equal(target.startDate, "2026-05-11");
  assert.equal(target.endDate, "2026-05-17");
});

test("daily bar opens day-path view from known OHLC without inventing minutes", () => {
  const target = drillTargetForBar("日线", sample);
  assert.equal(target.interval, "日线");
  assert.equal(target.startDate, "2026-05-15");
  assert.equal(target.endDate, "2026-05-15");
  assert.equal(target.dayPath?.high, 12);
  assert.equal(target.dayPath?.low, 9);
});

test("moving averages preserve leading gaps and calculate rolling close averages", () => {
  const bars = [10, 12, 14, 16].map((close, index) => ({ ...sample, timestamp: `2026-05-${10 + index}`, close }));
  assert.deepEqual(movingAverage(bars, 3), [null, null, 12, 14]);
});
