/** Cross-conversation @-references for the composer (thread + brain conversation). */

export const CONVERSATION_REF_TURN_LIMIT = 5;
export const CONVERSATION_REF_CONTENT_MAX = 600;

export type ConversationRefKind = "thread" | "brain_conversation";

export type ConversationRefTurn = {
  role: string;
  content: string;
  createdAt?: string;
};

export type ConversationRef = {
  id: string;
  kind: ConversationRefKind;
  title: string;
  summary: string;
  workspaceId?: string;
  threadId?: string;
  conversationId?: string;
  archived?: boolean;
  turns?: ConversationRefTurn[];
  truncated?: boolean;
};

export type ConversationRefCandidate = {
  id: string;
  kind: ConversationRefKind;
  title: string;
  detail: string;
  workspaceId?: string;
  threadId?: string;
  conversationId?: string;
  archived?: boolean;
  updatedAt?: string;
};

export function conversationRefKey(ref: Pick<ConversationRef, "kind" | "workspaceId" | "threadId" | "conversationId" | "id">): string {
  if (ref.kind === "thread") {
    return `thread:${ref.workspaceId || ""}/${ref.threadId || ref.id}`;
  }
  return `brain:${ref.conversationId || ref.id}`;
}

export function detectComposerMentionQuery(text: string, cursor: number): { start: number; query: string } | null {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, safeCursor);
  const match = before.match(/(^|[\s([{"'「『])@([^\s@]*)$/);
  if (!match) return null;
  const atIndex = before.lastIndexOf("@");
  if (atIndex < 0) return null;
  return { start: atIndex, query: match[2] ?? "" };
}

export function replaceComposerMentionRange(
  text: string,
  start: number,
  cursor: number,
  insertion = ""
): { next: string; cursor: number } {
  const end = Math.max(start, Math.min(cursor, text.length));
  const next = `${text.slice(0, start)}${insertion}${text.slice(end)}`;
  return { next, cursor: start + insertion.length };
}

export function truncateRefContent(content: string, max = CONVERSATION_REF_CONTENT_MAX): string {
  const normalized = String(content || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1))}…`;
}

export function selectRecentConversationTurns(
  messages: Array<{ role?: string; content?: string; createdAt?: string }>,
  limit = CONVERSATION_REF_TURN_LIMIT
): { turns: ConversationRefTurn[]; truncated: boolean } {
  const usable = messages
    .filter((message) => {
      const role = String(message.role || "").toLowerCase();
      return role === "user" || role === "assistant";
    })
    .map((message) => ({
      role: String(message.role || "user"),
      content: String(message.content || "").trim(),
      createdAt: message.createdAt
    }))
    .filter((message) => message.content);
  const turns = usable.slice(-Math.max(1, limit));
  return { turns, truncated: usable.length > turns.length };
}

export function formatConversationRefBlock(ref: ConversationRef): string {
  const kindLabel = ref.kind === "brain_conversation" ? "BRAIN 会话" : "工作区线程";
  const lines = [
    `【引用${kindLabel}：${ref.title || "未命名"}】`,
    ref.summary ? `摘要：${truncateRefContent(ref.summary, 240)}` : "摘要：（无）",
    "最近对话："
  ];
  const turns = ref.turns?.length ? ref.turns : [];
  if (!turns.length) {
    lines.push("（暂无可用回合）");
  } else {
    for (const turn of turns) {
      const role = turn.role === "assistant" ? "助手" : turn.role === "user" ? "用户" : turn.role;
      lines.push(`${role}：${truncateRefContent(turn.content)}`);
    }
  }
  if (ref.truncated) lines.push("（已截断更早内容）");
  if (ref.archived) lines.push("（已归档）");
  return lines.join("\n");
}

export function injectConversationRefsIntoQuestion(question: string, refs: ConversationRef[]): string {
  const body = String(question || "").trim();
  if (!refs.length) return body;
  const blocks = refs.map((ref) => formatConversationRefBlock(ref)).join("\n\n");
  if (!body) return blocks;
  return `${blocks}\n\n---\n${body}`;
}

export function mergeConversationRef(
  current: ConversationRef[],
  next: ConversationRef
): ConversationRef[] {
  const key = conversationRefKey(next);
  const without = current.filter((item) => conversationRefKey(item) !== key);
  return [...without, next];
}

export function filterConversationRefCandidates(
  candidates: ConversationRefCandidate[],
  query: string,
  limit = 12
): ConversationRefCandidate[] {
  const needle = String(query || "").trim().toLowerCase();
  const ranked = candidates.filter((item) => {
    if (!needle) return true;
    return (
      item.title.toLowerCase().includes(needle)
      || item.detail.toLowerCase().includes(needle)
    );
  });
  return ranked.slice(0, limit);
}
