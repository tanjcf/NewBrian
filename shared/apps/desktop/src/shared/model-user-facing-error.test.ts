import assert from "node:assert/strict";
import test from "node:test";
import {
  SUBSCRIPTION_INACTIVE_USER_MESSAGE,
  isSubscriptionInactiveError,
  mapSubscriptionInactiveUserMessage,
  toUserFacingModelFailureMessage
} from "./model-user-facing-error.ts";

test("detects English and Chinese subscription inactive/expired refusals", () => {
  assert.equal(isSubscriptionInactiveError("subscription inactive or expired"), true);
  assert.equal(isSubscriptionInactiveError(new Error("HTTP 403: Subscription inactive or expired")), true);
  assert.equal(isSubscriptionInactiveError("订阅已过期，请续费"), true);
  assert.equal(isSubscriptionInactiveError("gateway failed"), false);
});

test("maps subscription refusals to purchase/admin guidance", () => {
  assert.equal(
    mapSubscriptionInactiveUserMessage("subscription inactive or expired"),
    SUBSCRIPTION_INACTIVE_USER_MESSAGE
  );
  assert.equal(mapSubscriptionInactiveUserMessage("other"), null);
  assert.equal(
    toUserFacingModelFailureMessage("subscription inactive or expired"),
    SUBSCRIPTION_INACTIVE_USER_MESSAGE
  );
  assert.equal(toUserFacingModelFailureMessage("gateway failed"), "gateway failed");
});
