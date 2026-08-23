import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner loads this source file directly.
import { buildResearchIntakeModelPrompt, normalizeResearchIntakeAnswers, parseResearchIntakeResult, selectResearchIntakeModel } from "./research-intake.ts";

const plan = [
  { id: "materials", title: "主题与素材输入", description: "建立主题与素材边界", status: "active" },
  { id: "outline", title: "提纲提炼与确认", description: "生成并人工确认提纲", status: "pending" },
  { id: "section-drafting", title: "按提纲分段生成", description: "按确认提纲逐段生成", status: "pending" },
  { id: "style-unification", title: "文风统一", description: "统一政务写作文风", status: "pending" },
  { id: "fact-check", title: "基础事实校验", description: "检查事实与政策口径", status: "pending" },
  { id: "export", title: "导出", description: "导出目标文件", status: "pending" }
];

test("parses a model-generated research intake question", () => {
  const result = parseResearchIntakeResult(JSON.stringify({
    status: "question",
    analysis: "需要确认使用场景",
    plan,
    question: {
      id: "audience",
      prompt: "这篇材料主要用于什么场景？",
      progress: { current: 2, total: 4 },
      options: [
        { label: "会议讲话", description: "强调部署和动员", recommended: true },
        { label: "内部汇报", description: "强调事实和决策依据" }
      ]
    }
  }));
  assert.equal(result.status, "question");
  assert.equal(result.question?.options.length, 2);
  assert.equal(result.question?.progress.current, 2);
});

test("parses a ready target and includes previous answers in the next analysis", () => {
  const ready = parseResearchIntakeResult(JSON.stringify({ status: "ready", analysis: "足够", plan: plan.map((step) => ({ ...step, status: "completed", result: "已完成" })), targetContext: "生成一篇面向干部大会的讲话稿" }));
  assert.equal(ready.targetContext, "生成一篇面向干部大会的讲话稿");
  const prompt = buildResearchIntakeModelPrompt({
    userRequest: "写一篇高质量发展讲话稿",
    answers: [{ question: "使用场景？", answer: "干部大会" }]
  });
  assert.match(prompt, /干部大会/);
  assert.match(prompt, /禁止固定题库/);
  assert.match(prompt, /materials（主题与素材输入）→ outline（提纲提炼及人工确认）→ section-drafting/);
  assert.match(prompt, /首次 ready 的目标成果只能是提纲/);
  assert.equal(ready.plan.every((step) => step.status === "completed" && Boolean(step.result)), true);
});

test("rejects illegal states and incomplete question payloads", () => {
  assert.throws(() => parseResearchIntakeResult('{"status":"done"}'), /不支持/);
  assert.throws(() => parseResearchIntakeResult(JSON.stringify({
    status: "question",
    plan: plan.slice(0, 5),
    question: { prompt: "用途？", options: [{ label: "内部", description: "内部使用" }, { label: "公开", description: "公开使用" }] }
  })), /固定六阶段/);
  assert.throws(() => parseResearchIntakeResult(JSON.stringify({ status: "question", plan, question: { prompt: "用途？", options: [{ label: "内部" }] } })), /不完整/);
});

test("deduplicates options and keeps only one recommendation", () => {
  const result = parseResearchIntakeResult(JSON.stringify({
    status: "question",
    plan,
    question: {
      prompt: "用途？",
      options: [
        { label: "内部汇报", description: "用于内部决策。", recommended: true },
        { label: "内部汇报", description: "重复选项。", recommended: true },
        { label: "公开发布", description: "用于社会公开。", recommended: true }
      ]
    }
  }));
  assert.deepEqual(result.question?.options.map((item) => item.label), ["内部汇报", "公开发布"]);
  assert.equal(result.question?.options.filter((item) => item.recommended).length, 1);
});

test("bounds untrusted intake history and preserves the latest six answers", () => {
  const answers = normalizeResearchIntakeAnswers(Array.from({ length: 8 }, (_, index) => ({
    question: `q${index}`.repeat(600),
    answer: `a${index}`.repeat(1_200)
  })));
  assert.equal(answers.length, 6);
  assert.match(answers[0].question, /^q2/);
  assert.equal(answers[0].question.length, 240);
  assert.equal(answers[0].answer.length, 600);
});

test("rejects options without an impact description and sanitizes question ids", () => {
  assert.throws(() => parseResearchIntakeResult(JSON.stringify({
    status: "question",
    plan,
    question: {
      prompt: "choose",
      options: [
        { label: "A", description: "" },
        { label: "B", description: "impact B" }
      ]
    }
  })), /选项不完整/);

  const parsed = parseResearchIntakeResult(JSON.stringify({
    status: "question",
    plan,
    question: {
      id: "audience <script>alert(1)</script>",
      prompt: "choose",
      options: [
        { label: "A", description: "impact A" },
        { label: "B", description: "impact B" }
      ]
    }
  }));
  assert.match(parsed.question?.id || "", /^[a-zA-Z0-9_-]+$/);
  assert.ok((parsed.question?.id.length || 0) <= 120);
});

test("prefers an authorized low-latency model for interactive intake", () => {
  const current = { model: "deepseek-v4-pro", provider: "gateway" };
  const fast = { model: "deepseek-v4-flash", provider: "gateway" };
  assert.equal(selectResearchIntakeModel(current, [current, fast]), fast);
  assert.equal(selectResearchIntakeModel(current, [current]), current);
});
