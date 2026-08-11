export interface ReconciledChatMessage {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  reasoningSummary?: string;
  excludeFromModelContext?: boolean;
  createdAt?: string;
  attachments?: Array<{ name: string; path: string; url: string }>;
}

export interface IncomingChatMessage {
  id?: string;
  role: "system" | "user" | "assistant";
  content: string;
  reasoningSummary?: string;
  excludeFromModelContext?: boolean;
  createdAt?: string;
  attachments?: Array<{ name: string; path: string; url: string }>;
}

export function reconcileThreadMessages(
  persisted: ReconciledChatMessage[],
  incoming: IncomingChatMessage[],
  makeMessageId: () => string,
  fallbackCreatedAt: string
) {
  const messages = persisted.map((message) => ({ ...message }));
  const knownIds = new Set(messages.map((message) => message.id));
  const knownLegacyMessages = new Set(
    messages.map((message) => `${message.role}\u0000${message.createdAt ?? ""}\u0000${message.content}`)
  );

  for (const message of incoming) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const incomingId = message.id?.trim() || "";
    // Renderer streaming stubs use local-assistant-*. Durable success uses assistant-turn-*.
    // Never re-ingest a completed stub into thread state or the UI will show two answers.
    if (
      incomingId.startsWith("local-assistant-")
      && !message.excludeFromModelContext
      && messages.some((existing) =>
        existing.role === "assistant"
        && !existing.excludeFromModelContext
        && String(existing.id || "").startsWith("assistant-")
        && Boolean(String(existing.content || "").trim())
      )
    ) {
      continue;
    }
    if (
      incomingId.startsWith("local-assistant-")
      && !message.excludeFromModelContext
      && !String(message.content || "").trim()
    ) {
      continue;
    }
    const legacyKey = `${message.role}\u0000${message.createdAt ?? ""}\u0000${message.content}`;
    if ((message.id && knownIds.has(message.id)) || (!message.id && knownLegacyMessages.has(legacyKey))) {
      continue;
    }

    const nextMessage: ReconciledChatMessage = {
      id: incomingId || makeMessageId(),
      role: message.role,
      content: message.content,
      reasoningSummary: message.reasoningSummary,
      excludeFromModelContext: message.excludeFromModelContext,
      attachments: message.attachments,
      createdAt: message.createdAt?.trim() || fallbackCreatedAt
    };
    messages.push(nextMessage);
    knownIds.add(nextMessage.id);
    knownLegacyMessages.add(legacyKey);
  }

  return messages;
}
