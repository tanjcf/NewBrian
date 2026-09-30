import assert from "node:assert/strict";
import test from "node:test";
import { aggregateDataset, summarizeNumericColumns } from "./data-analysis-service.ts";
test("creates deterministic numeric summary artifacts", () => {
  const input = { datasetId: "d1", contentHash: "a".repeat(64), columns: [{ key: "name", type: "string" }, { key: "close", type: "number" }], rows: [["A", "10"], ["B", "20"], ["C", "bad"]], createdAt: "2026-08-20T00:00:00Z" };
  const result = summarizeNumericColumns(input);
  assert.deepEqual(result.columns, [{ key: "close", count: 2, missingCount: 1, min: 10, max: 20, mean: 15, median: 15, standardDeviation: 7.07106781 }]);
  assert.equal(result.inputHash, summarizeNumericColumns(input).inputHash);
});
test("aggregates grouped metrics with topN and period comparison", () => {
  const input = {
    datasetId: "d2",
    contentHash: "b".repeat(64),
    columns: [
      { key: "region", type: "string" },
      { key: "quarter", type: "string" },
      { key: "revenue", type: "number" }
    ],
    rows: [
      ["华东", "2025Q1", "100"],
      ["华东", "2025Q2", "120"],
      ["华北", "2025Q1", "80"],
      ["华北", "2025Q2", "72"]
    ],
    groupBy: ["region"],
    metrics: [{ column: "revenue", operation: "sum" as const }],
    topN: 2,
    orderBy: { metric: "sum_revenue", direction: "desc" as const },
    periodColumn: "quarter",
    compareMetric: "revenue",
    createdAt: "2026-08-20T00:00:00Z"
  };
  const result = aggregateDataset(input);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].region, "华东");
  assert.equal(result.rows[0].sum_revenue, 220);
  assert.equal(result.periodComparison?.length, 2);
  assert.equal(result.periodComparison?.find((item) => item.keys.region === "华北")?.changePercent, -10);
  assert.equal(result.inputHash, aggregateDataset(input).inputHash);
});
