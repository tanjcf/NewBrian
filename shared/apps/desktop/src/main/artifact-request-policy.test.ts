import assert from "node:assert/strict";
import test from "node:test";

const policy = await import(new URL("./artifact-request-policy.js", import.meta.url).href);

test("uses the current multi-turn artifact request when it names a new format", () => {
  const request = "原始交付要求：写年度总结并输出PDF文件\n当前用户选择或补充：保留原PDF，再输出一个Word版本，不得覆盖原文件。";
  assert.deepEqual(policy.requestedArtifactFormats(request), ["docx"]);
  assert.equal(policy.requestedArtifactSatisfied(request, [{ path: "outputs/newbrain-output.pdf", size: 1000 }]), false);
  assert.equal(policy.requestedArtifactSatisfied(request, [{ path: "outputs/newbrain-output.docx", size: 1000 }]), true);
});

test("falls back to the original artifact request for an outline confirmation", () => {
  const request = "原始交付要求：写年度总结并输出PDF文件\n当前用户选择或补充：确认提纲，继续撰写";
  assert.deepEqual(policy.requestedArtifactFormats(request), ["pdf"]);
});

test("requires every explicitly requested office format", () => {
  const request = "请输出PDF文件和DOCX文件";
  assert.deepEqual(policy.requestedArtifactFormats(request), ["pdf", "docx"]);
  assert.equal(policy.requestedArtifactSatisfied(request, [{ path: "report.pdf", size: 1000 }]), false);
  assert.equal(policy.requestedArtifactSatisfied(request, [{ path: "report.pdf", size: 1000 }, { path: "report.docx", size: 1000 }]), true);
});

test("ignores office formats named only in a negative current-turn constraint", () => {
  const request = [
    "原始交付要求：生成 DOCX、XLSX、PPTX 和 PDF。",
    "当前用户选择或补充：只补齐缺失的 outputs/财务预测模型.xlsx，不要修改或重写已经生成的 DOCX、PPTX、PDF。"
  ].join("\n");

  assert.deepEqual(policy.requestedArtifactFormats(request), ["xlsx"]);
  assert.equal(policy.requestedArtifactSatisfied(request, [
    { path: "outputs/企业经营诊断报告.docx", size: 10_499 },
    { path: "outputs/管理层汇报.pptx", size: 107_704 },
    { path: "outputs/执行路线图.pdf", size: 44_129 },
    { path: "outputs/财务预测模型.xlsx", size: 11_344 }
  ]), true);
});

test("derives a first-version government filename when confirmation is a card click", () => {
  const request = "原始交付要求：写一篇煤炭企业2025年年终总结发言稿，最终输出PDF文件。\n当前用户选择或补充：确认提纲，继续撰写正文";
  assert.equal(
    policy.requestedArtifactTargetPath(request, "pdf", { government: true }),
    "outputs/煤炭企业2025年年终总结发言稿-第一版.pdf"
  );
});

test("uses each explicitly requested filename for multi-format delivery", () => {
  const request = "输出“煤炭企业2025年年终总结发言稿-第二版.pdf”和“煤炭企业2025年年终总结发言稿-第二版.docx”";
  assert.equal(policy.requestedArtifactTargetPath(request, "pdf", { government: true }), "outputs/煤炭企业2025年年终总结发言稿-第二版.pdf");
  assert.equal(policy.requestedArtifactTargetPath(request, "docx", { government: true }), "outputs/煤炭企业2025年年终总结发言稿-第二版.docx");
});

test("uses unquoted numbered filenames for multi-format delivery", () => {
  const request = `确认修改。生成第二版完整正文，同时输出以下两个文件：

1. 煤炭企业2025年年终总结发言稿-第二版.pdf
2. 煤炭企业2025年年终总结发言稿-第二版.docx`;
  assert.equal(policy.requestedArtifactTargetPath(request, "pdf", { government: true }), "outputs/煤炭企业2025年年终总结发言稿-第二版.pdf");
  assert.equal(policy.requestedArtifactTargetPath(request, "docx", { government: true }), "outputs/煤炭企业2025年年终总结发言稿-第二版.docx");
});

test("uses and verifies a filename named in natural language", () => {
  const request = "请输出 DOCX 文件，文件名为 test.docx";
  assert.equal(policy.requestedArtifactTargetPath(request, "docx"), "outputs/test.docx");
  assert.equal(policy.requestedArtifactSatisfied(request, [
    { path: "outputs/newbrain-output.docx", size: 1000 }
  ]), false);
  assert.equal(policy.requestedArtifactSatisfied(request, [
    { path: "outputs/test.docx", size: 1000 }
  ]), true);
});

test("preserves an explicit outputs path and normalizes separators for verification", () => {
  const request = "save as outputs/test.docx";
  assert.equal(policy.requestedArtifactTargetPath(request, "docx"), "outputs/test.docx");
  assert.equal(policy.requestedArtifactSatisfied(request, [
    { path: "outputs\\test.docx", size: 1000 }
  ]), true);
});
