import type { PhaseOneSnapshot } from "@codex-forge/protocol";

export const LEGACY_SIDEBAR_ROW_STORAGE_KEY = "codecn.lastSelectedSidebarRow.v1";

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
