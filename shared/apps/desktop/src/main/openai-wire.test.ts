import assert from "node:assert/strict";
import test from "node:test";

const wire = import(new URL("./openai-wire.ts", import.meta.url).href) as Promise<typeof import("./openai-wire.js")>;

test("extracts Responses function calls alongside text", async () => {
  const { extractResponsesEnvelope } = await wire;
  const result = extractResponsesEnvelope({ output: [
    { type: "message", content: [{ type: "output_text", text: "checking" }] },
    { type: "function_call", call_id: "call-1", name: "git.status", arguments: "{}" }
  ] });
  assert.equal(result.content, "checking");
  assert.deepEqual(result.toolCalls, [{ id: "call-1", name: "git.status", arguments: "{}" }]);
  assert.deepEqual(result.webSearchCalls, []);
  assert.deepEqual(result.citations, []);
});

test("extracts native web search calls and citations", async () => {
  const { extractResponsesEnvelope, appendUrlCitations } = await wire;
  const result = extractResponsesEnvelope({ output: [
    { type: "web_search_call", id: "ws-1", status: "completed", action: { type: "search", query: "latest" } },
    {
      type: "message",
      content: [{
        type: "output_text",
        text: "Current result.",
        annotations: [{ type: "url_citation", url: "https://example.com/news", title: "Example News" }]
      }]
    }
  ] });
  assert.deepEqual(result.webSearchCalls, [{
    id: "ws-1",
    status: "completed",
    action: { type: "search", query: "latest" }
  }]);
  assert.deepEqual(result.citations, [{ url: "https://example.com/news", title: "Example News" }]);
  assert.match(appendUrlCitations(result.content, result.citations), /\[Example News\]\(https:\/\/example\.com\/news\)/);
});

test("reconstructs streamed function arguments", async () => {
  const { extractResponsesEnvelopeFromSse } = await wire;
  const blocks = [
    { type: "response.output_item.added", item: { type: "function_call", call_id: "call-1", name: "shell.exec" } },
    { type: "response.function_call_arguments.delta", call_id: "call-1", delta: '{"command":' },
    { type: "response.function_call_arguments.delta", call_id: "call-1", delta: '"pwd"}' }
  ].map((item) => `data: ${JSON.stringify(item)}\n\n`).join("");
  assert.deepEqual(extractResponsesEnvelopeFromSse(blocks).toolCalls, [
    { id: "call-1", name: "shell.exec", arguments: '{"command":"pwd"}' }
  ]);
});

test("accepts chat chunks returned from a compatible Responses endpoint", async () => {
  const { extractResponsesEnvelopeFromSse } = await wire;
  const blocks = [
    { choices: [{ delta: { content: "first " } }] },
    { choices: [{ delta: { content: "second" } }] }
  ].map((item) => `data: ${JSON.stringify(item)}\n\n`).join("");
  assert.equal(extractResponsesEnvelopeFromSse(blocks).content, "first second");
});

test("keeps the visible reasoning summary separate from final response text", async () => {
  const { extractResponsesEnvelopeFromSse } = await wire;
  const summaryOnly = [
    { type: "response.reasoning_summary_text.delta", delta: "outline " },
    { type: "response.reasoning_summary_text.delta", delta: "summary" }
  ].map((item) => `data: ${JSON.stringify(item)}\n\n`).join("");
  assert.equal(extractResponsesEnvelopeFromSse(summaryOnly).content, "");
  assert.equal(extractResponsesEnvelopeFromSse(summaryOnly).reasoningSummary, "outline summary");

  const withFinal = `${summaryOnly}data: ${JSON.stringify({ type: "response.output_text.delta", delta: "final" })}\n\n`;
  assert.equal(extractResponsesEnvelopeFromSse(withFinal).content, "final");
  assert.equal(extractResponsesEnvelopeFromSse(withFinal).reasoningSummary, "outline summary");
});

test("reconstructs streamed Chat Completions text and tool calls", async () => {
  const { extractChatEnvelopeFromSse } = await wire;
  const blocks = [
    { choices: [{ delta: { content: "你" } }] },
    { choices: [{ delta: { content: "好" } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "call-1", function: { name: "shell.exec", arguments: '{\"command\":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '\"pwd\"}' } }] } }] }
  ].map((item) => `data: ${JSON.stringify(item)}\n\n`).join("");
  assert.deepEqual(extractChatEnvelopeFromSse(blocks), {
    content: "你好",
    reasoningSummary: "",
    providerReasoningContent: "",
    toolCalls: [{ id: "call-1", name: "shell.exec", arguments: '{\"command\":\"pwd\"}' }],
    webSearchCalls: [],
    citations: [],
    usage: undefined
  });
});

test("exposes DeepSeek reasoning_content as the model reasoning trace", async () => {
  const { extractChatEnvelope, extractChatEnvelopeFromSse, extractResponsesEnvelopeFromSse } = await wire;
  const blocks = [
    { choices: [{ delta: { reasoning_content: "检查" } }] },
    { choices: [{ delta: { reasoning_content: "上下文" } }] },
    { choices: [{ delta: { content: "完成" } }] }
  ].map((item) => `data: ${JSON.stringify(item)}\n\n`).join("");
  const streamed = extractChatEnvelopeFromSse(blocks);
  assert.equal(streamed.reasoningSummary, "检查上下文");
  assert.equal(streamed.content, "完成");
  assert.equal(extractChatEnvelope({ choices: [{ message: {
    reasoning_content: "完整推理",
    content: "最终回答"
  } }] }).reasoningSummary, "完整推理");

  // Auto + Kimi often arrives as chat chunks on the /responses wire.
  const responsesCompat = extractResponsesEnvelopeFromSse([
    { choices: [{ delta: { reasoning_content: "先读 SVG" } }] },
    { choices: [{ delta: { tool_calls: [{ id: "call-1", function: { name: "shell.exec", arguments: "{\"command\":\"ls\"}" } }] } }] }
  ].map((item) => `data: ${JSON.stringify(item)}`).join("\n"));
  assert.equal(responsesCompat.reasoningSummary, "先读 SVG");
  assert.equal(responsesCompat.toolCalls[0]?.name, "shell.exec");
});

test("preserves compatible thinking aliases for the next tool continuation", async () => {
  const { extractChatEnvelopeFromSse } = await wire;
  const envelope = extractChatEnvelopeFromSse([
    'data: {"choices":[{"delta":{"reasoning":"检查工作区"}}]}',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"workspace.read","arguments":"{\\"path\\":\\"README.md\\"}"}}]},"finish_reason":"tool_calls"}]}',
    'data: [DONE]'
  ].join("\n"));

  assert.equal(envelope.reasoningSummary, "检查工作区");
  assert.equal(envelope.toolCalls[0]?.name, "workspace.read");
});

test("preserves non-stream thinking aliases for the next tool continuation", async () => {
  const { extractChatEnvelope } = await wire;
  const envelope = extractChatEnvelope({
    choices: [{
      message: {
        content: "",
        thinking: "先检查文件",
        tool_calls: [{ id: "call-1", function: { name: "workspace.read", arguments: "{}" } }]
      }
    }]
  });

  assert.equal(envelope.reasoningSummary, "先检查文件");
  assert.equal(envelope.toolCalls[0]?.name, "workspace.read");
});

test("formats Chat Completions tool definitions", async () => {
  const { formatToolDefinitions } = await wire;
  const result = formatToolDefinitions([{ type: "function", name: "echo", description: "Echo", parameters: {}, strict: true }], "chat.completions");
  assert.equal(result[0].function.name, "echo");
});

test("adds native web search only to Responses tools", async () => {
  const { formatToolDefinitions } = await wire;
  assert.deepEqual(formatToolDefinitions([], "responses", { webSearch: true }), [{ type: "web_search" }]);
  assert.deepEqual(formatToolDefinitions([], "chat.completions", { webSearch: true }), []);
});

test("enables native web search only for compatible OpenAI Responses models", async () => {
  const { supportsNativeWebSearch } = await wire;
  assert.equal(supportsNativeWebSearch("OpenAI", "gpt-5", "responses"), true);
  assert.equal(supportsNativeWebSearch("custom", "openai/gpt-5-mini", "responses"), true);
  assert.equal(supportsNativeWebSearch("DeepSeek", "deepseek-v4-pro", "responses"), false);
  assert.equal(supportsNativeWebSearch("OpenAI", "gpt-5", "chat.completions"), false);
});

test("formats structured gateway failures without dumping raw JSON", async () => {
  const { formatModelGatewayError } = await wire;
  const message = formatModelGatewayError({
    title: "Bad gateway",
    detail: "The upstream origin is unavailable.",
    retryable: true,
    retry_after: 60
  }, 502, "req-123");
  assert.match(message, /HTTP 502/);
  assert.match(message, /60 秒后/);
  assert.match(message, /request_id=req-123/);
  assert.doesNotMatch(message, /\{"title"/);
});

test("formats daily limit failures as an actionable message", async () => {
  const { formatModelGatewayError } = await wire;
  const message = formatModelGatewayError({
    code: "DAILY_LIMIT_EXCEEDED",
    message: "daily usage limit exceeded"
  }, 429, "req-429");
  assert.match(message, /今日模型调用额度已用完/);
  assert.match(message, /request_id=req-429/);
  assert.doesNotMatch(message, /daily usage limit exceeded/);
});

test("accepts responses SSE events without blank separators", async () => {
  const { extractResponsesEnvelopeFromSse } = await wire;
  const raw = [
    `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "政务" })}`,
    `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "正文" })}`,
    "data: [DONE]"
  ].join("\n");
  assert.equal(extractResponsesEnvelopeFromSse(raw).content, "政务正文");
});
