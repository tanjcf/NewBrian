import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner loads this source file directly.
import { buildErrorRemediationRequest } from "./error-remediation-policy.ts";

test("requires MCP evidence, test-first repair, and verified status closure", () => {
  const request = buildErrorRemediationRequest();
  assert.match(request, /errer_outf\.read_errors/);
  assert.match(request, /FIXING/);
  assert.match(request, /先编写.*失败.*回归测试/s);
  assert.match(request, /自动化测试全部通过/);
  assert.match(request, /errer_outf\.update_status/);
  assert.match(request, /verification/);
  assert.match(request, /original_error_verified/);
  assert.match(request, /exit_code/);
  assert.match(request, /不得.*FIXED/s);
});
