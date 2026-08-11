import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("exposes specification version, guidance, and confirmation IPC operations", async () => {
  const protocol = await readFile(new URL("../../../../packages/protocol/src/index.ts", import.meta.url), "utf8");
  const preload = await readFile(new URL("../preload/index.ts", import.meta.url), "utf8");
  const handlers = await readFile(new URL("./goal-ipc.ts", import.meta.url), "utf8");
  assert.match(protocol, /governmentWritingSpecification:\s*\{[\s\S]*get:[\s\S]*save:[\s\S]*saveSuggestions:[\s\S]*applySuggestions:[\s\S]*confirm:/u);
  assert.match(preload, /getGovernmentWritingSpecification[\s\S]*saveGovernmentWritingSpecification[\s\S]*saveGovernmentWritingSuggestions[\s\S]*applyGovernmentWritingSuggestions[\s\S]*confirmGovernmentWritingSpecification/u);
  assert.match(handlers, /GovernmentWritingSpecificationService/u);
  assert.match(handlers, /currentVersionId/u);
  assert.match(handlers, /goal\.goalId !== input\.goalId/u);
});
