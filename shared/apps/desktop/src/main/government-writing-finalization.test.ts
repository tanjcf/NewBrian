import assert from "node:assert/strict";
import test from "node:test";

const {
  buildGovernmentWritingFinalizationRequest,
  parseGovernmentWritingFinalization,
  sanitizeGovernmentDraftForDelivery,
  selectGovernmentDraftCandidate,
  hasSubstantiveGovernmentDraftBody,
  isGovernmentDraftClaimWithoutBody
} = await import(
  new URL("./government-writing-finalization.ts", import.meta.url).href
) as typeof import("./government-writing-finalization.js");

test("defers replacement reset until the retry emits visible text", async () => {
  const module = await import(new URL("./government-writing-finalization.ts", import.meta.url).href) as any;
  assert.equal(typeof module.createGovernmentFinalizationReplacementEmitter, "function");
  const events: Array<{ delta: string; reset?: boolean }> = [];
  const emitReplacement = module.createGovernmentFinalizationReplacementEmitter(
    "request-1",
    (event: { delta: string; reset?: boolean }) => events.push(event)
  );
  assert.deepEqual(events, []);
  emitReplacement("替代正文");
  emitReplacement("继续输出");
  assert.deepEqual(events, [
    { requestId: "request-1", delta: "替代正文", reset: true },
    { requestId: "request-1", delta: "继续输出" }
  ]);
});

test("parses an evidence-aware government-writing finalization", () => {
  const validFinalization = JSON.stringify({
    finalDraft: "同志们，现就有关工作作出安排。要坚持目标导向，逐项明确责任单位、完成时限和验收标准；要强化协同联动，及时解决推进中的堵点难点；要严格跟踪问效，定期复盘工作进展，确保各项任务按计划落地见效。各部门要主动担当、密切配合，以务实作风推动部署要求落实到位。",
    styleReview: "\u5df2\u7edf\u4e00\u4e3a\u52a1\u5b9e\u514b\u5236\u7684\u5185\u90e8\u90e8\u7f72\u8bed\u4f53\u3002",
    factReview: "\u672a\u4f7f\u7528\u65e0\u6765\u6e90\u6570\u636e\u6216\u653f\u7b56\u6587\u4ef6\u540d\u3002",
    verificationNeeded: []
  });
  const parsed = parseGovernmentWritingFinalization(`${validFinalization}\nFinalization completed.\n{"ignored":true}`);
  assert.match(parsed.finalDraft, /\u540c\u5fd7\u4eec/);
  assert.deepEqual(parsed.verificationNeeded, []);
  assert.match(buildGovernmentWritingFinalizationRequest("request", "draft"), /Return JSON only/);
  assert.match(buildGovernmentWritingFinalizationRequest("request", "draft"), /primary official source/);
  assert.match(buildGovernmentWritingFinalizationRequest("request", "draft"), /Media reports, search snippets.*do not establish a government fact/);
  assert.match(buildGovernmentWritingFinalizationRequest("request", "draft"), /Never invent a source title, URL, document number/);
  assert.throws(() => parseGovernmentWritingFinalization('{"finalDraft":"x"}'), /style review/);
  assert.throws(() => parseGovernmentWritingFinalization(JSON.stringify({
    finalDraft: "...",
    styleReview: "...",
    factReview: "...",
    verificationNeeded: []
  })), /style review/);
  assert.throws(() => parseGovernmentWritingFinalization(JSON.stringify({
    finalDraft: `Let me draft the speech now. ${"同志们，要持续改进服务流程，压实工作责任，提升服务质效。".repeat(8)}`,
    styleReview: "已检查文风与结构。",
    factReview: "已检查事实边界。",
    verificationNeeded: []
  })), /private planning/);
  assert.throws(() => parseGovernmentWritingFinalization(JSON.stringify({
    finalDraft: `同志们，本周内成立专项工作组，由政务服务科牵头推进。${"要压实责任，改进服务，确保工作落实。".repeat(8)}`,
    styleReview: "已检查文风与结构。",
    factReview: "已检查事实边界。",
    verificationNeeded: []
  })), /unsupported dates/);
  const sanitized = sanitizeGovernmentDraftForDelivery([
    "Let me draft this now.",
    "同志们：今年以来，我们取得了阶段性成效。今天召开会议，主要部署下一阶段工作。",
    "本周内成立专项工作组，由政务服务科牵头推进。",
    "各科室要压实责任，优化流程，提升服务质效。",
    "正文初稿已生成，但尚未终审。"
  ].join("\n"));
  assert.doesNotMatch(sanitized, /Let me|今年以来|专项工作组|政务服务科|正文初稿/);
  assert.match(sanitized, /今天召开会议/);
  assert.match(sanitized, /各责任主体/);
  const repeatedSalutation = sanitizeGovernmentDraftForDelivery([
    "# 年终总结发言稿",
    "同志们：开场并回顾全年工作。",
    "一、安全生产。二、稳产保供。三、智能化建设。四、存在的问题。",
    "同志们，新一年继续奋斗。",
    "谢谢大家。"
  ].join("\n"));
  assert.match(repeatedSalutation, /开场并回顾全年工作/u);
  assert.match(repeatedSalutation, /安全生产/u);
  assert.match(repeatedSalutation, /新一年继续奋斗/u);
  const evidenceSanitized = sanitizeGovernmentDraftForDelivery(
    "同志们：前一阶段，群众满意度稳步提升。贯彻落实某专项部署要求，下一步要优化办事流程。《虚构政策》要求在2026年完成任务。",
    "用户只要求起草内部部署讲话，不得虚构政策、数据、日期或工作成绩。"
  );
  assert.doesNotMatch(evidenceSanitized, /满意度稳步提升|《虚构政策》|2026年/);
  assert.match(evidenceSanitized, /围绕当前工作任务|优化办事流程/);
  const supportedEvidence = sanitizeGovernmentDraftForDelivery(
    "材料显示，2026年办结率达到96%。",
    "政府官网材料明确写明：2026年办结率达到96%。"
  );
  assert.match(supportedEvidence, /2026年办结率达到96%/);
  assert.equal(
    selectGovernmentDraftCandidate("Goal completed.", ["A".repeat(300), "B".repeat(280)]),
    "A".repeat(300)
  );
  assert.equal(
    selectGovernmentDraftCandidate(
      "Goal completed.",
      ["Goal completed.", "\u76ee\u6807\u5df2\u5b8c\u6210\uff0c\u6d41\u7a0b\u5168\u90e8\u95ed\u73af\u3002".repeat(30), "C".repeat(320)]
    ),
    "C".repeat(320)
  );
  assert.equal(
    selectGovernmentDraftCandidate(
      "⏸️ 初稿已完成（约2900字）。如需继续，请确认是否进入风格统一与事实核验步骤？",
      ["验证项 | 标准 | 实际 | 结果\n篇幅 | 3000字 | 2900 | ✅"]
    ),
    ""
  );
  assert.equal(
    isGovernmentDraftClaimWithoutBody("完整正文已在上方呈现。如需调整任何部分，请告知。"),
    true
  );
  assert.equal(
    hasSubstantiveGovernmentDraftBody(`一、背景\n${"贵阳市大数据产业从资源禀赋出发，探索新质生产力落地路径。".repeat(8)}`),
    true
  );
});

test("government draft body helpers reject meta claims", async () => {
  const {
    governmentDraftBodyInstruction,
    hasSubstantiveGovernmentDraftBody,
    isGovernmentDraftClaimWithoutBody
  } = await import(new URL("./government-draft-body.js", import.meta.url).href) as typeof import("./government-draft-body.js");
  assert.match(governmentDraftBodyInstruction(), /COMPLETE Chinese article body/);
  assert.equal(isGovernmentDraftClaimWithoutBody(""), true);
  assert.equal(isGovernmentDraftClaimWithoutBody("Continue with the current deliverable; do not call goal.finish directly."), true);
  assert.equal(hasSubstantiveGovernmentDraftBody("正文已经开始。"), false);
});
