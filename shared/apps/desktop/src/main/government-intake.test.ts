import assert from "node:assert/strict";
import test from "node:test";

const {
  GOVERNMENT_INTAKE_QUESTION_ID,
  analyzeGovernmentMissingInformation,
  applyGovernmentIntakeToPlan,
  buildGovernmentIntakeNotice,
  buildGovernmentIntakeQuestion,
  completeGovernmentIntakeInPlan,
  extractMissingInformationFromPlan
} = await import(new URL("./government-intake.js", import.meta.url).href);
const { buildGovernmentWritingInitialPlan } = await import(new URL("./government-goal-workflow.ts", import.meta.url).href);

test("identifies missing scenario, length, and material from a bare request", () => {
  const missing = analyzeGovernmentMissingInformation({
    userRequest: "请帮我撰写某区基层治理现代化实践总结，要求结构完整、内容详实。",
    hasAttachments: false
  });
  assert.deepEqual(missing, ["文章使用场景", "目标字数", "至少一份可引用的本地材料"]);
});

test("a complete request with attachments needs no clarification", () => {
  const missing = analyzeGovernmentMissingInformation({
    userRequest: "根据我上传的生产数据，写一篇煤炭企业2025年年终总结发言稿，约1200字。",
    hasAttachments: true
  });
  assert.deepEqual(missing, []);
});

test("a scoped case-study research article moves defaults into the confirmable specification", () => {
  const missing = analyzeGovernmentMissingInformation({
    userRequest: "请撰写一篇关于产业转型的典型案例研究文章，采用政务写作技能。",
    hasAttachments: false
  });
  assert.deepEqual(missing, []);
});

test("partially specified requests only ask for what is absent", () => {
  const missing = analyzeGovernmentMissingInformation({
    userRequest: "写一篇用于全市年终会议的讲话材料，字数3500字左右。",
    hasAttachments: false
  });
  assert.deepEqual(missing, []);
  const missingLength = analyzeGovernmentMissingInformation({
    userRequest: "写一篇用于全市年终会议的讲话，附材料如下。",
    hasAttachments: true
  });
  assert.deepEqual(missingLength, ["目标字数"]);
});

test("intake question and notice carry the missing items and survive plan round-trip", () => {
  const missing = ["文章使用场景", "目标字数"];
  const question = buildGovernmentIntakeQuestion(missing);
  assert.equal(question.questionId, GOVERNMENT_INTAKE_QUESTION_ID);
  assert.match(question.prompt, /文章使用场景、目标字数/);
  assert.equal(question.options.length, 2);
  assert.equal(question.options[0].recommended, true);

  assert.match(question.options[1].label, /写作规格/);
  const notice = buildGovernmentIntakeNotice(missing);
  assert.match(notice, /还需要补充以下信息/);
  assert.match(notice, /写作规格/);
  assert.match(notice, /- 目标字数/);

  const plan = applyGovernmentIntakeToPlan(buildGovernmentWritingInitialPlan(), missing);
  assert.equal(plan.find((step: any) => step.stepId === "material-assessment")?.status, "completed");
  assert.equal(plan.find((step: any) => step.stepId === "requirement-clarification")?.status, "in_progress");
  assert.deepEqual(extractMissingInformationFromPlan(plan), missing);

  const completed = completeGovernmentIntakeInPlan(plan, "用于全市年终会议，3500字左右");
  assert.equal(completed.find((step: any) => step.stepId === "requirement-clarification")?.status, "completed");
});
