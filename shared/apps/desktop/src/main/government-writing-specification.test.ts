import assert from "node:assert/strict";
import test from "node:test";
const {
  analyzeGovernmentSpecificationCompleteness,
  applyGovernmentWritingSuggestions,
  buildSpecificationGenerationInput,
  canStartGovernmentDraft,
  parseGovernmentWritingSpecificationMarkdown,
  serializeGovernmentWritingSpecificationMarkdown,
  validateGovernmentWritingSpecification
} = await import(new URL("./government-writing-specification.ts", import.meta.url).href);

function validSpecification() {
  return {
    task: "撰写因地制宜发展新质生产力典型案例研究文章。",
    requirements: [
      { key: "theme", label: "主题定位", value: "回答为什么和怎样因地制宜", status: "confirmed" as const },
      { key: "caseSelection", label: "案例选取", value: "选取可核验地方案例", status: "confirmed" as const },
      { key: "caseLogic", label: "案例展开逻辑", value: "按禀赋、困境、做法、成效展开", status: "confirmed" as const },
      { key: "genre", label: "文体", value: "理论案例研究文章", status: "confirmed" as const },
      { key: "language", label: "语言", value: "政务书面语，克制规范", status: "confirmed" as const },
      { key: "data", label: "数据使用", value: "仅使用可考数据，禁止虚构", status: "confirmed" as const },
      { key: "citation", label: "引用规范", value: "引用权威公开文献与讲话摘录", status: "confirmed" as const },
      { key: "length", label: "篇幅", value: "全文约3500字", status: "confirmed" as const }
    ],
    cases: [{
      caseId: "yunnan",
      name: "云南高原特色农业",
      plannedUse: "说明科技赋能特色农业",
      status: "verified" as const,
      evidence: [{
        evidenceId: "ev-1",
        title: "云南省农业现代化相关公开材料",
        authority: "云南省人民政府",
        publishedAt: "2025-01-01",
        url: "https://www.yn.gov.cn/example.html",
        supportedClaims: ["云南发展高原特色农业"],
        unsupportedClaims: [],
        readFromOfficialPage: true,
        status: "verified" as const
      }]
    }],
    structure: [{
      sectionId: "summary",
      level: 1 as const,
      title: "摘要",
      points: "概括案例与启示",
      evidenceIds: ["ev-1"],
      targetCharacters: 200,
      verification: "不得引入未核验数据"
    }]
  };
}

test("validates all four specification sections", () => {
  const result = validateGovernmentWritingSpecification(validSpecification());
  assert.equal(result.task.length > 0, true);
  assert.equal(result.requirements.length, 8);
  assert.equal(result.cases[0].evidence[0].status, "verified");
  assert.equal(result.structure[0].title, "摘要");
});

test("marks a complete writing-specification analysis ready for user confirmation", () => {
  const complete = analyzeGovernmentSpecificationCompleteness(validSpecification());
  assert.equal(complete.complete, true);
  assert.deepEqual(complete.missing, []);
  const incomplete = analyzeGovernmentSpecificationCompleteness({
    task: "写一篇文章",
    requirements: [{ key: "theme", label: "主题定位", value: "回答核心问题", status: "confirmed" }],
    cases: [],
    structure: [{
      sectionId: "summary", level: 1, title: "摘要", points: "概括",
      evidenceIds: [], targetCharacters: 200, verification: "不得引入未核验数据"
    }]
  });
  assert.equal(incomplete.complete, false);
  assert.ok(incomplete.missing.some((item: { id: string }) => item.id === "length"));
});

test("rejects a verified case backed only by a search summary", () => {
  const input = validSpecification();
  input.cases[0].evidence[0].readFromOfficialPage = false;
  assert.throws(() => validateGovernmentWritingSpecification(input), /政府网页原文/u);
});

test("does not import unrelated historical messages into generation input", () => {
  const input = buildSpecificationGenerationInput({
    currentGoal: "撰写农业新质生产力案例研究",
    currentAttachments: [],
    currentEvidence: [],
    historicalMessages: ["煤炭企业原煤产量301万吨"]
  });
  assert.doesNotMatch(JSON.stringify(input), /煤炭|301万吨/u);
});

test("round-trips a specification through Markdown", () => {
  const source = validateGovernmentWritingSpecification(validSpecification());
  const markdown = serializeGovernmentWritingSpecificationMarkdown(source);
  assert.match(markdown, /写作任务[\s\S]*核心要求[\s\S]*案例与官方证据[\s\S]*结构模板[\s\S]*写作风格约束/u);
  assert.deepEqual(parseGovernmentWritingSpecificationMarkdown(markdown), source);
});

test("applies selected guidance without mutating the prior version", () => {
  const source = validateGovernmentWritingSpecification(validSpecification());
  const next = applyGovernmentWritingSuggestions(source, [{
    suggestionId: "s-1",
    target: { kind: "requirement", key: "theme" as const },
    reason: "表达更明确",
    proposedValue: "重点回答因地制宜的必要性与实践路径"
  }] as any, ["s-1"]);
  assert.equal(source.requirements[0].value, "回答为什么和怎样因地制宜");
  assert.equal(next.requirements[0].value, "重点回答因地制宜的必要性与实践路径");
});

test("allows drafting only from the current confirmed specification version", () => {
  assert.equal(canStartGovernmentDraft(null), false);
  assert.equal(canStartGovernmentDraft({ currentVersionId: "v2", confirmedVersionId: "v1" }), false);
  assert.equal(canStartGovernmentDraft({ currentVersionId: "v2", confirmedVersionId: "v2" }), true);
});
