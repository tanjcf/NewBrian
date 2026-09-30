import assert from "node:assert/strict";
import test from "node:test";
import { classifyToolActivity, toolActivityDetail } from "./tool-activity-policy.js";

test("classifies only shell.exec as an expandable process command", () => {
  assert.equal(classifyToolActivity("shell.exec").commandDetails, true);
  for (const name of ["goal.update_plan", "goal.request_user_input", "workspace.write_file", "mcp__server__tool", "browser.open"]) {
    assert.equal(classifyToolActivity(name).commandDetails, false, name);
  }
  assert.equal(toolActivityDetail("shell.exec", { command: "git status" }), "git status");
});
