import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAnnotationChatReference,
  buildDocxMarkingAnchor,
  buildPptxMarkingAnchor,
  createTextLineAnchor,
  currentDocumentAnnotations,
  resolveDocxAnchorFromMark,
  resolveMarkdownAnchorFromMark,
  resolvePdfAnchorFromMark,
  resolvePptxAnchorFromMark,
  resolveXlsxAnchorFromMark
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
  const base = {
    fileId: "file-1", fileVersion: 1, pageOrSheet: "", annotationType: "text-range", anchor,
    geometry: { style: { tool: "select-rect" as const, color: "#FFEB3B" }, displayIndex: 1 },
    selectedText: "旧内容", createdBy: "owner", createdAt: "2026-08-19T00:00:00Z"
  };
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
    anchor, geometry: { style: { tool: "highlight", color: "#FFEB3B" }, displayIndex: 2 },
    instruction: "替换为新内容", status: "OPEN", supersedesAnnotationId: "", selectedText: "旧内容",
    createdBy: "owner", createdAt: "2026-08-19T00:00:00Z"
  }, { fileName: "report.txt" });
  assert.match(text, /请针对以下文档标记位置/);
  assert.match(text, /【标记位置】第 1 页 · 标记 2/);
  assert.match(text, /【文件】report\.txt · 版本 1/);
  assert.match(text, /【选中内容】[\s\S]*旧内容/);
  assert.match(text, /【修改要求】[\s\S]*替换为新内容/);
  assert.match(text, /标注 ID：annotation-1/);
});

test("chat reference mentions attached snapshot when present", () => {
  const anchor = createTextLineAnchor("txt", 1, "旧内容");
  const text = buildAnnotationChatReference({
    id: "annotation-1", fileId: "file-1", fileVersion: 1, pageOrSheet: "", annotationType: "text-range",
    anchor, geometry: {
      style: { tool: "highlight", color: "#FFEB3B" },
      displayIndex: 2,
      snapshotPath: "C:/tmp/mark.png",
      snapshotUrl: "data:image/png;base64,aaa"
    },
    instruction: "替换为新内容", status: "OPEN", supersedesAnnotationId: "", selectedText: "旧内容",
    createdBy: "owner", createdAt: "2026-08-19T00:00:00Z"
  }, { fileName: "report.txt" });
  assert.match(text, /请针对以下标记区域（见附图）/);
});

test("includes chunk heading in chat reference location", () => {
  const anchor = {
    anchorId: "markdown:chunk:0",
    objectId: "markdown:chunk:0",
    format: "markdown" as const,
    locator: { kind: "text-range" as const, startLine: 1, endLine: 2, startCharacter: 0, endCharacter: 20 },
    selectedText: "Intro",
    chunk: { chunkIndex: 0, headingPath: ["Title", "Section"], startOffset: 0, endOffset: 20 }
  };
  const text = buildAnnotationChatReference({
    id: "annotation-2", fileId: "file-1", fileVersion: 2, pageOrSheet: "", annotationType: "text-range",
    anchor, geometry: { style: { tool: "select-rect", color: "#FFEB3B" }, displayIndex: 1 },
    instruction: "改得更简洁", status: "OPEN", supersedesAnnotationId: "", selectedText: "Intro",
    createdBy: "owner", createdAt: "2026-08-19T00:00:00Z"
  });
  assert.match(text, /【标记位置】第 1 页 · 标记 1 · 章节「Title › Section」/);
});

test("resolves docx marks to free-form preview anchors when structural anchors are unavailable", () => {
  const viewport = { width: 800, height: 600 };
  const freeForm = resolveDocxAnchorFromMark({ x: 700, y: 500, width: 80, height: 60 }, null, [], viewport);
  assert.match(freeForm.objectId, /^docx:mark:/);
  assert.equal(freeForm.format, "docx");
  assert.deepEqual((freeForm as ReturnType<typeof buildDocxMarkingAnchor>).transform?.coordinateSpace, "pixels");
  const explicit = buildDocxMarkingAnchor({ rect: { x: 400, y: 300, width: 80, height: 60 }, viewport, markId: "demo" });
  assert.equal(explicit.objectId, "docx:mark:demo");
});

test("resolves pptx marks to ingested shapes or free-form slide anchors", () => {
  const ingested = {
    anchorId: "pptx:s:1:shape:8",
    objectId: "pptx:s:1:shape:8",
    format: "pptx" as const,
    page: 1,
    locator: { kind: "pptx-shape" as const, slide: 1, shapeId: "8", zIndex: 2 },
    rect: { x: 0, y: 0, width: 6_096_000, height: 1_000_000 },
    transform: { coordinateSpace: "slide-emu" as const, basisWidth: 12_192_000, basisHeight: 6_858_000, scale: 1 },
    selectedText: "复购率 92%"
  };
  const slideChunk = {
    anchorId: "pptx:s:1:chunk:0",
    objectId: "pptx:s:1:chunk:0",
    format: "pptx" as const,
    page: 1,
    locator: { kind: "pptx-shape" as const, slide: 1, shapeId: "slide-chunk-0", zIndex: 0 },
    rect: { x: 0, y: 0, width: 12_192_000, height: 6_858_000 },
    transform: { coordinateSpace: "slide-emu" as const, basisWidth: 12_192_000, basisHeight: 6_858_000, scale: 1 },
    selectedText: "复购率 92%\n整页文本",
    chunk: { chunkIndex: 0, pageOrSheet: 1, headingPath: ["复购率 92%"] }
  };
  const viewport = { width: 960, height: 540 };
  const overlapping = resolvePptxAnchorFromMark({ x: 0, y: 0, width: 480, height: 80 }, viewport, 1, [slideChunk, ingested]);
  assert.equal(overlapping.objectId, "pptx:s:1:shape:8");
  assert.equal(overlapping.locator.kind === "pptx-shape" ? overlapping.locator.shapeId : "", "8");
  const freeForm = buildPptxMarkingAnchor({ rect: { x: 700, y: 400, width: 120, height: 60 }, viewport, slide: 2 });
  assert.equal(freeForm.page, 2);
  assert.match(freeForm.objectId, /^pptx:s:2:mark:/);
});

test("resolves pdf marks to ingested chunk anchors or free-form page marks", () => {
  const ingested = {
    anchorId: "pdf:p:1:chunk:0",
    objectId: "pdf:p:1:chunk:0",
    format: "pdf" as const,
    page: 1,
    locator: { kind: "pdf-text" as const, page: 1, textRange: { start: 0, end: 4 } },
    rect: { x: 0, y: 0, width: 595, height: 300 },
    transform: { coordinateSpace: "pdf-points" as const, basisWidth: 595, basisHeight: 842, scale: 1 },
    chunk: { chunkIndex: 0, pageOrSheet: 1, headingPath: [] }
  };
  const viewport = { width: 595, height: 842 };
  const transform = { coordinateSpace: "pdf-points" as const, basisWidth: 595, basisHeight: 842, scale: 1 };
  const hit = resolvePdfAnchorFromMark({ x: 10, y: 20, width: 200, height: 80 }, viewport, 1, [ingested], transform);
  assert.equal(hit.objectId, "pdf:p:1:chunk:0");
  const fallback = resolvePdfAnchorFromMark({ x: 10, y: 700, width: 200, height: 80 }, viewport, 1, [], transform);
  assert.match(fallback.objectId, /^pdf:page:1:mark:/);
});

test("resolves markdown marks to section chunks when available", () => {
  const anchors = [
    {
      anchorId: "markdown:chunk:0",
      objectId: "markdown:chunk:0",
      format: "markdown" as const,
      locator: { kind: "text-range" as const, startLine: 1, endLine: 2, startCharacter: 0, endCharacter: 20 },
      selectedText: "# Title\nIntro",
      chunk: { chunkIndex: 0, headingPath: ["Title"], startOffset: 0, endOffset: 20 }
    }
  ];
  const lines = ["# Title", "Intro", "## Section", "Body"];
  const viewport = { width: 800, height: 400 };
  const hit = resolveMarkdownAnchorFromMark({ x: 0, y: 0, width: 700, height: 120 }, viewport, anchors, lines);
  assert.equal(hit.objectId, "markdown:chunk:0");
});

test("resolves xlsx marks to ingested sheet chunk anchors", () => {
  const ingested = {
    anchorId: "xlsx:Model:chunk:1",
    objectId: "xlsx:Model:chunk:1",
    format: "xlsx" as const,
    sheet: "Model",
    range: "A2:B21",
    locator: { kind: "xlsx-range" as const, sheet: "Model", range: "A2:B21" },
    rect: { x: 0, y: 1, width: 2, height: 20 },
    transform: { coordinateSpace: "sheet-grid" as const, basisWidth: 26, basisHeight: 50, scale: 1 },
    chunk: { chunkIndex: 1, pageOrSheet: "Model", headingPath: ["Model", "Rows 2-21"] }
  };
  const viewport = { width: 960, height: 540 };
  const hit = resolveXlsxAnchorFromMark({ x: 0, y: 60, width: 400, height: 200 }, viewport, "Model", [ingested], { columnCount: 2, rowCount: 21 });
  assert.equal(hit.objectId, "xlsx:Model:chunk:1");
});
