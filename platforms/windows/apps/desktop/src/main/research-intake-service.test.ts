import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner loads this source file directly.
import { runResearchIntakeService } from "./research-intake.ts";

const plan = [
  { id: "materials", title: "主题与素材输入", description: "建立主题与素材边界", status: "active" },
  { id: "outline", title: "提纲提炼与确认", description: "生成并人工确认提纲", status: "pending" },
  { id: "section-drafting", title: "按提纲分段生成", description: "按确认提纲逐段生成", status: "pending" },
  { id: "style-unification", title: "文风统一", description: "统一政务写作文风", status: "pending" },
  { id: "fact-check", title: "基础事实校验", description: "检查事实与政策口径", status: "pending" },
  { id: "export", title: "导出", description: "导出目标文件", status: "pending" }
];

const questionJson = JSON.stringify({
  status: "question",
  analysis: "需要确认受众",
  plan,
  question: {
    id: "audience",
    prompt: "主要受众是谁？",
    options: [{ label: "领导决策", description: "突出依据" }, { label: "公开发布", description: "突出可读性" }]
  }
});

test("runs a valid first intake turn and forwards attachments", async () => {
  const calls: any[] = [];
  const result = await runResearchIntakeService({
    input: {
      userRequest: "写调研报告",
      attachments: [{ name: "素材.docx", path: "C:/tmp/素材.docx", url: "newbrain://attachment" }]
    },
    callModel: async (messages) => {
      calls.push(messages);
      return { content: questionJson };
    }
  });
  assert.equal(result.status, "question");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].attachments[0].name, "素材.docx");
});

test("repairs malformed model JSON once", async () => {
  let count = 0;
  let repaired = false;
  const result = await runResearchIntakeService({
    input: { userRequest: "写讲话稿" },
    callModel: async (messages) => {
      count += 1;
      if (count === 1) return { content: "not-json" };
      assert.equal(messages.length, 3);
      return { content: questionJson };
    },
    onRepair: () => { repaired = true; }
  });
  assert.equal(result.status, "question");
  assert.equal(count, 2);
  assert.equal(repaired, true);
});

test("forces ready after the sixth answer", async () => {
  let count = 0;
  const result = await runResearchIntakeService({
    input: {
      userRequest: "写报告",
      answers: Array.from({ length: 6 }, (_, index) => ({ question: `q${index}`, answer: `a${index}` }))
    },
    callModel: async (messages) => {
      count += 1;
      if (count === 1) return { content: questionJson };
      assert.match(messages[2].content, /status=ready/);
      return { content: JSON.stringify({ status: "ready", analysis: "信息足够", plan: plan.map((step) => ({ ...step, status: "completed", result: "已完成" })), targetContext: "生成供常务会议决策的调研报告" }) };
    }
  });
  assert.equal(result.status, "ready");
  assert.equal(count, 2);
});

test("fails clearly when the model still asks after the hard limit", async () => {
  await assert.rejects(() => runResearchIntakeService({
    input: {
      userRequest: "写报告",
      answers: Array.from({ length: 6 }, (_, index) => ({ question: `q${index}`, answer: `a${index}` }))
    },
    callModel: async () => ({ content: questionJson })
  }), /未生成目标约束/);
});

test("retries one transient timeout and preserves the same intake request", async () => {
  const calls: any[] = [];
  let retries = 0;
  const result = await runResearchIntakeService({
    input: { userRequest: "draft a meeting speech", answers: [] },
    callModel: async (messages) => {
      calls.push(messages);
      if (calls.length === 1) {
        const error = new Error("The operation was aborted due to timeout");
        error.name = "TimeoutError";
        throw error;
      }
      return { content: questionJson };
    },
    onTransientRetry: () => { retries += 1; }
  });
  assert.equal(result.status, "question");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(retries, 1);
});

test("does not retry non-transient intake failures", async () => {
  let calls = 0;
  await assert.rejects(() => runResearchIntakeService({
    input: { userRequest: "draft a meeting speech", answers: [] },
    callModel: async () => {
      calls += 1;
      throw new Error("invalid credentials");
    }
  }), /invalid credentials/);
  assert.equal(calls, 1);
});

test("derives visible progress from confirmed answers instead of trusting the model", async () => {
  const result = await runResearchIntakeService({
    input: {
      userRequest: "draft a policy briefing",
      answers: [
        { question: "audience", answer: "city leaders" },
        { question: "purpose", answer: "work deployment" }
      ]
    },
    callModel: async () => ({ content: questionJson })
  });
  assert.equal(result.status, "question");
  assert.equal(result.question?.progress.current, 3);
  assert.ok((result.question?.progress.total || 0) >= 3);
});
