import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const claimedItem = {
  schemaVersion: 1 as const,
  id: "wi_1",
  source: "desktop",
  objective: "Run tests",
  status: "DISPATCHED" as const,
  targetDeviceId: "device_1",
  knowledgeSnapshotId: "ks_1",
  executionPolicyVersion: "execution-v1",
  learningPolicyVersion: "learning-v1",
  versionNo: 1,
  dispatchAttemptCount: 1,
  leaseUntil: "2026-07-22T00:02:00.000Z",
  cancelRequested: false,
  createdAt: "2026-07-22T00:00:00.000Z",
  updatedAt: "2026-07-22T00:00:00.000Z"
};

async function fixture(execute: (input: any) => Promise<void>) {
  const [{ CodexStorage }, { HolonWorkItemService }, { HolonRuntimeProjector }] = await Promise.all([
    import(new URL("./codex-storage.ts", import.meta.url).href) as Promise<typeof import("./codex-storage.js")>,
    import(new URL("./holon-work-item-service.ts", import.meta.url).href) as Promise<
      typeof import("./holon-work-item-service.js")
    >,
    import(new URL("./holon-runtime-projector.ts", import.meta.url).href) as Promise<
      typeof import("./holon-runtime-projector.js")
    >
  ]);
  const root = mkdtempSync(join(tmpdir(), "newbrain-holon-work-"));
  const storage = new CodexStorage(root);
  const intervalCallbacks: Array<() => void> = [];
  const intervalDelays: number[] = [];
  const client = {
    claimNextWorkItem: async () => claimedItem,
    getKnowledgeSnapshot: async () => ({
      schemaVersion: 1 as const, id: "ks_1", generation: 1, status: "READY" as const,
      itemCount: 0, contentHash: "abc", createdAt: "2026-07-22T00:00:00.000Z", items: []
    }),
    heartbeat: async () => ({ workItemId: "wi_1", leaseUntil: "2026-07-22T00:04:00.000Z" }),
    getControl: async () => ({ status: "RUNNING", cancel_requested: false })
  };
  const projector = new HolonRuntimeProjector({
    storage,
    createId: (prefix, sequence) => `${prefix}_${sequence}`,
    nowIso: () => "2026-07-22T00:00:00.000Z",
    nowMs: () => 100
  });
  const service = new HolonWorkItemService({
    storage,
    client,
    projector,
    execute,
    now: () => Date.parse("2026-07-22T00:00:00.000Z"),
    setInterval: (callback: () => void, delayMs: number) => {
      intervalCallbacks.push(callback);
      intervalDelays.push(delayMs);
      return callback;
    },
    clearInterval: () => undefined
  });
  return { root, storage, service, client, intervalCallbacks, intervalDelays };
}

test("maps the immutable execution policy version to a bounded local tool allowlist", async () => {
  const { resolveRemoteAllowedToolNames } = await import(
    new URL("./holon-work-item-service.ts", import.meta.url).href
  ) as typeof import("./holon-work-item-service.js");
  assert.deepEqual(resolveRemoteAllowedToolNames("execution-v1"), ["workspace.scan", "shell.exec"]);
  assert.throws(() => resolveRemoteAllowedToolNames("execution-unknown"), /HOLON_EXECUTION_POLICY_UNSUPPORTED/);
});

function cleanup(root: string) {
  try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 }); } catch { /* WAL closes at exit. */ }
}

test("claim persists and displays a WorkItem without executing it", async () => {
  let executions = 0;
  const value = await fixture(async () => { executions += 1; });
  try {
    const state = await value.service.claimNext();
    assert.equal(state?.workItem.id, "wi_1");
    assert.equal(state?.status, "claimed");
    assert.deepEqual(state?.effectiveToolNames, ["workspace.scan", "shell.exec"]);
    assert.equal(executions, 0);
    assert.equal(value.storage.getRemoteWorkItem("wi_1")?.status, "claimed");
  } finally {
    value.storage.close();
    cleanup(value.root);
  }
});

test("explicit start executes once and persists terminal evidence", async () => {
  let executions = 0;
  const value = await fixture(async ({ onEvent }) => {
    executions += 1;
    onEvent({ type: "agent_loop_started", payload: {} });
    onEvent({ type: "agent_loop_completed", payload: { step: 2 } });
  });
  try {
    await value.service.claimNext();
    const result = await value.service.start("wi_1", "thread_1", "turn_1");
    assert.equal(result.status, "completed");
    assert.equal(executions, 1);
    assert.equal(value.storage.getRemoteWorkItem("wi_1")?.status, "completed");
    assert.deepEqual(value.storage.listDueRemoteEvents(100, 100).map((row) => row.sequenceNo), [0, 1]);
    await assert.rejects(() => value.service.start("wi_1", "thread_1", "turn_2"), /HOLON_WORK_NOT_STARTABLE/);
  } finally {
    value.storage.close();
    cleanup(value.root);
  }
});

test("schedules lease maintenance before half of the two-minute lease", async () => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const value = await fixture(async () => waiting);
  try {
    await value.service.claimNext();
    const running = value.service.start("wi_1", "thread_1", "turn_1");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(value.intervalDelays, [45_000]);
    release();
    await running;
  } finally {
    value.storage.close();
    cleanup(value.root);
  }
});

test("heartbeat control cancellation aborts the active execution", async () => {
  let resolveStarted!: () => void;
  const started = new Promise<void>((resolve) => { resolveStarted = resolve; });
  const value = await fixture(async ({ signal, onEvent }) => {
    onEvent({ type: "agent_loop_started", payload: {} });
    resolveStarted();
    await new Promise<void>((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  value.client.getControl = async () => ({ status: "RUNNING", cancel_requested: true });
  try {
    await value.service.claimNext();
    const running = value.service.start("wi_1", "thread_1", "turn_1");
    await started;
    await value.intervalCallbacks[0]?.();
    const result = await running;
    assert.equal(result.status, "cancelled");
    assert.equal(value.storage.getRemoteWorkItem("wi_1")?.status, "cancelled");
  } finally {
    value.storage.close();
    cleanup(value.root);
  }
});

test("persists waiting approval and resumes running before completion", async () => {
  let release!: () => void;
  let requested!: () => void;
  const approvalRequested = new Promise<void>((resolve) => { requested = resolve; });
  const approvalResolved = new Promise<void>((resolve) => { release = resolve; });
  const value = await fixture(async ({ onEvent }) => {
    onEvent({ type: "agent_loop_started", payload: {} });
    onEvent({ type: "approval_requested", payload: { call: { id: "call_1", name: "shell" } } });
    requested();
    await approvalResolved;
    onEvent({ type: "approval_resolved", payload: { call: { id: "call_1", name: "shell" }, approved: true } });
  });
  try {
    await value.service.claimNext();
    const running = value.service.start("wi_1", "thread_1", "turn_1");
    await approvalRequested;
    assert.equal(value.storage.getRemoteWorkItem("wi_1")?.status, "waiting_approval");
    release();
    const result = await running;
    assert.equal(result.status, "completed");
  } finally {
    value.storage.close();
    cleanup(value.root);
  }
});

test("persists terminal state before appending terminal evidence", async () => {
  const value = await fixture(async ({ onEvent }) => {
    onEvent({ type: "agent_loop_started", payload: {} });
    onEvent({ type: "agent_loop_completed", payload: { step: 1 } });
  });
  const originalAppend = value.storage.appendRemoteEvent.bind(value.storage);
  let statusAtTerminalAppend = "";
  value.storage.appendRemoteEvent = ((event: any) => {
    if (JSON.parse(event.payloadJson).eventType === "work_item.completed") {
      statusAtTerminalAppend = value.storage.getRemoteWorkItem("wi_1")?.status ?? "";
    }
    originalAppend(event);
  }) as typeof value.storage.appendRemoteEvent;
  try {
    await value.service.claimNext();
    await value.service.start("wi_1", "thread_1", "turn_1");
    assert.equal(statusAtTerminalAppend, "completed");
  } finally {
    value.storage.close();
    cleanup(value.root);
  }
});

test("requires explicit resume or discard for an interrupted WorkItem", async () => {
  let executions = 0;
  const value = await fixture(async ({ onEvent }) => {
    executions += 1;
    onEvent({ type: "agent_loop_completed", payload: {} });
  });
  try {
    await value.service.claimNext();
    assert.equal(value.storage.updateRemoteWorkItemStatus("wi_1", "claimed", "running"), true);
    value.storage.recoverRemoteExecutionState(200);
    assert.equal((await value.service.claimNext())?.status, "interrupted");
    assert.equal(executions, 0);
    const resumed = await value.service.start("wi_1", "thread_1", "turn_resume");
    assert.equal(resumed.status, "completed");
    assert.equal(executions, 1);
  } finally {
    value.storage.close();
    cleanup(value.root);
  }
});

test("discarding a claimed WorkItem persists cancellation before terminal evidence", async () => {
  const value = await fixture(async () => undefined);
  const originalAppend = value.storage.appendRemoteEvent.bind(value.storage);
  let statusAtTerminalAppend = "";
  value.storage.appendRemoteEvent = ((event: any) => {
    if (JSON.parse(event.payloadJson).eventType === "work_item.cancelled") {
      statusAtTerminalAppend = value.storage.getRemoteWorkItem("wi_1")?.status ?? "";
    }
    originalAppend(event);
  }) as typeof value.storage.appendRemoteEvent;
  try {
    await value.service.claimNext();
    const discarded = value.service.cancel("wi_1", "USER_DISCARDED");
    assert.equal(discarded.status, "cancelled");
    assert.equal(discarded.lastError, "USER_DISCARDED");
    assert.equal(statusAtTerminalAppend, "cancelled");
    assert.deepEqual(value.storage.listDueRemoteEvents(100, 100).map((row) =>
      JSON.parse(row.payloadJson).eventType), ["work_item.cancelled"]);
  } finally {
    value.storage.close();
    cleanup(value.root);
  }
});

test("cancelling active work aborts execution and uses the regular terminal path", async () => {
  let resolveStarted!: () => void;
  const started = new Promise<void>((resolve) => { resolveStarted = resolve; });
  const value = await fixture(async ({ signal }) => {
    resolveStarted();
    await new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  try {
    await value.service.claimNext();
    const running = value.service.start("wi_1", "thread_1", "turn_1");
    await started;
    assert.equal(value.service.cancel("wi_1", "USER_CANCELLED").status, "running");
    assert.equal((await running).status, "cancelled");
  } finally {
    value.storage.close();
    cleanup(value.root);
  }
});
