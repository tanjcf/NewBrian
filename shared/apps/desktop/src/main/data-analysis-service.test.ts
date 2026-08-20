import assert from "node:assert/strict";
import test from "node:test";
import { summarizeNumericColumns } from "./data-analysis-service.ts";
test("creates deterministic numeric summary artifacts", () => {
  const input = { datasetId: "d1", contentHash: "a".repeat(64), columns: [{ key: "name", type: "string" }, { key: "close", type: "number" }], rows: [["A", "10"], ["B", "20"], ["C", "bad"]], createdAt: "2026-08-20T00:00:00Z" };
  const result = summarizeNumericColumns(input);
  assert.deepEqual(result.columns, [{ key: "close", count: 2, min: 10, max: 20, mean: 15 }]);
  assert.equal(result.inputHash, summarizeNumericColumns(input).inputHash);
});
