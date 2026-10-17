/**
 * MODEL-STABILITY-FALLBACK-SMOKE-001
 * Packaging must run this case and stop when it fails.
 * A rate-limit reply must advance the server-provided fallback chain.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { advanceAutoModelFallback, isAbnormalModelStepError } from "./model-auto-router.ts";

test("MODEL-STABILITY-FALLBACK-SMOKE-001 switches after a Chinese rate-limit error", () => {
  const error = new Error("请求未能完成：模型请求过于频繁，请稍后再试");
  assert.equal(isAbnormalModelStepError(error), true);
  const advanced = advanceAutoModelFallback({
    selected: "model-a",
    fallback_chain: ["model-b", "model-c"],
    fallback_index: 0
  });
  assert.deepEqual(advanced, { model: "model-b", fallback_index: 1 });
  assert.equal(isAbnormalModelStepError(new Error("HTTP 401 unauthorized")), false);
});
