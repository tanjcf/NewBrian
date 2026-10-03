import { isApprovalWaitNotice, stripApprovalWaitNotice } from "../../shared/approval-wait-notice.ts";

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

/**
 * Process-global snapshot.approval must only drive UI for the thread that
 * still has an in-flight request. Catalog `awaiting-approval` alone is sticky
 * across restarts/scenes and must not let the focused thread steal another
 * thread's approval banner or sidebar highlight.
 */
export function resolveSelectedThreadOwnsLiveApproval(input: {
  selectedThreadId?: string;
  activeThreadRequestIds: Readonly<Record<string, string>>;
  selectedThreadAwaitingApproval?: boolean;
}): boolean {
  const threadId = input.selectedThreadId?.trim();
  if (!threadId) return false;
  return Boolean(input.activeThreadRequestIds[threadId]);
}

/**
 * Sidebar / project-list "等待批准" highlight for the focused thread only when
 * that same thread owns the live approval. A foreign snapshot.approval must
 * not paint the currently selected thread.
 */
export function resolvePendingApprovalThreadKey(input: {
  workspaceId?: string;
  threadId?: string;
  snapshotHasApproval: boolean;
  selectedThreadOwnsLiveApproval: boolean;
}): string {
  const workspaceId = input.workspaceId?.trim();
  const threadId = input.threadId?.trim();
  if (!workspaceId || !threadId) return "";
  if (!input.snapshotHasApproval || !input.selectedThreadOwnsLiveApproval) return "";
  return `${workspaceId}:${threadId}`;
}

/**
 * Sidebar "等待批准" after the user already approved or rejected.
 * Catalog status and a replayed snapshot of the same approval id stay sticky
 * while the tool resume is still running; a different approval id may show.
 */
export function threadStillNeedsApproval(input: {
  threadStatus?: string;
  threadKey: string;
  pendingApprovalThreadKey: string;
  threadId?: string;
  settledApprovalId?: string;
  settledThreadId?: string;
  snapshotApprovalId?: string;
}): boolean {
  const catalogPending = input.threadStatus === "awaiting-approval";
  const livePending = Boolean(input.pendingApprovalThreadKey) && input.threadKey === input.pendingApprovalThreadKey;
  if (!catalogPending && !livePending) return false;
  const settledApprovalId = input.settledApprovalId?.trim() || "";
  const settledThreadId = input.settledThreadId?.trim() || "";
  if (settledApprovalId && settledThreadId && input.threadId === settledThreadId) {
    const snapshotApprovalId = input.snapshotApprovalId?.trim() || "";
    if (!snapshotApprovalId || snapshotApprovalId === settledApprovalId) return false;
  }
  return true;
}

type DisplayMessage = {
  id: string;
  role: string;
  createdAt?: string;
  excludeFromModelContext?: boolean;
};

function findPrecedingUserMessage<T extends { id: string; role: string }>(
  messages: T[],
  messageId: string
): T | undefined {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index <= 0) return undefined;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return messages[i];
  }
  return undefined;
}

function findDurableAssistantForUserTurn<T extends DisplayMessage>(
  canonical: T[],
  userMessageId: string | undefined
): T | undefined {
  if (!userMessageId) return undefined;
  const userIndex = canonical.findIndex((message) => message.id === userMessageId);
  if (userIndex < 0) return undefined;
  for (let i = userIndex + 1; i < canonical.length; i += 1) {
    const message = canonical[i];
    if (message.role === "user") return undefined;
    if (
      message.role === "assistant"
      && !message.excludeFromModelContext
      && !String(message.id || "").startsWith("local-assistant-")
    ) {
      return message;
    }
  }
  return undefined;
}

function hasCanonicalAssistantForOptimisticStub<T extends DisplayMessage>(
  canonical: T[],
  current: T[],
  stub: T
): boolean {
  const precedingUser = findPrecedingUserMessage(current, stub.id);
  if (!precedingUser) return false;
  return Boolean(findDurableAssistantForUserTurn(canonical, precedingUser.id));
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

/** A finished answer replaces the approval-wait notice even when the notice is longer. */
function preferAnswerOverApprovalNotice(left: string | undefined, right: string | undefined) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  const aBody = stripApprovalWaitNotice(a);
  const bBody = stripApprovalWaitNotice(b);
  const aIsOnlyNotice = isApprovalWaitNotice(a) && !aBody;
  const bIsOnlyNotice = isApprovalWaitNotice(b) && !bBody;
  if (aIsOnlyNotice && bBody) return b;
  if (bIsOnlyNotice && aBody) return a;
  return preferLongerText(a, b);
}

/** Resolve the assistant row owned by one user turn — never scan by timestamp. */
export function resolveTurnAssistantMessageId<T extends DisplayMessage>(
  messages: T[],
  input: {
    streamRequestId: string;
    userMessageId: string;
  }
): string | undefined {
  const streamRequestId = input.streamRequestId.trim();
  const userMessageId = input.userMessageId.trim();
  if (messages.some((message) => message.id === streamRequestId)) return streamRequestId;
  const durable = findDurableAssistantForUserTurn(messages, userMessageId);
  if (durable) return durable.id;
  return undefined;
}

/**
 * Patch only the current turn's assistant row when merging a runtime snapshot.
 * Never rewrite the previous turn's assistant when the durable row for this turn
 * has not landed yet.
 */
export function patchRuntimeSnapshotMessagesForTurn<T extends DisplayMessageWithProgress>(input: {
  snapshotMessages: T[];
  currentMessages: T[];
  streamRequestId: string;
  userMessageId: string;
  finalContent: string;
  reasoningSummary?: string;
}): T[] {
  const messages = [...input.snapshotMessages];
  const targetId = resolveTurnAssistantMessageId(input.currentMessages, {
    streamRequestId: input.streamRequestId,
    userMessageId: input.userMessageId
  }) ?? resolveTurnAssistantMessageId(messages, {
    streamRequestId: input.streamRequestId,
    userMessageId: input.userMessageId
  });
  if (targetId) {
    const index = messages.findIndex((message) => message.id === targetId);
    if (index >= 0) {
      messages[index] = {
        ...messages[index],
        content: input.finalContent,
        reasoningSummary: input.reasoningSummary || messages[index].reasoningSummary
      };
      return messages;
    }
  }
  messages.push({
    id: input.streamRequestId,
    role: "assistant",
    content: input.finalContent,
    reasoningSummary: input.reasoningSummary || "",
    createdAt: new Date().toISOString()
  } as T);
  return messages;
}

/** Prefer in-memory streamed progress when durable snapshot still has an empty stub. */
export function mergeDisplayMessageProgress<T extends DisplayMessageWithProgress>(
  local: T,
  canonical: T
): T {
  const content = preferAnswerOverApprovalNotice(local.content, canonical.content);
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
    // Drop the stub only when THIS turn's durable assistant arrives — never because
    // an older turn's assistant is still within a 1s time window.
    if (
      message.id.startsWith("local-assistant-")
      && !message.excludeFromModelContext
      && hasCanonicalAssistantForOptimisticStub(mergedCanonical, current, message)
    ) {
      return false;
    }
    return true;
  });
  // When a durable assistant-turn replaces a richer local-assistant stub, fold the
  // streamed body/error summary into that turn's durable row only.
  const droppedLocalAssistants = current.filter((message) =>
    message.id.startsWith("local-assistant-")
    && !canonicalIds.has(message.id)
    && !optimisticTail.includes(message)
  );
  if (droppedLocalAssistants.length) {
    const foldByDurableId = new Map<string, T>();
    for (const local of droppedLocalAssistants) {
      const precedingUser = findPrecedingUserMessage(current, local.id);
      const durable = findDurableAssistantForUserTurn(mergedCanonical, precedingUser?.id);
      if (!durable) continue;
      const existing = foldByDurableId.get(durable.id);
      if (
        !existing
        || String(local.content ?? "").length > String(existing.content ?? "").length
        || String(local.reasoningSummary ?? "").length > String(existing.reasoningSummary ?? "").length
      ) {
        foldByDurableId.set(durable.id, local);
      }
    }
    mergedCanonical = mergedCanonical.map((message) => {
      const local = foldByDurableId.get(message.id);
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
