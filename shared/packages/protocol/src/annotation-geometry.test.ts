import assert from "node:assert/strict";
import test from "node:test";
import {
  ANNOTATION_MARKING_COLORS,
  linesFromPreviewRect,
  normalizeAnnotationGeometry,
  validateAnnotationGeometry
} from "./annotation-geometry.ts";

test("normalizes annotation geometry with defaults", () => {
  assert.deepEqual(normalizeAnnotationGeometry(undefined), {
    style: { tool: "select-rect", color: ANNOTATION_MARKING_COLORS[0] },
    displayIndex: 0
  });
  assert.deepEqual(normalizeAnnotationGeometry({
    style: { tool: "highlight", color: "#2196F3" },
    displayIndex: 2
  }), {
    style: { tool: "highlight", color: "#2196F3" },
    displayIndex: 2
  });
  assert.deepEqual(normalizeAnnotationGeometry({
    style: { tool: "select-rect", color: "#FFEB3B" },
    displayIndex: 3,
    snapshotPath: ".newbrain/attachments/mark.png",
    snapshotUrl: "data:image/png;base64,abc"
  }), {
    style: { tool: "select-rect", color: "#FFEB3B" },
    displayIndex: 3,
    snapshotPath: ".newbrain/attachments/mark.png",
    snapshotUrl: "data:image/png;base64,abc"
  });
});

test("validates persisted annotation geometry", () => {
  assert.doesNotThrow(() => validateAnnotationGeometry({
    style: { tool: "highlight", color: "#FFEB3B" },
    displayIndex: 1
  }));
  assert.throws(() => validateAnnotationGeometry({
    style: { tool: "highlight", color: "" },
    displayIndex: 1
  }));
});

test("maps preview drag to text line range", () => {
  assert.deepEqual(linesFromPreviewRect({
    rect: { x: 0, y: 28, width: 200, height: 40 },
    lineHeight: 28,
    totalLines: 10
  }), { startLine: 2, endLine: 3 });
});
