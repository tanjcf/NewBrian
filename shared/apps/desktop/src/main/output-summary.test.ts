import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner loads this source file directly.
import { collectWrittenArtifacts, formatWrittenArtifactSummary, linkWrittenArtifactMentions } from "./output-summary.ts";

test("collects successful workspace writes once and formats openable file links", () => {
  const artifacts = collectWrittenArtifacts([
    { type: "tool_result", payload: { name: "workspace.write_file", result: { ok: true, artifact: { path: "docs/new file.md", size: 12, changeType: "created" } } } },
    { type: "tool_result", payload: { name: "artifact.inspect", result: { ok: true, artifact: { path: "docs/new file.md", size: 12 } } } },
    { type: "tool_result", payload: { name: "workspace.write_file", result: { ok: true, artifact: { path: "src/app.ts", size: 30, changeType: "modified" } } } },
    { type: "tool_result", payload: { name: "artifact.create", result: { ok: true, artifact: { path: "reports/native.xlsx", size: 42_000, changeType: "created" } } } },
    { type: "tool_result", payload: { name: "artifact.inspect", result: { ok: true, artifact: { path: "reports/final.pdf", size: 231_000 } } } },
    { type: "tool_result", payload: { name: "artifact.inspect", result: { ok: true, artifact: { path: "reports/empty.pdf", size: 0 } } } }
  ]);
  assert.deepEqual(artifacts, [
    { path: "docs/new file.md", size: 12, changeType: "created" },
    { path: "src/app.ts", size: 30, changeType: "modified" },
    { path: "reports/native.xlsx", size: 42_000, changeType: "created" },
    { path: "reports/final.pdf", size: 231_000, changeType: "created" }
  ]);
  const summary = formatWrittenArtifactSummary("C:\\project", artifacts);
  assert.ok(summary.includes("\u65b0\u5efa 3 \u4e2a\uff0c\u7f16\u8f91 1 \u4e2a\u3002"));
  assert.match(summary, /\[docs\/new file\.md\]\(<C:\\project\\docs\\new file\.md>\)/);
  assert.match(summary, /\[reports\/final\.pdf\]\(<C:\\project\\reports\\final\.pdf>\)/);
  assert.doesNotMatch(summary, /empty\.pdf/);
});

test("turns verified artifact names in model prose into openable links", () => {
  const linked = linkWrittenArtifactMentions(
    "DOC 文件已生成：**山川有别.docx**（10116 字节）。",
    "C:\\project",
    [{ path: "outputs/山川有别.docx", size: 10116, changeType: "created" }]
  );
  assert.equal(linked, "DOC 文件已生成：[山川有别.docx](<C:\\project\\outputs\\山川有别.docx>)（10116 字节）。");
  assert.equal(
    linkWrittenArtifactMentions(linked, "C:\\project", [{ path: "outputs/山川有别.docx", size: 10116, changeType: "created" }]),
    linked
  );
});
