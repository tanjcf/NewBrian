import assert from "node:assert/strict";
import test from "node:test";

test("quant market contract skips when BRAIN_MARKET_DATA_URL is unset", async (t) => {
  if (process.env.BRAIN_MARKET_DATA_URL?.trim()) {
    t.skip("live market gateway configured separately");
  }
  assert.equal(process.env.BRAIN_MARKET_DATA_URL?.trim(), undefined);
});

test("quant market contract accepts configured gateway when present", async (t) => {
  const url = process.env.BRAIN_MARKET_DATA_URL?.trim();
  if (!url) t.skip("no live market gateway configured");
  const response = await fetch(`${url.replace(/\/$/, "")}/health`).catch(() => null);
  assert.ok(response, "market gateway health endpoint should respond when configured");
});
