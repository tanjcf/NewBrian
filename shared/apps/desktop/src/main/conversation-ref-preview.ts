import {
  CONVERSATION_REF_TURN_LIMIT,
  selectRecentConversationTurns,
  type ConversationRef,
  type ConversationRefKind
} from "../renderer/app/conversation-refs.ts";

export type ConversationRefPreviewInput = {
  kind: ConversationRefKind;
  title?: string;
  summary?: string;
  workspaceId?: string;
  threadId?: string;
  conversationId?: string;
  archived?: boolean;
  turnLimit?: number;
  messages?: Array<{ role?: string; content?: string; createdAt?: string }>;
};

export function buildConversationRefPreview(input: ConversationRefPreviewInput): ConversationRef {
  const turnLimit = Math.max(1, Number(input.turnLimit) || CONVERSATION_REF_TURN_LIMIT);
  const { turns, truncated } = selectRecentConversationTurns(input.messages ?? [], turnLimit);
  const id = input.kind === "thread"
    ? `thread-${input.workspaceId || "ws"}-${input.threadId || "thread"}`
    : `brain-${input.conversationId || "conversation"}`;
  return {
    id,
    kind: input.kind,
    title: String(input.title || "").trim() || (input.kind === "thread" ? "工作区线程" : "BRAIN 会话"),
    summary: String(input.summary || "").trim(),
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    conversationId: input.conversationId,
    archived: Boolean(input.archived),
    turns,
    truncated
  };
}
