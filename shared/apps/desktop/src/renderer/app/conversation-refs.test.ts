import assert from "node:assert/strict";
import test from "node:test";
import {
  conversationRefKey,
  detectComposerMentionQuery,
  filterConversationRefCandidates,
  formatConversationRefBlock,
  injectConversationRefsIntoQuestion,
  mergeConversationRef,
  replaceComposerMentionRange,
  selectRecentConversationTurns,
  truncateRefContent
} from "./conversation-refs.ts";

test("detectComposerMentionQuery finds @ query at cursor", () => {
  assert.deepEqual(detectComposerMentionQuery("请看 @方案", 6), { start: 3, query: "方案" });
  assert.equal(detectComposerMentionQuery("请看 @方案 继续", 8), null);
  assert.deepEqual(detectComposerMentionQuery("@", 1), { start: 0, query: "" });
});

test("replaceComposerMentionRange removes partial mention", () => {
  assert.deepEqual(replaceComposerMentionRange("参考 @abc 然后", 3, 7, ""), {
    next: "参考  然后",
    cursor: 3
  });
});

test("selectRecentConversationTurns keeps last five user/assistant turns", () => {
  const messages = [
    { role: "system", content: "sys" },
    { role: "user", content: "u1" },
    { role: "assistant", content: "a1" },
    { role: "user", content: "u2" },
    { role: "assistant", content: "a2" },
    { role: "user", content: "u3" },
    { role: "assistant", content: "a3" },
    { role: "tool", content: "ignored" }
  ];
  const result = selectRecentConversationTurns(messages, 5);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.turns.map((item) => item.content), ["a1", "u2", "a2", "u3", "a3"]);
});

test("format and inject conversation refs", () => {
  const block = formatConversationRefBlock({
    id: "t1",
    kind: "thread",
    title: "打包方案",
    summary: "讨论 MSI",
    turns: [{ role: "user", content: "怎么打包" }, { role: "assistant", content: "用脚本" }],
    truncated: true
  });
  assert.match(block, /引用工作区线程：打包方案/);
  assert.match(block, /摘要：讨论 MSI/);
  assert.match(block, /已截断/);
  const injected = injectConversationRefsIntoQuestion("继续优化", [{
    id: "t1",
    kind: "thread",
    title: "打包方案",
    summary: "讨论 MSI",
    turns: [{ role: "user", content: "怎么打包" }]
  }]);
  assert.match(injected, /继续优化$/);
  assert.match(injected, /---/);
});

test("mergeConversationRef dedupes by key", () => {
  const first = mergeConversationRef([], {
    id: "a",
    kind: "brain_conversation",
    title: "旧",
    summary: "",
    conversationId: "c1"
  });
  const next = mergeConversationRef(first, {
    id: "b",
    kind: "brain_conversation",
    title: "新",
    summary: "s",
    conversationId: "c1",
    turns: [{ role: "user", content: "hi" }]
  });
  assert.equal(next.length, 1);
  assert.equal(next[0]?.title, "新");
  assert.equal(conversationRefKey(next[0]!), "brain:c1");
});

test("filterConversationRefCandidates ranks by query", () => {
  const items = filterConversationRefCandidates([
    { id: "1", kind: "thread", title: "Alpha", detail: "x" },
    { id: "2", kind: "brain_conversation", title: "Beta", detail: "alpha note" }
  ], "alpha");
  assert.equal(items.length, 2);
  assert.equal(truncateRefContent("a".repeat(10), 5).endsWith("…"), true);
});
