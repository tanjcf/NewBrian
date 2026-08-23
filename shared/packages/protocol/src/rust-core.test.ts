import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseRustCoreRequest, parseRustCoreResponse } from "./rust-core.ts";

test("TypeScript protocol matches the checked Rust Core schema fixture", async () => {
  const schema = JSON.parse(await readFile(
    new URL("../schema/rust-core-protocol.schema.json", import.meta.url),
    "utf8"
  ));
  assert.equal(schema.protocol_version, "1");
  assert.deepEqual(schema.request.required, [
    "protocol_version", "request_id", "project_id", "workspace_type", "operation",
    "approval_token", "resource_limits", "payload"
  ]);
  assert.deepEqual(schema.response.required, [
    "protocol_version", "request_id", "status", "error_code", "artifacts"
  ]);
  assert.equal(schema.request.resource_limits.timeout_ms.const, 0);
  assert.match(schema.request.resource_limits.timeout_ms.description, /event-driven/u);
  assert.equal(schema.request.resource_limits.max_output_bytes.maximum, 16_777_216);
});

test("accepts an event-driven versioned Rust Core request", () => {
  const request = parseRustCoreRequest({
    protocol_version: "1",
    request_id: "req-1",
    project_id: "project-1",
    workspace_type: "documents",
    operation: "file.read",
    approval_token: "",
    resource_limits: { timeout_ms: 0, max_output_bytes: 1_048_576 },
    payload: { path: "report.docx" }
  });
  assert.equal(request.operation, "file.read");
});

test("accepts zero as the explicit no-deadline execution policy", () => {
  const request = parseRustCoreRequest({
    protocol_version: "1", request_id: "req-no-deadline", project_id: "project-1", workspace_type: "video",
    operation: "process.run", approval_token: "approved", resource_limits: { timeout_ms: 0, max_output_bytes: 1_048_576 }, payload: {}
  });
  assert.equal(request.resource_limits.timeout_ms, 0);
});

test("rejects unknown versions, unbounded limits, and credential-shaped fields", () => {
  assert.throws(() => parseRustCoreRequest({
    protocol_version: "2",
    request_id: "req-1",
    project_id: "project-1",
    workspace_type: "software",
    operation: "process.run",
    approval_token: "approved",
    resource_limits: { timeout_ms: 0, max_output_bytes: 1024 },
    payload: {}
  }), /protocol_version/u);

  assert.throws(() => parseRustCoreRequest({
    protocol_version: "1",
    request_id: "req-1",
    project_id: "project-1",
    workspace_type: "software",
    operation: "process.run",
    approval_token: "approved",
    resource_limits: { timeout_ms: 0, max_output_bytes: 0 },
    payload: {}
  }), /resource_limits/u);

  assert.throws(() => parseRustCoreRequest({
    protocol_version: "1",
    request_id: "req-1",
    project_id: "project-1",
    workspace_type: "software",
    operation: "process.run",
    approval_token: "approved",
    resource_limits: { timeout_ms: 0, max_output_bytes: 1024 },
    payload: { authorization: "Bearer secret" }
  }), /credential/u);

  assert.throws(() => parseRustCoreRequest({
    protocol_version: "1", request_id: "req-fixed-deadline", project_id: "project-1", workspace_type: "software",
    operation: "process.run", approval_token: "approved", resource_limits: { timeout_ms: 1, max_output_bytes: 1024 }, payload: {}
  }), /no fixed deadline/u);
});

test("parses data-only responses with stable status and error fields", () => {
  const response = parseRustCoreResponse({
    protocol_version: "1",
    request_id: "req-1",
    status: "failed",
    error_code: "BRAIN_CORE_PATH_ESCAPE",
    artifacts: []
  });
  assert.equal(response.status, "failed");
  assert.equal(response.error_code, "BRAIN_CORE_PATH_ESCAPE");
});
