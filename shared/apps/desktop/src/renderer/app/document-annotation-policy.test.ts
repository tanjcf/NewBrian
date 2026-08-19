import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAnnotationChatReference,
  createTextLineAnchor,
  currentDocumentAnnotations
} from "./document-annotation-policy.ts";

test("creates a stable text-line anchor", () => {
  assert.deepEqual(createTextLineAnchor("markdown", 2, "正文"), {
    anchorId: "markdown:line:2",
    objectId: "markdown:line:2",
    format: "markdown",
    locator: { kind: "text-range", startLine: 2, endLine: 2, startCharacter: 0, endCharacter: 2 },
    selectedText: "正文"
  });
});

test("projects only the latest immutable annotation revision", () => {
  const anchor = createTextLineAnchor("txt", 1, "旧内容");
  const base = { fileId: "file-1", fileVersion: 1, pageOrSheet: "", annotationType: "text-range", anchor, selectedText: "旧内容", createdBy: "owner", createdAt: "2026-08-19T00:00:00Z" };
  const annotations = [
    { ...base, id: "annotation-1", instruction: "修改", status: "OPEN" as const, supersedesAnnotationId: "" },
    { ...base, id: "annotation-2", instruction: "取消修改", status: "DISMISSED" as const, supersedesAnnotationId: "annotation-1" }
  ];
  assert.deepEqual(currentDocumentAnnotations(annotations).map((item) => item.id), ["annotation-2"]);
});

test("builds an explicit chat reference containing the annotation id", () => {
  const anchor = createTextLineAnchor("txt", 1, "旧内容");
  const text = buildAnnotationChatReference({
    id: "annotation-1", fileId: "file-1", fileVersion: 1, pageOrSheet: "", annotationType: "text-range",
    anchor, instruction: "替换为新内容", status: "OPEN", supersedesAnnotationId: "", selectedText: "旧内容",
    createdBy: "owner", createdAt: "2026-08-19T00:00:00Z"
  });
  assert.match(text, /文档标注 annotation-1/);
  assert.match(text, /修改要求：替换为新内容/);
});
