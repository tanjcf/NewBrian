import type { ChatMessage } from "@codex-forge/protocol";
import {
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  estimateMessagesAndEventsTokens,
  estimateTextTokens,
  shouldCompactByTokenCount
} from "./context-budget-policy.ts";

export const CODEX_COMPACTION_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.`;

export const CODEX_SUMMARY_PREFIX = "Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:";

const COMPACT_USER_MESSAGE_MAX_TOKENS = 20_000;

export interface ThreadContextState {
  version: 1;
  summary: string;
  compactedMessageIds: string[];
  estimatedTokens: number;
  modelContextWindow: number;
  lastCompactedAt?: string;
  summaryMessageId?: string;
  retainedMessageIds?: string[];
  windowNumber?: number;
  firstWindowId?: string;
  previousWindowId?: string;
  windowId?: string;
  systemPromptHash?: string;
  provider?: string;
  model?: string;
}

interface ThreadContextPolicyDependencies {
  makeId?: (prefix: string) => string;
  nowIso?: () => string;
  summary?: string;
  /** Apply summarization even when under the soft threshold. */
  force?: boolean;
}

export function estimateMessageTokens(messages: Array<{ content: string }>) {
  return estimateTextTokens(messages.map((message) => message.content).join("\n"));
}

export function activeThreadMessages(messages: ChatMessage[], previous?: ThreadContextState): ChatMessage[] {
  if (!previous?.summary || !previous.compactedMessageIds.length) return messages;
  const compacted = new Set(previous.compactedMessageIds);
  const retained = new Set(previous.retainedMessageIds ?? []);
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  const retainedMessages = (previous.retainedMessageIds ?? []).flatMap((id) => {
    const message = messagesById.get(id);
    return message ? [message] : [];
  });
  const messagesAfterCompaction = messages.filter((message) => !compacted.has(message.id) && !retained.has(message.id));
  return [
    ...retainedMessages,
    {
      id: previous.summaryMessageId || `context-summary-window-${previous.windowNumber ?? 0}`,
      role: "user",
      content: previous.summary,
      createdAt: previous.lastCompactedAt || messages[0]?.createdAt || new Date(0).toISOString()
    },
    ...messagesAfterCompaction
  ];
}

export function shouldCompactThreadMessages(
  messages: ChatMessage[],
  previous?: ThreadContextState,
  modelContextWindow = DEFAULT_CONTEXT_WINDOW_TOKENS,
  events?: Array<{ type?: string; payload?: unknown }>
) {
  const activeMessages = activeThreadMessages(messages, previous);
  if (activeMessages.length <= 1) return false;
  const estimatedTokens = estimateMessagesAndEventsTokens(activeMessages, events);
  return shouldCompactByTokenCount(estimatedTokens, modelContextWindow);
}

function collectRetainedUserMessages(messages: ChatMessage[]) {
  const retained: ChatMessage[] = [];
  let remainingTokens = COMPACT_USER_MESSAGE_MAX_TOKENS;
  for (let index = messages.length - 1; index >= 0 && remainingTokens > 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user" || message.content.startsWith(CODEX_SUMMARY_PREFIX)) continue;
    const tokens = estimateMessageTokens([message]);
    if (tokens <= remainingTokens) {
      retained.push(message);
      remainingTokens -= tokens;
      continue;
    }
    const maxCharacters = Math.max(0, Math.floor(remainingTokens * 4));
    retained.push({ ...message, content: message.content.slice(-maxCharacters) });
    break;
  }
  return retained.reverse();
}

export function compactThreadMessages(
  messages: ChatMessage[],
  previous?: ThreadContextState,
  modelContextWindow = DEFAULT_CONTEXT_WINDOW_TOKENS,
  dependencies: ThreadContextPolicyDependencies = {},
  events?: Array<{ type?: string; payload?: unknown }>
): { messages: ChatMessage[]; context: ThreadContextState; compacted: boolean } {
  const makeId = dependencies.makeId ?? ((prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
  const nowIso = dependencies.nowIso ?? (() => new Date().toISOString());
  const activeMessages = activeThreadMessages(messages, previous);
  const estimatedTokens = estimateMessagesAndEventsTokens(activeMessages, events);
  if (!dependencies.force && !shouldCompactThreadMessages(messages, previous, modelContextWindow, events)) {
    return {
      messages: activeMessages,
      context: {
        ...(previous ?? { version: 1 as const, summary: "", compactedMessageIds: [] }),
        estimatedTokens,
        modelContextWindow
      } as ThreadContextState,
      compacted: false
    };
  }

  const summarySuffix = dependencies.summary?.trim();
  if (!summarySuffix) throw new Error("Context compaction requires a completed model summary.");
  const now = nowIso();
  const summaryMessageId = makeId("context-summary");
  const summary = `${CODEX_SUMMARY_PREFIX}\n${summarySuffix}`;
  const retainedUsers = collectRetainedUserMessages(activeMessages);
  const replacementMessages: ChatMessage[] = [
    ...retainedUsers,
    { id: summaryMessageId, role: "user", content: summary, createdAt: now }
  ];
  const previousWindowId = previous?.windowId;
  const windowId = makeId("context-window");
  const retainedIds = new Set(retainedUsers.map((message) => message.id));
  const newlyCompactedIds = messages
    .filter((message) => !retainedIds.has(message.id))
    .map((message) => message.id);
  return {
    messages: replacementMessages,
    context: {
      version: 1,
      summary,
      compactedMessageIds: [...new Set([...(previous?.compactedMessageIds ?? []), ...newlyCompactedIds])],
      estimatedTokens: estimateMessageTokens(replacementMessages),
      modelContextWindow,
      lastCompactedAt: now,
      summaryMessageId,
      retainedMessageIds: retainedUsers.map((message) => message.id),
      windowNumber: (previous?.windowNumber ?? 0) + 1,
      firstWindowId: previous?.firstWindowId || previousWindowId || windowId,
      previousWindowId,
      windowId,
      systemPromptHash: previous?.systemPromptHash,
      provider: previous?.provider,
      model: previous?.model
    },
    compacted: true
  };
}
