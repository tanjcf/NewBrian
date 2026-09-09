import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { RustCoreClient, rustCoreChildEnvironment } from "./rust-core-client.ts";

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    exitCode: number | null;
    kill: () => boolean;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.kill = () => true;
  return child;
}

test("passes only non-secret runtime environment to Rust Core", () => {
  const environment = rustCoreChildEnvironment({
    PATH: "C:/tools",
    SystemRoot: "C:/Windows",
    LANG: "zh_CN.UTF-8",
    HOME: "C:/Users/example",
    BOCHA_API_KEY: "search-secret",
    OPENAI_API_KEY: "model-secret",
    NEWBRAIN_ACCESS_TOKEN: "session-secret"
  });
  assert.deepEqual(environment, {
    PATH: "C:/tools",
    SystemRoot: "C:/Windows",
    LANG: "zh_CN.UTF-8",
    HOME: "C:/Users/example"
  });
});

test("pairs a validated response with its request id", async () => {
  const child = fakeChild();
  let written = "";
  child.stdin.on("data", (chunk) => { written += chunk.toString(); });
  const client = new RustCoreClient({ child });
  const pending = client.request({
    request_id: "req-1",
    project_id: "project-1",
    workspace_type: "software",
    operation: "health.check",
    approval_token: "",
    resource_limits: { timeout_ms: 0, max_output_bytes: 1024 },
    payload: {}
  });
  child.stdout.write(`${JSON.stringify({
    protocol_version: "1",
    request_id: "req-1",
    status: "completed",
    error_code: "",
    artifacts: [],
    result: { ready: true }
  })}\n`);
  assert.deepEqual((await pending).result, { ready: true });
  assert.match(written, /"protocol_version":"1"/u);
  await client.shutdown();
});

test("keeps an explicitly unbounded request pending until an event arrives", async () => {
  const child = fakeChild();
  let written = "";
  child.stdin.on("data", (chunk) => { written += chunk.toString(); });
  const client = new RustCoreClient({ child });
  const pending = client.request({ request_id: "req-no-deadline", project_id: "project-1", workspace_type: "video", operation: "process.run", approval_token: "approved", resource_limits: { timeout_ms: 0, max_output_bytes: 1024 }, payload: {} });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(written.includes('"operation":"request.cancel"'), false);
  child.stdout.write(`${JSON.stringify({ protocol_version: "1", request_id: "req-no-deadline", status: "completed", error_code: "", artifacts: [], result: { success: true } })}\n`);
  assert.equal((await pending).status, "completed");
  await client.shutdown();
});

test("generates and consumes a main-process approval token for one mutating request", async () => {
  const child = fakeChild();
  const frames: Array<Record<string, unknown>> = [];
  child.stdin.on("data", (chunk) => {
    for (const line of chunk.toString().trim().split("\n")) {
      if (line) frames.push(JSON.parse(line) as Record<string, unknown>);
    }
  });
  const client = new RustCoreClient({ child });
  const pending = client.requestWithApproval({
    request_id: "req-write",
    project_id: "project-1",
    workspace_type: "software",
    operation: "file.write",
    resource_limits: { timeout_ms: 0, max_output_bytes: 1024 },
    payload: { path: "report.txt", data_base64: "cmVwb3J0" }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(frames.length, 1);
  assert.equal(frames[0]?.operation, "approval.register");
  const approvalPayload = frames[0]?.payload as { token?: string };
  assert.match(approvalPayload.token ?? "", /^[A-Za-z0-9_-]{43}$/u);
  child.stdout.write(`${JSON.stringify({
    protocol_version: "1", request_id: "req-write:approval", status: "completed",
    error_code: "", artifacts: [], result: { registered: true }
  })}\n`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(frames.length, 2);
  assert.equal(frames[1]?.operation, "file.write");
  assert.equal(frames[1]?.approval_token, approvalPayload.token);
  child.stdout.write(`${JSON.stringify({
    protocol_version: "1", request_id: "req-write", status: "completed",
    error_code: "", artifacts: [], result: { path: "report.txt" }
  })}\n`);
  assert.equal((await pending).status, "completed");
  await client.shutdown();
});

test("does not issue a mutating request when approval registration fails", async () => {
  const child = fakeChild();
  const frames: Array<Record<string, unknown>> = [];
  child.stdin.on("data", (chunk) => {
    for (const line of chunk.toString().trim().split("\n")) {
      if (line) frames.push(JSON.parse(line) as Record<string, unknown>);
    }
  });
  const client = new RustCoreClient({ child });
  const pending = client.requestWithApproval({
    request_id: "req-denied",
    project_id: "project-1",
    workspace_type: "documents",
    operation: "file.write",
    resource_limits: { timeout_ms: 0, max_output_bytes: 1024 },
    payload: { path: "report.txt", data_base64: "cmVwb3J0" }
  });
  await new Promise((resolve) => setImmediate(resolve));
  child.stdout.write(`${JSON.stringify({
    protocol_version: "1", request_id: "req-denied:approval", status: "failed",
    error_code: "BRAIN_CORE_APPROVAL_INVALID", artifacts: []
  })}\n`);
  await assert.rejects(pending, /BRAIN_CORE_APPROVAL_INVALID/u);
  assert.equal(frames.length, 1);
  await client.shutdown();
});
