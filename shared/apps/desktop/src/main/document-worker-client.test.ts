import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { DocumentWorkerClient } from "./document-worker-client.ts";

function makeChild() {
  const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; exitCode: number | null; kill: () => boolean };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.exitCode = null;
  child.kill = () => { child.exitCode = 0; child.emit("exit", 0, null); return true; };
  return child;
}

test("document worker client sends bounded requests and resolves results", async () => {
  const child = makeChild();
  const client = new DocumentWorkerClient({ child });
  const requestPromise = client.ingest({ requestId: "read-1", projectRoot: "C:/project", relativePath: "notes.md", maxBytes: 99_999_999 });
  const request = JSON.parse(child.stdin.read()?.toString() ?? "{}");
  assert.equal(request.protocol_version, "2");
  assert.equal(request.max_bytes, 20 * 1024 * 1024);
  child.stdout.write(`${JSON.stringify({ protocol_version: "2", request_id: "read-1", status: "completed", error_code: "", format: "markdown", text: "hello", anchors: [], warnings: [] })}\n`);
  assert.equal((await requestPromise).text, "hello");
  await client.shutdown();
});

test("document worker client fails closed on worker error", async () => {
  const child = makeChild();
  const client = new DocumentWorkerClient({ child });
  const pending = client.ingest({ requestId: "read-2", projectRoot: "C:/project", relativePath: "notes.md" });
  child.stdout.write(`${JSON.stringify({ protocol_version: "2", request_id: "read-2", status: "failed", error_code: "DOCUMENT_WORKER_PATH_FORBIDDEN" })}\n`);
  await assert.rejects(pending, /DOCUMENT_WORKER_PATH_FORBIDDEN/);
  await client.shutdown();
});
