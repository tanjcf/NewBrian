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
    CODECN_ACCESS_TOKEN: "session-secret"
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
  const client = new RustCoreClient({ child, defaultTimeoutMs: 1000 });
  const pending = client.request({
    request_id: "req-1",
    project_id: "project-1",
    workspace_type: "software",
    operation: "health.check",
    approval_token: "",
    resource_limits: { timeout_ms: 1000, max_output_bytes: 1024 },
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

test("times out a request and emits a cancellation frame", async () => {
  const child = fakeChild();
  let written = "";
  child.stdin.on("data", (chunk) => { written += chunk.toString(); });
  const client = new RustCoreClient({ child, defaultTimeoutMs: 5 });
  await assert.rejects(client.request({
    request_id: "req-timeout",
    project_id: "project-1",
    workspace_type: "documents",
    operation: "file.read",
    approval_token: "",
    resource_limits: { timeout_ms: 5, max_output_bytes: 1024 },
    payload: { path: "report.pdf" }
  }), /BRAIN_CORE_TIMEOUT/u);
  assert.match(written, /"operation":"request.cancel"/u);
  await client.shutdown();
});
