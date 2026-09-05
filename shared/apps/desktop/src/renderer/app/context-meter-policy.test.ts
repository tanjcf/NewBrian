import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTEXT_IMAGE_TOKEN_ESTIMATE,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  estimateContextMeter,
  estimateTextTokens,
  formatContextMeterBreakdown,
  formatContextTokens,
  readServerEstimatedTokens,
  resolveContextWindowTokens
} from "./context-meter-policy.ts";

test("estimates text tokens with Cursor-like chars/4 heuristic", () => {
  assert.equal(estimateTextTokens(""), 0);
  assert.equal(estimateTextTokens("abcd"), 1);
  assert.equal(estimateTextTokens("a".repeat(400)), 100);
});

test("resolves context window from selected model routing max_context", () => {
  assert.equal(resolveContextWindowTokens(null), DEFAULT_CONTEXT_WINDOW_TOKENS);
  assert.equal(
    resolveContextWindowTokens({
      model: "gpt-5",
      availableModels: [
        { id: "other", model: "other", routing: { max_context: 64_000 } as any },
        { id: "gpt-5", model: "gpt-5", routing: { max_context: 200_000 } as any }
      ]
    }),
    200_000
  );
});

test("counts system, tools, skills, mcp, and images like Cursor payload accounting", () => {
  const estimate = estimateContextMeter({
    modelConfig: {
      model: "demo",
      systemPrompt: "You are helpful. ".repeat(50),
      availableModels: [{ id: "demo", model: "demo", routing: { max_context: 200_000 } as any }]
    },
    conversationTurns: [
      {
        user: { content: "请读取大文件并修复" },
        assistant: { content: "好的，我先查看相关文件。", reasoningSummary: "plan steps" },
        tools: [{ name: "shell", content: "out".repeat(1_000) }]
      }
    ],
    events: [
      {
        type: "tool_result",
        payload: {
          name: "fs.read",
          result: { output: "x".repeat(40_000), stdout: "y".repeat(4_000) }
        }
      }
    ],
    selectedSkill: { name: "programming-skill", description: "guardrails", body: "z".repeat(8_000) },
    mcpTools: [{ name: "browser_navigate", description: "open url", inputSchema: { type: "object", properties: { url: { type: "string" } } } }],
    imageCount: 2,
    draftText: "继续"
  });

  assert.equal(estimate.windowTokens, 200_000);
  assert.ok(estimate.breakdown.system > 0);
  assert.ok(estimate.breakdown.messages > 0);
  assert.ok(estimate.breakdown.tools > 5_000);
  assert.ok(estimate.breakdown.skills > 1_000);
  assert.ok(estimate.breakdown.mcp > 0);
  assert.equal(estimate.breakdown.attachments, 2 * CONTEXT_IMAGE_TOKEN_ESTIMATE);
  assert.ok(estimate.usedTokens > 10_000);
  assert.ok(estimate.usedPercent > 0);
  assert.match(formatContextMeterBreakdown(estimate.breakdown).join("|"), /工具结果/);
});

test("uses server compaction estimate as model-visible budget after compact", () => {
  const estimate = estimateContextMeter({
    conversationTurns: [{ user: { content: "hi" } }],
    events: [
      { type: "tool_result", payload: { result: { output: "x".repeat(80_000) } } },
      { type: "context_compacted", payload: { estimatedTokens: 50_000 } }
    ],
    serverEstimatedTokens: 50_000
  });
  assert.equal(estimate.usedTokens, 50_000);
  assert.equal(estimate.breakdown.tools, 0);
  assert.ok(estimate.breakdown.messages >= 40_000);
});

test("reads latest context_compacted estimatedTokens", () => {
  assert.equal(readServerEstimatedTokens([
    { type: "tool_call", payload: {} },
    { type: "context_compacted", payload: { estimatedTokens: 12_000 } },
    { type: "context_compacted", payload: { estimatedTokens: 88_000 } }
  ]), 88_000);
  assert.equal(formatContextTokens(12_500), "13k");
});

test("grows much faster than the legacy chat-only meter for agent tool output", () => {
  const legacyChatOnly = estimateTextTokens("hello world") + estimateTextTokens("ok");
  const cursorLike = estimateContextMeter({
    conversationTurns: [
      { user: { content: "hello world" }, assistant: { content: "ok" } }
    ],
    events: [
      { type: "tool_result", payload: { result: { output: "file contents ".repeat(20_000) } } }
    ],
    modelConfig: { systemPrompt: "sys ".repeat(2_000) }
  });
  assert.ok(cursorLike.usedTokens > legacyChatOnly * 50);
});
