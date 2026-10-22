import assert from "node:assert/strict";
import test from "node:test";
import {
  MODEL_GATEWAY_TIMEOUT_USER_MESSAGE,
  SUBSCRIPTION_INACTIVE_USER_MESSAGE,
  isModelGatewayTimeoutError,
  isSubscriptionInactiveError,
  isUserCancelledModelError,
  mapModelGatewayTimeoutUserMessage,
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

test("maps HTTP 524/504 gateway wait timeouts to clear non-crash copy", () => {
  assert.equal(isModelGatewayTimeoutError("模型网关请求失败（HTTP 524）"), true);
  assert.equal(isModelGatewayTimeoutError("模型网关请求失败 (HTTP 524)"), true);
  assert.equal(isModelGatewayTimeoutError(new Error("模型网关请求失败（HTTP 504）")), true);
  assert.equal(isModelGatewayTimeoutError("HTTP 524"), true);
  assert.equal(isModelGatewayTimeoutError("error code: 524"), false);
  assert.equal(isModelGatewayTimeoutError("模型网关请求失败（HTTP 500）"), false);
  assert.equal(isModelGatewayTimeoutError("This operation was aborted"), false);
  assert.equal(
    mapModelGatewayTimeoutUserMessage("模型网关请求失败（HTTP 524）"),
    MODEL_GATEWAY_TIMEOUT_USER_MESSAGE
  );
  assert.equal(
    toUserFacingModelFailureMessage("模型网关请求失败（HTTP 524）"),
    MODEL_GATEWAY_TIMEOUT_USER_MESSAGE
  );
  assert.match(MODEL_GATEWAY_TIMEOUT_USER_MESSAGE, /超时/);
  assert.match(MODEL_GATEWAY_TIMEOUT_USER_MESSAGE, /视频/);
  assert.doesNotMatch(MODEL_GATEWAY_TIMEOUT_USER_MESSAGE, /异常终止|崩溃/);
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
  assert.equal(isUserCancelledModelError("模型网关请求失败（HTTP 524）"), false);
});
