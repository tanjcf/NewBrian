import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner loads this source file directly.
import { clearStaleThreadApprovalInCatalog, markThreadActiveInCatalog, markThreadApprovalSettlingInCatalog, mostRecentlyActiveThread, sortThreadsByRecentActivity } from "./thread-order.ts";

test("orders threads by most recent runtime activity instead of catalog position", () => {
  const threads = [
    { id: "old", updatedAt: "2026-07-16T08:00:00.000Z" },
    { id: "latest", updatedAt: "2026-07-16T10:00:00.000Z" },
    { id: "middle", updatedAt: "2026-07-16T09:00:00.000Z" }
  ];
  assert.deepEqual(sortThreadsByRecentActivity(threads).map((thread) => thread.id), ["latest", "middle", "old"]);
  assert.equal(mostRecentlyActiveThread(threads)?.id, "latest");
  assert.deepEqual(threads.map((thread) => thread.id), ["old", "latest", "middle"]);
});

test("keeps invalid timestamps deterministic and behind valid activity", () => {
  assert.deepEqual(sortThreadsByRecentActivity([
    { id: "b", updatedAt: "invalid" },
    { id: "active", updatedAt: "2026-07-16T10:00:00.000Z" },
    { id: "a" }
  ]).map((thread) => thread.id), ["active", "a", "b"]);
});

test("marks a thread active as soon as a real request starts", () => {
  const catalog = [{ id: "workspace", threads: [
    { id: "selected", updatedAt: "2026-07-16T08:00:00.000Z" },
    { id: "other", updatedAt: "2026-07-16T09:00:00.000Z" }
  ] }];
  const updated = markThreadActiveInCatalog(catalog, "workspace", "selected", "2026-07-16T10:00:00.000Z");
  assert.equal(sortThreadsByRecentActivity(updated[0].threads)[0].id, "selected");
  assert.equal(catalog[0].threads[0].updatedAt, "2026-07-16T08:00:00.000Z");
});

test("approval settle keeps catalog as an array so App can call .find", () => {
  const catalog = [{
    id: "workspace",
    threads: [
      { id: "waiting", status: "awaiting-approval", statusLabel: "等待批准" },
      { id: "other", status: "idle", statusLabel: "" }
    ]
  }];
  const updated = markThreadApprovalSettlingInCatalog(catalog, "workspace", "waiting", true);
  assert.equal(Array.isArray(updated), true);
  assert.equal(typeof updated.find, "function");
  assert.equal(updated.find((item) => item.id === "workspace")?.threads[0]?.status, "running");
  assert.equal(updated.find((item) => item.id === "workspace")?.threads[0]?.statusLabel, "执行中");
  assert.equal(updated.find((item) => item.id === "workspace")?.threads[1]?.status, "idle");
  assert.deepEqual(markThreadApprovalSettlingInCatalog({ workspaces: catalog } as never, "workspace", "waiting", true), []);
});

test("clearing stale approval only touches the target thread", () => {
  const catalog = [
    {
      id: "ws-game",
      threads: [{ id: "game-thread", status: "awaiting-approval", statusLabel: "等待批准" }]
    },
    {
      id: "ws-software",
      threads: [{ id: "software-thread", status: "awaiting-approval", statusLabel: "等待批准" }]
    }
  ];
  const updated = clearStaleThreadApprovalInCatalog(catalog, "ws-game", "game-thread");
  assert.equal(updated.find((item) => item.id === "ws-game")?.threads[0]?.status, "idle");
  assert.equal(updated.find((item) => item.id === "ws-game")?.threads[0]?.statusLabel, "");
  assert.equal(updated.find((item) => item.id === "ws-software")?.threads[0]?.status, "awaiting-approval");
});
