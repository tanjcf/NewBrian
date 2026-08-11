import assert from "node:assert/strict";
import test from "node:test";

const { ThreadRolloutRecoveryService } = await import(
  new URL("./thread-rollout-recovery-service.ts", import.meta.url).href
);

test("recovers a missing index from the richest canonical snapshot", async () => {
  const indexed: Array<{ id: string; title: string; preview: string }> = [];
  const service = new ThreadRolloutRecoveryService({
    getThreadsDirectory: () => "threads",
    getRolloutPath: (_workspaceId: string, threadId: string) => `${threadId}.rollout.jsonl`,
    listFiles: async () => [{ name: "thread-1.rollout.jsonl", isFile: () => true }],
    readRecords: async () => [
      { record_type: "state_snapshot", state: { messages: [{ role: "user", content: "Question" }, { role: "assistant", content: "Complete answer" }] } },
      { record_type: "state_snapshot", state: { messages: [{ role: "user", content: "Question" }] } }
    ],
    stat: async () => ({ mtimeMs: 20, birthtimeMs: 10 }),
    listKnownThreadIds: () => [],
    upsertThread: (input: { id: string; title: string; preview: string }) => { indexed.push(input); },
    appendDebugLog: async () => undefined,
    nowMs: () => 30
  } as never);
  await service.recover({ id: "workspace", path: "G:/repo" } as never);
  assert.equal(indexed[0].id, "thread-1");
  assert.equal(indexed[0].title, "Question");
  assert.equal(indexed[0].preview, "Complete answer");
});

test("does not invent an index for a rollout without a user or assistant message", async () => {
  const indexed: unknown[] = [];
  const service = new ThreadRolloutRecoveryService({
    getThreadsDirectory: () => "threads",
    getRolloutPath: () => "thread.rollout.jsonl",
    listFiles: async () => [{ name: "thread.rollout.jsonl", isFile: () => true }],
    readRecords: async () => [{ record_type: "state_snapshot", state: { messages: [{ role: "system", content: "system" }] } }],
    stat: async () => ({ mtimeMs: 20, birthtimeMs: 10 }),
    listKnownThreadIds: () => [],
    upsertThread: (input: unknown) => { indexed.push(input); },
    appendDebugLog: async () => undefined,
    nowMs: () => 30
  } as never);
  await service.recover({ id: "workspace", path: "G:/repo" } as never);
  assert.equal(indexed.length, 0);
});
