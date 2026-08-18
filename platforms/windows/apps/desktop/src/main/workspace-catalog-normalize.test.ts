import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWorkspaceCatalog } from "../renderer/app/workspace-visibility.ts";

test("normalizeWorkspaceCatalog accepts arrays and rejects object catalog shapes", () => {
  assert.deepEqual(normalizeWorkspaceCatalog([{ id: "a", threads: [] } as never]), [
    { id: "a", threads: [] }
  ]);
  assert.deepEqual(normalizeWorkspaceCatalog({ workspaces: [{ id: "b", threads: [] }] }), [
    { id: "b", threads: [] }
  ]);
  assert.deepEqual(normalizeWorkspaceCatalog({ workspaces: [] }), []);
  assert.deepEqual(normalizeWorkspaceCatalog(null), []);
});
