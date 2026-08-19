import assert from "node:assert/strict";
import test from "node:test";
import { parseRustCoreRequest, parseRustCoreResponse } from "./rust-core.ts";

test("accepts a bounded versioned Rust Core request", () => {
  const request = parseRustCoreRequest({
    protocol_version: "1",
    request_id: "req-1",
    project_id: "project-1",
    workspace_type: "documents",
    operation: "file.read",
    approval_token: "",
    resource_limits: { timeout_ms: 30_000, max_output_bytes: 1_048_576 },
    payload: { path: "report.docx" }
  });
  assert.equal(request.operation, "file.read");
});

test("rejects unknown versions, unbounded limits, and credential-shaped fields", () => {
  assert.throws(() => parseRustCoreRequest({
    protocol_version: "2",
    request_id: "req-1",
    project_id: "project-1",
    workspace_type: "software",
    operation: "process.run",
    approval_token: "approved",
    resource_limits: { timeout_ms: 30_000, max_output_bytes: 1024 },
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
    resource_limits: { timeout_ms: 30_000, max_output_bytes: 1024 },
    payload: { authorization: "Bearer secret" }
  }), /credential/u);
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
