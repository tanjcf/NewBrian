import assert from "node:assert/strict";
import test from "node:test";

const { ModelChatFailureService } = await import(
  new URL("./model-chat-failure-service.ts", import.meta.url).href
);

function fixture() {
  const events: Array<Record<string, unknown>> = [];
  const metadata: Array<Record<string, unknown>> = [];
  const reports: Array<Record<string, unknown>> = [];
  const state = { messages: [] as Array<Record<string, unknown>> };
  const service = new ModelChatFailureService({
    nowIso: () => "2026-07-17T00:00:00.000Z",
    readThreadState: async () => state as never,
    writeThreadState: async () => undefined,
    createEvent: (_type: string, payload: Record<string, unknown>) => ({ payload }) as never,
    appendEvents: async (_workspace: unknown, _thread: unknown, next: Array<{ payload: Record<string, unknown> }>) => {
      events.push(...next.map((event) => event.payload));
    },
    updateMetadata: async (next: Record<string, unknown>) => { metadata.push(next); },
    reportFailure: async (next: Record<string, unknown>) => { reports.push(next); }
  } as never);
  return { service, events, metadata, reports, state };
}

test("persists a canonical cancellation event and failed metadata", async () => {
  const state = fixture();
  await state.service.persistCancellation({ id: "ws" }, { id: "thread" }, "turn");
  assert.equal(state.events[0].code, "cancelled_by_user");
  assert.equal(state.metadata[0].statusLabel, "Cancelled");
});

test("keeps failed reasoning display-only and records the failure", async () => {
  const state = fixture();
  await state.service.persistFailure({
    workspace: { id: "ws" },
    thread: { id: "thread" },
    requestId: "request-1",
    turnId: "turn",
    reasoningSummary: "progress",
    error: new Error("gateway failed")
  });
  assert.equal(state.state.messages[0].excludeFromModelContext, true);
  assert.match(String(state.state.messages[0].reasoningSummary), /gateway failed/);
  assert.equal(state.metadata[0].status, "failed");
  assert.equal(state.reports[0].kind, "model_request_failed");
  assert.equal(state.reports[0].message, "gateway failed");
  assert.equal(state.reports[0].context.terminal, true);
  assert.equal(state.reports[0].context.failureCode, "model_request_failed");
});

test("labels model callback timeouts as the terminal failure code", async () => {
  const state = fixture();
  const error = Object.assign(new Error("Agent model callback timed out: model_23"), { code: "model_callback_timeout" });
  await state.service.persistFailure({
    workspace: { id: "ws" },
    thread: { id: "thread" },
    requestId: "request-2",
    turnId: "turn-2",
    reasoningSummary: "",
    error
  });
  assert.equal(state.reports[0].message, "Agent model callback timed out: model_23");
  assert.equal(state.reports[0].context.failureCode, "model_callback_timeout");
  assert.equal(state.reports[0].context.terminal, true);
  assert.equal(state.state.messages[0].id, "request-2");
  assert.match(String(state.state.messages[0].content), /model_23/);
  assert.equal(state.state.messages[0].excludeFromModelContext, true);
});

test("classifies reasoning context gateway errors for automatic repair", async () => {
  const state = fixture();
  await state.service.persistFailure({
    workspace: { id: "ws" },
    thread: { id: "thread" },
    requestId: "request-reasoning",
    turnId: "turn-reasoning",
    reasoningSummary: "正在继续工具调用",
    error: new Error("模型网关请求失败（HTTP 400）；The reasoning_content in the thinking mode must be passed back to the API.")
  });
  assert.equal(state.events.at(-1)?.code, "gateway_reasoning_context_required");
  assert.equal(state.events.at(-1)?.remediation, "retry_without_stale_thinking_context");
  assert.equal(state.reports[0].context.failureCode, "gateway_reasoning_context_required");
  assert.equal(state.reports[0].context.httpStatus, 400);
});

test("persists a visible failure assistant when approval/media fail with empty stream", async () => {
  const state = fixture();
  await state.service.persistFailure({
    workspace: { id: "ws" },
    thread: { id: "thread" },
    requestId: "local-assistant-empty",
    turnId: "turn-empty",
    reasoningSummary: "",
    partialContent: "",
    error: new Error("provider rejected media connectivity request")
  });
  assert.equal(state.state.messages.length, 1);
  assert.match(String(state.state.messages[0].content), /media connectivity request/);
  assert.match(String(state.state.messages[0].reasoningSummary), /media connectivity request/);
  assert.equal(state.state.messages[0].excludeFromModelContext, true);
});

test("labels agent loop stall failures with a dedicated failure code", async () => {
  const state = fixture();
  await state.service.persistFailure({
    workspace: { id: "ws" },
    thread: { id: "thread" },
    requestId: "request-stall",
    turnId: "turn-stall",
    reasoningSummary: "",
    error: new Error("Agent loop stalled: no tool progress across 4 consecutive steps.")
  });
  assert.equal(state.events.at(-1)?.code, "agent_loop_stalled");
  assert.equal(state.reports[0].context.failureCode, "agent_loop_stalled");
});

test("labels subscription inactive refusals as subscription_inactive with purchase guidance", async () => {
  const state = fixture();
  await state.service.persistFailure({
    workspace: { id: "ws" },
    thread: { id: "thread" },
    requestId: "request-sub",
    turnId: "turn-sub",
    reasoningSummary: "",
    error: new Error("subscription inactive or expired")
  });
  assert.equal(state.events.at(-1)?.code, "subscription_inactive");
  assert.equal(state.events.at(-1)?.remediation, "renew_or_contact_admin");
  assert.equal(state.metadata[0].statusLabel, "订阅失效");
  assert.match(String(state.state.messages[0].content), /重新购买订阅/);
  assert.match(String(state.state.messages[0].content), /联系管理员/);
  assert.doesNotMatch(String(state.state.messages[0].content), /本轮执行失败：subscription inactive/);
  assert.equal(state.reports[0].context.failureCode, "subscription_inactive");
  assert.match(String(state.reports[0].context.userFacingMessage), /重新购买订阅/);
});

test("persists streamed partial content when a turn fails mid-generation", async () => {
  const state = fixture();
  await state.service.persistFailure({
    workspace: { id: "ws" },
    thread: { id: "thread" },
    requestId: "local-assistant-partial",
    turnId: "turn-partial",
    reasoningSummary: "正在生成视频",
    partialContent: "半成品分镜 1：开场淡入",
    error: new Error("model stream aborted")
  });
  assert.equal(state.state.messages[0].id, "local-assistant-partial");
  assert.equal(state.state.messages[0].content, "半成品分镜 1：开场淡入");
  assert.equal(state.state.messages[0].excludeFromModelContext, true);
  assert.match(String(state.state.messages[0].reasoningSummary), /model stream aborted/);
});
