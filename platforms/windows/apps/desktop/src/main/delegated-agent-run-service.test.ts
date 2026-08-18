import assert from "node:assert/strict";
import test from "node:test";

const { DelegatedAgentRunService } = await import(new URL("./delegated-agent-run-service.ts", import.meta.url).href);

function fixture(status = "queued") {
  const transitions: string[] = [];
  const task = { id: "task", childThreadId: "child", instruction: "verify", status, summary: "done" };
  const workspace = { id: "workspace", threads: [{ id: "child" }] };
  const service = new DelegatedAgentRunService({
    listTasks: () => [task],
    readCatalog: async () => ({ workspaces: [workspace] }),
    updateSpawnStatus: (_child: string, next: string) => { transitions.push(`spawn:${next}`); },
    updateMetadata: async (input: { status: string }) => { transitions.push(`thread:${input.status}`); },
    runTask: async (_id: string, execute: (task: unknown) => Promise<unknown>) => {
      await execute(task);
      return { ...task, status: "completed" };
    },
    persistTask: () => { transitions.push("persist"); }
  } as never);
  return { service, transitions };
}

test("publishes one durable running-to-completed lifecycle", async () => {
  const { service, transitions } = fixture();
  await service.run({ workspaceId: "workspace", childThreadId: "child" }, async () => ({ content: "result" }));
  assert.deepEqual(transitions, ["spawn:running", "thread:running", "persist", "spawn:completed", "thread:idle"]);
});

test("rejects a terminal task before mutating durable state", async () => {
  const { service, transitions } = fixture("completed");
  await assert.rejects(
    service.run({ workspaceId: "workspace", childThreadId: "child" }, async () => ({ content: "result" })),
    /cannot start/
  );
  assert.deepEqual(transitions, []);
});

test("does not replay a stale running task after volatile control state is lost", async () => {
  const { service, transitions } = fixture("running");
  await assert.rejects(
    service.run({ workspaceId: "workspace", childThreadId: "child" }, async () => ({ content: "result" })),
    /cannot start from status running/
  );
  assert.deepEqual(transitions, []);
});
