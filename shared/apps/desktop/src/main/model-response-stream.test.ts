import assert from "node:assert/strict";
import test from "node:test";
const { readModelResponseBody } = await import(
  new URL("./model-response-stream.ts", import.meta.url).href
);

test("finishes an SSE response at response.completed even when the server leaves the socket open", async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode([
        'data: {"type":"response.output_text.delta","delta":"正文"}',
        "",
        'data: {"type":"response.completed","response":{"output":[]}}',
        "",
        ""
      ].join("\n")));
    }
  });
  const response = new Response(body, { headers: { "content-type": "text/event-stream" } });
  const deltas: string[] = [];
  const result = await readModelResponseBody(response, {
    wireApi: "responses",
    onTextDelta: (delta: string) => deltas.push(delta)
  });
  assert.deepEqual(deltas, ["正文"]);
  assert.match(result.rawText, /response\.completed/);
});

test("waits for delayed SSE events without imposing a fixed execution deadline", async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"A"}\n\n'));
      setTimeout(() => controller.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"B"}\n\n')), 6);
      setTimeout(() => controller.enqueue(encoder.encode('data: {"type":"response.completed","response":{"output":[]}}\n\n')), 12);
    }
  });
  const response = new Response(body, { headers: { "content-type": "text/event-stream" } });
  const deltas: string[] = [];

  await readModelResponseBody(response, {
    wireApi: "responses",
    onTextDelta: (delta: string) => deltas.push(delta)
  });

  assert.deepEqual(deltas, ["A", "B"]);
});

test("keeps a task running while reasoning messages continue to arrive", async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"A"}}]}\n\n'));
      setTimeout(() => controller.enqueue(encoder.encode(
        'data: {"choices":[{"delta":{"reasoning_content":"B"}}]}\n\n'
      )), 6);
      setTimeout(() => controller.enqueue(encoder.encode(
        'data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}\n\n'
      )), 12);
    }
  });
  const response = new Response(body, { headers: { "content-type": "text/event-stream" } });
  const reasoning: string[] = [];

  await readModelResponseBody(response, {
    wireApi: "chat.completions",
    onReasoningDelta: (delta: string) => reasoning.push(delta)
  });

  assert.deepEqual(reasoning, ["A", "B"]);
});

test("responses wire still harvests chat-style reasoning_content from compatible gateways", async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"先读文件"}}]}\n\n'));
      setTimeout(() => controller.enqueue(encoder.encode(
        'data: {"choices":[{"delta":{"tool_calls":[{"id":"c1","function":{"name":"shell.exec","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\n'
      )), 6);
    }
  });
  const response = new Response(body, { headers: { "content-type": "text/event-stream" } });
  const reasoning: string[] = [];

  await readModelResponseBody(response, {
    wireApi: "responses",
    onReasoningDelta: (delta: string) => reasoning.push(delta)
  });

  assert.deepEqual(reasoning, ["先读文件"]);
});
