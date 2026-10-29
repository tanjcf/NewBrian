import assert from "node:assert/strict";
import test from "node:test";
import type { QuantBar } from "@codex-forge/protocol/quant-types";
import { QuantRadarService } from "./quant-radar-service.ts";

function bars(symbol: string): QuantBar[] {
  return Array.from({ length: 24 }, (_, index) => {
    const close = 10 + index;
    return { symbol, exchange: "SSE", timezone: "Asia/Shanghai", interval: "1d" as const, adjustment: "forward" as const,
      timestamp: `2026-06-${String(index + 1).padStart(2, "0")}T15:00:00+08:00`, open: close, high: close + 1, low: close - 1,
      close, volume: 1_000 + index, turnover: 10_000, changePercent: 1, source: { provider: "fixture", dataset: "test", fetchedAt: "2026-08-23T00:00:00Z" } };
  });
}

test("radar scans screener candidates and reports signals without placing orders", async () => {
  const calls: string[] = [];
  const radar = new QuantRadarService({
    queryScreener: async (criteria) => {
      assert.equal(criteria.limit, 100);
      return { items: [{ code: "600031", name: "三一重工" }, { code: "invalid/name" }] };
    },
    queryBars: async (query) => { calls.push(query.symbol); return bars(query.symbol); }
  });
  const result = await radar.scan({
    strategyId: "ma-breakout",
    criteria: {},
    rules: {
      buy: { all: [{ left: { metric: "close" }, comparison: "above", right: { value: 20 } }] },
      sell: { all: [{ left: { metric: "close" }, comparison: "below", right: { value: 5 } }] },
      tracking: { any: [{ left: { metric: "volume" }, comparison: "above", right: { value: 1_005 } }] }
    }
  });
  assert.deepEqual(calls, ["600031"]);
  assert.equal(result.scannedCount, 1);
  assert.equal(result.ordersCreated, 0);
  assert.equal(result.matches[0]?.signal, "buy_candidate");
});
