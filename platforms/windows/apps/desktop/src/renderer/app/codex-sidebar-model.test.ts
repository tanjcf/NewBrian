import assert from "node:assert/strict";
import test from "node:test";

const { sortCodexSidebarThreads } = await import(
  new URL("./codex-sidebar-model.ts", import.meta.url).href
);

const threads = [
  { id: "recent", status: "idle", updatedAt: "2026-07-19T10:00:00.000Z" },
  { id: "approval", status: "awaiting-approval", updatedAt: "2026-07-19T08:00:00.000Z" },
  { id: "unread", status: "idle", updatedAt: "2026-07-19T09:00:00.000Z" },
  { id: "pinned", status: "idle", updatedAt: "2026-07-19T07:00:00.000Z" }
];

test("Codex priority order keeps pinned, input-required, and unread tasks first", () => {
  const sorted = sortCodexSidebarThreads(threads, "priority", new Set(["pinned"]), new Set(["unread"]));
  assert.deepEqual(sorted.map((thread: { id: string }) => thread.id), ["pinned", "approval", "unread", "recent"]);
});

test("updated order preserves pinning and otherwise follows recency", () => {
  const sorted = sortCodexSidebarThreads(threads, "updated", new Set(["pinned"]), new Set(["unread"]));
  assert.deepEqual(sorted.map((thread: { id: string }) => thread.id), ["pinned", "recent", "unread", "approval"]);
});
