import assert from "node:assert/strict";
import test from "node:test";
import {
  SUBSCRIPTION_INACTIVE_USER_MESSAGE,
  isSubscriptionInactiveError,
  isUserCancelledModelError,
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

test("treats manual stop and abort as a normal cancellation, not a failure", () => {
  assert.equal(isUserCancelledModelError("This operation was aborted"), true);
  assert.equal(isUserCancelledModelError(new Error("AbortError: The user aborted a request.")), true);
  assert.equal(isUserCancelledModelError("Agent loop was cancelled."), true);
  assert.equal(isUserCancelledModelError("User requested cancellation."), true);
  assert.equal(isUserCancelledModelError("当前任务已停止。"), true);
  assert.equal(isUserCancelledModelError("用户已请求停止当前任务"), true);
  assert.equal(isUserCancelledModelError("上一轮请求已被新消息取代或手动停止。请查看最新回复，或重试上一轮。"), true);
  assert.equal(isUserCancelledModelError("无法连接模型服务"), false);
  assert.equal(isUserCancelledModelError("模型请求过于频繁，请稍后再试。"), false);
});
