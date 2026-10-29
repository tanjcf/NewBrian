/**
 * Messages submitted while a turn is running (Cursor / Codex style queue).
 * The queue is one ordered list across threads; each thread drains its own
 * items first-in-first-out, one item per finished turn.
 */
export type ComposerQueueItem = {
  id?: string;
  threadId?: string;
  question?: string;
  createdAt?: string;
};

function createComposerQueueId() {
  return `queued-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function enqueueComposerDraft<T extends ComposerQueueItem>(queue: readonly T[], draft: T): T[] {
  return [...queue, draft.id ? draft : { ...draft, id: createComposerQueueId() }];
}

export function composerQueueForThread<T extends ComposerQueueItem>(
  queue: readonly T[],
  threadId: string | null | undefined
): T[] {
  const id = String(threadId || "").trim();
  return id ? queue.filter((item) => item.threadId === id) : [];
}

export function removeComposerQueueItem<T extends ComposerQueueItem>(queue: readonly T[], itemId: string | undefined): T[] {
  return itemId ? queue.filter((item) => item.id !== itemId) : [...queue];
}

/** Put an item back as the next one its thread will send. */
export function requeueComposerItemFirst<T extends ComposerQueueItem>(queue: readonly T[], item: T): T[] {
  return [item, ...removeComposerQueueItem(queue, item.id)];
}

export function takeNextComposerQueueItem<T extends ComposerQueueItem>(
  queue: readonly T[],
  threadId: string | null | undefined
): { next: T | null; rest: T[] } {
  const next = composerQueueForThread(queue, threadId)[0] ?? null;
  return { next, rest: next ? queue.filter((item) => item !== next) : [...queue] };
}
