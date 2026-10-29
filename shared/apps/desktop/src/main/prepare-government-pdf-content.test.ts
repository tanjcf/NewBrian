import assert from "node:assert/strict";
import test from "node:test";

const { prepareGovernmentPdfContent } = await import(
  new URL("./government-writing-finalization.ts", import.meta.url).href
);

const opening =
  "同志们：\n今天召开专题会议，研究县域富民产业与农民工就业基本盘。\n" +
  "一、背景形势\n近期调研显示，县域就业承压，需稳住外出务工与返乡创业两端。";

const fullArticle =
  "同志们：\n今天我们专题研究加快完善县域富民产业、持续巩固农民工就业基本盘。\n\n" +
  "一、深刻认识稳就业、兴产业的现实紧迫性\n" +
  `${"县域是农民工就业的重要承载地，必须把富民产业做实做细。".repeat(12)}\n\n` +
  "二、当前县域富民产业与就业工作存在的突出问题\n" +
  `${"产业层次偏低、技能培训供需错配、融资成本偏高，制约就近就业质量提升。".repeat(10)}\n\n` +
  "三、对策建议\n" +
  `${"坚持政策设计、问题导向与具体举措一体推进，形成可落地的工作闭环。".repeat(10)}`;

test("prepareGovernmentPdfContent prefers substantive full draft over early opening", () => {
  const prepared = prepareGovernmentPdfContent("Goal completed.", [opening, fullArticle], "");
  assert.match(prepared, /对策建议/);
  assert.ok(prepared.replace(/\s+/g, "").length > opening.replace(/\s+/g, "").length);
});

test("prepareGovernmentPdfContent keeps short complete speeches via salutation fallback", () => {
  const speech = [
    "原始交付要求：写发言稿并生成 PDF。",
    "同志们：",
    "大家好！过去一年，全体干部职工担当尽责。新的一年，我们将守牢安全底线，推动企业高质量发展。谢谢大家！",
    "### 终审结果",
    "- 文风统一：已检查。",
    "PDF 文件尚未生成并验证，目标保持进行中。"
  ].join("\n");
  const prepared = prepareGovernmentPdfContent(speech, [], "写发言稿并生成 PDF");
  assert.match(prepared, /^同志们：/u);
  assert.doesNotMatch(prepared, /原始交付要求|终审结果|尚未生成/u);
});

test("prepareGovernmentPdfContent accepts a single substantive draft", () => {
  const prepared = prepareGovernmentPdfContent(fullArticle, [], "");
  assert.match(prepared, /同志们/);
  assert.match(prepared, /对策建议/);
});
