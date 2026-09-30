import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildPlainTextExport, buildResearchWritingSkillInvocation, buildResearchWritingSources, classifyResearchSource, defaultResearchWritingSession, researchWritingStorageKey, scanFactRisks } from "./research-writing.ts";

test("writing invocation preserves the requested topic and next action", () => {
  const session = { ...defaultResearchWritingSession(), topic: "海洋经济地方实践", targetWords: 3500, confirmedOutline: "一、以科技链牵引产业链" };
  const prompt = buildResearchWritingSkillInvocation(session, "先写第一部分");
  assert.match(prompt, /\$government-research-writing/);
  assert.match(prompt, /海洋经济地方实践/);
  assert.match(prompt, /以科技链牵引产业链/);
  assert.match(prompt, /先写第一部分/);
});

test("fact scanner identifies protected categories without inventing findings", () => {
  const risks = scanFactRisks("2025年，某县级市依据《海洋经济行动方案》实施10个项目，增长12.5%。【待核验】产值为30亿元。");
  assert.deepEqual(new Set(risks.map((risk) => risk.category)), new Set(["data", "policy", "time", "administrative-level", "unverified"]));
  assert.equal(scanFactRisks("坚持因地制宜，完善协同机制。").length, 0);
});

test("thread storage keys are isolated and marked export contains an appendix", () => {
  assert.notEqual(researchWritingStorageKey("a", "one"), researchWritingStorageKey("a", "two"));
  const output = buildPlainTextExport("测试稿", "正文", scanFactRisks("2025年增长10%。"));
  assert.match(output, /^测试稿/);
  assert.match(output, /事实校验附录/);
  assert.match(output, /2025年/);
});

test("a new writing session has no leaked request or answers", () => {
  const session = defaultResearchWritingSession();
  assert.equal(session.requestText, "");
  assert.deepEqual(session.intakeHistory, []);
  assert.equal(session.intakeComplete, false);
});

test("builds a trustworthy source ledger and excludes synthetic goal decisions", () => {
  assert.equal(classifyResearchSource("https://www.gov.cn/zhengce/test"), "政府官网");
  assert.equal(classifyResearchSource("https://paper.people.com.cn/test"), "中央媒体");
  assert.equal(classifyResearchSource("https://citydaily.example.cn/story"), "地方媒体");
  const sources = buildResearchWritingSources([
    { user: { content: "参考 https://www.gov.cn/zhengce/test 的公开材料。", attachments: [{ name: "案例汇编.docx", path: "案例汇编.docx" }] } },
    { user: { content: "目标决策：请确认提纲\n用户选择：确认提纲，开始起草正文" } }
  ]);
  assert.deepEqual(sources.map((source) => source.sourceType), ["政府官网", "用户附件"]);
  assert.equal(sources.some((source) => source.content.includes("用户选择")), false);
});

test("explicit government writing uses the normal composer and durable goal decision UI", async () => {
  const source = await readFile(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(source, /RESEARCH_WRITING_PRODUCT_ENABLED = true/);
  assert.match(source, /intakeComplete: researchEnabled \? true/);
  assert.doesNotMatch(source, /if \(requireResearchIntake\(\)\) return/);
  assert.match(source, /const researchIntakePending = false/);
  assert.doesNotMatch(source, /<section className="research-intake-card"/);
  assert.doesNotMatch(source, /researchIntakeInteractionActive/);
  assert.match(source, /!isAskingModel[\s\S]*goalExecution\?\.goal\?\.status === "active"[\s\S]*goalExecution\?\.pendingQuestion/);
  assert.match(source, /answerGoalDecision/);
  assert.match(source, /void askModel\(\)/);
  assert.match(source, /\.\.\.\(RESEARCH_WRITING_PRODUCT_ENABLED[\s\S]*central-government-research-writing/);
});
