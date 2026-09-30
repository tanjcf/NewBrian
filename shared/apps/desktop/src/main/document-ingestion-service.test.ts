import assert from "node:assert/strict";
import test from "node:test";
import { DocumentIngestionService } from "./document-ingestion-service.ts";

test("text ingestion normalizes newlines and creates line anchors", () => {
  const result = new DocumentIngestionService().ingestText("notes.md", "第一行\r\n第二行");
  assert.equal(result.format, "markdown");
  assert.equal(result.text, "第一行\n第二行");
  assert.deepEqual(result.anchors[1].locator, { kind: "text-range", startLine: 2, endLine: 2, startCharacter: 0, endCharacter: 3 });
});

test("text ingestion rejects unsupported formats", () => {
  assert.throws(() => new DocumentIngestionService().ingestText("report.pdf", "x"), /TXT and Markdown/);
});

test("adapts isolated worker results into the ingestion contract", async () => {
  const result = await new DocumentIngestionService().ingestFile({
    ingest: async () => ({ status: "completed", error_code: "", format: "markdown", text: "a", anchors: [{ anchorId: "markdown:line:1", objectId: "markdown:line:1", format: "markdown", locator: { kind: "text-range", startLine: 1, endLine: 1, startCharacter: 0, endCharacter: 1 }, selectedText: "a" }], warnings: [] })
  }, { requestId: "read", projectRoot: "C:/project", relativePath: "a.md" });
  assert.equal(result.format, "markdown");
  assert.equal(result.anchors[0]?.locator.kind, "text-range");
});
