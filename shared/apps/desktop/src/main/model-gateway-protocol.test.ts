import assert from "node:assert/strict";
import test from "node:test";

const protocol = await import(new URL("./model-gateway-protocol.ts", import.meta.url).href);
const authPolicy = await import(new URL("./model-request-auth-policy.ts", import.meta.url).href);
const responseStream = await import(new URL("./model-response-stream.ts", import.meta.url).href);

test("normalizes model gateway URLs and endpoints", () => {
  assert.equal(protocol.resolveGatewayBaseUrl(" https://example.com/api/ "), "https://example.com/api");
  assert.equal(protocol.resolveGatewayOrigin("https://example.com/api"), "https://example.com");
  assert.equal(protocol.buildApiEndpoint("https://example.com/v1/", "responses"), "https://example.com/v1/responses");
  assert.throws(() => protocol.resolveGatewayOrigin("not a url"), /Invalid/);
});

test("extracts Responses JSON and SSE text safely", () => {
  assert.equal(protocol.extractResponsesText({ output: [{ content: [{ text: "first" }, { text: "second" }] }] }), "first\n\nsecond");
  assert.equal(protocol.extractResponsesTextFromSse('data: {"type":"response.output_text.delta","delta":"hel"}\n\ndata: {"type":"response.output_text.delta","delta":"lo"}\n\n'), "hello");
  assert.equal(protocol.extractResponsesTextFromSse('data: invalid\n\ndata: [DONE]\n\n'), "");
});

test("retries only transient gateway failures or explicit retryable payloads", () => {
  assert.equal(protocol.shouldRetryModelGatewayResponse(502, null), true);
  assert.equal(protocol.shouldRetryModelGatewayResponse(503, {}), true);
  assert.equal(protocol.shouldRetryModelGatewayResponse(504, null), true);
  assert.equal(protocol.shouldRetryModelGatewayResponse(429, { retryable: true }), true);
  assert.equal(protocol.shouldRetryModelGatewayResponse(400, { retryable: false }), false);
  assert.equal(protocol.shouldRetryModelGatewayResponse(500, "retryable"), false);
});

test("selects model credentials with explicit secure precedence", () => {
  assert.deepEqual(authPolicy.selectModelRequestAuth({
    mode: "desktop_token", access_token: " access "
  }, "configured"), {
    source: "desktop_access_token", bearerToken: "access", useGatewayBaseUrl: true
  });

  const previousBypass = process.env.NEWBRAIN_E2E_AUTH_BYPASS;
  const previousBaseUrl = process.env.NEWBRAIN_MODEL_BASE_URL;
  const previousDebugPort = process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT;
  process.env.NEWBRAIN_E2E_AUTH_BYPASS = "1";
  process.env.NEWBRAIN_MODEL_BASE_URL = "http://127.0.0.1:8790/v1";
  delete process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT;
  try {
    assert.deepEqual(authPolicy.selectModelRequestAuth({
      mode: "desktop_token", access_token: " live-user-token "
    }, ""), {
      source: "desktop_access_token", bearerToken: "live-user-token", useGatewayBaseUrl: true
    });
    assert.deepEqual(authPolicy.selectModelRequestAuth({
      mode: "desktop_token", access_token: ""
    }, ""), {
      source: "dev_e2e_bypass", bearerToken: "newbrain-e2e", useGatewayBaseUrl: true
    });
  } finally {
    if (previousBypass === undefined) delete process.env.NEWBRAIN_E2E_AUTH_BYPASS;
    else process.env.NEWBRAIN_E2E_AUTH_BYPASS = previousBypass;
    if (previousBaseUrl === undefined) delete process.env.NEWBRAIN_MODEL_BASE_URL;
    else process.env.NEWBRAIN_MODEL_BASE_URL = previousBaseUrl;
    if (previousDebugPort === undefined) delete process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT;
    else process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT = previousDebugPort;
  }

  assert.equal(authPolicy.selectModelRequestAuth({ mode: "session_cookie", session_cookie: " cookie " }, " configured ").source, "configured_api_key");
  assert.equal(authPolicy.selectModelRequestAuth({ mode: "session_cookie", session_cookie: " cookie " }, "").source, "none");
  assert.equal(authPolicy.selectModelRequestAuth(null, " ").source, "none");
});

test("E2E remote-debug session injects Auto bearer without MODEL_BASE_URL env", () => {
  const previousBypass = process.env.NEWBRAIN_E2E_AUTH_BYPASS;
  const previousBaseUrl = process.env.NEWBRAIN_MODEL_BASE_URL;
  const previousMediaUrl = process.env.NEWBRAIN_MEDIA_GATEWAY_BASE_URL;
  const previousDebugPort = process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT;
  const previousToken = process.env.NEWBRAIN_E2E_AUTH_TOKEN;
  process.env.NEWBRAIN_E2E_AUTH_BYPASS = "1";
  process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT = "9555";
  delete process.env.NEWBRAIN_MODEL_BASE_URL;
  delete process.env.NEWBRAIN_MEDIA_GATEWAY_BASE_URL;
  delete process.env.NEWBRAIN_E2E_AUTH_TOKEN;
  try {
    assert.equal(authPolicy.isDevE2eAuthBypassActive(), true);
    assert.equal(authPolicy.resolveDevE2eBearerToken(), "newbrain-e2e");
    assert.deepEqual(authPolicy.selectModelRequestAuth(null, ""), {
      source: "dev_e2e_bypass",
      bearerToken: "newbrain-e2e",
      useGatewayBaseUrl: true
    });
  } finally {
    if (previousBypass === undefined) delete process.env.NEWBRAIN_E2E_AUTH_BYPASS;
    else process.env.NEWBRAIN_E2E_AUTH_BYPASS = previousBypass;
    if (previousBaseUrl === undefined) delete process.env.NEWBRAIN_MODEL_BASE_URL;
    else process.env.NEWBRAIN_MODEL_BASE_URL = previousBaseUrl;
    if (previousMediaUrl === undefined) delete process.env.NEWBRAIN_MEDIA_GATEWAY_BASE_URL;
    else process.env.NEWBRAIN_MEDIA_GATEWAY_BASE_URL = previousMediaUrl;
    if (previousDebugPort === undefined) delete process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT;
    else process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT = previousDebugPort;
    if (previousToken === undefined) delete process.env.NEWBRAIN_E2E_AUTH_TOKEN;
    else process.env.NEWBRAIN_E2E_AUTH_TOKEN = previousToken;
  }
});

test("E2E bypass alone without gateway env or remote-debug does not inject bearer", () => {
  const previousBypass = process.env.NEWBRAIN_E2E_AUTH_BYPASS;
  const previousBaseUrl = process.env.NEWBRAIN_MODEL_BASE_URL;
  const previousMediaUrl = process.env.NEWBRAIN_MEDIA_GATEWAY_BASE_URL;
  const previousDebugPort = process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT;
  process.env.NEWBRAIN_E2E_AUTH_BYPASS = "1";
  delete process.env.NEWBRAIN_MODEL_BASE_URL;
  delete process.env.NEWBRAIN_MEDIA_GATEWAY_BASE_URL;
  delete process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT;
  try {
    assert.equal(authPolicy.isDevE2eAuthBypassActive(), false);
    assert.equal(authPolicy.resolveDevE2eBearerToken(), "");
    assert.equal(authPolicy.selectModelRequestAuth(null, "").source, "none");
  } finally {
    if (previousBypass === undefined) delete process.env.NEWBRAIN_E2E_AUTH_BYPASS;
    else process.env.NEWBRAIN_E2E_AUTH_BYPASS = previousBypass;
    if (previousBaseUrl === undefined) delete process.env.NEWBRAIN_MODEL_BASE_URL;
    else process.env.NEWBRAIN_MODEL_BASE_URL = previousBaseUrl;
    if (previousMediaUrl === undefined) delete process.env.NEWBRAIN_MEDIA_GATEWAY_BASE_URL;
    else process.env.NEWBRAIN_MEDIA_GATEWAY_BASE_URL = previousMediaUrl;
    if (previousDebugPort === undefined) delete process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT;
    else process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT = previousDebugPort;
  }
});

test("builds wire-specific model request payloads", () => {
  const common = {
    model: "gpt-5", upstreamMessages: [{ role: "user", content: "hello" }],
    disableResponseStorage: true, reasoningEffort: "high", tools: [{ type: "function" }]
  } as const;
  const responses = protocol.buildModelRequestPayload({ ...common, wireApi: "responses" });
  assert.equal(responses.stream, true, "chat/agent Responses calls must default to SSE");
  assert.equal(responses.store, false);
  assert.deepEqual(responses.reasoning, { effort: "high", summary: "auto" });
  assert.equal("messages" in responses, false);
  const chat = protocol.buildModelRequestPayload({ ...common, wireApi: "chat.completions" });
  assert.equal(chat.stream, true, "chat/agent Chat Completions calls must default to SSE");
  assert.equal(chat.temperature, 0.7);
  assert.equal("input" in chat, false);
  assert.equal("store" in chat, false);
  const thinkingChat = protocol.buildModelRequestPayload({ ...common, wireApi: "chat.completions", enableThinking: true });
  assert.equal(thinkingChat.stream, true);
  assert.deepEqual(thinkingChat.thinking, { type: "enabled" });
  assert.equal(thinkingChat.reasoning_effort, "high");
  assert.equal("temperature" in thinkingChat, false);
  const plainResponses = protocol.buildModelRequestPayload({ ...common, wireApi: "responses", enableThinking: false });
  assert.equal(plainResponses.reasoning, undefined);
});

test("serializes tool calls and outputs for both wire protocols", () => {
  const messages = [
    { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "read", arguments: { path: "a.ts" } }] },
    { role: "tool", content: { ok: true }, toolCallId: "call-1", name: "read" }
  ] as const;
  const responses = protocol.buildUpstreamModelMessages("responses", " system ", messages);
  assert.deepEqual(responses.map((item: any) => item.type ?? item.role), ["system", "function_call", "function_call_output"]);
  assert.equal(responses[1].arguments, '{"path":"a.ts"}');
  assert.equal(responses[2].output, '{"ok":true}');
  const chat = protocol.buildUpstreamModelMessages("chat.completions", "", messages);
  assert.equal(chat[0].tool_calls[0].function.arguments, '{"path":"a.ts"}');
  assert.equal(chat[1].tool_call_id, "call-1");
});

test("does not send the visible reasoning summary as provider reasoning_content", () => {
  const messages = [
    {
      role: "assistant",
      content: "",
      reasoningSummary: "正在分析请求目标、约束与当前上下文。",
      toolCalls: [{ id: "call-1", name: "plugin.list", arguments: {} }]
    },
    { role: "tool", content: { ok: true }, toolCallId: "call-1", name: "plugin.list" }
  ] as const;

  const chat = protocol.buildUpstreamModelMessages("chat.completions", "", messages);

  assert.equal("reasoning_content" in chat[0], false);
  assert.equal(chat[0].tool_calls[0].function.name, "plugin.list");

  const responses = protocol.buildUpstreamModelMessages("responses", "", messages);
  assert.equal(responses.some((item: any) => item?.reasoning_content), false);
  assert.equal(responses[0].type, "function_call");
  assert.equal(responses[0].name, "plugin.list");
  assert.equal(responses[1].type, "function_call_output");
});

test("preserves provider reasoning_content only for an in-memory tool continuation", () => {
  const messages = [
    {
      role: "assistant",
      content: "",
      reasoningSummary: "正在读取文件。",
      providerReasoningContent: "provider-issued-opaque-reasoning",
      toolCalls: [{ id: "call-1", name: "workspace.read", arguments: { path: "README.md" } }]
    },
    { role: "tool", content: { ok: true }, toolCallId: "call-1", name: "workspace.read" }
  ] as const;

  const chat = protocol.buildUpstreamModelMessages("chat.completions", "", messages);
  assert.equal(chat[0].reasoning_content, "provider-issued-opaque-reasoning");

  const responses = protocol.buildUpstreamModelMessages("responses", "", messages);
  assert.equal(responses[0].reasoning_content, "provider-issued-opaque-reasoning");
});

test("disables thinking continuation when persisted tool history has no provider trace", () => {
  assert.equal(protocol.canContinueThinkingWithMessages([
    { role: "user", content: "继续" },
    { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "read", arguments: "{}" }] }
  ]), false);
  assert.equal(protocol.canContinueThinkingWithMessages([
    { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "read", arguments: "{}" }], providerReasoningContent: "opaque" }
  ]), true);
  assert.equal(protocol.canContinueThinkingWithMessages([
    { role: "assistant", content: "普通回答" }
  ]), true);
});

test("treats server-side Auto as thinking-capable when the catalog can route there", () => {
  const catalog = [
    { model: "deepseek-v3.2-BD", provider: "百度智能云千帆" },
    { model: "ernie-5.1", provider: "百度智能云千帆" }
  ];
  assert.equal(protocol.requiresThinkingWireProtocol({
    provider: "百度智能云千帆", model: "auto", candidateModels: catalog
  }), true, "Auto must use the wire that can round-trip a thinking trace");
  assert.equal(protocol.requiresThinkingWireProtocol({
    provider: "百度智能云千帆", model: "auto", candidateModels: [{ model: "ernie-5.1", provider: "百度智能云千帆" }]
  }), false);
  assert.equal(protocol.requiresThinkingWireProtocol({
    provider: "gateway", model: "auto", routedModel: "deepseek-v3.2"
  }), true, "a previously routed thinking model must decide the next step");
  assert.equal(protocol.requiresThinkingWireProtocol({ provider: "DeepSeek", model: "deepseek-v4-pro" }), true);
  assert.equal(protocol.requiresThinkingWireProtocol({ provider: "openai", model: "gpt-5" }), false);
});

test("detects the thinking-context rejection that must be repaired, not surfaced", () => {
  const payload = {
    error: { message: "The `reasoning_content` in the thinking mode must be passed back to the API." }
  };
  assert.equal(protocol.isThinkingContextGatewayRejection(400, payload), true);
  assert.equal(protocol.isThinkingContextGatewayRejection(
    400,
    null,
    "The `reasoning_content` in the thinking mode must be passed back to the API."
  ), true);
  assert.equal(protocol.isThinkingContextGatewayRejection(400, { error: { message: "invalid model" } }), false);
  assert.equal(protocol.isThinkingContextGatewayRejection(200, payload), false);
});

test("streams response deltas through a terminal SSE event", async () => {
  const text: string[] = [];
  const reasoning: string[] = [];
  const body = [
    'data: {"type":"response.reasoning_summary_text.delta","delta":"think"}\n\n',
    'data: {"type":"response.output_text.delta","delta":"done"}\n\n',
    'data: {"type":"response.completed","response":{"output":[]}}\n\n'
  ].join("");
  const result = await responseStream.readModelResponseBody(new Response(body, {
    headers: { "content-type": "text/event-stream; charset=utf-8" }
  }), {
    wireApi: "responses",
    onTextDelta: (delta: string) => text.push(delta),
    onReasoningDelta: (delta: string) => reasoning.push(delta)
  });
  assert.equal(result.isEventStream, true);
  assert.deepEqual(text, ["done"]);
  assert.deepEqual(reasoning, ["think"]);
  assert.equal(result.rawText, body);
});

test("reads non-stream model responses without emitting deltas", async () => {
  const result = await responseStream.readModelResponseBody(new Response('{"ok":true}', {
    headers: { "content-type": "application/json" }
  }), { wireApi: "responses" });
  assert.equal(result.isEventStream, false);
  assert.equal(result.rawText, '{"ok":true}');
});

test("streams DeepSeek reasoning_content as a user-visible reasoning trace", async () => {
  const text: string[] = [];
  const reasoning: string[] = [];
  const body = [
    'data: {"choices":[{"delta":{"reasoning_content":"inspect "}}]}\n\n',
    'data: {"choices":[{"delta":{"reasoning_content":"workspace"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}\n\n'
  ].join("");
  await responseStream.readModelResponseBody(new Response(body, {
    headers: { "content-type": "text/event-stream; charset=utf-8" }
  }), {
    wireApi: "chat.completions",
    onTextDelta: (delta: string) => text.push(delta),
    onReasoningDelta: (delta: string) => reasoning.push(delta)
  });
  assert.deepEqual(reasoning, ["inspect ", "workspace"]);
  assert.deepEqual(text, ["done"]);
});
