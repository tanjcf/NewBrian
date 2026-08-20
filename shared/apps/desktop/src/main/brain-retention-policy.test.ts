import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_BRAIN_RETENTION, selectRetentionVictims } from "./brain-retention-policy.ts";

test("selects expired retention victims before count overflow", () => {
  const nowMs = Date.parse("2026-08-20T00:00:00.000Z");
  const victims = selectRetentionVictims([
    { id: "old", createdAt: "2020-01-01T00:00:00.000Z" },
    { id: "keep-a", createdAt: "2026-08-19T00:00:00.000Z" },
    { id: "keep-b", createdAt: "2026-08-18T00:00:00.000Z" }
  ], { maxCount: 10, maxAgeMs: 7 * 24 * 60 * 60 * 1_000 }, nowMs);
  assert.deepEqual(victims, ["old"]);
});

test("selects oldest overflow victims when over maxCount", () => {
  const victims = selectRetentionVictims([
    { id: "a", createdAt: "2026-08-01T00:00:00.000Z" },
    { id: "b", createdAt: "2026-08-02T00:00:00.000Z" },
    { id: "c", createdAt: "2026-08-03T00:00:00.000Z" }
  ], { maxCount: 2, maxAgeMs: Number.MAX_SAFE_INTEGER }, Date.parse("2026-08-20T00:00:00.000Z"));
  assert.deepEqual(victims, ["a"]);
});

test("keeps separate default budgets for each retention class", () => {
  assert.notEqual(DEFAULT_BRAIN_RETENTION.projectMetadata.maxCount, DEFAULT_BRAIN_RETENTION.cache.maxCount);
  assert.ok(DEFAULT_BRAIN_RETENTION.cache.maxAgeMs < DEFAULT_BRAIN_RETENTION.artifacts.maxAgeMs);
  assert.ok(DEFAULT_BRAIN_RETENTION.diagnostics.maxCount < DEFAULT_BRAIN_RETENTION.artifacts.maxCount);
});
