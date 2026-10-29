import type { PhaseOneSnapshot } from "@codex-forge/protocol";

export const LEGACY_SIDEBAR_ROW_STORAGE_KEY = "newbrain.lastSelectedSidebarRow.v1";

export type LegacySidebarRowKind = "chat" | "project-thread" | "brain-conversation" | "other";

export type ParsedLegacySidebarRow = {
  kind: LegacySidebarRowKind;
  workspaceId?: string;
  threadId?: string;
  conversationId?: string;
};

export type SidebarRowThreadTarget<
  TWorkspace extends { id: string; threads?: readonly { id: string; kind?: string | null; archived?: boolean }[] }
> = {
  kind: Extract<LegacySidebarRowKind, "chat" | "project-thread">;
  workspace: TWorkspace;
  thread: NonNullable<TWorkspace["threads"]>[number];
};

/** Parse persisted sidebar rows like `chat:ws:thread` or `project-thread:ws:thread`. */
export function parseLegacySidebarRow(row: string | null | undefined): ParsedLegacySidebarRow | null {
  const normalized = String(row || "").trim();
  if (!normalized) return null;
  if (normalized.startsWith("brain-conversation:")) {
    return {
      kind: "brain-conversation",
      conversationId: normalized.slice("brain-conversation:".length)
    };
  }
  const parts = normalized.split(":");
  const head = parts[0];
  if ((head === "chat" || head === "project-thread") && parts.length >= 3) {
    return {
      kind: head,
      workspaceId: parts.slice(1, -1).join(":"),
      threadId: parts[parts.length - 1]
    };
  }
  return { kind: "other" };
}

/** Resolve a sidebar row to a catalog workspace/thread when the thread still exists. */
export function resolveSidebarRowThreadTarget<
  TWorkspace extends { id: string; threads?: readonly { id: string; kind?: string | null; archived?: boolean }[] }
>(input: {
  sidebarRow: string | null | undefined;
  workspaces: readonly TWorkspace[];
}): SidebarRowThreadTarget<TWorkspace> | null {
  const parsed = parseLegacySidebarRow(input.sidebarRow);
  if (!parsed || (parsed.kind !== "chat" && parsed.kind !== "project-thread")) return null;
  const workspaceId = String(parsed.workspaceId || "").trim();
  const threadId = String(parsed.threadId || "").trim();
  if (!workspaceId || !threadId) return null;
  const workspace = input.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) return null;
  const threads = workspace.threads ?? [];
  const direct = threads.find((thread) => thread.id === threadId && !thread.archived && thread.kind !== "subagent");
  if (direct) {
    return { kind: parsed.kind, workspace, thread: direct };
  }
  return null;
}

/** Whether startup should prefer the persisted sidebar row over lastSelectedThreadId. */
export function shouldPreferSidebarRowThreadRestore(input: {
  sidebarRow: string | null | undefined;
  selectedWorkspaceId?: string | null;
  selectedThreadId?: string | null;
  workspaces: readonly { id: string; threads?: readonly { id: string; kind?: string | null; archived?: boolean }[] }[];
}) {
  const target = resolveSidebarRowThreadTarget({
    sidebarRow: input.sidebarRow,
    workspaces: input.workspaces
  });
  if (!target) return false;
  return input.selectedWorkspaceId !== target.workspace.id || input.selectedThreadId !== target.thread.id;
}

export type DisplayChatMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  reasoningSummary?: string;
  excludeFromModelContext?: boolean;
  createdAt?: string;
  attachments?: Array<{ name: string; path: string; url: string }>;
};

export function snapshotToDisplayMessages(snapshot: Pick<PhaseOneSnapshot, "messages">): DisplayChatMessage[] {
  return snapshot.messages
    .filter(
      (message): message is typeof message & { role: "user" | "assistant" } =>
        message.role === "user" || message.role === "assistant"
    )
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      reasoningSummary: message.reasoningSummary,
      excludeFromModelContext: message.excludeFromModelContext,
      createdAt: message.createdAt,
      attachments: message.attachments
    }));
}

export function resolveLegacySidebarRowForThread(input: {
  workspaceId: string;
  threadId: string;
  scope?: string | null;
}) {
  const workspaceId = String(input.workspaceId || "").trim();
  const threadId = String(input.threadId || "").trim();
  if (!workspaceId || !threadId) return "";
  const prefix = input.scope === "chat" ? "chat" : "project-thread";
  return `${prefix}:${workspaceId}:${threadId}`;
}
