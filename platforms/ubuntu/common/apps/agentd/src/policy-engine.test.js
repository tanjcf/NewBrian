import assert from "node:assert/strict";
import test from "node:test";
import { PolicyEngine } from "./policy-engine.js";

const workspace = process.platform === "win32" ? "G:\\workspace" : "/workspace";
const descriptor = { risk: "high", requiresApproval: true };

test("non-overridable guards deny critical commands even in full mode", () => {
  const engine = new PolicyEngine({ rules: [{ toolName: "shell.exec", commandPrefix: "shutdown", decision: "allow" }] });
  const result = engine.evaluate({
    toolName: "shell.exec", arguments: { command: "shutdown /s /t 0" }, descriptor,
    workspacePath: workspace, permissionMode: "full"
  });
  assert.equal(result.decision, "deny");
  assert.equal(result.source, "builtin");
});

test("ordered rules allow a known prefix and ask for unmatched commands", () => {
  const engine = new PolicyEngine({ rules: [
    { id: "git-status", toolName: "shell.exec", commandPrefix: "git status", decision: "allow" }
  ] });
  assert.equal(engine.evaluate({
    toolName: "shell.exec", arguments: { command: "git status --short" }, descriptor,
    workspacePath: workspace, permissionMode: "approval"
  }).decision, "allow");
  assert.equal(engine.evaluate({
    toolName: "shell.exec", arguments: { command: "git push" }, descriptor,
    workspacePath: workspace, permissionMode: "approval"
  }).decision, "ask");
});

test("denies mutating absolute paths outside the workspace", () => {
  const outside = process.platform === "win32" ? "C:\\Windows\\Temp\\x" : "/tmp/x";
  const command = process.platform === "win32"
    ? `Remove-Item -LiteralPath '${outside}' -Recurse`
    : `rm -rf '${outside}'`;
  const result = new PolicyEngine().evaluate({
    toolName: "shell.exec", arguments: { command }, descriptor,
    workspacePath: workspace, permissionMode: "full"
  });
  assert.equal(result.decision, "deny");
  assert.equal(result.ruleId, "workspace-boundary");
});
