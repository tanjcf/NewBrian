import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DocumentWorkerProcess } from "./document-worker-process.ts";

test("document worker process performs a bounded text ingestion round trip", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-document-worker-"));
  const worker = new DocumentWorkerProcess({
    appDirectory: process.cwd(),
    workerSourcePath: join(process.cwd(), "shared/apps/desktop/src/main/document-worker.js")
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
    assert.equal(result.anchors?.[1]?.locator.line, 2);
  } finally {
    await worker.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});
