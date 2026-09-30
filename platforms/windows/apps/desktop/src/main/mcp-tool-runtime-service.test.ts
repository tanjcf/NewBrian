import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner loads this source file directly.
import { resolveMcpToolPolicy } from "./mcp-tool-runtime-service.ts";

test("allows only the explicitly authorized builtin errer_outf automation tools without approval", () => {
  assert.deepEqual(resolveMcpToolPolicy("builtin:errer_outf", "errer_outf.read_errors"), {
    kind: "read", risk: "low", requiresApproval: false
  });
  assert.deepEqual(resolveMcpToolPolicy("builtin:errer_outf", "errer_outf.update_status"), {
    kind: "write", risk: "medium", requiresApproval: false
  });
  assert.deepEqual(resolveMcpToolPolicy("external", "unknown"), {
    kind: "read", risk: "medium", requiresApproval: true
  });
});
