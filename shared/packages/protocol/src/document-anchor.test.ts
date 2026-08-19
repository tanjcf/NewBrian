import assert from "node:assert/strict";
import test from "node:test";
import { validateDocumentAnchor } from "./document-anchor.ts";

test("document anchors preserve format-specific coordinates", () => {
  assert.doesNotThrow(() => validateDocumentAnchor({ format: "pdf", locator: { page: 2 }, page: 2, rect: { x: 1, y: 2, width: 10, height: 20 }, selectedText: "公告" }));
  assert.doesNotThrow(() => validateDocumentAnchor({ format: "xlsx", locator: { sheet: "Sheet1", range: "A1:C4" }, sheet: "Sheet1", range: "A1:C4" }));
});

test("document anchors reject invalid geometry", () => {
  assert.throws(() => validateDocumentAnchor({ format: "image", locator: {}, rect: { x: 0, y: 0, width: -1, height: 2 } }), /negative/);
});
