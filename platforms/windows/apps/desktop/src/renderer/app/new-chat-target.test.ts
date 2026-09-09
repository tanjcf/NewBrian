import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceCatalogItem } from "@codex-forge/protocol";

const {
  INTERNAL_CHAT_WORKSPACE_ID,
  NewChatThreadActivationError,
  createAndActivateNewChatThread,
  resolveNewChatWorkspaceId,
  shouldCreateChatThreadBeforeSend,
  shouldCreateStandaloneChatThreadBeforeSend
} = await import(
  new URL("./new-chat-target.ts", import.meta.url).href
) as typeof import("./new-chat-target.js");

function workspace(overrides: Partial<WorkspaceCatalogItem> = {}): WorkspaceCatalogItem {
  return {
    id: INTERNAL_CHAT_WORKSPACE_ID,
    name: "__internal_chat__",
    path: "C:\\NewBrain\\tmp",
    threads: [],
    ...overrides
  };
}

test("routes a standalone chat with no selected project to the internal chat workspace", () => {
  assert.equal(resolveNewChatWorkspaceId({
    scope: "chat",
    chatUsesProject: false,
    selectedWorkspaceId: ""
  }), INTERNAL_CHAT_WORKSPACE_ID);
});

test("routes a standalone chat to the internal workspace even when a project is selected", () => {
  assert.equal(resolveNewChatWorkspaceId({
    scope: "chat",
    chatUsesProject: false,
    selectedWorkspaceId: "workspace-project"
  }), INTERNAL_CHAT_WORKSPACE_ID);
});

test("uses the selected project for an explicitly project-backed chat", () => {
  assert.equal(resolveNewChatWorkspaceId({
    scope: "chat",
    chatUsesProject: true,
    selectedWorkspaceId: "workspace-project"
  }), "workspace-project");
});

test("keeps project drafts without a selected project unresolved", () => {
  assert.equal(resolveNewChatWorkspaceId({
    scope: "project",
    chatUsesProject: false,
    selectedWorkspaceId: ""
  }), "");
});

test("creates a thread before sending from an empty new-chat surface", () => {
  assert.equal(shouldCreateChatThreadBeforeSend({
    isComposingNewThread: false,
    currentThreadId: ""
  }), true);
  assert.equal(shouldCreateChatThreadBeforeSend({
    isComposingNewThread: false,
    currentThreadId: "thread-1"
  }), false);
});

test("reuses the active internal-chat thread for later standalone messages", () => {
  assert.equal(shouldCreateStandaloneChatThreadBeforeSend({
    isComposingNewThread: false,
    currentWorkspaceId: INTERNAL_CHAT_WORKSPACE_ID,
    currentThreadId: "thread-existing"
  }), false);
});

test("reuses a just-created internal-chat thread before the catalog refresh catches up", () => {
  assert.equal(shouldCreateStandaloneChatThreadBeforeSend({
    isComposingNewThread: false,
    currentWorkspaceId: INTERNAL_CHAT_WORKSPACE_ID,
    currentThreadId: "thread-just-created"
  }), false);
});

test("creates a standalone thread when the selected thread belongs to another workspace", () => {
  assert.equal(shouldCreateStandaloneChatThreadBeforeSend({
    isComposingNewThread: false,
    currentWorkspaceId: "workspace-project",
    currentThreadId: "thread-project"
  }), true);
});

test("retains the created catalog before activation can fail", async () => {
  const returnedCatalog = [workspace({
    threads: [{
      id: "chat-created",
      title: "Recoverable chat",
      summary: "",
      scope: "chat",
      updatedAt: "2026-07-23T00:00:00.000Z"
    }]
  })];
  let retainedCatalog: WorkspaceCatalogItem[] | undefined;

  await assert.rejects(
    createAndActivateNewChatThread({
      workspaceId: INTERNAL_CHAT_WORKSPACE_ID,
      scope: "chat",
      existingThreadIds: new Set<string>(),
      draft: {
        question: "keep this draft",
        images: [{ name: "diagram.png", path: "C:\\tmp\\diagram.png", url: "file:///diagram.png" }],
        tools: [{ id: "tool-1", label: "Tool", detail: "detail", fieldValues: { query: "keep" } }],
        skill: { id: "skill-1", name: "Skill", summary: "summary", status: "enabled" },
        skillContext: "context",
        modes: ["goal"]
      },
      addWorkspaceThread: async () => returnedCatalog,
      retainCatalog: (catalog) => {
        retainedCatalog = catalog;
      },
      activateWorkspaceThread: async () => {
        assert.strictEqual(retainedCatalog, returnedCatalog);
        throw new Error("activation unavailable");
      }
    }),
    (error: unknown) => error instanceof NewChatThreadActivationError
  );
});

test("activation failures retain a recoverable copy of the complete composer draft", async () => {
  const draft = {
    question: "preserve question",
    images: [{ name: "reference.png", path: "C:\\tmp\\reference.png", url: "file:///reference.png" }],
    tools: [{ id: "tool-1", label: "Tool", detail: "detail", fieldValues: { query: "original" } }],
    skill: { id: "skill-1", name: "Skill", summary: "summary", status: "enabled" as const },
    skillContext: "preserve context",
    modes: ["goal" as const, "plan" as const]
  };

  await assert.rejects(
    createAndActivateNewChatThread({
      workspaceId: INTERNAL_CHAT_WORKSPACE_ID,
      scope: "chat",
      existingThreadIds: new Set<string>(),
      draft,
      addWorkspaceThread: async () => [workspace({
        threads: [{ id: "chat-created", title: "Chat", summary: "", scope: "chat", updatedAt: "2026-07-23T00:00:00.000Z" }]
      })],
      retainCatalog: () => undefined,
      activateWorkspaceThread: async () => {
        draft.images[0].name = "mutated.png";
        draft.tools[0].fieldValues!.query = "mutated";
        draft.modes.push("goal");
        throw new Error("activation unavailable");
      }
    }),
    (error: unknown) => {
      assert.ok(error instanceof NewChatThreadActivationError);
      assert.match(error.message, /created.*could not be opened/i);
      assert.deepEqual(error.draft, {
        question: "preserve question",
        images: [{ name: "reference.png", path: "C:\\tmp\\reference.png", url: "file:///reference.png" }],
        tools: [{ id: "tool-1", label: "Tool", detail: "detail", fieldValues: { query: "original" } }],
        skill: { id: "skill-1", name: "Skill", summary: "summary", status: "enabled" },
        skillContext: "preserve context",
        modes: ["goal", "plan"]
      });
      return true;
    }
  );
});
