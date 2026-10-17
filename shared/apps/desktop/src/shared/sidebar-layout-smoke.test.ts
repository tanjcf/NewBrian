import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { sortCodexSidebarThreads } from "../renderer/app/codex-sidebar-model.ts";
import {
  moveProjectBefore,
  moveThreadBetweenProjects,
  orderProjectsForSidebar,
  PINNED_THREAD_STORAGE_KEY,
  PROJECT_DRAG_TYPE,
  SIDEBAR_PROJECT_ORDER_STORAGE_KEY,
  THREAD_DRAG_TYPE
} from "./sidebar-layout.ts";

export const THREAD_MOVE_CASE_ID = "THREAD-MOVE-PROJECT-SMOKE-001";
export const PROJECT_REORDER_CASE_ID = "PROJECT-REORDER-SMOKE-001";
export const THREAD_PIN_CASE_ID = "THREAD-PIN-SMOKE-001";

function readFirst(urls: URL[]) {
  for (const url of urls) {
    if (existsSync(url)) return readFileSync(url, "utf8");
  }
  throw new Error(`Missing source: ${urls.map((url) => url.pathname).join(" | ")}`);
}

const projects = [
  { id: "alpha", threads: [{ id: "thread-a" }, { id: "thread-b" }] },
  { id: "beta", threads: [{ id: "thread-c" }] },
  { id: "gamma", threads: [] as Array<{ id: string }> }
];

test(`${THREAD_MOVE_CASE_ID} a thread can move from one project to another and keeps its id`, () => {
  const moved = moveThreadBetweenProjects(projects, {
    threadId: "thread-a",
    fromWorkspaceId: "alpha",
    toWorkspaceId: "beta"
  });
  assert.deepEqual(moved.find((item) => item.id === "alpha")?.threads?.map((thread) => thread.id), ["thread-b"]);
  assert.deepEqual(moved.find((item) => item.id === "beta")?.threads?.map((thread) => thread.id), ["thread-c", "thread-a"]);
  assert.throws(() => moveThreadBetweenProjects(projects, {
    threadId: "thread-a",
    fromWorkspaceId: "alpha",
    toWorkspaceId: "missing"
  }), /target project not found/);
  assert.throws(() => moveThreadBetweenProjects(projects, {
    threadId: "thread-a",
    fromWorkspaceId: "alpha",
    toWorkspaceId: "alpha"
  }), /already in this project/);

  const main = readFirst([
    new URL("../../../../../platforms/windows/apps/desktop/src/main/index.ts", import.meta.url),
    new URL("../main/index.ts", import.meta.url)
  ]);
  const move = main.slice(main.indexOf("async function moveWorkspaceThread"), main.indexOf("async function deleteWorkspaceThread"));
  assert.match(move, /moveThreadBetweenProjects\(catalog\.workspaces, input\)/);
  assert.match(move, /relocateThreadFiles\(input\.fromWorkspaceId, input\.toWorkspaceId, input\.threadId\)/);
  assert.match(move, /activeWorkspaceId = input\.toWorkspaceId/);

  assert.equal(THREAD_DRAG_TYPE, "application/x-newbrain-thread");
  const ui = readFileSync(new URL("../renderer/app/WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(ui, /api\.moveWorkspaceThread\(\{/);
  assert.match(ui, /setData\(THREAD_DRAG_TYPE/);
  assert.match(ui, /fromWorkspaceId: payload\.workspaceId/);
  assert.match(ui, /toWorkspaceId: targetWorkspaceId/);
});

test(`${PROJECT_REORDER_CASE_ID} projects can be dragged into a new vertical order`, () => {
  const visual = orderProjectsForSidebar(projects);
  assert.deepEqual(visual.map((item) => item.id), ["gamma", "beta", "alpha"]);
  const reordered = moveProjectBefore(visual, "alpha", "gamma");
  assert.deepEqual(reordered.map((item) => item.id), ["alpha", "gamma", "beta"]);
  const appended = moveProjectBefore(reordered, "alpha", null);
  assert.deepEqual(appended.map((item) => item.id), ["gamma", "beta", "alpha"]);
  assert.throws(() => moveProjectBefore(visual, "alpha", "alpha"), /before itself/);
  const saved = orderProjectsForSidebar(projects, new Set(), ["beta", "alpha", "gamma"]);
  assert.deepEqual(saved.map((item) => item.id), ["beta", "alpha", "gamma"]);
  const withFresh = orderProjectsForSidebar(
    [...projects, { id: "delta", threads: [] }],
    new Set(),
    ["beta", "alpha", "gamma"]
  );
  assert.deepEqual(withFresh.map((item) => item.id), ["beta", "alpha", "gamma", "delta"]);

  assert.equal(SIDEBAR_PROJECT_ORDER_STORAGE_KEY, "newbrain.sidebarProjectOrder.v1");
  assert.equal(PROJECT_DRAG_TYPE, "application/x-newbrain-project");
  const ui = readFileSync(new URL("../renderer/app/WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(ui, /moveProjectBefore\(orderedSidebarProjects, projectId, targetWorkspaceId\)/);
  assert.match(ui, /localStorage\.setItem\(SIDEBAR_PROJECT_ORDER_STORAGE_KEY/);
  assert.match(ui, /data-testid="sidebar-project-header"/);
  assert.match(ui, /setData\(PROJECT_DRAG_TYPE/);
  assert.match(ui, /orderSidebarProjects\(sceneVisibleWorkspaceCatalog, pinnedWorkspaceIds, sidebarProjectOrder\)/);
});

test(`${THREAD_PIN_CASE_ID} pinned threads stay above the recency order and the pin survives reload`, () => {
  const threads = [
    { id: "older", updatedAt: "2026-10-01T00:00:00.000Z" },
    { id: "newer", updatedAt: "2026-10-12T00:00:00.000Z" },
    { id: "pinned-old", updatedAt: "2026-09-01T00:00:00.000Z" }
  ];
  assert.deepEqual(
    sortCodexSidebarThreads(threads, "updated", new Set(["pinned-old"]), new Set()).map((thread) => thread.id),
    ["pinned-old", "newer", "older"]
  );
  assert.deepEqual(
    sortCodexSidebarThreads(threads, "updated", new Set(), new Set()).map((thread) => thread.id),
    ["newer", "older", "pinned-old"]
  );

  const ui = readFirst([
    new URL("../../../../../platforms/windows/apps/desktop/src/renderer/ui.tsx", import.meta.url),
    new URL("../renderer/ui.tsx", import.meta.url)
  ]);
  assert.match(ui, new RegExp(PINNED_THREAD_STORAGE_KEY));
  assert.match(ui, /readPersistedIdSet\("newbrain\.pinnedThreadIds\.v1"\)/);

  const menu = readFirst([
    new URL("../../../../../platforms/windows/apps/desktop/src/renderer/app/useDesktopCore.tsx", import.meta.url),
    new URL("../renderer/app/useDesktopCore.tsx", import.meta.url)
  ]);
  const pin = menu.slice(menu.indexOf('case "pin"'), menu.indexOf('case "rename"'));
  assert.match(pin, /setPinnedThreadIds/);
  assert.match(pin, /next\.delete\(thread\.id\)/);
  assert.match(pin, /next\.add\(thread\.id\)/);

  const sidebar = readFileSync(new URL("../renderer/app/WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(sidebar, /sortCodexSidebarThreads\(/);
  assert.match(sidebar, /pinnedThreadIds/);
  assert.match(sidebar, /handleThreadMenuAction\("pin"/);
});
