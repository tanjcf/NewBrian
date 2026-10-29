/**
 * GATEWAY-TIMEOUT-FAILURE-CARD-SMOKE-001
 * Real HTTP 524/504 gateway wait timeouts must stay visible as a failure card,
 * but with timeout (not crash) copy — distinct from manual cancel.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  MODEL_GATEWAY_TIMEOUT_USER_MESSAGE,
  isModelGatewayTimeoutError,
  isUserCancelledModelError,
  mapModelGatewayTimeoutUserMessage,
  toUserFacingModelFailureMessage
} from "./model-user-facing-error.ts";

const CASE_ID = "GATEWAY-TIMEOUT-FAILURE-CARD-SMOKE-001";

function readFirstPresent(urls: URL[]) {
  for (const url of urls) {
    const path = fileURLToPath(url);
    if (existsSync(path)) return readFileSync(path, "utf8");
  }
  throw new Error(`missing sources: ${urls.map((u) => fileURLToPath(u)).join(" | ")}`);
}

test(`${CASE_ID} classifies HTTP 524 as gateway timeout, not cancel`, () => {
  const raw = "模型网关请求失败（HTTP 524）";
  assert.equal(isModelGatewayTimeoutError(raw), true);
  assert.equal(isUserCancelledModelError(raw), false);
  assert.equal(mapModelGatewayTimeoutUserMessage(raw), MODEL_GATEWAY_TIMEOUT_USER_MESSAGE);
  assert.equal(toUserFacingModelFailureMessage(raw), MODEL_GATEWAY_TIMEOUT_USER_MESSAGE);
  assert.match(MODEL_GATEWAY_TIMEOUT_USER_MESSAGE, /超时/);
  assert.match(MODEL_GATEWAY_TIMEOUT_USER_MESSAGE, /视频/);
  assert.doesNotMatch(MODEL_GATEWAY_TIMEOUT_USER_MESSAGE, /异常终止|崩溃/);
});

test(`${CASE_ID} projects timeout title/copy on the failure card`, () => {
  const workspace = readFileSync(
    fileURLToPath(new URL("../renderer/app/WorkspaceModules.tsx", import.meta.url)),
    "utf8"
  );
  assert.match(workspace, /isModelGatewayTimeoutError/);
  assert.match(workspace, /生成超时中断/);
  assert.match(workspace, /不是本地崩溃/);
  assert.match(
    workspace,
    /!isUserCancelledModelError\(ctx\.generationFailure\.message\)/
  );
  assert.match(workspace, /generation-failure-card/);
  // Real failures still render; timeout only changes title, not hide the card.
  assert.match(workspace, /生成异常终止/);
});

test(`${CASE_ID} normalizes gateway timeout in platform renderer error paths`, () => {
  const windowsUi = readFirstPresent([
    new URL("../renderer/ui.tsx", import.meta.url),
    new URL("../../../../../platforms/windows/apps/desktop/src/renderer/ui.tsx", import.meta.url)
  ]);
  assert.match(windowsUi, /mapModelGatewayTimeoutUserMessage/);
  assert.match(windowsUi, /const gatewayTimeoutMessage = mapModelGatewayTimeoutUserMessage\(message\)/);
  assert.match(windowsUi, /if \(gatewayTimeoutMessage\) return gatewayTimeoutMessage/);
});
