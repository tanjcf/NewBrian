import assert from "node:assert/strict";
import test from "node:test";
import { MemoryIndex } from "./memory-index.js";

test("retrieves relevant durable memories and tracks usage", () => {
  const index = new MemoryIndex();
  index.hydrate([
    { id: "a", scope: "workspace", summary: "Use pnpm for TypeScript builds", createdAt: new Date(0).toISOString() },
    { id: "b", scope: "workspace", summary: "PostgreSQL migration notes", createdAt: new Date(0).toISOString() }
  ]);
  const result = index.search("run the TypeScript pnpm build");
  assert.equal(result[0].id, "a");
  assert.equal(result[0].usageCount, 1);
});

test("creates one bounded memory per unique exchange", () => {
  const index = new MemoryIndex({ maxRecords: 10 });
  const first = index.rememberExchange({ user: "Implement policy rules", assistant: "Added policy engine" });
  const duplicate = index.rememberExchange({ user: "Implement policy rules", assistant: "Added policy engine" });
  assert.equal(first.id, duplicate.id);
  assert.match(first.summary, /policy rules/);
});
