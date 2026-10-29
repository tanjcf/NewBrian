/**
 * Map a goal's model-chat turnId onto a conversation turn id (user message id).
 * Conversation turns use message.id; goals store makeId("turn") values — they differ.
 */

export type GoalOwnerTurnEvent = {
  type?: string;
  turnId?: string;
  payload?: Record<string, unknown>;
};

export type GoalOwnerConversationTurn = {
  id: string;
  user?: { id?: string } | null;
};

/** Resolve model turnId → user message id from timeline message events. */
export function mapGoalTurnIdToUserMessageId(
  goalTurnId: string,
  events: GoalOwnerTurnEvent[] | undefined
): string {
  const target = String(goalTurnId || "").trim();
  if (!target || !events?.length) return "";
  for (const event of events) {
    if (
      event.type === "message"
      && event.turnId === target
      && event.payload?.role === "user"
      && typeof event.payload.messageId === "string"
      && event.payload.messageId.trim()
    ) {
      return event.payload.messageId.trim();
    }
  }
  return "";
}

/**
 * Which conversation turn should render the goal card.
 * Completed goals must stay on their owner turn — never follow the latest message.
 */
export function resolveGoalOwnerConversationTurnId(input: {
  goalTurnId?: string | null;
  goalStatus?: string | null;
  conversationTurns: GoalOwnerConversationTurn[];
  events?: GoalOwnerTurnEvent[];
  /** Stable anchor once a goal completes (same goalId); prevents last-turn drift. */
  pinnedCompleteTurnId?: string | null;
}): string {
  const turns = input.conversationTurns || [];
  const status = String(input.goalStatus || "");
  const goalTurnId = String(input.goalTurnId || "").trim();
  const pinned = String(input.pinnedCompleteTurnId || "").trim();
  const mappedMessageId = mapGoalTurnIdToUserMessageId(goalTurnId, input.events);

  const findTurnId = (candidate: string): string => {
    const id = String(candidate || "").trim();
    if (!id) return "";
    const hit = turns.find((turn) => turn.id === id || turn.user?.id === id);
    return hit?.id || "";
  };

  const mappedTurnId = findTurnId(mappedMessageId) || findTurnId(goalTurnId);

  if (status === "complete") {
    if (mappedTurnId) return mappedTurnId;
    if (pinned && findTurnId(pinned)) return findTurnId(pinned);
    // Do not fall back to the latest turn — that keeps the card stuck under new chats.
    return pinned || mappedTurnId || "";
  }

  if (mappedTurnId) return mappedTurnId;
  return turns.at(-1)?.id || "";
}
