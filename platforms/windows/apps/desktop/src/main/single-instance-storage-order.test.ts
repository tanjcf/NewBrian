import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("acquires the desktop single-instance lock before opening Codex storage", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const lockIndex = source.indexOf("app.requestSingleInstanceLock()");
  const storageIndex = source.indexOf("new CodexStorage(workspaceStateRoot)");
  assert.ok(lockIndex >= 0);
  assert.ok(storageIndex >= 0);
  assert.ok(lockIndex < storageIndex, "Codex storage opened before the single-instance lock");
  assert.match(source.slice(lockIndex, storageIndex), /process\.exit\(0\)/u);
});
