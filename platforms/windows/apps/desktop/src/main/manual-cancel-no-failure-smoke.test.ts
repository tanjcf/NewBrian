/**
 * MANUAL-CANCEL-NO-FAILURE-SMOKE-001
 * Packaging must run this case and stop when it fails.
 * Manual stop is a normal end of turn. It must not open the
 * "生成异常终止" failure card or invent "请求未能完成" copy.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  isUserCancelledModelError
} from "../../../../../../shared/apps/desktop/src/shared/model-user-facing-error.ts";
import {
  projectModelChatCancellation,
  projectModelChatFailure
} from "../renderer/app/model-chat-failure-projection.ts";

const CASE_ID = "MANUAL-CANCEL-NO-FAILURE-SMOKE-001";

function readFirstExisting(relativeUrls: string[]) {
  for (const relativeUrl of relativeUrls) {
    const file = fileURLToPath(new URL(relativeUrl, import.meta.url));
    if (existsSync(file)) return { file, source: readFileSync(file, "utf8") };
  }
  throw new Error(`Missing smoke source: ${relativeUrls.join(" | ")}`);
}

function sliceFunction(source: string, signature: string) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing ${signature}`);
  const next = source.indexOf("\n  async function ", start + signature.length);
  const nextBare = source.indexOf("\n  function ", start + signature.length);
  const endCandidates = [next, nextBare].filter((index) => index >= 0);
  const end = endCandidates.length ? Math.min(...endCandidates) : -1;
  return source.slice(start, end === -1 ? undefined : end);
}

test(`${CASE_ID} treats abort and manual stop as normal cancellation`, () => {
  assert.equal(isUserCancelledModelError("This operation was aborted"), true);
  assert.equal(isUserCancelledModelError(new Error("AbortError")), true);
  assert.equal(isUserCancelledModelError("Agent loop was cancelled."), true);
  assert.equal(isUserCancelledModelError("User requested cancellation."), true);
  assert.equal(isUserCancelledModelError("当前任务已停止。"), true);
  assert.equal(
    isUserCancelledModelError("上一轮请求已被新消息取代或手动停止。请查看最新回复，或重试上一轮。"),
    true
  );
  assert.equal(isUserCancelledModelError("无法连接模型服务"), false);
  assert.equal(isUserCancelledModelError("模型请求过于频繁，请稍后再试。"), false);

  const cancelled = projectModelChatCancellation({
    content: "",
    reasoningSummary: "思考中"
  }, "已写出一半");
  assert.equal(cancelled.content, "已写出一半");
  assert.equal(cancelled.reasoningSummary, "思考中");
  assert.equal(cancelled.excludeFromModelContext, true);
  assert.doesNotMatch(cancelled.content, /请求未能完成/);
  assert.doesNotMatch(cancelled.reasoningSummary, /发生异常/);

  const emptyCancel = projectModelChatCancellation({ content: "", reasoningSummary: "" }, "");
  assert.equal(emptyCancel.content, "");
  assert.doesNotMatch(JSON.stringify(emptyCancel), /请求未能完成|发生异常/);

  const failure = projectModelChatFailure({ content: "", reasoningSummary: "" }, "网关不可达");
  assert.match(failure.content, /请求未能完成/);
  assert.match(failure.reasoningSummary, /发生异常/);
});

test(`${CASE_ID} keeps the canceled mark across cancelModelRequest`, () => {
  const { source: runtimeSource } = readFirstExisting([
    "../../../../../../shared/apps/desktop/src/main/runtime-command-service.ts",
    "../../../src/main/runtime-command-service.ts"
  ]);
  const cancelFn = sliceFunction(runtimeSource, "async cancelModelRequest(input: { requestId?: string })");
  assert.match(cancelFn, /markModelRequestCanceled\(requestId\)/);
  assert.match(cancelFn, /abortController\.abort\(\)/);
  assert.match(cancelFn, /removeModelTask\?\.\(requestId\)/);
  assert.doesNotMatch(
    cancelFn,
    /clearCanceledModelRequest\?\.\(requestId\)/,
    "clearing the canceled mark inside cancelModelRequest races persistFailure"
  );
});

test(`${CASE_ID} persists cancellation for abort even when the canceled set was cleared`, () => {
  const { source: chatSource } = readFirstExisting([
    "../../../../../../shared/apps/desktop/src/main/model-chat-service.ts",
    "../../../src/main/model-chat-service.ts"
  ]);
  assert.match(chatSource, /isUserCancelledModelError/);
  assert.match(
    chatSource,
    /isCanceled\(input\.requestId\)\s*\|\|\s*isUserCancelledModelError\(error\)/
  );
  const persistFailureCount = (chatSource.match(/persistFailure\(/g) || []).length;
  assert.ok(persistFailureCount >= 2, "expected persistFailure call sites to remain guarded");
});

test(`${CASE_ID} keeps the failure card off the manual-stop path`, () => {
  const { source: uiSource } = readFirstExisting([
    "../renderer/ui.tsx",
    "../../../../../../platforms/windows/apps/desktop/src/renderer/ui.tsx"
  ]);
  const { source: workspaceSource } = readFirstExisting([
    "../renderer/app/WorkspaceModules.tsx",
    "../../../../../../shared/apps/desktop/src/renderer/app/WorkspaceModules.tsx"
  ]);

  assert.match(uiSource, /isUserCancelledModelError\(error\)/);
  assert.match(uiSource, /projectModelChatCancellation/);
  assert.match(uiSource, /userCancelledRequestIdsRef/);
  assert.match(uiSource, /if \(userCancelled\)/);
  assert.match(uiSource, /setGenerationFailure\(null\)/);
  assert.match(uiSource, /setGenerationFailure\(\{ threadId: targetThreadId, message \}\)/);
  assert.match(uiSource, /已停止生成/);

  const cancelFn = sliceFunction(uiSource, "async function cancelCurrentModelRequest()");
  assert.match(cancelFn, /userCancelledRequestIdsRef\.current\.add\(requestId\)/);
  assert.match(cancelFn, /setGenerationFailure\(null\)/);
  assert.match(cancelFn, /已停止生成/);
  assert.match(cancelFn, /activeModelRequestIdRef\.current/);
  assert.ok(
    cancelFn.indexOf("userCancelledRequestIdsRef.current.add(requestId)")
      < cancelFn.indexOf("api.cancelModelRequest"),
    "mark cancel before invoking cancelModelRequest"
  );
  assert.doesNotMatch(
    cancelFn,
    /userCancelledRequestIdsRef\.current\.delete\(requestId\)/,
    "must not drop the cancel mark when cancelModelRequest returns !ok"
  );

  assert.match(
    workspaceSource,
    /!isUserCancelledModelError\(ctx\.generationFailure\.message\)/
  );
  assert.match(workspaceSource, /generation-failure-card/);
  assert.match(workspaceSource, /生成异常终止/);
});
