import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
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

test("resolves the synchronized worker from the built development layout", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-document-layout-"));
  const appRoot = join(root, "apps", "desktop");
  const appDirectory = join(appRoot, "out", "main");
  await mkdir(appDirectory, { recursive: true });
  await copyFile(fileURLToPath(new URL("./document-worker.js", import.meta.url)), join(appRoot, "document-worker.js"));
  const worker = new DocumentWorkerProcess({ appDirectory });
  try {
    await writeFile(join(root, "notes.md"), "正文", "utf8");
    const result = await worker.ingest({ requestId: "development-layout-1", projectRoot: root, relativePath: "notes.md", maxBytes: 1024 });
    assert.equal(result.status, "completed");
    assert.equal(result.anchors?.[0]?.anchorId, "markdown:line:1");
  } finally {
    await worker.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

test("routes document ingestion through Rust Core without approval or credentials", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const root = await mkdtemp(join(tmpdir(), "brain-document-rust-"));
  const worker = new DocumentWorkerProcess({
    appDirectory: process.cwd(),
    acquireRustCore: async (binding) => ({
      request: async (input) => {
        requests.push(input as unknown as Record<string, unknown>);
        return {
          protocol_version: "1", request_id: input.request_id, status: "completed", error_code: "", artifacts: [],
          result: { protocol_version: "2", request_id: input.request_id, status: "completed", error_code: "", format: "markdown", text: "正文", anchors: [{ anchorId: "markdown:line:1", objectId: "markdown:line:1", format: "markdown", locator: { kind: "text-range", startLine: 1, endLine: 1, startCharacter: 0, endCharacter: 2 }, selectedText: "正文" }], warnings: [] }
        };
      }
    })
  });
  try {
    await writeFile(join(root, "notes.md"), "正文", "utf8");
    const result = await worker.ingest({ requestId: "rust-document-1", projectRoot: root, relativePath: "notes.md", maxBytes: 1024 });
    assert.equal(result.text, "正文");
    assert.equal(requests[0]?.operation, "document.ingest");
    assert.equal(requests[0]?.approval_token, "");
    assert.doesNotMatch(JSON.stringify(requests[0]), /api.?key|authorization|credential|secret/iu);
  } finally {
    await worker.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});
