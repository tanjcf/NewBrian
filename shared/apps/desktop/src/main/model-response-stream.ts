import type { ModelConfig } from "@codex-forge/protocol";

interface ModelResponseStreamOptions {
  wireApi: ModelConfig["wireApi"];
  signal?: AbortSignal;
  onTextDelta?: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
}

function dispatchSseBlock(block: string, options: ModelResponseStreamOptions) {
  const dataText = block.split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n").trim();
  if (!dataText) return { terminal: false, resultProgress: false };
  if (dataText === "[DONE]") return { terminal: true, resultProgress: true };
  try {
    const event = JSON.parse(dataText);
    if (event.type === "response.reasoning_summary_text.delta" && typeof event.delta === "string" && event.delta) {
      options.onReasoningDelta?.(event.delta);
    }
    if (event.type === "response.reasoning_text.delta" && typeof event.delta === "string" && event.delta) {
      options.onReasoningDelta?.(event.delta);
    }
    const chatDelta = event.choices?.[0]?.delta;
    const chatReasoningDelta = typeof chatDelta?.reasoning_content === "string"
      ? chatDelta.reasoning_content
      : typeof chatDelta?.reasoning === "string"
        ? chatDelta.reasoning
        : typeof chatDelta?.thinking === "string"
          ? chatDelta.thinking
          : "";
    // /responses gateways that forward Kimi/DeepSeek chat chunks still carry
    // reasoning_content on choices[].delta — harvest it for echo + UI.
    if (chatReasoningDelta) {
      options.onReasoningDelta?.(chatReasoningDelta);
    }
    const delta = options.wireApi === "responses"
      ? (event.type === "response.output_text.delta" || event.type === "response.refusal.delta" ? event.delta : "")
      : event.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta) options.onTextDelta?.(delta);
    const terminal = event.type === "response.completed" || Boolean(event.choices?.some(
      (choice: { finish_reason?: unknown }) => choice?.finish_reason
    ));
    const responseToolProgress = event.type === "response.output_item.added"
      || event.type === "response.function_call_arguments.delta"
      || event.type === "response.output_item.done";
    const chatToolProgress = Array.isArray(event.choices?.[0]?.delta?.tool_calls)
      && event.choices[0].delta.tool_calls.length > 0;
    return {
      terminal,
      resultProgress: terminal || Boolean(delta) || responseToolProgress || chatToolProgress
    };
  } catch {
    // The complete raw body is retained for the final envelope parser.
    return { terminal: false, resultProgress: false };
  }
}

export async function readModelResponseBody(response: Response, options: ModelResponseStreamOptions) {
  const contentType = response.headers.get("content-type") ?? "";
  const isEventStream = contentType.toLowerCase().includes("text/event-stream");
  if (!isEventStream || !response.body) {
    return { rawText: await response.text(), contentType, isEventStream };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let rawText = "";
  let pending = "";
  let protocolCompleted = false;
  while (true) {
    if (options.signal?.aborted) throw new DOMException("Model request aborted", "AbortError");
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    rawText += chunk;
    pending += chunk;
    const blocks = pending.split(/\r?\n\r?\n/);
    pending = blocks.pop() ?? "";
    for (const block of blocks) {
      const dispatched = dispatchSseBlock(block, options);
      protocolCompleted = dispatched.terminal || protocolCompleted;
    }
    if (protocolCompleted) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  const tail = decoder.decode();
  rawText += tail;
  pending += tail;
  if (pending.trim()) {
    const dispatched = dispatchSseBlock(pending, options);
    protocolCompleted = dispatched.terminal || protocolCompleted;
  }
  if (!protocolCompleted) {
    throw new Error("Model response stream ended before a terminal event.");
  }
  return { rawText, contentType, isEventStream };
}
