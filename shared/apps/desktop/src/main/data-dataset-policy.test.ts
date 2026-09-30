import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDataset } from "./data-dataset-policy.ts";

test("normalizes a bounded dataset contract", () => {
  const dataset = normalizeDataset({ id: "d1", projectId: "p1", name: "指标", columns: [{ key: "close", label: "收盘价", type: "number" }], rowCount: 2, contentHash: "A".repeat(64), updatedAt: "2026-01-01T00:00:00Z" });
  assert.equal(dataset.contentHash, "a".repeat(64));
});

test("rejects duplicate or unsafe columns", () => {
  assert.throws(() => normalizeDataset({ id: "d1", projectId: "p1", name: "bad", columns: [{ key: "x", label: "x", type: "string" }, { key: "x", label: "x2", type: "string" }], rowCount: 0, contentHash: "a".repeat(64), updatedAt: "now" }), /BRAIN_DATASET_COLUMN_INVALID/);
});
