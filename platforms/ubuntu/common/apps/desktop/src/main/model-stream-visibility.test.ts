import assert from "node:assert/strict";
import test from "node:test";

const visibility = import(new URL("./model-stream-visibility.ts", import.meta.url).href) as Promise<typeof import("./model-stream-visibility.js")>;

test("suppresses private planning before it reaches visible output", async () => {
  const { ModelStreamVisibilityGate } = await visibility;
  const gate = new ModelStreamVisibilityGate();
  assert.deepEqual(gate.push("The user is asking me to draft a speech. "), {
    suppressed: true,
    delta: "The user is asking me to draft a speech. "
  });
  assert.deepEqual(gate.push("Let me call a tool."), {
    suppressed: true,
    delta: "Let me call a tool."
  });
  assert.deepEqual(gate.finish(true), { suppressed: true });
});

test("suppresses alternate model narration before the probe threshold", async () => {
  const { ModelStreamVisibilityGate } = await visibility;
  const gate = new ModelStreamVisibilityGate();
  assert.deepEqual(gate.push("The user wants me to draft a municipal speech with several constraints."), {
    suppressed: true,
    delta: "The user wants me to draft a municipal speech with several constraints."
  });
  assert.deepEqual(gate.push(" Let me analyze the request."), {
    suppressed: true,
    delta: " Let me analyze the request."
  });
});

test("suppresses decision-card planning narration seen in the desktop stream", async () => {
  const { ModelStreamVisibilityGate } = await visibility;
  const gate = new ModelStreamVisibilityGate();
  assert.deepEqual(gate.push("The user input request has been created. Now I need to wait for the user to choose one of the three options."), {
    suppressed: true,
    delta: "The user input request has been created. Now I need to wait for the user to choose one of the three options."
  });
  assert.deepEqual(gate.push(" Let me present the decision card to the user and stop here."), {
    suppressed: true,
    delta: " Let me present the decision card to the user and stop here."
  });
  assert.deepEqual(gate.finish(true), { suppressed: true });
});

test("routes Chinese tool-introspection narration into extractable planning text", async () => {
  const { containsPrivatePlanningNarration, extractPrivatePlanningNarration, sanitizeVisibleModelContent } = await visibility;
  const content = "用户已经确认了大纲。当前可用工具没有 web.search_official，先检查一下当前工具列表。\n\n提纲已在上方展示，请选择后继续。";
  assert.equal(containsPrivatePlanningNarration(content), true);
  assert.match(extractPrivatePlanningNarration(content), /当前可用工具/);
  assert.equal(sanitizeVisibleModelContent(content), "提纲已在上方展示，请选择后继续。");
});

test("does not treat ordinary Chinese progress narration as private planning", async () => {
  const { containsPrivatePlanningNarration } = await visibility;
  assert.equal(containsPrivatePlanningNarration("接下来需要检索国务院公报相关文件。"), false);
  assert.equal(containsPrivatePlanningNarration("我现在需要整理案例证据并开始起草规格。"), false);
  assert.equal(containsPrivatePlanningNarration("让我先核对官方来源后再继续。"), false);
});

test("removes persisted Chinese runtime self-narration from historical assistant content", async () => {
  const { sanitizeVisibleModelContent } = await visibility;
  const content = `目标状态是 paused，phase 是 idle。我需要先恢复目标再继续。

虽然目标被暂停了，但用户已经说了要继续，我需要交付结果。

可能是因为之前的 goal_finish 被调用了。现在在 paused 状态下需要输出结果。

让我直接交付完整的演讲稿文本。`;
  const sanitized = sanitizeVisibleModelContent(content);
  assert.equal(sanitized.includes("目标状态是 paused"), false);
  assert.equal(sanitized.includes("现在在 paused 状态下"), false);
});

test("streams clear user-facing Chinese output", async () => {
  const { ModelStreamVisibilityGate } = await visibility;
  const gate = new ModelStreamVisibilityGate();
  assert.deepEqual(gate.push("同志们："), { delta: "同志们：" });
  assert.deepEqual(gate.push("今天召开会议。"), { delta: "今天召开会议。" });
  assert.deepEqual(gate.finish(false), { suppressed: false });
});

test("flushes a short final answer when the response completes without tools", async () => {
  const { ModelStreamVisibilityGate } = await visibility;
  const gate = new ModelStreamVisibilityGate();
  assert.deepEqual(gate.push("好的，我会继续处理。"), {});
  assert.deepEqual(gate.finish(false), { delta: "好的，我会继续处理。" });
});

test("keeps accepted user-facing commentary when a tool call follows", async () => {
  const { ModelStreamVisibilityGate } = await visibility;
  const gate = new ModelStreamVisibilityGate();
  const longText = "这是面向用户的临时说明。".repeat(20);
  assert.equal(gate.push(longText).delta, longText);
  assert.deepEqual(gate.finish(true), { suppressed: false });
});

test("keeps only the user-facing tail when a provider mixes planning and output", async () => {
  const { sanitizeVisibleModelContent, hasUserVisibleAssistantContent } = await visibility;
  assert.equal(
    sanitizeVisibleModelContent("The user has been shown a decision. I need to wait. Let me summarize.提纲已在上方展示，请选择后继续。"),
    "提纲已在上方展示，请选择后继续。"
  );
  assert.equal(sanitizeVisibleModelContent("I need to call a tool before answering."), "");
  assert.equal(sanitizeVisibleModelContent("同志们：今天部署下一阶段工作。"), "同志们：今天部署下一阶段工作。" );
  assert.equal(
    sanitizeVisibleModelContent("Let me just respond very briefly and wait for actual instructions. 你好！有什么需要帮忙的？"),
    "你好！有什么需要帮忙的？"
  );
  assert.equal(hasUserVisibleAssistantContent("你好！有什么需要帮忙的？"), true);
  assert.equal(hasUserVisibleAssistantContent("I should respond very simply."), false);
});

test("flash-BD style mixed English meta plus Chinese greeting counts as visible", async () => {
  const { sanitizeVisibleModelContent, hasUserVisibleAssistantContent, containsPrivatePlanningNarration } = await visibility;
  const payload = "me just respond very briefly and wait for actual instructions.\n\n你好！有什么需要帮忙的？";
  assert.equal(containsPrivatePlanningNarration(payload), true);
  assert.equal(hasUserVisibleAssistantContent(payload), true);
  assert.equal(sanitizeVisibleModelContent(payload), "你好！有什么需要帮忙的？");
});

test("removes skill telemetry, private diagnostics, and duplicate final sections", async () => {
  const { sanitizeVisibleModelContent } = await visibility;
  const output = sanitizeVisibleModelContent(`本轮使用 Skill：government-research-writing。

Chinese chars: 3004, total non-whitespace/md characters: 3546. The user wants 3000字.

Let me update the plan.

Style unification results:

1. Transitions improved
2. Tone is consistent

Now let me complete the step and move to fact-check.

Style unification results:

1. Transitions improved
2. Tone is consistent`);
  assert.equal(output, "Style unification results:\n\n1. Transitions improved\n2. Tone is consistent");
});
