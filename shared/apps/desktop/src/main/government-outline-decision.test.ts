import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
const {
  advanceGovernmentPlanAfterOutlineAnswer,
  buildFallbackGovernmentOutlineDecision,
  buildGovernmentOutlineSource,
  buildGovernmentOutlineDecisionRequest,
  expandDurableOutlineResult,
  expandGovernmentDraftPlanByOutline,
  extractGovernmentOutlineSections,
  extractVisibleGovernmentOutline,
  formatGovernmentOutlineMarkdown,
  isCompleteGovernmentOutline,
  isGovernmentOutlineConfirmationPending,
  markGovernmentOutlineReady,
  parseGovernmentOutlineDecision,
  shouldEnforceGovernmentDraftLength,
  shouldRunGovernmentOutlineService
} = await import(new URL("./government-outline-decision.ts", import.meta.url).href) as typeof import("./government-outline-decision.js");
const { buildGovernmentWritingInitialPlan } = await import(new URL("./government-goal-workflow.ts", import.meta.url).href) as typeof import("./government-goal-workflow.js");

test("formats the outline as styled markdown with a versioned title and dividers", () => {
  const raw = "## 基层治理实践总结写作提纲\n一、工作背景\n二、主要问题\n三、机制改革\n四、经验启示";
  const formatted = formatGovernmentOutlineMarkdown(raw);
  const lines = formatted.split("\n\n");
  assert.equal(lines[0], "### 文档大纲 · 第1版");
  assert.equal(lines[1], "**基层治理实践总结写作提纲**");
  assert.equal(lines[2], "---");
  assert.equal(lines[3], "一、工作背景");
  assert.equal(lines.at(-2), "---");
  assert.match(String(lines.at(-1)), /结构没有问题/);
  assert.equal(isCompleteGovernmentOutline(formatted), true);
  assert.deepEqual(
    extractGovernmentOutlineSections(formatted),
    ["工作背景", "主要问题", "机制改革", "经验启示"]
  );
  assert.match(formatGovernmentOutlineMarkdown(raw, true), /文档大纲 · 修订版/);
});

test("builds outline generation input from durable material facts when visible content is empty", () => {
  const source = buildGovernmentOutlineSource("", [{
    title: "材料评估",
    result: "原煤产量301万吨；安全培训5180人次；新增智能化设备31套；无较大及以上安全事故；不得写零事故"
  }]);
  assert.match(source, /Verified workflow context/);
  assert.match(source, /301万吨/);
  assert.match(source, /5180人次/);
  assert.match(source, /31套/);
  assert.match(source, /不得写零事故/);
});
test("expands the concise durable outline produced by a short government-writing request", () => {
  const persisted = "\u56db\u6bb5\u63d0\u7eb2\uff1a\u5f00\u573a\u81f4\u610f(40\u5b57)\u2192\u5e74\u5ea6\u56de\u987e(80\u5b57)\u2192\u95ee\u9898\u4e0e\u4e0d\u8db3(30\u5b57)\u2192\u5c55\u671b\u4e0e\u7ed3\u8bed(50\u5b57)\u3002\u4e0d\u5199\u5177\u4f53\u6570\u5b57\uff0c\u6982\u62ec\u8868\u8ff0\u3002";
  const outline = expandDurableOutlineResult(persisted);
  assert.match(outline, /\u4e00\u3001\u5f00\u573a\u81f4\u610f/);
  assert.match(outline, /\u56db\u3001\u5c55\u671b\u4e0e\u7ed3\u8bed/);
  assert.equal(isCompleteGovernmentOutline(outline), true);
  assert.equal(buildFallbackGovernmentOutlineDecision(outline).questionId, "outline-confirmation");
});

test("builds a selectable fallback from the model-generated visible outline", () => {
  const content = [
    "The model has prepared the following outline.",
    "## 写作提纲",
    "一、开场说明会议目的和工作背景，强调统一思想、明确任务、务实推进的总体要求。",
    "二、重点部署围绕窗口服务、流程优化和协同办理展开，每项都明确责任和执行要求。",
    "三、收束部分强调压实责任、加强协同和持续改进，形成简洁务实的部署动员。",
    "提纲已生成，但原生确认选项生成失败，请重试当前步骤。"
  ].join("\n");
  const visible = extractVisibleGovernmentOutline(content);
  assert.doesNotMatch(visible, /The model|生成失败/);
  const decision = buildFallbackGovernmentOutlineDecision(content);
  assert.equal(decision.options.length, 3);
  assert.equal(decision.options.filter((option) => option.recommended).length, 1);
  assert.equal(isCompleteGovernmentOutline(decision.outline), true);
});

test("does not mistake a clarification checklist for a writing outline", () => {
  assert.equal(isCompleteGovernmentOutline([
    "关键缺失信息：",
    "1. 公司/单位类型（煤矿生产企业、煤炭贸易公司等）",
    "2. 公司名称（或使用通用名称）",
    "3. 是否有具体数据和成绩需要体现"
  ].join("\n")), false);
});

test("production outline code contains no scenario-specific generator", async () => {
  const source = await readFile(new URL("./government-outline-decision.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /buildMaterialBoundGovernmentOutline|煤炭企业2025年|301\s*万吨|5180\s*人次|31\s*套/u);
});

test("moves outline generation to confirmation with exactly one in-progress step", () => {
  const plan = [
    { stepId: "material", title: "材料评估", description: "x", status: "completed", result: "done" },
    { stepId: "outline", title: "生成提纲", description: "x", status: "in_progress", result: "" },
    { stepId: "outline-confirmation", title: "提纲确认", description: "x", status: "pending", result: "" },
    { stepId: "draft", title: "撰写初稿", description: "x", status: "in_progress", result: "stale" }
  ] as any;
  const next = markGovernmentOutlineReady(plan, "一、开场。\n二、部署。\n三、落实。" );
  assert.deepEqual(next.map((step) => step.status), ["completed", "completed", "in_progress", "pending", "pending", "pending"]);
  assert.equal(next.filter((step) => step.status === "in_progress").length, 1);
  assert.deepEqual(next.filter((step) => step.stepId.startsWith("draft-section-")).map((step) => step.title), [
    "分段撰写：开场。", "分段撰写：部署。", "分段撰写：落实。"
  ]);
});

test("expands the single draft action into durable outline-section actions", () => {
  const plan = [
    { stepId: "confirm", title: "提纲确认", description: "", status: "pending", result: "" },
    { stepId: "draft", title: "撰写初稿", description: "", status: "pending", result: "" },
    { stepId: "style", title: "文风统一", description: "", status: "pending", result: "" }
  ] as any;
  const outline = "一、因地制宜识别资源禀赋\n二、围绕特色路径分段展开\n三、形成可核验的经验总结";
  assert.equal(extractGovernmentOutlineSections(outline).length, 3);
  const expanded = expandGovernmentDraftPlanByOutline(plan, outline);
  assert.deepEqual(expanded.map((step) => step.stepId), ["confirm", "draft-section-1", "draft-section-2", "draft-section-3", "style"]);
});

test("replaces previously expanded draft sections when a user revises the outline", () => {
  const plan = [
    { stepId: "outline-confirmation", title: "提纲确认", description: "", status: "pending", result: "" },
    { stepId: "draft-section-1", title: "分段撰写：旧一", description: "", status: "pending", result: "" },
    { stepId: "draft-section-2", title: "分段撰写：旧二", description: "", status: "pending", result: "" },
    { stepId: "style-unification", title: "统一文风", description: "", status: "pending", result: "" }
  ] as any;
  const revised = expandGovernmentDraftPlanByOutline(plan, "一、修订后的安全生产部分，明确事实边界\n二、修订后的稳产保供部分，引用生产数据\n三、存在的问题与下一步工作安排");
  assert.deepEqual(revised.map((step) => step.stepId), [
    "outline-confirmation", "draft-section-1", "draft-section-2", "draft-section-3", "style-unification"
  ]);
  assert.equal(new Set(revised.map((step) => step.stepId)).size, revised.length);
  assert.match(revised[3].title, /存在的问题/);
});

const snapshot = (plan: any[], pendingQuestion: any = null, status = "active") => ({
  goal: { goalId: "g", threadId: "t", objective: "draft", status, tokensUsed: 0, timeUsedSeconds: 0, createdAtMs: 1, updatedAtMs: 1 },
  runtime: { threadId: "t", goalId: "g", phase: "running", consecutiveBlockedTurns: 0, lastError: "", selectedSkillNames: [], updatedAtMs: 1 },
  plan,
  pendingQuestion
}) as any;

test("parses a model-generated outline decision with exactly one recommendation", () => {
  const validDecision = JSON.stringify({
    questionId: "ignored",
    outline: "\u4e00\u3001\u5f00\u573a\u4e0e\u4f1a\u8bae\u76ee\u7684\uff1a\u8bf4\u660e\u672c\u6b21\u90e8\u7f72\u7684\u80cc\u666f\u3001\u5b9a\u4f4d\u548c\u603b\u4f53\u8981\u6c42\u3002\n\u4e8c\u3001\u90e8\u7f72\u4e09\u9879\u91cd\u70b9\u5de5\u4f5c\uff1a\u5206\u522b\u8bf4\u660e\u4f18\u5316\u670d\u52a1\u3001\u534f\u540c\u529e\u7406\u548c\u538b\u5b9e\u8d23\u4efb\u7684\u5177\u4f53\u65b9\u5411\u3002\n\u4e09\u3001\u660e\u786e\u5de5\u4f5c\u8981\u6c42\u4e0e\u843d\u5b9e\u673a\u5236\uff1a\u5f3a\u8c03\u4efb\u52a1\u5206\u5de5\u3001\u8fc7\u7a0b\u534f\u540c\u3001\u8ddf\u8e2a\u95ee\u6548\u548c\u98ce\u9669\u9632\u8303\u3002\n\u56db\u3001\u6536\u675f\u52a8\u5458\uff1a\u5f3a\u8c03\u52a1\u5b9e\u6267\u884c\u3001\u7fa4\u4f17\u611f\u53d7\u548c\u670d\u52a1\u6548\u80fd\uff0c\u5f62\u6210\u7b80\u6d01\u6709\u529b\u7684\u6536\u675f\u3002",
    prompt: "\u8bf7\u786e\u8ba4\u63d0\u7eb2",
    options: [
      { label: "\u786e\u8ba4\u5e76\u7ee7\u7eed", description: "\u6309\u5f53\u524d\u7ed3\u6784\u8d77\u8349", recommended: true },
      { label: "\u8c03\u6574\u91cd\u70b9", description: "\u52a0\u5f3a\u7a97\u53e3\u4f5c\u98ce", recommended: false }
    ]
  });
  const decision = parseGovernmentOutlineDecision(`${validDecision}\n\nThe structured decision is ready.\n{"ignored":true}`);
  assert.equal(decision.questionId, "outline-confirmation");
  assert.match(decision.outline, /\u5f00\u573a/);
  assert.equal(decision.options.length, 2);
  assert.throws(() => parseGovernmentOutlineDecision('{"prompt":"x","options":[]}'), /complete outline/);
  assert.match(buildGovernmentOutlineDecisionRequest("request", "outline"), /actual outline/);
});

test("requires a native decision after outline and defers draft length enforcement", () => {
  const outlinePlan = snapshot([
    { stepId: "outline", title: "Outline", description: "", status: "completed", result: "done" },
    { stepId: "outline-confirm", title: "Outline confirmation", description: "", status: "in_progress", result: "" },
    { stepId: "draft", title: "Draft", description: "", status: "pending", result: "" }
  ]);
  assert.equal(isGovernmentOutlineConfirmationPending(outlinePlan), true);
  assert.equal(shouldEnforceGovernmentDraftLength(outlinePlan), false);
  const advanced = advanceGovernmentPlanAfterOutlineAnswer(outlinePlan, "outline-confirmation", "confirm");
  assert.equal(advanced[1].status, "completed");
  assert.equal(advanced[2].status, "in_progress");
  outlinePlan.plan[2].status = "in_progress";
  assert.equal(isGovernmentOutlineConfirmationPending(outlinePlan), false);
  assert.equal(shouldEnforceGovernmentDraftLength(outlinePlan), true);
});

test("advances outline confirmation atomically before starting the draft", () => {
  const snapshot = {
    goal: { status: "active" },
    pendingQuestion: null,
    plan: [
      { stepId: "outline", title: "\u4ea7\u51fa\u63d0\u7eb2", status: "in_progress", result: "" },
      { stepId: "confirm", title: "\u63d0\u7eb2\u786e\u8ba4", status: "pending", result: "" },
      { stepId: "draft", title: "\u8d77\u8349\u8bb2\u8bdd\u7a3f", status: "pending", result: "" }
    ]
  } as never;
  const advanced = advanceGovernmentPlanAfterOutlineAnswer(snapshot, "outline-confirmation", "\u786e\u8ba4\u5e76\u7ee7\u7eed");
  assert.deepEqual(advanced.map((step) => step.status), ["completed", "completed", "in_progress"]);
  assert.equal(advanced.filter((step) => step.status === "in_progress").length, 1);
});

test("outline confirmation does not complete the writing-specification confirmation step", () => {
  const mixed = {
    goal: { status: "active" },
    pendingQuestion: null,
    plan: [
      { stepId: "writing-specification", title: "生成写作规格", status: "completed", result: "ready" },
      { stepId: "specification-confirmation", title: "确认写作规格", status: "in_progress", result: "" },
      { stepId: "outline", title: "生成提纲", status: "completed", result: "一、背景\n二、做法" },
      { stepId: "outline-confirmation", title: "提纲确认", status: "in_progress", result: "" },
      { stepId: "draft", title: "撰写正文", status: "pending", result: "" }
    ]
  };
  const advanced = advanceGovernmentPlanAfterOutlineAnswer(mixed as never, "outline-confirmation", "确认");
  assert.equal(advanced.find((step) => step.stepId === "specification-confirmation")?.status, "in_progress");
  assert.equal(advanced.find((step) => step.stepId === "outline-confirmation")?.status, "completed");
  assert.equal(advanced.find((step) => step.stepId === "draft")?.status, "in_progress");

  const ready = markGovernmentOutlineReady(mixed.plan as never, "一、背景\n二、做法\n三、成效\n四、启示");
  assert.equal(ready.find((step) => step.stepId === "outline-confirmation")?.status, "in_progress");
  assert.equal(ready.find((step) => step.stepId === "specification-confirmation")?.status, "in_progress");
  assert.ok(ready.some((step) => /^draft(?:-section-)?/i.test(step.stepId) && step.status === "pending"));
});

test("repairs stale concurrent progress when outline confirmation starts drafting", () => {
  const staleSnapshot = {
    goal: { status: "active" },
    pendingQuestion: null,
    plan: [
      { stepId: "material", title: "材料评估", status: "in_progress", result: "stale" },
      { stepId: "outline", title: "生成提纲", status: "completed", result: "outline" },
      { stepId: "outline-confirmation", title: "提纲确认", status: "in_progress", result: "" },
      { stepId: "draft", title: "撰写正文", status: "pending", result: "" }
    ]
  } as never;
  const advanced = advanceGovernmentPlanAfterOutlineAnswer(
    staleSnapshot,
    "outline-confirmation",
    "确认提纲，继续撰写"
  );
  assert.deepEqual(advanced.map((step) => step.status), ["completed", "completed", "completed", "in_progress"]);
  assert.equal(advanced.filter((step) => step.status === "in_progress").length, 1);
});

test("recognizes the Chinese synonym 大纲 as an outline stage", () => {
  const outlinePlan = snapshot([
    { stepId: "s1", title: "\u51fa\u5177\u5927\u7eb2", description: "", status: "completed", result: "\u4e00\u3001\u5f00\u573a\n\u4e8c\u3001\u56de\u987e\n\u4e09\u3001\u5c55\u671b" },
    { stepId: "s2", title: "\u5927\u7eb2\u786e\u8ba4", description: "", status: "in_progress", result: "" },
    { stepId: "s3", title: "\u6309\u786e\u8ba4\u540e\u7684\u5927\u7eb2\u8d77\u8349\u6b63\u6587", description: "", status: "pending", result: "" }
  ]);
  assert.equal(isGovernmentOutlineConfirmationPending(outlinePlan), true);
});

test("does not request outline confirmation before the outline step is complete", () => {
  const earlyPlan = snapshot([
    { stepId: "material", title: "\u6750\u6599\u8bc4\u4f30", description: "", status: "in_progress", result: "" },
    { stepId: "outline", title: "\u751f\u6210\u5b8c\u6574\u5199\u4f5c\u63d0\u7eb2", description: "", status: "pending", result: "" },
    { stepId: "outline-confirmation", title: "\u63d0\u7eb2\u786e\u8ba4", description: "", status: "pending", result: "" },
    { stepId: "draft", title: "\u8d77\u8349\u6b63\u6587", description: "", status: "pending", result: "" }
  ]);
  assert.equal(isGovernmentOutlineConfirmationPending(earlyPlan), false);
});

test("starts a 撰写初稿 step after outline confirmation", () => {
  const outlinePlan = snapshot([
    { stepId: "s1", title: "\u751f\u6210\u63d0\u7eb2", description: "", status: "completed", result: "outline" },
    { stepId: "s2", title: "\u63d0\u7eb2\u786e\u8ba4", description: "", status: "in_progress", result: "" },
    { stepId: "s3", title: "\u64b0\u5199\u521d\u7a3f", description: "", status: "pending", result: "" }
  ]);
  const advanced = advanceGovernmentPlanAfterOutlineAnswer(outlinePlan, "outline-confirmation", "confirm");
  assert.equal(advanced[2].status, "in_progress");
  const advancedSnapshot = { ...outlinePlan, plan: advanced };
  assert.equal(shouldEnforceGovernmentDraftLength(advancedSnapshot), true);
});

test("keeps drafting paused when the user requests a concrete outline edit", () => {
  const outlinePlan = snapshot([
    { stepId: "outline", title: "生成提纲", description: "", status: "completed", result: "old outline" },
    { stepId: "outline-confirmation", title: "提纲确认", description: "", status: "in_progress", result: "" },
    { stepId: "draft-section-1", title: "分段撰写：第一部分", description: "", status: "pending", result: "" }
  ]);
  const adjusted = advanceGovernmentPlanAfterOutlineAnswer(outlinePlan, "outline-confirmation", "删除第二部分，并把第三部分提前");
  assert.deepEqual(adjusted.map((step) => step.status), ["in_progress", "pending", "pending"]);
  assert.match(adjusted[0].result, /删除第二部分/);
});

test("rejects confirmation placeholders and accepts a complete visible outline", () => {
  assert.equal(isCompleteGovernmentOutline("\u51b3\u7b56\u5361\u7247\u5df2\u751f\u6210\uff0c\u8bf7\u9009\u62e9\u540e\u7ee7\u7eed\u3002"), false);
  assert.equal(isCompleteGovernmentOutline([
    "\u4e00\u3001\u5f00\u573a\u8bf4\u660e\u4f1a\u8bae\u76ee\u7684\u548c\u5de5\u4f5c\u80cc\u666f\uff0c\u5f3a\u8c03\u7edf\u4e00\u601d\u60f3\u3001\u660e\u786e\u4efb\u52a1\u3001\u52a1\u5b9e\u63a8\u8fdb\u7684\u603b\u4f53\u8981\u6c42\u3002",
    "\u4e8c\u3001\u91cd\u70b9\u90e8\u7f72\u56f4\u7ed5\u7a97\u53e3\u670d\u52a1\u3001\u6d41\u7a0b\u4f18\u5316\u548c\u534f\u540c\u529e\u7406\u5c55\u5f00\uff0c\u6bcf\u9879\u90fd\u660e\u786e\u8d23\u4efb\u548c\u6267\u884c\u8981\u6c42\u3002",
    "\u4e09\u3001\u6536\u675f\u90e8\u5206\u5f3a\u8c03\u538b\u5b9e\u8d23\u4efb\u3001\u52a0\u5f3a\u534f\u540c\u548c\u6301\u7eed\u6539\u8fdb\uff0c\u5f62\u6210\u7b80\u6d01\u52a1\u5b9e\u7684\u90e8\u7f72\u52a8\u5458\u3002"
  ].join("\n")), true);
});

test("modern specification plans never enter legacy outline service or crash markReady", () => {
  const plan = buildGovernmentWritingInitialPlan();
  const snapshot = {
    goal: { status: "active" as const },
    pendingQuestion: {
      questionId: "report-type",
      prompt: "请选择报告类型",
      options: [
        { label: "政策解读报告", description: "推荐", recommended: true },
        { label: "政策分析研究报告", description: "研究", recommended: false }
      ]
    },
    plan
  };
  assert.equal(shouldRunGovernmentOutlineService(snapshot as never, "部分草稿"), false);
  assert.doesNotThrow(() => markGovernmentOutlineReady(plan as never, "一、背景\n二、做法\n三、成效"));
  const next = markGovernmentOutlineReady(plan as never, "一、背景\n二、做法\n三、成效");
  assert.equal(next.some((step) => step.stepId === "outline-confirmation"), false);
  assert.equal(next.some((step) => step.stepId === "specification-confirmation"), true);
});

test("legacy outline plans still enter outline service when confirmation is pending", () => {
  const snapshot = {
    goal: { status: "active" as const },
    pendingQuestion: null,
    plan: [
      { stepId: "outline", title: "生成提纲", description: "", status: "completed", result: "一、开场\n二、部署\n三、收束" },
      { stepId: "outline-confirmation", title: "提纲确认", description: "", status: "pending", result: "" },
      { stepId: "draft", title: "撰写初稿", description: "", status: "pending", result: "" }
    ]
  };
  assert.equal(shouldRunGovernmentOutlineService(snapshot as never, ""), true);
});
