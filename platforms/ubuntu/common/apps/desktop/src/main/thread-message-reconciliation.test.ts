import assert from "node:assert/strict";
import { test } from "node:test";

const { reconcileThreadMessages } = await (import(
  new URL("./thread-message-reconciliation.ts", import.meta.url).href
) as Promise<typeof import("./thread-message-reconciliation.js")>);

const makeIdFactory = () => {
  let counter = 0;
  return () => `generated-${++counter}`;
};

test("appends new user/assistant messages with generated ids", () => {
  const merged = reconcileThreadMessages(
    [{ id: "m1", role: "user", content: "hello", createdAt: "2026-01-01T00:00:00Z" }],
    [
      { role: "assistant", content: "hi there" },
      { role: "tool", content: "ignored tool output" }
    ],
    makeIdFactory(),
    "2026-01-02T00:00:00Z"
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[1].id, "generated-1");
  assert.equal(merged[1].role, "assistant");
  assert.equal(merged[1].createdAt, "2026-01-02T00:00:00Z");
});

test("skips duplicates by id", () => {
  const merged = reconcileThreadMessages(
    [{ id: "m1", role: "user", content: "hello", createdAt: "2026-01-01T00:00:00Z" }],
    [{ id: "m1", role: "user", content: "hello (edited copy should be ignored)" }],
    makeIdFactory(),
    "2026-01-02T00:00:00Z"
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].content, "hello");
});

test("skips legacy duplicates without id by role+createdAt+content", () => {
  const merged = reconcileThreadMessages(
    [{ id: "m1", role: "user", content: "hello", createdAt: "2026-01-01T00:00:00Z" }],
    [{ role: "user", content: "hello", createdAt: "2026-01-01T00:00:00Z" }],
    makeIdFactory(),
    "2026-01-02T00:00:00Z"
  );
  assert.equal(merged.length, 1);
});

test("does not mutate the persisted array", () => {
  const persisted = [{ id: "m1", role: "user", content: "hello", createdAt: "2026-01-01T00:00:00Z" }];
  const merged = reconcileThreadMessages(persisted, [{ role: "assistant", content: "hi" }], makeIdFactory(), "2026-01-02T00:00:00Z");
  assert.equal(persisted.length, 1);
  assert.equal(merged.length, 2);
  assert.notEqual(merged[0], persisted[0]);
});
