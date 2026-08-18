import assert from "node:assert/strict";
import test from "node:test";
import { isMissingWorkspaceSelectionError } from "./workspace-selection-errors.ts";

test("treats Electron IPC Project-was-not-found as a recoverable selection miss", () => {
  assert.equal(
    isMissingWorkspaceSelectionError(
      "Error invoking remote method 'phase1:activate-workspace-thread': Error: Project was not found."
    ),
    true
  );
  assert.equal(isMissingWorkspaceSelectionError("Workspace was not found."), true);
  assert.equal(isMissingWorkspaceSelectionError("Workspace thread was not found."), true);
  assert.equal(isMissingWorkspaceSelectionError("Thread was not found in the selected project."), true);
  assert.equal(isMissingWorkspaceSelectionError("Renderer bootstrap failed"), false);
});
