import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's strip-types runner loads this source file directly.
import {
  buildGovernmentMaxStepsProgressBrief,
  governmentMaxStepsFallbackContent,
  wrapGovernmentMaxStepsDraft
} from "./government-max-steps-draft.ts";

test("builds a max-steps progress brief from plan results and assistant fragments", () => {
  const brief = buildGovernmentMaxStepsProgressBrief({
    latestUserRequest: "撰写地方实践文章",
    goalSnapshot: {
      plan: [
        { stepId: "research", title: "调研", description: "收集材料", status: "completed", result: "已读官方材料" },
        { stepId: "draft", title: "起草", description: "写正文", status: "in_progress", result: "" }
      ]
    } as never,
    assistantMessages: ["# 问题提出\n地方实践正在形成特色路径。", "本轮探索已达安全步数上限，忽略这条"]
  });
  assert.match(brief, /撰写地方实践文章/);
  assert.match(brief, /\[已完成\].*已读官方材料/);
  assert.match(brief, /\[进行中\].*(?:起草|写正文)/);
  assert.match(brief, /地方实践正在形成特色路径/);
  assert.equal(/已达安全步数上限/.test(brief), false);
});

test("wraps a synthesized draft with a staged-delivery banner", () => {
  const wrapped = wrapGovernmentMaxStepsDraft("# 问题提出\n正文");
  assert.match(wrapped, /【阶段性成稿】/);
  assert.match(wrapped, /# 问题提出/);
});

test("fallback content includes the progress brief when synthesis is unavailable", () => {
  const fallback = governmentMaxStepsFallbackContent({
    latestUserRequest: "写一篇讲话稿",
    goalSnapshot: {
      plan: [{ stepId: "s1", title: "收集", description: "", status: "completed", result: "要点已齐" }]
    } as never,
    assistantMessages: []
  });
  assert.match(fallback, /自动成稿暂未产出可用正文/);
  assert.match(fallback, /要点已齐/);
});
