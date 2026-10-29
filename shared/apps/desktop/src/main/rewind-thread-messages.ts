export function messagesBeforeUserMessage<T extends { id?: string; role?: string }>(
  messages: readonly T[],
  userMessageId: string
): T[] | null {
  const index = messages.findIndex((message) => message?.id === userMessageId && message?.role === "user");
  if (index < 0) return null;
  return messages.slice(0, index);
}
