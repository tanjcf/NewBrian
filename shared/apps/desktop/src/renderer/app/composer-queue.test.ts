import assert from "node:assert/strict";
import test from "node:test";

const {
  composerQueueForThread,
  enqueueComposerDraft,
  removeComposerQueueItem,
  requeueComposerItemFirst,
  takeNextComposerQueueItem
} = await import(
  new URL("./composer-queue.ts", import.meta.url).href
) as typeof import("./composer-queue.js");

type Draft = { id?: string; threadId: string; question: string };

test("queueing a second message keeps the first instead of overwriting it", () => {
  const queue = enqueueComposerDraft(enqueueComposerDraft<Draft>([], { threadId: "a", question: "first" }), { threadId: "a", question: "second" });
  assert.deepEqual(queue.map((item) => item.question), ["first", "second"]);
  assert.ok(queue.every((item) => item.id));
  assert.notEqual(queue[0].id, queue[1].id);
});

test("each thread drains its own items first-in-first-out", () => {
  let queue = enqueueComposerDraft([], { threadId: "a", question: "a1" });
  queue = enqueueComposerDraft(queue, { threadId: "b", question: "b1" });
  queue = enqueueComposerDraft(queue, { threadId: "a", question: "a2" });
  assert.deepEqual(composerQueueForThread(queue, "a").map((item) => item.question), ["a1", "a2"]);
  const first = takeNextComposerQueueItem(queue, "a");
  assert.equal(first.next?.question, "a1");
  assert.deepEqual(first.rest.map((item) => item.question), ["b1", "a2"]);
  const second = takeNextComposerQueueItem(first.rest, "a");
  assert.equal(second.next?.question, "a2");
  assert.equal(takeNextComposerQueueItem(second.rest, "a").next, null);
});

test("an unselected thread shows no queued items", () => {
  const queue = enqueueComposerDraft([], { threadId: "a", question: "a1" });
  assert.deepEqual(composerQueueForThread(queue, ""), []);
  assert.deepEqual(composerQueueForThread(queue, undefined), []);
});

test("a failed send-now puts the item back at the front of its thread", () => {
  let queue = enqueueComposerDraft<Draft>([], { threadId: "a", question: "a1" });
  queue = enqueueComposerDraft(queue, { threadId: "a", question: "a2" });
  const item = queue[1];
  const withoutItem = removeComposerQueueItem(queue, item.id);
  assert.deepEqual(withoutItem.map((entry) => entry.question), ["a1"]);
  const restored = requeueComposerItemFirst(withoutItem, item);
  assert.deepEqual(composerQueueForThread(restored, "a").map((entry) => entry.question), ["a2", "a1"]);
});
