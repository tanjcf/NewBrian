import assert from "node:assert/strict";
import test from "node:test";
import { classifyExecutionKind, executionKindLabel } from "./plugin-execution.ts";

test("classifies instruction-only, script, builtin, MCP, and hybrid capabilities", () => {
  assert.equal(classifyExecutionKind({ skillRoots: ["skills"] }), "instructions");
  assert.equal(classifyExecutionKind({ hasScripts: true }), "script-assisted");
  assert.equal(classifyExecutionKind({ builtinToolNames: ["spreadsheet.inspect"] }), "builtin-tools");
  assert.equal(classifyExecutionKind({ mcpServerIds: ["figma:main"] }), "mcp");
  assert.equal(classifyExecutionKind({ hasScripts: true, mcpServerIds: ["server"] }), "hybrid");
  assert.equal(executionKindLabel("instructions"), "仅提示词");
});
