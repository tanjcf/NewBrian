import assert from "node:assert/strict";
import test from "node:test";
import { DocumentIngestionService } from "./document-ingestion-service.ts";

test("text ingestion normalizes newlines and creates line anchors", () => {
  const result = new DocumentIngestionService().ingestText("notes.md", "第一行\r\n第二行");
  assert.equal(result.format, "markdown");
  assert.equal(result.text, "第一行\n第二行");
  assert.deepEqual(result.anchors[1].locator, { line: 2 });
});

test("text ingestion rejects unsupported formats", () => {
  assert.throws(() => new DocumentIngestionService().ingestText("report.pdf", "x"), /TXT and Markdown/);
});
