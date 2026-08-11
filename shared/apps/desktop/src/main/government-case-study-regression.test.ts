import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const {
  advanceGovernmentPlanAfterSpecificationConfirm,
  advanceGovernmentPlanAfterSpecificationSaved,
  buildSpecificationGenerationInput,
  canStartGovernmentDraft
} = await import(new URL("./government-writing-specification.ts", import.meta.url).href);
const { buildGovernmentWritingInitialPlan } = await import(new URL("./government-goal-workflow.ts", import.meta.url).href);
const { shouldAutomaticallyUseGovernmentWriting } = await import(new URL("./government-skill-routing.js", import.meta.url).href);
const {
  extractPreservableGovernmentFacts,
  preserveSubstantiveGovernmentDraft
} = await import(new URL("./government-draft-preservation.js", import.meta.url).href);
const { buildGovernmentResultOracle, scoreGovernmentResultAgainstOracle } = await import(
  new URL("./government-result-oracle.js", import.meta.url).href
);
const { registerOfficialGovernmentWebTools } = await import(
  new URL("./official-government-web-tools.ts", import.meta.url).href
);
const {
  analyzeGovernmentSpecificationCompleteness,
  serializeGovernmentWritingSpecificationMarkdown,
  validateGovernmentWritingSpecification
} = await import(new URL("./government-writing-specification.ts", import.meta.url).href);
const { sanitizeGovernmentDraftForDelivery } = await import(
  new URL("./government-writing-finalization.ts", import.meta.url).href
);
const { shouldHandoffGovernmentOutline, shouldPauseForGovernmentUserConfirmation } = await import(
  new URL("./model-chat-agent-loop-service.ts", import.meta.url).href
);
const { isGovernmentOutlinePreparationRequired } = await import(
  new URL("./government-outline-decision.ts", import.meta.url).href
);

const CASE_REQUEST = "请你撰写一篇关于‘因地制宜发展新质生产力’的典型案例研究文章。";

async function loadResultOracleText() {
  const mammoth = await import("mammoth");
  const docxPath = resolve(process.cwd(), "..", "..", "..", "tmp", "gov-case-verify.docx");
  const extracted = await mammoth.extractRawText({ buffer: readFileSync(docxPath) });
  return String(extracted.value || "");
}

test("routes the new-quality-productivity case-study request into government writing", () => {
  assert.equal(shouldAutomaticallyUseGovernmentWriting(CASE_REQUEST), true);
});

test("initial government plan is specification-first and scenario-agnostic", async () => {
  const plan = buildGovernmentWritingInitialPlan();
  assert.deepEqual(
    plan.map((step: { stepId: string }) => step.stepId),
    [
      "material-assessment",
      "requirement-clarification",
      "official-evidence-research",
      "writing-specification",
      "specification-confirmation",
      "draft",
      "style-unification",
      "fact-check",
      "delivery"
    ]
  );
  const joined = JSON.stringify(plan);
  assert.doesNotMatch(joined, /煤炭|301万吨|5180|年终总结发言稿|云南|江苏|庆阳/u);
  assert.equal(shouldHandoffGovernmentOutline({
    goal: { status: "active" },
    pendingQuestion: null,
    plan
  } as never), false);
  assert.equal(isGovernmentOutlinePreparationRequired({
    goal: { status: "active" },
    pendingQuestion: null,
    plan: plan.map((step: { stepId: string }) => step.stepId === "specification-confirmation"
      ? { ...step, status: "in_progress" }
      : step)
  } as never), false);
});

test("result oracle docx drives dynamic validation and is not treated as a fixed scene template", async () => {
  const text = await loadResultOracleText();
  const oracle = buildGovernmentResultOracle(text);
  assert.equal(oracle.sourceKind, "result-oracle");
  assert.ok(oracle.characterCount > 2_000);
  assert.ok(oracle.requiredPhrases.includes("因地制宜"));
  assert.ok(oracle.requiredPhrases.includes("新质生产力"));
  assert.ok(oracle.distinctivePhrases.length >= 4);
  assert.equal(oracle.structuralHints.hasAbstract, true);
  assert.equal(oracle.structuralHints.hasBackground, true);
  assert.equal(oracle.structuralHints.hasPractices, true);
  assert.equal(oracle.structuralHints.hasImplications, true);

  // Generation input for this request must not pull unrelated historical coal facts,
  // and must not require the oracle file as an attachment.
  const input = buildSpecificationGenerationInput({
    currentGoal: CASE_REQUEST,
    currentAttachments: [],
    currentEvidence: [],
    historicalMessages: ["煤炭企业原煤产量301万吨", "安全培训5180人次"]
  });
  assert.doesNotMatch(JSON.stringify(input), /煤炭|301万吨|5180|云南|江苏|庆阳/u);
  assert.equal(input.currentAttachments.length, 0);

  const aligned = scoreGovernmentResultAgainstOracle(text, oracle);
  assert.equal(aligned.pass, true);
  assert.ok(aligned.requiredHitRate >= 0.5);

  const coalSpeech = "同志们：原煤产量301万吨，安全培训5180人次，全年安全生产形势总体平稳。";
  const mismatched = scoreGovernmentResultAgainstOracle(coalSpeech, oracle, {
    forbiddenCrossScene: ["301万吨", "5180人次", "煤炭企业2025年年终总结发言稿"]
  });
  assert.equal(mismatched.pass, false);
  assert.ok(mismatched.requiredHitRate < 0.5 || mismatched.leakedForbidden.length > 0);
});

test("draft preservation keeps facts discovered in the candidate, not a fixed scene list", () => {
  const candidate = [
    "# 摘要",
    "云南高原特色农业近3万亿元，江苏连续11年全国第一，庆阳建成东数西算集群。",
    "# 背景",
    "材料未证明的增长率不得写入。",
    "# 做法",
    "一、科技赋能；二、深耕根基；三、算力突围。",
    "# 启示",
    "因地制宜。"
  ].join("\n");
  const reviewed = "# 摘要\n各地都取得了很好成绩。\n# 背景\n略。";
  const facts = extractPreservableGovernmentFacts(candidate);
  assert.ok(facts.some((fact: string) => /3万亿/.test(fact)));
  assert.equal(preserveSubstantiveGovernmentDraft(reviewed, candidate), candidate);

  const coalCandidate = "同志们：原煤产量301万吨，安全培训5180人次，智能设备31套，无较大及以上安全事故。";
  const coalReviewed = "同志们：全年安全生产形势总体平稳。";
  assert.equal(preserveSubstantiveGovernmentDraft(coalReviewed, coalCandidate), coalCandidate);
});

test("saving and confirming a specification advances the durable plan without outline cards", () => {
  const plan = buildGovernmentWritingInitialPlan();
  const afterSave = advanceGovernmentPlanAfterSpecificationSaved(plan);
  assert.equal(afterSave.find((step: { stepId: string }) => step.stepId === "writing-specification")?.status, "completed");
  assert.equal(afterSave.find((step: { stepId: string }) => step.stepId === "specification-confirmation")?.status, "in_progress");
  assert.equal(shouldPauseForGovernmentUserConfirmation({
    goal: { status: "active" },
    pendingQuestion: null,
    plan: afterSave
  } as never), true);

  const afterConfirm = advanceGovernmentPlanAfterSpecificationConfirm(afterSave, [
    { title: "背景情况" },
    { title: "主要做法" },
    { title: "经验启示" }
  ]);
  assert.equal(afterConfirm.find((step: { stepId: string }) => step.stepId === "specification-confirmation")?.status, "completed");
  assert.deepEqual(
    afterConfirm
      .filter((step: { stepId: string }) => step.stepId.startsWith("draft-section-"))
      .map((step: { title: string }) => step.title),
    ["分段撰写：背景情况", "分段撰写：主要做法", "分段撰写：经验启示"]
  );
  assert.equal(canStartGovernmentDraft({ currentVersionId: "v1", confirmedVersionId: "v1" }), true);
});

test("production government modules do not hard-code coal or case-study scenes", async () => {
  const files = [
    "./government-goal-workflow.ts",
    "./government-draft-preservation.js",
    "./government-skill-routing.js",
    "./government-writing-specification.ts",
    "./central-skills.ts",
    "./government-result-oracle.js"
  ];
  for (const relative of files) {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL(relative, import.meta.url), "utf8")
    );
    assert.doesNotMatch(
      source,
      /301万吨|5180人次|煤炭企业2025年年终总结发言稿|buildMaterialBoundGovernmentOutline|山川有别|东数西算国家数据中心/u,
      relative
    );
  }
});

test("case-study service integration follows official-search to confirmed-specification to sourced-draft", async () => {
  const calls: string[] = [];
  const registered: Array<{
    definition: { name?: string };
    execute: (input: Record<string, unknown>) => Promise<{ ok: boolean; output: string }>;
  }> = [];
  registerOfficialGovernmentWebTools({
    unregisterExternalTools() {},
    registerExternalTool(definition: { name?: string }, execute: (input: Record<string, unknown>) => Promise<{ ok: boolean; output: string }>) {
      registered.push({ definition, execute });
    }
  }, {
    async search({ query }: { query: string }) {
      calls.push(`search:${query}`);
      return [{
        title: "甲地人民政府关于推进海洋特色产业升级的公开材料",
        url: "https://example.gov.cn/policy/case-a",
        snippet: "甲地立足海洋资源和产业基础推进技术改造",
        rank: 1
      }];
    },
    async read({ url }: { url: string }) {
      calls.push(`read:${url}`);
      return {
        url,
        title: "甲地人民政府关于推进海洋特色产业升级的公开材料",
        text: "甲地立足海洋资源禀赋和既有产业基础，以技术改造推动海洋特色产业高端化、智能化、绿色化。"
      };
    }
  } as never);

  assert.deepEqual(registered.map((item) => item.definition.name), [
    "web.search_official",
    "web.read_official"
  ]);
  const search = await registered[0].execute({ query: "因地制宜发展新质生产力 地方典型案例" });
  assert.equal(search.ok, true);
  const searchPayload = JSON.parse(search.output);
  const read = await registered[1].execute({ url: searchPayload.results[0].url });
  assert.equal(read.ok, true);
  const officialPage = JSON.parse(read.output);
  assert.deepEqual(calls, [
    "search:因地制宜发展新质生产力 地方典型案例",
    "read:https://example.gov.cn/policy/case-a"
  ]);

  const specification = validateGovernmentWritingSpecification({
    task: CASE_REQUEST,
    requirements: [
      { key: "theme", label: "主题定位", value: "因地制宜发展新质生产力", status: "confirmed" },
      { key: "caseSelection", label: "案例选取", value: "选用已读取政府网页的地方实践", status: "confirmed" },
      { key: "caseLogic", label: "案例展开逻辑", value: "基础—做法—成效—启示", status: "confirmed" },
      { key: "genre", label: "文体", value: "典型案例研究文章", status: "confirmed" },
      { key: "language", label: "语言", value: "规范政务研究文风", status: "confirmed" },
      { key: "data", label: "数据使用", value: "仅使用官方页面可核验事实", status: "confirmed" },
      { key: "citation", label: "引用规范", value: "注明政府网页来源", status: "confirmed" },
      { key: "length", label: "篇幅", value: "约3000字", status: "confirmed" }
    ],
    cases: [{
      caseId: "case-a",
      name: "甲地海洋特色产业升级实践",
      plannedUse: "分析资源禀赋与产业升级的结合路径",
      status: "verified",
      evidence: [{
        evidenceId: "evidence-a",
        title: officialPage.title,
        authority: "甲地人民政府",
        publishedAt: "2026-01-01",
        url: officialPage.url,
        supportedClaims: [officialPage.text],
        unsupportedClaims: ["产值增长50%"],
        readFromOfficialPage: true,
        status: "verified"
      }]
    }],
    structure: [
      { sectionId: "abstract", level: 1, title: "摘要", points: "概括案例路径", evidenceIds: ["evidence-a"], targetCharacters: 300, verification: "与正文一致" },
      { sectionId: "background", level: 1, title: "背景", points: "说明资源和产业基础", evidenceIds: ["evidence-a"], targetCharacters: 500, verification: "核对政府网页" },
      { sectionId: "practices", level: 1, title: "主要做法", points: "说明技术改造路径", evidenceIds: ["evidence-a"], targetCharacters: 1200, verification: "核对政府网页" },
      { sectionId: "implications", level: 1, title: "经验启示", points: "提炼因地制宜方法", evidenceIds: ["evidence-a"], targetCharacters: 600, verification: "不得超出证据" }
    ]
  });
  assert.equal(analyzeGovernmentSpecificationCompleteness(specification).complete, true);
  assert.match(serializeGovernmentWritingSpecificationMarkdown(specification), /example\.gov\.cn\/policy\/case-a/u);

  const afterSave = advanceGovernmentPlanAfterSpecificationSaved(buildGovernmentWritingInitialPlan());
  const afterConfirm = advanceGovernmentPlanAfterSpecificationConfirm(afterSave, specification.structure);
  assert.equal(afterConfirm.find((step: { stepId: string }) => step.stepId === "specification-confirmation")?.status, "completed");
  assert.equal(canStartGovernmentDraft({ currentVersionId: "v1", confirmedVersionId: "v1" }), true);

  const draft = sanitizeGovernmentDraftForDelivery([
    "# 摘要",
    "甲地以海洋资源禀赋和产业基础为依托，通过技术改造培育新质生产力。",
    "# 一、背景",
    officialPage.text,
    "# 二、主要做法",
    "坚持从实际出发推进技术改造，促进海洋特色产业高端化、智能化、绿色化。",
    "# 三、经验启示",
    "地方发展新质生产力必须立足资源禀赋和产业基础，不能照搬其他地区模式。"
  ].join("\n"));
  assert.match(draft, /海洋特色产业/u);
  assert.match(draft, /资源禀赋/u);
  assert.doesNotMatch(draft, /产值增长50%/u);
  assert.doesNotMatch(draft, /301\s*万吨|煤炭企业2025年年终总结发言稿/u);
});
