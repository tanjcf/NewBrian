import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage } from "@codex-forge/protocol";

const {
  activeThreadMessages,
  CODEX_SUMMARY_PREFIX,
  compactThreadMessages,
  estimateMessageTokens,
  shouldCompactThreadMessages
} = await import(new URL("./thread-context-policy.ts", import.meta.url).href);

function message(index: number, content = `message-${index}`): ChatMessage {
  return { id: `message-${index}`, role: index % 2 ? "assistant" : "user", content, createdAt: "2026-01-01T00:00:00.000Z" };
}

test("uses the Codex 90 percent auto-compaction threshold", () => {
  const below = [message(0, "x".repeat(300)), message(1)];
  const above = [message(0, "x".repeat(400)), message(1)];
  assert.equal(shouldCompactThreadMessages(below, undefined, 100), false);
  assert.equal(shouldCompactThreadMessages(above, undefined, 100), true);
});

test("replaces active history with retained user messages and the Codex summary", () => {
  const messages = Array.from({ length: 14 }, (_, index) => message(index, `content ${index} `.repeat(40)));
  const result = compactThreadMessages(messages, undefined, 100, {
    makeId: (prefix: string) => `${prefix}-fixed`,
    nowIso: () => "2026-02-03T04:05:06.000Z",
    summary: "Progress is durable. Continue with the next step."
  });

  assert.equal(result.compacted, true);
  assert.equal(result.messages.at(-1)?.role, "user");
  assert.match(result.messages.at(-1)?.content ?? "", new RegExp(`^${CODEX_SUMMARY_PREFIX}`));
  assert.ok(result.messages.slice(0, -1).every((item: ChatMessage) => item.role === "user"));
  assert.equal(result.context.windowNumber, 1);
  assert.equal(result.context.firstWindowId, "context-window-fixed");
  assert.equal(result.context.windowId, "context-window-fixed");
  assert.equal(result.context.summaryMessageId, "context-summary-fixed");
});

test("continues from persisted replacement history without immediately compacting again", () => {
  const messages = Array.from({ length: 14 }, (_, index) => message(index, `content ${index} `.repeat(40)));
  const first = compactThreadMessages(messages, undefined, 100, {
    makeId: (prefix: string) => `${prefix}-one`,
    nowIso: () => "2026-02-03T04:05:06.000Z",
    summary: "Checkpoint one"
  });
  const continued = [...messages, message(20, "follow up")];
  const active = activeThreadMessages(continued, first.context);

  assert.equal(active.findIndex((item: ChatMessage) => item.id === "context-summary-one"), active.length - 2);
  assert.equal(active.at(-1)?.content, "follow up");
  assert.equal(shouldCompactThreadMessages(continued, first.context, 10_000), false);
  assert.equal(compactThreadMessages(continued, first.context, 10_000).compacted, false);
});

test("estimates tokens from aggregate content length", () => {
  assert.equal(estimateMessageTokens([{ content: "1234567" }, { content: "1234567" }]), 4);
});

test("counts oversized tool events toward the compaction threshold", () => {
  const messages = [message(0, "short"), message(1, "short")];
  const events = [{
    type: "tool_result",
    payload: { output: "y".repeat(2_000) }
  }];
  assert.equal(shouldCompactThreadMessages(messages, undefined, 100), false);
  assert.equal(shouldCompactThreadMessages(messages, undefined, 100, events), true);
});

test("force compaction replaces history even when under soft threshold", () => {
  const messages = [message(0, "keep me"), message(1, "assistant reply")];
  const result = compactThreadMessages(messages, undefined, 200_000, {
    makeId: (prefix: string) => `${prefix}-forced`,
    nowIso: () => "2026-02-03T04:05:06.000Z",
    summary: "Forced checkpoint",
    force: true
  });
  assert.equal(result.compacted, true);
  assert.match(result.messages.at(-1)?.content ?? "", /Forced checkpoint/);
});
