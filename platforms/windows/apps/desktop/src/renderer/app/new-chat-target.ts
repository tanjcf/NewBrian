import {
  INTERNAL_CHAT_WORKSPACE_ID,
  type SkillSpec,
  type WorkspaceCatalogItem,
  type WorkspaceThreadRecord
} from "@codex-forge/protocol";
import type { ComposerToolChip } from "./desktop-model";

export { INTERNAL_CHAT_WORKSPACE_ID } from "@codex-forge/protocol";

export type NewChatComposerDraft = {
  question: string;
  images: Array<{ name: string; path: string; url: string }>;
  tools: ComposerToolChip[];
  skill: SkillSpec | null;
  skillContext: string;
  modes: Array<"goal" | "plan">;
};

export function resolveNewChatWorkspaceId(input: {
  scope: "project" | "chat";
  chatUsesProject: boolean;
  selectedWorkspaceId: string;
}) {
  if (input.scope === "chat" && !input.chatUsesProject) {
    return INTERNAL_CHAT_WORKSPACE_ID;
  }
  return input.selectedWorkspaceId;
}

export function shouldCreateChatThreadBeforeSend(input: {
  isComposingNewThread: boolean;
  currentThreadId?: string;
}) {
  return input.isComposingNewThread || !String(input.currentThreadId || "").trim();
}

export function shouldCreateStandaloneChatThreadBeforeSend(input: {
  isComposingNewThread: boolean;
  currentWorkspaceId?: string;
  currentThreadId?: string;
}) {
  return shouldCreateChatThreadBeforeSend(input)
    || input.currentWorkspaceId !== INTERNAL_CHAT_WORKSPACE_ID;
}

export class NewChatThreadActivationError extends Error {
  readonly activationError: unknown;
  readonly catalog: WorkspaceCatalogItem[];
  readonly workspace: WorkspaceCatalogItem;
  readonly thread: WorkspaceThreadRecord;
  readonly draft: NewChatComposerDraft;

  constructor(
    activationError: unknown,
    catalog: WorkspaceCatalogItem[],
    workspace: WorkspaceCatalogItem,
    thread: WorkspaceThreadRecord,
    draft: NewChatComposerDraft
  ) {
    super("Thread was created but could not be opened.");
    this.name = "NewChatThreadActivationError";
    this.activationError = activationError;
    this.catalog = catalog;
    this.workspace = workspace;
    this.thread = thread;
    this.draft = draft;
  }
}

export async function createAndActivateNewChatThread<TSnapshot>(input: {
  workspaceId: string;
  scope: "project" | "chat";
  existingThreadIds: ReadonlySet<string>;
  draft: NewChatComposerDraft;
  addWorkspaceThread: () => Promise<WorkspaceCatalogItem[]>;
  retainCatalog: (catalog: WorkspaceCatalogItem[]) => void;
  activateWorkspaceThread: (input: { workspaceId: string; threadId: string }) => Promise<TSnapshot>;
}) {
  const recoveryDraft = cloneNewChatComposerDraft(input.draft);
  const catalog = await input.addWorkspaceThread();
  const workspace = catalog.find((item) => item.id === input.workspaceId);
  const thread = workspace?.threads.find((item) =>
    item.scope === input.scope && !input.existingThreadIds.has(item.id)
  );
  if (!workspace || !thread) {
    throw new Error("New thread was not returned after creation.");
  }

  input.retainCatalog(catalog);
  try {
    const snapshot = await input.activateWorkspaceThread({
      workspaceId: workspace.id,
      threadId: thread.id
    });
    return { catalog, workspace, thread, snapshot };
  } catch (error) {
    throw new NewChatThreadActivationError(error, catalog, workspace, thread, recoveryDraft);
  }
}

export function cloneNewChatComposerDraft(input: NewChatComposerDraft): NewChatComposerDraft {
  return {
    question: input.question,
    images: input.images.map((image) => ({ ...image })),
    tools: input.tools.map((tool) => ({ ...tool, fieldValues: { ...(tool.fieldValues ?? {}) } })),
    skill: input.skill ? { ...input.skill } : null,
    skillContext: input.skillContext,
    modes: [...input.modes]
  };
}
