import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { DocumentWorkerProcess } from "./document-worker-process.ts";

test("document worker process performs a bounded text ingestion round trip", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-document-worker-"));
  const worker = new DocumentWorkerProcess({
    appDirectory: process.cwd(),
    workerSourcePath: fileURLToPath(new URL("./document-worker.js", import.meta.url))
  });
  try {
    await writeFile(join(root, "notes.md"), "第一行\r\n第二行", "utf8");
    const result = await worker.ingest({
      requestId: "integration-1",
      projectRoot: root,
      relativePath: "notes.md",
      maxBytes: 1024
    });
    assert.equal(result.status, "completed");
    assert.equal(result.format, "markdown");
    assert.equal(result.text, "第一行\r\n第二行");
    assert.deepEqual(result.anchors?.[1]?.locator, { kind: "text-range", startLine: 2, endLine: 2, startCharacter: 0, endCharacter: 3 });
  } finally {
    await worker.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});
