import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeDocumentRect,
  projectDocumentRect,
  unprojectDocumentRect,
  validateDocumentAnchor,
  type DocumentAnchor
} from "./document-anchor.ts";

const anchors: DocumentAnchor[] = [
  { anchorId: "image:region:0", objectId: "image", format: "image", locator: { kind: "image-region", regionIndex: 0 }, rect: { x: 0, y: 0, width: 640, height: 480 }, transform: { coordinateSpace: "pixels", basisWidth: 640, basisHeight: 480, scale: 1 } },
  { anchorId: "pdf:page:2:text:0", objectId: "pdf:page:2:text:0", format: "pdf", locator: { kind: "pdf-text", page: 2, textRange: { start: 0, end: 2 } }, page: 2, rect: { x: 1, y: 2, width: 10, height: 20 }, transform: { coordinateSpace: "pdf-points", basisWidth: 595, basisHeight: 842, scale: 1 }, selectedText: "公告" },
  { anchorId: "docx:p:3", objectId: "docx:p:3", format: "docx", locator: { kind: "docx-object", objectType: "paragraph", paragraphIndex: 3, textRange: { start: 0, end: 4 } }, selectedText: "项目说明" },
  { anchorId: "pptx:s:1:shape:8", objectId: "pptx:s:1:shape:8", format: "pptx", locator: { kind: "pptx-shape", slide: 1, shapeId: "8", zIndex: 2 }, page: 1, rect: { x: 1, y: 2, width: 3, height: 4 }, transform: { coordinateSpace: "slide-emu", basisWidth: 12192000, basisHeight: 6858000, scale: 1 } },
  { anchorId: "xlsx:Sheet1:A1:C4", objectId: "xlsx:Sheet1:A1:C4", format: "xlsx", locator: { kind: "xlsx-range", sheet: "Sheet1", range: "A1:C4" }, sheet: "Sheet1", range: "A1:C4" },
  { anchorId: "markdown:line:2", objectId: "markdown:line:2", format: "markdown", locator: { kind: "text-range", startLine: 2, endLine: 2, startCharacter: 0, endCharacter: 3 }, selectedText: "正文" }
];

test("accepts every discriminated document anchor format", () => {
  for (const anchor of anchors) assert.doesNotThrow(() => validateDocumentAnchor(anchor));
});

test("rejects cross-format locators and invalid geometry", () => {
  assert.throws(() => validateDocumentAnchor({ ...anchors[0], rect: { x: 0, y: 0, width: -1, height: 2 } } as DocumentAnchor), /negative/);
  assert.throws(() => validateDocumentAnchor({ ...anchors[1], page: 3 } as DocumentAnchor), /does not match/);
  assert.throws(() => validateDocumentAnchor({ ...anchors[4], sheet: "Other" } as DocumentAnchor), /does not match/);
});

test("projects source coordinates into a viewport and reverses them without drift", () => {
  for (const anchor of anchors.filter((item) => item.rect && item.transform)) {
    const rect = anchor.rect!;
    const transform = anchor.transform!;
    const projected = projectDocumentRect(rect, transform, { width: 960, height: 540 });
    const restored = unprojectDocumentRect(projected, transform, { width: 960, height: 540 });
    assert.deepEqual(restored, rect);
    const normalized = normalizeDocumentRect(rect, transform);
    assert.ok(normalized.x >= 0 && normalized.x <= 1);
    assert.ok(normalized.y >= 0 && normalized.y <= 1);
    assert.ok(normalized.width >= 0 && normalized.width <= 1);
    assert.ok(normalized.height >= 0 && normalized.height <= 1);
  }
});

test("rejects rectangles outside their declared coordinate basis", () => {
  assert.throws(
    () => normalizeDocumentRect(
      { x: 600, y: 0, width: 1, height: 1 },
      { coordinateSpace: "pdf-points", basisWidth: 595, basisHeight: 842, scale: 1 }
    ),
    /coordinate basis/
  );
});
