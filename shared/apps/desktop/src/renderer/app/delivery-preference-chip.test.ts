import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_DELIVERY_PREFERENCE_CHIP,
  normalizeDeliveryPreferenceChip
} from "./delivery-preference-chip.ts";

test("normalizeDeliveryPreferenceChip fills defaults", () => {
  assert.deepEqual(normalizeDeliveryPreferenceChip(null), EMPTY_DELIVERY_PREFERENCE_CHIP);
  const next = normalizeDeliveryPreferenceChip({
    visible: true,
    hasStyle: true,
    scope: "thread",
    scopeLabel: "本对话",
    summary: "SimSun 行距1.5",
    canClear: true,
    canPin: true,
    styleGapQuestion: ""
  });
  assert.equal(next.scope, "thread");
  assert.equal(next.canPin, true);
  assert.equal(next.summary, "SimSun 行距1.5");
});
