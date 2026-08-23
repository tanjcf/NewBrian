export interface StructuredToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface WebSearchCall {
  id: string;
  status: string;
  action?: unknown;
}

export interface UrlCitation {
  url: string;
  title: string;
}

export interface StructuredModelEnvelope {
  content: string;
  reasoningSummary?: string;
  providerReasoningContent?: string;
  toolCalls: StructuredToolCall[];
  webSearchCalls: WebSearchCall[];
  citations: UrlCitation[];
  usage?: unknown;
}

export function extractResponsesEnvelope(payload: any): StructuredModelEnvelope {
  const textParts: string[] = [];
  const reasoningSummaryParts: string[] = [];
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) textParts.push(payload.output_text.trim());
  const toolCalls: StructuredToolCall[] = [];
  const webSearchCalls: WebSearchCall[] = [];
  const citations: UrlCitation[] = [];
  for (const output of Array.isArray(payload?.output) ? payload.output : []) {
    if (output?.type === "reasoning") {
      for (const summary of Array.isArray(output.summary) ? output.summary : []) {
        if (typeof summary?.text === "string" && summary.text.trim()) reasoningSummaryParts.push(summary.text.trim());
      }
    }
    if (output?.type === "function_call" && output.name) {
      toolCalls.push({
        id: String(output.call_id || output.id || `call-${toolCalls.length + 1}`),
        name: String(output.name),
        arguments: typeof output.arguments === "string" ? output.arguments : JSON.stringify(output.arguments ?? {})
      });
    }
    if (output?.type === "web_search_call") {
      webSearchCalls.push({
        id: String(output.id || `web-search-${webSearchCalls.length + 1}`),
        status: String(output.status || ""),
        action: output.action
      });
    }
    for (const item of Array.isArray(output?.content) ? output.content : []) {
      if (typeof item?.text === "string" && item.text.trim()) textParts.push(item.text.trim());
      for (const annotation of Array.isArray(item?.annotations) ? item.annotations : []) {
        if (annotation?.type === "url_citation" && annotation.url) {
          citations.push({
            url: String(annotation.url),
            title: String(annotation.title || annotation.url)
          });
        }
      }
    }
  }
  return {
    content: [...new Set(textParts)].join("\n\n").trim(),
    reasoningSummary: reasoningSummaryParts.join("\n\n").trim(),
    toolCalls,
    webSearchCalls,
    citations: [...new Map(citations.map((citation) => [citation.url, citation])).values()],
    usage: payload?.usage
  };
}

export function extractChatEnvelope(payload: any): StructuredModelEnvelope {
  const message = payload?.choices?.[0]?.message ?? {};
  const toolCalls = (Array.isArray(message.tool_calls) ? message.tool_calls : []).map((call: any, index: number) => ({
    id: String(call?.id || `call-${index + 1}`),
    name: String(call?.function?.name || call?.name || ""),
    arguments: typeof call?.function?.arguments === "string"
      ? call.function.arguments
      : JSON.stringify(call?.function?.arguments ?? call?.arguments ?? {})
  })).filter((call: StructuredToolCall) => call.name);
  return {
    content: typeof message.content === "string" ? message.content.trim() : "",
    reasoningSummary: chatDeltaReasoningText(message).trim()
      || (typeof message.reasoning_summary === "string" ? message.reasoning_summary.trim() : ""),
    providerReasoningContent: typeof message.reasoning_content === "string" ? message.reasoning_content : "",
    toolCalls,
    webSearchCalls: [],
    citations: [],
    usage: payload?.usage
  };
}

function chatDeltaReasoningText(delta: Record<string, unknown> | null | undefined): string {
  if (!delta || typeof delta !== "object") return "";
  if (typeof delta.reasoning_content === "string") return delta.reasoning_content;
  if (typeof delta.reasoning === "string") return delta.reasoning;
  if (typeof delta.thinking === "string") return delta.thinking;
  return "";
}

export function extractResponsesEnvelopeFromSse(rawText: string): StructuredModelEnvelope {
  const textParts: string[] = [];
  // Compatible gateways sometimes expose /responses while forwarding legacy
  // chat-completion chunks. Preserve their text instead of treating it as empty.
  const chatTextParts: string[] = [];
  const reasoningSummaryParts: string[] = [];
  const chatReasoningParts: string[] = [];
  const completed: any[] = [];
  const calls = new Map<string, StructuredToolCall>();
  // Compatible gateways may omit the blank line between SSE events. Each
  // Responses payload is a single JSON data line, so parse lines independently.
  for (const line of rawText.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const dataText = line.slice(5).trim();
    if (!dataText || dataText === "[DONE]") continue;
    let event: any;
    try { event = JSON.parse(dataText); } catch { continue; }
    const chatDelta = event?.choices?.[0]?.delta;
    if (typeof chatDelta?.content === "string") chatTextParts.push(chatDelta.content);
    const chatReasoning = chatDeltaReasoningText(chatDelta);
    if (chatReasoning) chatReasoningParts.push(chatReasoning);
    // Chat-style tool_calls on a /responses stream (Kimi/DeepSeek thinking gateways).
    for (const call of Array.isArray(chatDelta?.tool_calls) ? chatDelta.tool_calls : []) {
      const id = String(call?.id || `call-${calls.size + 1}`);
      const current = calls.get(id) ?? { id, name: "", arguments: "" };
      if (call?.id) current.id = String(call.id);
      if (call?.function?.name) current.name += String(call.function.name);
      if (call?.function?.arguments) current.arguments += String(call.function.arguments);
      calls.set(id, current);
    }
    if (event.type === "response.reasoning_summary_text.delta" && typeof event.delta === "string") {
      reasoningSummaryParts.push(event.delta);
    }
    if (event.type === "response.reasoning_text.delta" && typeof event.delta === "string") {
      reasoningSummaryParts.push(event.delta);
    }
    if (event.type === "response.output_text.delta" || event.type === "response.refusal.delta") {
      if (typeof event.delta === "string") textParts.push(event.delta);
    } else if (event.type === "response.output_item.added" && event.item?.type === "function_call") {
      const id = String(event.item.call_id || event.item.id || `call-${calls.size + 1}`);
      calls.set(id, { id, name: String(event.item.name || ""), arguments: String(event.item.arguments || "") });
    } else if (event.type === "response.function_call_arguments.delta") {
      const id = String(event.call_id || event.item_id || "");
      const current = calls.get(id) ?? { id, name: String(event.name || ""), arguments: "" };
      current.arguments += String(event.delta || "");
      calls.set(id, current);
    } else if (event.type === "response.output_item.done" && event.item?.type === "function_call") {
      const id = String(event.item.call_id || event.item.id || `call-${calls.size + 1}`);
      calls.set(id, {
        id,
        name: String(event.item.name || calls.get(id)?.name || ""),
        arguments: String(event.item.arguments || calls.get(id)?.arguments || "{}")
      });
    } else if (event.type === "response.completed" && event.response) {
      completed.push(event.response);
    }
  }
  const mergedReasoning = (reasoningSummaryParts.length ? reasoningSummaryParts : chatReasoningParts)
    .join("")
    .trim();
  if (completed.length) {
    const envelope = extractResponsesEnvelope(completed.at(-1));
    if (!envelope.content && textParts.length) envelope.content = textParts.join("").trim();
    if (!envelope.content && chatTextParts.length) envelope.content = chatTextParts.join("").trim();
    if (!envelope.reasoningSummary && mergedReasoning) envelope.reasoningSummary = mergedReasoning;
    if (!envelope.providerReasoningContent && chatReasoningParts.length) {
      envelope.providerReasoningContent = chatReasoningParts.join("");
    }
    if (!envelope.toolCalls.length && calls.size) envelope.toolCalls = [...calls.values()].filter((call) => call.name);
    return envelope;
  }
  return {
    content: (textParts.length ? textParts : chatTextParts).join("").trim(),
    reasoningSummary: mergedReasoning,
    providerReasoningContent: chatReasoningParts.join(""),
    toolCalls: [...calls.values()].filter((call) => call.name),
    webSearchCalls: [],
    citations: []
  };
}

export function extractChatEnvelopeFromSse(rawText: string): StructuredModelEnvelope {
  const textParts: string[] = [];
  const reasoningParts: string[] = [];
  const providerReasoningParts: string[] = [];
  const calls = new Map<number, StructuredToolCall>();
  let usage: unknown;
  // Parse each data line independently. Compatible gateways do not always
  // emit the blank SSE separator required by the specification.
  for (const line of rawText.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const dataText = line.slice(5).trim();
    if (!dataText || dataText === "[DONE]") continue;
    let event: any;
    try { event = JSON.parse(dataText); } catch { continue; }
    if (event.usage) usage = event.usage;
    const delta = event.choices?.[0]?.delta;
    if (typeof delta?.content === "string") textParts.push(delta.content);
    const reasoning = chatDeltaReasoningText(delta);
    if (reasoning) reasoningParts.push(reasoning);
    if (typeof delta?.reasoning_content === "string") providerReasoningParts.push(delta.reasoning_content);
    for (const call of Array.isArray(delta?.tool_calls) ? delta.tool_calls : []) {
      const index = Number(call.index ?? 0);
      const current = calls.get(index) ?? { id: "", name: "", arguments: "" };
      if (call.id) current.id = String(call.id);
      if (call.function?.name) current.name += String(call.function.name);
      if (call.function?.arguments) current.arguments += String(call.function.arguments);
      calls.set(index, current);
    }
  }
  return {
    content: textParts.join("").trim(),
    reasoningSummary: reasoningParts.join("").trim(),
    providerReasoningContent: providerReasoningParts.join(""),
    toolCalls: [...calls.entries()].map(([index, call]) => ({
      ...call,
      id: call.id || `call-${index + 1}`
    })).filter((call) => call.name),
    webSearchCalls: [],
    citations: [],
    usage
  };
}

export function formatToolDefinitions(
  tools: any[],
  wireApi: "responses" | "chat.completions",
  options: { webSearch?: boolean } = {}
) {
  if (wireApi === "responses") {
    return [
      ...tools,
      ...(options.webSearch ? [{ type: "web_search" }] : [])
    ];
  }
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: tool.strict
    }
  }));
}

export function supportsNativeWebSearch(
  provider: string,
  model: string,
  wireApi: "responses" | "chat.completions"
) {
  if (wireApi !== "responses") return false;
  const normalizedProvider = provider.trim().toLowerCase();
  const normalizedModel = model.trim().toLowerCase().replace(/^openai\//, "");
  return normalizedProvider === "openai"
    || /^(?:gpt-|o[134](?:-|$)|codex(?:-|$))/.test(normalizedModel);
}

export function appendUrlCitations(content: string, citations: UrlCitation[]) {
  const unique = [...new Map(citations.map((citation) => [citation.url, citation])).values()];
  if (!unique.length) return content;
  const sources = unique.map((citation) => `- [${citation.title}](${citation.url})`).join("\n");
  return `${content.trim()}\n\n### 来源\n${sources}`.trim();
}

export function formatModelGatewayError(
  payload: any,
  status: number,
  requestId = ""
) {
  const code = String(payload?.code || payload?.error?.code || "").trim();
  const title = typeof payload?.title === "string" ? payload.title.trim() : "";
  const detail = typeof payload?.detail === "string"
    ? payload.detail.trim()
    : typeof payload?.error?.message === "string"
      ? payload.error.message.trim()
      : typeof payload?.message === "string"
        ? payload.message.trim()
        : "";
  const retryable = payload?.retryable === true;
  const retryAfter = Number(payload?.retry_after);

  if (status === 429 || code === "DAILY_LIMIT_EXCEEDED") {
    const parts = [
      code === "DAILY_LIMIT_EXCEEDED" || /daily usage limit exceeded/i.test(detail)
        ? "\u4eca\u65e5\u6a21\u578b\u8c03\u7528\u989d\u5ea6\u5df2\u7528\u5b8c\uff0c\u8bf7\u660e\u5929\u989d\u5ea6\u91cd\u7f6e\u540e\u518d\u8bd5\uff0c\u6216\u5207\u6362\u5230\u6709\u53ef\u7528\u989d\u5ea6\u7684\u6a21\u578b/API Key\u3002"
        : "\u6a21\u578b\u8bf7\u6c42\u8fc7\u4e8e\u9891\u7e41\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002",
      requestId ? `request_id=${requestId}` : ""
    ].filter(Boolean);
    return parts.join(" ");
  }

  const parts = [
    `\u6a21\u578b\u7f51\u5173\u8bf7\u6c42\u5931\u8d25\uff08HTTP ${status}\uff09`,
    detail || title
  ].filter(Boolean);
  if (retryable) {
    parts.push(
      Number.isFinite(retryAfter) && retryAfter > 0
        ? `\u53ef\u91cd\u8bd5\uff0c\u5efa\u8bae ${retryAfter} \u79d2\u540e\u518d\u8bd5`
        : "\u53ef\u7a0d\u540e\u91cd\u8bd5"
    );
  }
  if (requestId) parts.push(`request_id=${requestId}`);
  return parts.join("\uff1b");
}

export function formatModelNetworkError(error: unknown, endpoint = "") {
  const cause = typeof error === "object" && error !== null && "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  const source = cause ?? error;
  const code = typeof source === "object" && source !== null && "code" in source
    ? String((source as { code?: unknown }).code ?? "")
    : "";
  const message = error instanceof Error ? error.message : String(error);
  const causeMessage = cause instanceof Error ? cause.message : "";
  const detail = causeMessage || message;
  const isTimeout =
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    /timeout|timed out/i.test(detail);

  const reason = isTimeout
    ? "\u8fde\u63a5\u6a21\u578b\u7f51\u5173\u8d85\u65f6"
    : "\u65e0\u6cd5\u8fde\u63a5\u6a21\u578b\u7f51\u5173";
  const hint = isTimeout
    ? "\u8bf7\u68c0\u67e5\u7f51\u7edc\u3001\u4ee3\u7406/VPN\u3001\u6a21\u578b Base URL \u662f\u5426\u53ef\u8bbf\u95ee\uff0c\u6216\u7a0d\u540e\u91cd\u8bd5\u3002"
    : "\u8bf7\u68c0\u67e5\u6a21\u578b Base URL\u3001\u7f51\u7edc\u8fde\u63a5\u548c\u672c\u5730\u9632\u706b\u5899\u8bbe\u7f6e\u3002";
  return [
    reason,
    endpoint ? `endpoint=${endpoint}` : "",
    code ? `code=${code}` : "",
    hint
  ].filter(Boolean).join("\uff1b");
}
