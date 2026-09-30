import assert from "node:assert/strict";
import test from "node:test";
import { projectDocumentRect, type DocumentAnchor } from "@codex-forge/protocol/document-anchor";

test("projects PDF page anchors through shared coordinate transform", () => {
  const anchor: DocumentAnchor = {
    anchorId: "pdf:page:1",
    objectId: "pdf:page:1",
    format: "pdf",
    page: 1,
    locator: { kind: "pdf-text", page: 1 },
    rect: { x: 0, y: 0, width: 297.5, height: 421 },
    transform: { coordinateSpace: "pdf-points", basisWidth: 595, basisHeight: 842, scale: 1 }
  };
  const projected = projectDocumentRect(anchor.rect, anchor.transform, { width: 1190, height: 1684 });
  assert.equal(projected.x, 0);
  assert.equal(projected.y, 0);
  assert.equal(projected.width, 595);
  assert.equal(projected.height, 842);
});

test("projects image region anchors into viewer pixels", () => {
  const anchor: DocumentAnchor = {
    anchorId: "image:region:0",
    objectId: "image",
    format: "image",
    locator: { kind: "image-region", regionIndex: 0 },
    rect: { x: 10, y: 20, width: 30, height: 40 },
    transform: { coordinateSpace: "pixels", basisWidth: 100, basisHeight: 200, scale: 1 }
  };
  const projected = projectDocumentRect(anchor.rect, anchor.transform, { width: 200, height: 400 });
  assert.deepEqual(projected, { x: 20, y: 40, width: 60, height: 80 });
});

test("projects PPTX EMU rects onto slide viewport", () => {
  const anchor: DocumentAnchor = {
    anchorId: "pptx:s:1:shape:1",
    objectId: "pptx:s:1:shape:1",
    format: "pptx",
    page: 1,
    locator: { kind: "pptx-shape", slide: 1, shapeId: "1", zIndex: 0 },
    rect: { x: 0, y: 0, width: 6_096_000, height: 3_429_000 },
    transform: { coordinateSpace: "slide-emu", basisWidth: 12_192_000, basisHeight: 6_858_000, scale: 1 }
  };
  const projected = projectDocumentRect(anchor.rect, anchor.transform, { width: 960, height: 540 });
  assert.equal(projected.width, 480);
  assert.equal(projected.height, 270);
});
