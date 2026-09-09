import test from "node:test";
import assert from "node:assert/strict";
import { verifyBuiltinArtifactResult, verifyCapabilityResult } from "./capability-verifier.js";

test("successful capability requires a registered verifier", async () => {
  const capability = { id: "test", verification: "missing" };
  const result = await verifyCapabilityResult({ capability, result: { status: "completed", output: {} } });
  assert.equal(result.verification.status, "unverified");
});

test("failed verification changes the execution result to failed", async () => {
  const capability = { id: "test", verification: "test.v1" };
  const result = await verifyCapabilityResult({
    capability,
    result: { status: "completed", output: {} },
    verifiers: new Map([["test.v1", async () => ({ status: "failed", reason: "bad artifact" })]])
  });
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "VERIFICATION_FAILED");
});

test("accepts independently inspected PDF evidence", async () => {
  const capability = { id: "document.create_pdf", verification: "builtin.artifact.v1" };
  const result = await verifyCapabilityResult({
    capability,
    result: {
      status: "completed",
      output: { ok: true, artifact: { path: "outputs/report.pdf", size: 2048, type: "application/pdf", pages: 1 } }
    },
    verifiers: new Map([["builtin.artifact.v1", verifyBuiltinArtifactResult]])
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(result.verification.checks, ["artifact-path", "pdf-signature", "pdf-page-count"]);
});

test("accepts OOXML office artifacts by path and size", async () => {
  const result = await verifyBuiltinArtifactResult({
    ok: true,
    artifact: { path: "outputs/newbrain-output.pptx", size: 53094, type: "application/octet-stream" }
  });
  assert.equal(result.status, "verified");
  assert.ok(result.checks.includes("office-size-and-extension"));
});
