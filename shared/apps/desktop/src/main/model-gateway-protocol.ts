import type { ModelConfig } from "@codex-forge/protocol";

export function buildApiEndpoint(baseUrl: string, wireApi: ModelConfig["wireApi"]) {
  const trimmedBaseUrl = baseUrl.replace(/\/+$/, "");
  return wireApi === "responses" ? `${trimmedBaseUrl}/responses` : `${trimmedBaseUrl}/chat/completions`;
}

export function resolveGatewayOrigin(baseUrl: string) {
  const normalized = baseUrl.trim();
  if (!normalized) throw new Error("Model base URL is required.");
  try {
    return new URL(normalized).origin;
  } catch {
    throw new Error(`Invalid model base URL: ${normalized}`);
  }
}

export function resolveGatewayBaseUrl(baseUrl: string) {
  const normalized = baseUrl.trim();
  if (!normalized) throw new Error("Model base URL is required.");
  return normalized.replace(/\/+$/, "");
}

export function shouldRetryModelGatewayResponse(status: number, payload: unknown) {
  if (status === 429 || status === 502 || status === 503 || status === 504) return true;
  return Boolean(record(payload)?.retryable === true);
}

/**
 * Wire payload for user-facing chat / agent-loop model calls.
 * Always requests SSE (`stream: true`) so the UI can paint tokens as they arrive.
 * Non-stream is reserved for connectivity probes, certification runners, and
 * short sidecar health checks (e.g. local vision describe) — not this helper.
 */
export function buildModelRequestPayload(input: {
  wireApi: ModelConfig["wireApi"];
  model: string;
  upstreamMessages: unknown[];
  disableResponseStorage: boolean;
  reasoningEffort: "low" | "medium" | "high" | "xhigh";
  enableThinking?: boolean;
  tools: unknown[];
}) {
  if (input.wireApi === "responses") {
    return {
      model: input.model,
      stream: true,
      input: input.upstreamMessages,
      store: !input.disableResponseStorage,
      // Ask Responses-compatible providers for their safe reasoning summary.
      // Otherwise they may reason internally without emitting summary deltas.
      reasoning: { effort: input.reasoningEffort, summary: "auto" as const },
      ...(input.tools.length ? { tools: input.tools } : {})
    };
  }
  return {
    model: input.model,
    stream: true,
    messages: input.upstreamMessages,
    ...(input.enableThinking
      ? { reasoning_effort: input.reasoningEffort, thinking: { type: "enabled" as const } }
      : { temperature: 0.7 }),
    ...(input.tools.length ? { tools: input.tools } : {})
  };
}

interface EncodedModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
  toolCallId?: string;
  name?: string;
  reasoningSummary?: string;
  /**
   * Opaque provider-issued thinking trace for the current in-memory tool loop.
   * This is deliberately distinct from the user-visible reasoning summary and
   * must never be persisted with thread history.
   */
  providerReasoningContent?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string | Record<string, unknown> }>;
}

export function buildUpstreamModelMessages(
  wireApi: ModelConfig["wireApi"],
  systemPrompt: string,
  messages: EncodedModelMessage[]
) {
  const upstreamMessages: any[] = systemPrompt.trim()
    ? [{ role: "system", content: systemPrompt.trim() }]
    : [];
  for (const message of messages) {
    if (wireApi === "responses") {
      if (message.role === "tool") {
        upstreamMessages.push({
          type: "function_call_output",
          call_id: message.toolCallId,
          output: typeof message.content === "string" ? message.content : JSON.stringify(message.content)
        });
        continue;
      }
      const hasText = Boolean(
        message.content && (typeof message.content !== "string" || message.content.trim())
      );
      const reasoning = message.role === "assistant"
        ? String(message.providerReasoningContent || "").trim()
        : "";
      // Thinking-mode vendors (Kimi/DeepSeek via gateway) require the prior
      // assistant reasoning_content to be echoed before function_call items,
      // even when the assistant content was empty and only tools were emitted.
      if (hasText || reasoning) {
        upstreamMessages.push({
          role: message.role,
          content: hasText
            ? message.content
            : (typeof message.content === "string" ? message.content : ""),
          ...(reasoning ? { reasoning_content: reasoning } : {})
        });
      }
      for (const call of message.toolCalls ?? []) {
        upstreamMessages.push({
          type: "function_call",
          call_id: call.id,
          name: call.name,
          arguments: typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments)
        });
      }
      continue;
    }
    if (message.role === "tool") {
      upstreamMessages.push({
        role: "tool", tool_call_id: message.toolCallId, name: message.name, content: message.content
      });
      continue;
    }
    upstreamMessages.push({
      role: message.role,
      content: message.content,
      ...(message.role === "assistant" && message.providerReasoningContent?.trim()
        ? { reasoning_content: message.providerReasoningContent.trim() }
        : {}),
      ...(message.toolCalls?.length ? {
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: {
            name: call.name,
            arguments: typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments)
          }
        }))
      } : {})
    });
  }
  return upstreamMessages;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function extractResponsesText(payload: unknown) {
  const root = record(payload);
  if (typeof root?.output_text === "string" && root.output_text.trim()) return root.output_text.trim();
  const outputs = Array.isArray(root?.output) ? root.output : [];
  const parts: string[] = [];
  for (const output of outputs) {
    const contents = Array.isArray(record(output)?.content) ? record(output)?.content as unknown[] : [];
    for (const item of contents) {
      const text = record(item)?.text;
      if (typeof text === "string" && text.trim()) parts.push(text.trim());
    }
  }
  return parts.join("\n\n").trim();
}

export function extractResponsesTextFromSse(rawText: string) {
  const textParts: string[] = [];
  const completedBodies: unknown[] = [];
  for (const block of rawText.split(/\r?\n\r?\n/)) {
    const dataText = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n").trim();
    if (!dataText || dataText === "[DONE]") continue;
    let payload: unknown;
    try { payload = JSON.parse(dataText); } catch { continue; }
    const event = record(payload);
    const type = typeof event?.type === "string" ? event.type : "";
    if (type === "response.output_text.delta" || type === "response.refusal.delta") {
      if (typeof event?.delta === "string") textParts.push(event.delta);
    } else if (type === "response.completed" && event?.response) {
      completedBodies.push(event.response);
    }
  }
  const streamedText = textParts.join("").trim();
  if (streamedText) return streamedText;
  for (const body of completedBodies.reverse()) {
    const completedText = extractResponsesText(body);
    if (completedText) return completedText;
  }
  return "";
}
