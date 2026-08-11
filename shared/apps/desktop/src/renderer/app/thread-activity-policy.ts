export function isComposerThreadRunning(input: {
  isComposingNewThread: boolean;
  selectedThreadId?: string;
  activeThreadRequestIds: Readonly<Record<string, string>>;
}): boolean {
  if (input.isComposingNewThread || !input.selectedThreadId) return false;
  return Boolean(input.activeThreadRequestIds[input.selectedThreadId]);
}

/**
 * Live stream / activity request for the selected thread only.
 * Never fall back to another thread's in-flight request — that bleeds
 * running-tab UI (thinking, approvals, tool cards) into the selected thread.
 */
export function resolveActiveReasoningRequestId(input: {
  selectedThreadId?: string;
  activeThreadRequestIds: Readonly<Record<string, string>>;
}): string {
  const threadId = input.selectedThreadId?.trim();
  if (!threadId) return "";
  return String(input.activeThreadRequestIds[threadId] || "");
}

type DisplayMessage = {
  id: string;
  role: string;
  createdAt?: string;
  excludeFromModelContext?: boolean;
};

function hasCanonicalAssistantForOptimisticStub(
  canonical: DisplayMessage[],
  optimisticCreatedAt: string | undefined
): boolean {
  const startedAt = Date.parse(optimisticCreatedAt ?? "") || 0;
  return canonical.some((message) => {
    if (message.role !== "assistant" || message.excludeFromModelContext) return false;
    if (String(message.id || "").startsWith("local-assistant-")) return false;
    const createdAt = Date.parse(message.createdAt ?? "") || 0;
    // Durable success lands at/after the streaming stub started; ignore older turns.
    return createdAt >= startedAt - 1_000;
  });
}

type DisplayMessageWithProgress = DisplayMessage & {
  content?: string;
  reasoningSummary?: string;
};

function preferLongerText(left: string | undefined, right: string | undefined) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  return a.length >= b.length ? a : b;
}

/** Prefer in-memory streamed progress when durable snapshot still has an empty stub. */
export function mergeDisplayMessageProgress<T extends DisplayMessageWithProgress>(
  local: T,
  canonical: T
): T {
  const content = preferLongerText(local.content, canonical.content);
  const reasoningSummary = preferLongerText(local.reasoningSummary, canonical.reasoningSummary);
  const excludeFromModelContext = Boolean(local.excludeFromModelContext || canonical.excludeFromModelContext);
  const next = { ...canonical, content };
  if (reasoningSummary) next.reasoningSummary = reasoningSummary;
  else delete next.reasoningSummary;
  if (excludeFromModelContext) next.excludeFromModelContext = true;
  else delete next.excludeFromModelContext;
  return next;
}

export function reconcileThreadDisplayMessages<T extends DisplayMessageWithProgress>(
  current: T[],
  canonical: T[]
): T[] {
  const currentById = new Map(current.map((message) => [message.id, message]));
  let mergedCanonical = canonical.map((message) => {
    const local = currentById.get(message.id);
    if (!local) return message;
    const localHasRicherProgress =
      String(local.content ?? "").length > String(message.content ?? "").length
      || String(local.reasoningSummary ?? "").length > String(message.reasoningSummary ?? "").length
      || Boolean(local.excludeFromModelContext && !message.excludeFromModelContext);
    return localHasRicherProgress ? mergeDisplayMessageProgress(local, message) : message;
  });
  const canonicalIds = new Set(mergedCanonical.map((message) => message.id));
  const canonicalLatestTime = mergedCanonical.reduce(
    (latest, message) => Math.max(latest, Date.parse(message.createdAt ?? "") || 0),
    0
  );
  // A freshly created thread can persist its synthetic summary a few milliseconds
  // after the optimistic user message. Keep recent local messages across that
  // activation snapshot until the canonical message event catches up.
  const optimisticGraceBoundary = canonicalLatestTime - 60_000;
  const optimisticTail = current.filter((message) => {
    if (canonicalIds.has(message.id)) return false;
    if (!(message.id.startsWith("local-user-") || message.id.startsWith("local-assistant-"))) return false;
    if ((Date.parse(message.createdAt ?? "") || 0) < optimisticGraceBoundary) return false;
    // Streaming stubs keep a local-assistant-* id; success persists assistant-turn-*.
    // Drop the stub once the durable assistant arrives or UI will render the answer twice.
    if (
      message.id.startsWith("local-assistant-")
      && !message.excludeFromModelContext
      && hasCanonicalAssistantForOptimisticStub(mergedCanonical, message.createdAt)
    ) {
      return false;
    }
    return true;
  });
  // When a durable assistant-turn replaces a richer local-assistant stub, fold the
  // streamed body/error summary into the durable row instead of discarding it.
  const droppedLocalAssistants = current.filter((message) =>
    message.id.startsWith("local-assistant-")
    && !canonicalIds.has(message.id)
    && !optimisticTail.includes(message)
  );
  if (droppedLocalAssistants.length) {
    mergedCanonical = mergedCanonical.map((message) => {
      if (message.role !== "assistant") return message;
      if (String(message.id || "").startsWith("local-assistant-")) return message;
      const local = droppedLocalAssistants.find((candidate) => {
        const startedAt = Date.parse(candidate.createdAt ?? "") || 0;
        const createdAt = Date.parse(message.createdAt ?? "") || 0;
        return createdAt >= startedAt - 1_000;
      });
      if (!local) return message;
      const localHasRicherProgress =
        String(local.content ?? "").length > String(message.content ?? "").length
        || String(local.reasoningSummary ?? "").length > String(message.reasoningSummary ?? "").length
        || Boolean(local.excludeFromModelContext && !message.excludeFromModelContext);
      return localHasRicherProgress ? mergeDisplayMessageProgress(local, message) : message;
    });
  }
  return [...mergedCanonical, ...optimisticTail];
}

type TurnEvent = {
  type: string;
  turnId?: string;
  payload?: Record<string, unknown>;
};

type TurnActivity = {
  turnId?: string;
};

export function groupActivitiesByUserMessage<T extends TurnActivity>(
  events: TurnEvent[],
  activities: T[]
): Map<string, T[]> {
  const messageByTurn = new Map<string, string>();
  for (const event of events) {
    if (
      event.type === "message"
      && event.turnId
      && event.payload?.role === "user"
      && typeof event.payload.messageId === "string"
    ) {
      messageByTurn.set(event.turnId, event.payload.messageId);
    }
  }
  const grouped = new Map<string, T[]>();
  for (const activity of activities) {
    if (!activity.turnId) continue;
    const messageId = messageByTurn.get(activity.turnId);
    if (!messageId) continue;
    grouped.set(messageId, [...(grouped.get(messageId) ?? []), activity]);
  }
  return grouped;
}
