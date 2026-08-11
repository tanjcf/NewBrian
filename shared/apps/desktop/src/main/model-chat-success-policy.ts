export interface AssistantMessageLike {
  id: string;
  role: string;
  content: string;
  createdAt?: string;
  reasoningSummary?: string;
}

/** Returns the assistant message owned by this turn, creating it exactly once when allowed. */
export function ensureTurnAssistantMessage<T extends AssistantMessageLike>(input: {
  messages: T[];
  turnId: string;
  waitingForApproval: boolean;
  create: (id: string) => T;
}) {
  const id = `assistant-${input.turnId}`;
  let assistant = input.messages.find((message) => message.role === "assistant" && message.id === id);
  if (!assistant) {
    // Also create during approval waits so syncSnapshot cannot leave a user-only blank turn.
    assistant = input.create(id);
    input.messages.push(assistant);
  }
  return assistant;
}
