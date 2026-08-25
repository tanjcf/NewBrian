import assert from "node:assert/strict";
import test from "node:test";
import {
  artifactPathsReferToSameFile,
  buildFilePreviewDiagnosticContext,
  classifyArtifactPreviewPayload,
  classifyFilePreviewError,
  classifySoftFilePreviewFailure,
  classifyTextPreviewPayload,
  filePreviewRetryDelayMs,
  findMatchingArtifactTab,
  formatFilePreviewStatus,
  isReusableArtifactPreview,
  isStaleFilePreviewRequest
} from "./file-preview-policy.ts";

test("treats only newer sequences as current preview requests", () => {
  assert.equal(isStaleFilePreviewRequest(1, 1), false);
  assert.equal(isStaleFilePreviewRequest(1, 2), true);
  assert.equal(isStaleFilePreviewRequest(3, 2), true);
});

test("classifies empty and binary text previews with retry hints", () => {
  assert.deepEqual(classifyTextPreviewPayload({ content: "hello", size: 5 }), { ok: true });
  assert.equal(classifyTextPreviewPayload({ content: "", size: 0 }).reason, "empty_file");
  assert.equal(classifyTextPreviewPayload({ content: "", size: 0 }).retryable, true);
  assert.equal(classifyTextPreviewPayload({ content: "", binary: true, size: 12 }).reason, "binary_file");
  assert.equal(classifyTextPreviewPayload({ content: "", size: 12 }).retryable, false);
});

test("classifies missing files as retryable preview errors", () => {
  const missing = classifyFilePreviewError(new Error("文件不存在，无法预览：outputs/a.md"));
  assert.equal(missing.reason, "missing_file");
  assert.equal(missing.retryable, true);
  const ipcWrapped = classifyFilePreviewError(
    new Error("Error invoking remote method 'phase1:preview-workspace-file': Error: 文件不存在，无法预览：outputs/a.docx")
  );
  assert.equal(ipcWrapped.reason, "missing_file");
  assert.equal(ipcWrapped.retryable, true);
  assert.match(ipcWrapped.message, /^文件不存在/);
  assert.doesNotMatch(ipcWrapped.message, /Error invoking remote method/);
  const other = classifyFilePreviewError(new Error("Permission denied"));
  assert.equal(other.reason, "read_failed");
  assert.equal(other.retryable, false);
});

test("classifies soft IPC preview failures without aborting retryable reasons", () => {
  const missing = classifySoftFilePreviewFailure({
    ok: false,
    reason: "missing_file",
    error: "文件不存在，无法预览：explore-e2e-note.txt"
  });
  assert.equal(missing.reason, "missing_file");
  assert.equal(missing.retryable, true);
  const unsupported = classifySoftFilePreviewFailure({
    ok: false,
    reason: "preview_unsupported",
    error: "此文件类型不支持文档侧栏预览。"
  });
  assert.equal(unsupported.retryable, false);
});

test("detects empty artifact payloads", () => {
  assert.equal(classifyArtifactPreviewPayload({ kind: "docx", html: "" }).reason, "empty_artifact");
  assert.deepEqual(classifyArtifactPreviewPayload({ kind: "docx", html: "<p>ok</p>" }), { ok: true });
});

test("builds user-visible status and durable diagnostic context", () => {
  const issue = classifyTextPreviewPayload({ content: "", size: 0 });
  assert.match(formatFilePreviewStatus(issue, "desktop-error-1"), /诊断 desktop-error-1/);
  assert.equal(filePreviewRetryDelayMs(1), 120);
  assert.equal(filePreviewRetryDelayMs(10), 600);
  assert.deepEqual(
    buildFilePreviewDiagnosticContext({
      workspaceId: "w1",
      filePath: "outputs/a.md",
      reason: "empty_file",
      attempt: 2,
      artifact: false,
      size: 0
    }),
    {
      feature: "file_preview",
      severity: "diagnostic",
      workspaceId: "w1",
      filePath: "outputs/a.md",
      reason: "empty_file",
      attempt: 2,
      artifact: false,
      size: 0,
      binary: undefined,
      errorMessage: undefined
    }
  );
});

test("dedupes absolute, outputs-relative, and basename preview paths", () => {
  assert.equal(artifactPathsReferToSameFile("outputs\\龟途-第1章.md", "outputs/龟途-第1章.md"), true);
  assert.equal(artifactPathsReferToSameFile("outputs/龟途-第1章.md", "龟途-第1章.md"), true);
  assert.equal(artifactPathsReferToSameFile("C:/project/outputs/龟途-第1章.md", "龟途-第1章.md"), true);
  assert.equal(artifactPathsReferToSameFile("outputs/a.md", "outputs/b.md"), false);
  const tabs = [
    { tabPath: "outputs/龟途-第1章.md", path: "outputs/龟途-第1章.md", name: "龟途-第1章.md", content: "# ok" }
  ];
  assert.equal(findMatchingArtifactTab(tabs, "龟途-第1章.md")?.tabPath, "outputs/龟途-第1章.md");
  assert.equal(isReusableArtifactPreview(tabs[0]), true);
  assert.equal(isReusableArtifactPreview({ ...tabs[0], error: "missing" }), false);
});
