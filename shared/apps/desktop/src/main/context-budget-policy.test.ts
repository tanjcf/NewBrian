import assert from "node:assert/strict";
import test from "node:test";

const {
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  compactionThresholdTokens,
  estimateTextTokens,
  isContextOverflowError,
  pruneAgentMessagesForBudget,
  pruneThreadToolEvents,
  shouldCompactByTokenCount
} = await import(new URL("./context-budget-policy.ts", import.meta.url).href);

test("uses chars/4 token heuristic aligned with composer meter", () => {
  assert.equal(estimateTextTokens("abcd"), 1);
  assert.equal(estimateTextTokens("a".repeat(8)), 2);
  assert.equal(compactionThresholdTokens(200_000), 180_000);
  assert.equal(shouldCompactByTokenCount(179_999, 200_000), false);
  assert.equal(shouldCompactByTokenCount(180_000, 200_000), true);
  assert.equal(DEFAULT_CONTEXT_WINDOW_TOKENS, 200_000);
});

test("detects provider context overflow errors", () => {
  assert.equal(isContextOverflowError(new Error("context_length_exceeded")), true);
  assert.equal(isContextOverflowError("maximum context length exceeded"), true);
  assert.equal(isContextOverflowError("request_too_large"), true);
  assert.equal(isContextOverflowError(new Error("tool not found")), false);
});

test("prunes older tool_result events while keeping recent ones fuller", () => {
  const events = Array.from({ length: 6 }, (_, index) => ({
    type: "tool_result",
    payload: { output: "z".repeat(12_000), index }
  }));
  const { events: pruned, pruned: count } = pruneThreadToolEvents(events, {
    keepRecentFull: 2,
    maxChars: 500
  });
  assert.ok(count >= 4);
  assert.ok(String(JSON.stringify(pruned[0].payload)).length < 12_000);
  assert.ok(String(pruned[5].payload.output).length >= 12_000);
});

test("prunes older tool messages in the agent loop without dropping pairs", () => {
  const messages = [
    { role: "user", content: "start" },
    { role: "assistant", content: "calling", toolCalls: [{ id: "1" }] },
    { role: "tool", toolCallId: "1", content: JSON.stringify({ output: "w".repeat(20_000) }) },
    { role: "user", content: "continue ".repeat(2_000) }
  ];
  const result = pruneAgentMessagesForBudget(messages, 8_000, {
    keepRecentTokens: 1_000,
    maxToolChars: 800
  });
  assert.equal(result.pruned, true);
  assert.equal(result.messages.length, 4);
  assert.equal(result.messages[2].role, "tool");
  assert.ok(String(result.messages[2].content).length < 20_000);
});
