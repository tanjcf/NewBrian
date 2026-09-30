const DEFAULT_MAX_MESSAGES = 16;
const DEFAULT_MAX_CHARS = 60_000;

function terms(value) {
  return [...new Set(String(value || "").toLowerCase().match(/[\p{L}\p{N}_./-]{2,}/gu) ?? [])];
}
function messageScore(message, queryTerms, recency) {
  const content = String(message?.content || "").toLowerCase();
  const matches = queryTerms.reduce((count, term) => count + (content.includes(term) ? 1 : 0), 0);
  return matches * 100 + recency;
}

/** Builds a bounded, attributable context slice for a delegated agent. */
export function buildContextCapsule(input) {
  const maxMessages = Math.max(1, Math.min(64, Number(input?.maxMessages) || DEFAULT_MAX_MESSAGES));
  const maxChars = Math.max(1_000, Math.min(500_000, Number(input?.maxChars) || DEFAULT_MAX_CHARS));
  const queryTerms = terms(input?.instruction);
  const sourceMessages = (Array.isArray(input?.messages) ? input.messages : [])
    .filter((message) => message && !message.excludeFromModelContext)
    .filter((message) => ["user", "assistant"].includes(message.role))
    .map((message, index, all) => ({
      message,
      originalIndex: index,
      score: messageScore(message, queryTerms, index - all.length)
    }));

  const latestUser = [...sourceMessages].reverse().find((item) => item.message.role === "user");
  const selected = new Map();
  if (latestUser) selected.set(latestUser.originalIndex, latestUser);
  for (const item of [...sourceMessages].sort((left, right) => right.score - left.score)) {
    if (selected.size >= maxMessages) break;
    selected.set(item.originalIndex, item);
  }

  const ordered = [...selected.values()].sort((left, right) => left.originalIndex - right.originalIndex);
  const messages = [];
  let usedChars = 0;
  for (const item of ordered.reverse()) {
    const content = String(item.message.content || "");
    const remaining = maxChars - usedChars;
    if (remaining <= 0) break;
    const boundedContent = content.length <= remaining ? content : content.slice(content.length - remaining);
    messages.push({ role: item.message.role, content: boundedContent });
    usedChars += boundedContent.length;
  }
  messages.reverse();

  const memories = (Array.isArray(input?.memories) ? input.memories : [])
    .map((memory) => ({
      scope: memory.scope,
      summary: String(memory.summary || "").trim(),
      score: messageScore({ content: memory.summary }, queryTerms, Number(memory.usageCount || 0))
    }))
    .filter((memory) => memory.summary)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map(({ scope, summary }) => ({ scope, summary }));

  return {
    schemaVersion: 1,
    instruction: String(input?.instruction || "").trim(),
    messages,
    memories,
    budget: { maxMessages, maxChars, usedMessages: messages.length, usedChars },
    sources: ordered.map((item) => ({ kind: "message", index: item.originalIndex, role: item.message.role }))
  };
}
