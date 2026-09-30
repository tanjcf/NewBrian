import assert from "node:assert/strict";
import test from "node:test";
import {
  extractPendingApprovalCommand,
  normalizeApprovalCommand,
  rememberApprovedCommand
} from "./approval-memory.ts";

test("normalizeApprovalCommand collapses whitespace and case", () => {
  assert.equal(
    normalizeApprovalCommand("  Get-ChildItem   .\\outputs  "),
    "get-childitem .\\outputs"
  );
});

test("rememberApprovedCommand stores exact shell allow and dedupes", () => {
  const first = rememberApprovedCommand([], {
    toolName: "shell.exec",
    command: "where.exe ffmpeg"
  });
  assert.equal(first.length, 1);
  assert.equal(first[0]!.decision, "allow");
  assert.equal(first[0]!.match, "exact");
  const second = rememberApprovedCommand(first, {
    toolName: "shell.exec",
    command: "WHERE.EXE  ffmpeg"
  });
  assert.equal(second.length, 1);
});

test("rememberApprovedCommand ignores non-shell tools", () => {
  assert.deepEqual(
    rememberApprovedCommand([], { toolName: "workspace.write_file", command: "x" }),
    []
  );
});

test("extractPendingApprovalCommand reads pending tool arguments", () => {
  const extracted = extractPendingApprovalCommand({
    pendingTool: { name: "shell.exec", arguments: { command: "npm test" } }
  });
  assert.deepEqual(extracted, { toolName: "shell.exec", command: "npm test" });
});
