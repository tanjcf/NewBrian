/**
 * Context budget helpers aligned with Composer context-meter (chars/4) and
 * OpenClaw/Codex compaction: prune oversized tool payloads, keep a recent tail,
 * and detect provider context-overflow errors for compact-and-retry.
 */

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;
export const COMPACTION_THRESHOLD_RATIO = 0.9;
/** OpenClaw-style recent tail kept verbatim around the summary. */
export const KEEP_RECENT_TOKENS = 20_000;
/** Soft cap for a single older tool payload after pruning. */
export const PRUNED_TOOL_RESULT_MAX_CHARS = 4_000;
/** Keep the newest N tool results at fuller size before pruning older ones. */
export const KEEP_RECENT_FULL_TOOL_RESULTS = 4;

const OVERFLOW_RE = /context[_\s-]?length|maximum context|context window|too many tokens|prompt is too long|request_too_large|input is too long|input exceeds|max[_\s-]?tokens|token limit|exceeds? (?:the )?(?:maximum|model) (?:context|input)/i;

export function estimateTextTokens(value: unknown): number {
  if (value == null) return 0;
  let text = "";
  if (typeof value === "string") text = value;
  else {
    try {
      text = JSON.stringify(value) ?? "";
    } catch {
      text = String(value);
    }
  }
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function compactionThresholdTokens(modelContextWindow = DEFAULT_CONTEXT_WINDOW_TOKENS) {
  const parsed = Math.floor(Number(modelContextWindow));
  const windowTokens = Number.isFinite(parsed) && parsed >= 100
    ? parsed
    : DEFAULT_CONTEXT_WINDOW_TOKENS;
  return Math.floor(windowTokens * COMPACTION_THRESHOLD_RATIO);
}

export function shouldCompactByTokenCount(
  estimatedTokens: number,
  modelContextWindow = DEFAULT_CONTEXT_WINDOW_TOKENS
) {
  return estimatedTokens >= compactionThresholdTokens(modelContextWindow);
}

export function isHardContextLimit(
  estimatedTokens: number,
  modelContextWindow = DEFAULT_CONTEXT_WINDOW_TOKENS
) {
  const parsed = Math.floor(Number(modelContextWindow));
  const windowTokens = Number.isFinite(parsed) && parsed >= 100
    ? parsed
    : DEFAULT_CONTEXT_WINDOW_TOKENS;
  return estimatedTokens >= windowTokens;
}

export function isContextOverflowError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return OVERFLOW_RE.test(message);
}

function truncateText(text: string, maxChars: number) {
  if (text.length <= maxChars) return text;
  const keep = Math.max(64, Math.floor(maxChars / 2));
  return `${text.slice(0, keep)}\n…[truncated ${text.length - maxChars} chars for context budget]…\n${text.slice(-keep)}`;
}

function pruneToolPayloadValue(value: unknown, maxChars: number): unknown {
  if (typeof value === "string") return truncateText(value, maxChars);
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => pruneToolPayloadValue(item, maxChars));
  }
  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = { ...record };
  for (const key of ["output", "stdout", "stderr", "content", "text", "detail", "failureMessage"]) {
    if (typeof next[key] === "string") next[key] = truncateText(String(next[key]), maxChars);
  }
  if (next.result != null) next.result = pruneToolPayloadValue(next.result, maxChars);
  try {
    const encoded = JSON.stringify(next);
    if (encoded.length > maxChars * 2) {
      return {
        ok: next.ok,
        exitCode: next.exitCode,
        output: truncateText(String(next.output ?? encoded), maxChars),
        pruned: true
      };
    }
  } catch {
    // keep structured prune
  }
  return next;
}

/** Truncate older tool_result event payloads so meter + model budget can recover. */
export function pruneThreadToolEvents<T extends { type?: string; payload?: Record<string, unknown> }>(
  events: T[],
  options?: { keepRecentFull?: number; maxChars?: number }
): { events: T[]; pruned: number } {
  const keepRecentFull = Math.max(0, Math.floor(options?.keepRecentFull ?? KEEP_RECENT_FULL_TOOL_RESULTS));
  const maxChars = Math.max(256, Math.floor(options?.maxChars ?? PRUNED_TOOL_RESULT_MAX_CHARS));
  const toolIndexes: number[] = [];
  for (let index = 0; index < events.length; index += 1) {
    if (events[index]?.type === "tool_result") toolIndexes.push(index);
  }
  if (!toolIndexes.length) return { events, pruned: 0 };
  const preserve = new Set(toolIndexes.slice(-keepRecentFull));
  let pruned = 0;
  const next = events.map((event, index) => {
    if (event?.type !== "tool_result" || preserve.has(index) || !event.payload) return event;
    const before = JSON.stringify(event.payload);
    const payload = pruneToolPayloadValue(event.payload, maxChars) as Record<string, unknown>;
    const after = JSON.stringify(payload);
    if (after.length < before.length) pruned += 1;
    return { ...event, payload };
  });
  return { events: next, pruned };
}

type LoopMessage = {
  role: string;
  content?: string;
  toolCallId?: string;
  name?: string;
  toolCalls?: unknown[];
};

/**
 * OpenClaw-style in-loop pruning: keep a recent token tail intact; truncate older
 * tool payloads. Does not drop tool_call/tool_result pairs.
 */
export function pruneAgentMessagesForBudget<T extends LoopMessage>(
  messages: T[],
  modelContextWindow = DEFAULT_CONTEXT_WINDOW_TOKENS,
  options?: { keepRecentTokens?: number; maxToolChars?: number }
): { messages: T[]; pruned: boolean; estimatedTokens: number } {
  const keepRecentTokens = Math.max(2_000, Math.floor(options?.keepRecentTokens ?? KEEP_RECENT_TOKENS));
  const maxToolChars = Math.max(256, Math.floor(options?.maxToolChars ?? PRUNED_TOOL_RESULT_MAX_CHARS));
  const threshold = compactionThresholdTokens(modelContextWindow);
  const estimate = (items: T[]) => items.reduce((sum, message) => sum + estimateTextTokens(message.content) + 4, 0);
  let estimatedTokens = estimate(messages);
  if (estimatedTokens < threshold) {
    return { messages, pruned: false, estimatedTokens };
  }

  let usedFromEnd = 0;
  let cutIndex = messages.length;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const tokens = estimateTextTokens(messages[index].content) + 4;
    if (usedFromEnd + tokens > keepRecentTokens && cutIndex === messages.length) {
      cutIndex = index + 1;
    }
    usedFromEnd += tokens;
  }
  // Do not split inside a trailing tool block: if cut lands on tool, walk back to prior assistant/user.
  while (cutIndex < messages.length && messages[cutIndex]?.role === "tool") {
    cutIndex -= 1;
    if (cutIndex < 0) {
      cutIndex = 0;
      break;
    }
  }

  let pruned = false;
  const next = messages.map((message, index) => {
    if (index >= cutIndex) return message;
    if (message.role !== "tool") return message;
    const content = String(message.content ?? "");
    if (content.length <= maxToolChars) return message;
    pruned = true;
    try {
      const parsed = JSON.parse(content);
      return { ...message, content: JSON.stringify(pruneToolPayloadValue(parsed, maxToolChars)) };
    } catch {
      return { ...message, content: truncateText(content, maxToolChars) };
    }
  });
  estimatedTokens = estimate(next);
  return { messages: next, pruned, estimatedTokens };
}

export function estimateMessagesAndEventsTokens(
  messages: Array<{ content?: string }>,
  events?: Array<{ type?: string; payload?: unknown }>
) {
  let total = messages.reduce((sum, message) => sum + estimateTextTokens(message.content) + 4, 0);
  for (const event of events ?? []) {
    if (event?.type === "tool_call" || event?.type === "tool_result") {
      total += estimateTextTokens(event.payload) + 4;
    }
  }
  return total;
}
