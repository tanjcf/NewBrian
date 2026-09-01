import assert from "node:assert/strict";
import test from "node:test";
import { resolveNearestChunkAnchor, sliceMarkdownSections } from "../dist/document-chunk.js";
import type { DocumentAnchor } from "../dist/document-anchor.js";

test("slices markdown by heading hierarchy", () => {
  const content = "# Title\nIntro line\n\n## Section A\nBody A\n\n## Section B\nBody B";
  const slices = sliceMarkdownSections(content);
  assert.equal(slices.length, 3);
  assert.deepEqual(slices[0]!.headingPath, ["Title"]);
  assert.equal(slices[0]!.startLine, 1);
  assert.deepEqual(slices[1]!.headingPath, ["Title", "Section A"]);
  assert.match(slices[1]!.text, /Body A/);
  assert.deepEqual(slices[2]!.headingPath, ["Title", "Section B"]);
});

test("resolves nearest projected chunk anchor by overlap", () => {
  const anchors: DocumentAnchor[] = [
    {
      anchorId: "pdf:p:1:chunk:0",
      objectId: "pdf:p:1:chunk:0",
      format: "pdf",
      page: 1,
      locator: { kind: "pdf-text", page: 1, textRange: { start: 0, end: 4 } },
      rect: { x: 0, y: 0, width: 595, height: 200 },
      transform: { coordinateSpace: "pdf-points", basisWidth: 595, basisHeight: 842, scale: 1 },
      chunk: { chunkIndex: 0, pageOrSheet: 1, headingPath: [] }
    },
    {
      anchorId: "pdf:p:1:chunk:1",
      objectId: "pdf:p:1:chunk:1",
      format: "pdf",
      page: 1,
      locator: { kind: "pdf-text", page: 1, textRange: { start: 5, end: 9 } },
      rect: { x: 0, y: 400, width: 595, height: 200 },
      transform: { coordinateSpace: "pdf-points", basisWidth: 595, basisHeight: 842, scale: 1 },
      chunk: { chunkIndex: 1, pageOrSheet: 1, headingPath: ["Section"] }
    }
  ];
  const viewport = { width: 595, height: 842 };
  const hit = resolveNearestChunkAnchor({ x: 0, y: 420, width: 200, height: 80 }, viewport, anchors, { page: 1, format: "pdf" });
  assert.equal(hit?.anchorId, "pdf:p:1:chunk:1");
});
