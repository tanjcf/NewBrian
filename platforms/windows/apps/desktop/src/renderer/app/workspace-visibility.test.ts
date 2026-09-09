import assert from "node:assert/strict";
import test from "node:test";
import {
  INTERNAL_CHAT_WORKSPACE_ID,
  type SearchResultSpec,
  type WorkspaceCatalogItem
} from "@codex-forge/protocol";

const visibility = await import(
  new URL("./workspace-visibility.ts", import.meta.url).href
) as typeof import("./workspace-visibility.js");

function workspace(overrides: Partial<WorkspaceCatalogItem> = {}): WorkspaceCatalogItem {
  return {
    id: "workspace-user",
    name: "User project",
    path: "C:\\Projects\\user-project",
    threads: [],
    ...overrides
  };
}

const catalog = [
  workspace({
    id: INTERNAL_CHAT_WORKSPACE_ID,
    name: "__internal_chat__",
    path: "C:\\NewBrain\\tmp",
    threads: [
      { id: "chat-1", title: "Standalone chat", summary: "", scope: "chat", updatedAt: "2026-07-23T00:00:00.000Z" }
    ]
  }),
  workspace({
    id: "workspace-tmp",
    name: "tmp",
    threads: [
      { id: "project-1", title: "Tmp project", summary: "", scope: "project", updatedAt: "2026-07-23T00:00:00.000Z" },
      { id: "chat-2", title: "Project chat", summary: "", scope: "chat", updatedAt: "2026-07-23T00:00:00.000Z" }
    ]
  }),
  workspace({
    id: "workspace-user-internal-name",
    name: "__internal_chat__",
    threads: [
      { id: "project-2", title: "Named like internal", summary: "", scope: "project", updatedAt: "2026-07-23T00:00:00.000Z" }
    ]
  })
];

test("omits only the reserved internal workspace from project catalogs", () => {
  const projects = visibility.projectWorkspaces(catalog);

  assert.deepEqual(projects.map((item) => item.id), [
    "workspace-tmp",
    "workspace-user-internal-name"
  ]);
  assert.deepEqual(projects[0].threads.map((thread) => thread.id), ["project-1"]);
  assert.equal(visibility.isProjectVisible(catalog[0]), false);
  assert.equal(visibility.isProjectVisible(catalog[1]), true);
  assert.equal(visibility.isProjectVisible(catalog[2]), true);
});

test("keeps chat-scope threads available from the full workspace catalog", () => {
  const chats = visibility.chatWorkspaces(catalog);

  assert.deepEqual(
    chats.flatMap((item) => item.threads.map((thread) => `${item.id}:${thread.id}`)),
    [
      `${INTERNAL_CHAT_WORKSPACE_ID}:chat-1`,
      "workspace-tmp:chat-2"
    ]
  );
  assert.equal(catalog[0].threads[0].id, "chat-1");
});

test("keeps only projected project threads in project search results", () => {
  const results: SearchResultSpec[] = [
    { id: "internal", kind: "thread", title: "Standalone", detail: "", workspaceId: INTERNAL_CHAT_WORKSPACE_ID, threadId: "chat-1" },
    { id: "tmp", kind: "thread", title: "Tmp", detail: "", workspaceId: "workspace-tmp", threadId: "project-1" },
    { id: "tmp-chat", kind: "thread", title: "Project chat", detail: "", workspaceId: "workspace-tmp", threadId: "chat-2" },
    { id: "tmp-file", kind: "file", title: "Readme", detail: "", workspaceId: "workspace-tmp" },
    { id: "internal-name", kind: "thread", title: "Named internal", detail: "", workspaceId: "workspace-user-internal-name", threadId: "project-2" }
  ];

  assert.deepEqual(
    visibility.projectSearchResults(results, visibility.projectWorkspaces(catalog)).map((item) => item.id),
    ["tmp", "tmp-file", "internal-name"]
  );
});

test("sceneChatWorkspaces binds INTERNAL_CHAT threads to the active scene", () => {
  const sceneCatalog = [
    workspace({
      id: INTERNAL_CHAT_WORKSPACE_ID,
      name: "__internal_chat__",
      path: "C:\\NewBrain\\tmp",
      threads: [
        { id: "explore-chat", title: "Explore hi", summary: "", scope: "chat", brainWorkspaceKey: "explore", updatedAt: "2026-07-23T00:00:00.000Z" },
        { id: "doc-chat", title: "Doc hi", summary: "", scope: "chat", brainWorkspaceKey: "document", updatedAt: "2026-07-23T00:00:00.000Z" },
        { id: "legacy-chat", title: "Legacy", summary: "", scope: "chat", updatedAt: "2026-07-23T00:00:00.000Z" }
      ]
    }),
    workspace({
      id: "workspace-explore",
      name: "New projecta",
      brainWorkspaceKey: "explore",
      threads: [
        { id: "proj-1", title: "Project thread", summary: "", scope: "project", updatedAt: "2026-07-23T00:00:00.000Z" },
        { id: "proj-chat", title: "Project chat", summary: "", scope: "chat", updatedAt: "2026-07-23T00:00:00.000Z" }
      ]
    })
  ];

  const exploreChats = visibility.sceneChatWorkspaces(sceneCatalog, "explore");
  assert.deepEqual(
    exploreChats.flatMap((item) => item.threads.map((thread) => `${item.id}:${thread.id}`)),
    [
      `${INTERNAL_CHAT_WORKSPACE_ID}:explore-chat`,
      `${INTERNAL_CHAT_WORKSPACE_ID}:legacy-chat`,
      "workspace-explore:proj-chat"
    ]
  );

  const documentChats = visibility.sceneChatWorkspaces(sceneCatalog, "document");
  assert.deepEqual(
    documentChats.flatMap((item) => item.threads.map((thread) => `${item.id}:${thread.id}`)),
    [
      `${INTERNAL_CHAT_WORKSPACE_ID}:doc-chat`,
      `${INTERNAL_CHAT_WORKSPACE_ID}:legacy-chat`
    ]
  );
});

test("hides subagent threads from project/chat catalogs and falls back to parent on activation", () => {
  const withSubagent = [
    workspace({
      id: "workspace-tmp",
      name: "tmp",
      threads: [
        { id: "project-1", title: "Parent", summary: "", scope: "project", updatedAt: "2026-07-23T00:00:00.000Z" },
        {
          id: "child-1",
          title: "Child",
          summary: "",
          scope: "project",
          kind: "subagent",
          parentThreadId: "project-1",
          updatedAt: "2026-07-24T00:00:00.000Z"
        },
        { id: "chat-2", title: "Project chat", summary: "", scope: "chat", updatedAt: "2026-07-23T00:00:00.000Z" },
        {
          id: "chat-child",
          title: "Hidden chat child",
          summary: "",
          scope: "chat",
          kind: "subagent",
          parentThreadId: "chat-2",
          updatedAt: "2026-07-25T00:00:00.000Z"
        }
      ]
    })
  ];

  assert.deepEqual(
    visibility.projectWorkspaces(withSubagent)[0].threads.map((thread) => thread.id),
    ["project-1"]
  );
  assert.deepEqual(
    visibility.chatWorkspaces(withSubagent)[0].threads.map((thread) => thread.id),
    ["chat-2"]
  );
  assert.equal(visibility.isUserVisibleThread({ kind: "subagent" }), false);
  assert.equal(visibility.isUserVisibleThread({ kind: "user" }), true);
  assert.equal(
    visibility.resolveUserVisibleThreadSelection(withSubagent[0].threads, "child-1")?.id,
    "project-1"
  );
  assert.equal(
    visibility.resolveUserVisibleThreadSelection(withSubagent[0].threads, "project-1")?.id,
    "project-1"
  );
});

test("defaults unbound catalog items to document and filters by scene", () => {
  const sceneCatalog = [
    workspace({ id: "doc-1", name: "Doc", brainWorkspaceKey: undefined, threads: [{ id: "t1", title: "A", summary: "", scope: "project", updatedAt: "2026-07-20T00:00:00.000Z" }] }),
    workspace({ id: "quant-1", name: "Quant", brainWorkspaceKey: "quant", threads: [{ id: "t2", title: "B", summary: "", scope: "project", updatedAt: "2026-07-22T00:00:00.000Z" }] }),
    workspace({ id: "game-1", name: "Game", brainWorkspaceKey: "game", threads: [{ id: "t3", title: "C", summary: "", scope: "project", updatedAt: "2026-07-21T00:00:00.000Z" }] })
  ];

  assert.equal(visibility.resolveCatalogBrainWorkspaceKey(sceneCatalog[0]), "document");
  assert.deepEqual(
    visibility.filterWorkspaceCatalogByScene(sceneCatalog, "document").map((item) => item.id),
    ["doc-1"]
  );
  assert.deepEqual(
    visibility.filterWorkspaceCatalogByScene(sceneCatalog, "quant").map((item) => item.id),
    ["quant-1"]
  );
  assert.deepEqual(
    visibility.crossSceneRecentProjects(sceneCatalog, "document").map((item) => item.id),
    ["quant-1", "game-1"]
  );
});

test("orders sidebar projects newest-first with pinned workspaces on top", () => {
  const sceneCatalog = [
    workspace({ id: "older", name: "Older", brainWorkspaceKey: "software", threads: [] }),
    workspace({ id: "newer", name: "Newer", brainWorkspaceKey: "software", threads: [] }),
    workspace({ id: "pinned-old", name: "Pinned", brainWorkspaceKey: "software", threads: [] })
  ];

  assert.deepEqual(
    visibility.orderSidebarProjects(sceneCatalog).map((item) => item.id),
    ["pinned-old", "newer", "older"]
  );
  assert.deepEqual(
    visibility.orderSidebarProjects(sceneCatalog, new Set(["pinned-old"])).map((item) => item.id),
    ["pinned-old", "newer", "older"]
  );
  assert.deepEqual(
    visibility.orderSidebarProjects(sceneCatalog, new Set(["older"])).map((item) => item.id),
    ["older", "pinned-old", "newer"]
  );
});
