import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner loads this source file directly.
import { requireWorkspaceThreadSelection } from "./workspace-thread-selection.ts";

const catalog = [{
  id: "project-a",
  threads: [{ id: "thread-a" }]
}, {
  id: "project-b",
  threads: [{ id: "thread-b" }]
}];

test("selects only a thread owned by the requested project", () => {
  const selected = requireWorkspaceThreadSelection(catalog, "project-b", "thread-b");
  assert.equal(selected.workspace.id, "project-b");
  assert.equal(selected.thread.id, "thread-b");
});

test("never falls back across projects when identifiers are stale or mixed", () => {
  assert.throws(() => requireWorkspaceThreadSelection(catalog, "missing", "thread-a"), /Project was not found/);
  assert.throws(() => requireWorkspaceThreadSelection(catalog, "project-a", "thread-b"), /Thread was not found in the selected project/);
});
