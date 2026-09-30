import assert from "node:assert/strict";
import test from "node:test";

const { restoreStartupThreadSnapshot } = await import(
  new URL("./startup-thread-restore.ts", import.meta.url).href
);

test("activates the restored thread and syncs its canonical snapshot during startup", async () => {
  const calls: unknown[] = [];
  const snapshot = { messages: [{ id: "latest", role: "user", content: "latest turn" }] };

  const result = await restoreStartupThreadSnapshot({
    api: {
      activateWorkspaceThread: async (input: unknown) => {
        calls.push(input);
        return snapshot;
      }
    },
    workspaceId: "workspace-1",
    threadId: "thread-1",
    syncSnapshot: (nextSnapshot: unknown, threadId: string) => {
      calls.push({ nextSnapshot, threadId });
    }
  });

  assert.equal(result, snapshot);
  assert.deepEqual(calls, [
    { workspaceId: "workspace-1", threadId: "thread-1" },
    { nextSnapshot: snapshot, threadId: "thread-1" }
  ]);
});
