import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const storageModule = import(new URL("./codex-storage.ts", import.meta.url).href) as Promise<
  typeof import("./codex-storage.js")
>;

function cleanup(root: string) {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  } catch (error: any) {
    if (process.platform !== "win32" || error?.code !== "EPERM") throw error;
  }
}

test("persists a remote WorkItem and allocates monotonic event sequences", async () => {
  const { CodexStorage } = await storageModule;
  const root = mkdtempSync(join(tmpdir(), "newbrain-holon-storage-"));
  const storage = new CodexStorage(root);
  try {
    storage.upsertRemoteWorkItem({
      id: "wi_1",
      status: "claimed",
      objective: "Run tests",
      source: "desktop",
      targetDeviceId: "device_1",
      knowledgeSnapshotId: "ks_1",
      payloadJson: "{}",
      claimedAtMs: 100,
      leaseUntilMs: 10_000,
      lastError: ""
    });

    assert.equal(storage.getRemoteWorkItem("wi_1")?.knowledgeSnapshotId, "ks_1");
    assert.equal(storage.nextRemoteEventSequence("wi_1"), 0);
    storage.appendRemoteEvent({
      eventId: "evt_1",
      workItemId: "wi_1",
      sequenceNo: 0,
      payloadJson: "{\"event_id\":\"evt_1\"}",
      status: "pending",
      attemptCount: 0,
      nextAttemptAtMs: 100,
      createdAtMs: 100
    });
    assert.equal(storage.nextRemoteEventSequence("wi_1"), 1);
    assert.throws(() => storage.appendRemoteEvent({
      eventId: "evt_2",
      workItemId: "wi_1",
      sequenceNo: 0,
      payloadJson: "{}",
      status: "pending",
      attemptCount: 0,
      nextAttemptAtMs: 100,
      createdAtMs: 100
    }));
  } finally {
    storage.close();
    cleanup(root);
  }
});

test("acknowledged events are not replayed after restart", async () => {
  const { CodexStorage } = await storageModule;
  const root = mkdtempSync(join(tmpdir(), "newbrain-holon-ack-"));
  try {
    let storage = new CodexStorage(root);
    storage.upsertRemoteWorkItem({
      id: "wi_1", status: "running", objective: "Run tests", source: "desktop",
      targetDeviceId: "device_1", payloadJson: "{}", claimedAtMs: 100,
      leaseUntilMs: 10_000, lastError: ""
    });
    storage.appendRemoteEvent({
      eventId: "evt_1", workItemId: "wi_1", sequenceNo: 0,
      payloadJson: "{}", status: "pending", attemptCount: 0,
      nextAttemptAtMs: 100, createdAtMs: 100
    });
    storage.acknowledgeRemoteEvents(["evt_1"], 200);
    storage.close();

    storage = new CodexStorage(root);
    storage.recoverRemoteExecutionState(300);
    assert.equal(storage.getRemoteWorkItem("wi_1")?.status, "interrupted");
    assert.equal(storage.listDueRemoteEvents(100, 300).length, 0);
    storage.close();
  } finally {
    cleanup(root);
  }
});

test("recovers sending rows for retry without duplicating their identity", async () => {
  const { CodexStorage } = await storageModule;
  const root = mkdtempSync(join(tmpdir(), "newbrain-holon-retry-"));
  const storage = new CodexStorage(root);
  try {
    storage.appendRemoteEvent({
      eventId: "evt_1", workItemId: "wi_1", sequenceNo: 0,
      payloadJson: "{}", status: "sending", attemptCount: 1,
      nextAttemptAtMs: 100, createdAtMs: 100
    });
    storage.recoverRemoteExecutionState(300);
    const due = storage.listDueRemoteEvents(100, 300);
    assert.deepEqual(due.map((event) => event.eventId), ["evt_1"]);
    assert.equal(due[0]?.status, "pending");
  } finally {
    storage.close();
    cleanup(root);
  }
});

test("uploads a bounded batch and acknowledges accepted or duplicate events", async () => {
  const [{ CodexStorage }, { HolonOutboxService }] = await Promise.all([
    storageModule,
    import(new URL("./holon-outbox-service.ts", import.meta.url).href) as Promise<
      typeof import("./holon-outbox-service.js")
    >
  ]);
  const root = mkdtempSync(join(tmpdir(), "newbrain-holon-send-"));
  const storage = new CodexStorage(root);
  try {
    for (let index = 0; index < 3; index += 1) {
      storage.appendRemoteEvent({
        eventId: `evt_${index}`, workItemId: "wi_1", sequenceNo: index,
        payloadJson: JSON.stringify({
          schemaVersion: 1,
          eventId: `evt_${index}`,
          workItemId: "wi_1",
          threadId: "thread_1",
          turnId: "turn_1",
          sequenceNo: index,
          eventType: index === 0 ? "work_item.started" : "tool.completed",
          occurredAt: "2026-07-22T00:00:00.000Z",
          payload: {}
        }), status: "pending",
        attemptCount: 0, nextAttemptAtMs: 100, createdAtMs: 100 + index
      });
    }
    const sent: unknown[][] = [];
    const service = new HolonOutboxService({
      storage,
      sendEvents: async (events) => {
        sent.push(events);
        return { ok: true, accepted: 2, duplicate: 1, total: 3 };
      },
      now: () => 200
    });

    const result = await service.flush();

    assert.deepEqual(result, { sent: 3, pending: 0 });
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.length, 3);
    assert.equal(storage.listDueRemoteEvents(100, 200).length, 0);
  } finally {
    storage.close();
    cleanup(root);
  }
});

test("returns failed sends to pending with bounded backoff", async () => {
  const [{ CodexStorage }, { HolonOutboxService }] = await Promise.all([
    storageModule,
    import(new URL("./holon-outbox-service.ts", import.meta.url).href) as Promise<
      typeof import("./holon-outbox-service.js")
    >
  ]);
  const root = mkdtempSync(join(tmpdir(), "newbrain-holon-send-fail-"));
  const storage = new CodexStorage(root);
  try {
    storage.appendRemoteEvent({
      eventId: "evt_1", workItemId: "wi_1", sequenceNo: 0, payloadJson: "{}",
      status: "pending", attemptCount: 0, nextAttemptAtMs: 100, createdAtMs: 100
    });
    const service = new HolonOutboxService({
      storage,
      sendEvents: async () => { throw new Error("offline"); },
      now: () => 200
    });

    const result = await service.flush();

    assert.deepEqual(result, { sent: 0, pending: 1 });
    assert.equal(storage.listDueRemoteEvents(100, 200).length, 0);
    assert.equal(storage.listDueRemoteEvents(100, 2_200)[0]?.attemptCount, 1);
  } finally {
    storage.close();
    cleanup(root);
  }
});

test("reports aggregate sync state without exposing event payloads", async () => {
  const { CodexStorage } = await storageModule;
  const root = mkdtempSync(join(tmpdir(), "newbrain-holon-sync-state-"));
  const storage = new CodexStorage(root);
  try {
    storage.appendRemoteEvent({
      eventId: "evt_pending", workItemId: "wi_1", sequenceNo: 0,
      payloadJson: JSON.stringify({ secret: "must-not-leak" }), status: "pending",
      attemptCount: 0, nextAttemptAtMs: 100, createdAtMs: 100
    });
    storage.appendRemoteEvent({
      eventId: "evt_acked", workItemId: "wi_1", sequenceNo: 1,
      payloadJson: "{}", status: "pending", attemptCount: 0,
      nextAttemptAtMs: 100, createdAtMs: 101
    });
    storage.acknowledgeRemoteEvents(["evt_acked"], 500);
    const status = storage.getRemoteEventSyncStatus();
    assert.deepEqual(status, {
      pendingEventCount: 1,
      sendingEventCount: 0,
      quarantinedEventCount: 0,
      lastAcknowledgedAtMs: 500,
      lastError: ""
    });
    assert.doesNotMatch(JSON.stringify(status), /must-not-leak|payload/);
  } finally {
    storage.close();
    cleanup(root);
  }
});

test("quarantines a conflicting batch instead of retrying it forever", async () => {
  const [{ CodexStorage }, { HolonOutboxService }] = await Promise.all([
    storageModule,
    import(new URL("./holon-outbox-service.ts", import.meta.url).href) as Promise<typeof import("./holon-outbox-service.js")>
  ]);
  const root = mkdtempSync(join(tmpdir(), "newbrain-holon-conflict-"));
  const storage = new CodexStorage(root);
  try {
    storage.appendRemoteEvent({
      eventId: "evt_conflict", workItemId: "wi_1", sequenceNo: 0,
      payloadJson: JSON.stringify({
        schemaVersion: 1, eventId: "evt_conflict", workItemId: "wi_1", sequenceNo: 0,
        eventType: "work_item.started", occurredAt: "2026-07-22T00:00:00.000Z", payload: {}
      }),
      status: "pending", attemptCount: 0, nextAttemptAtMs: 100, createdAtMs: 100
    });
    const service = new HolonOutboxService({
      storage,
      sendEvents: async () => { throw new Error("HOLON_HTTP_409:HOLON_EVENT_SEQUENCE_CONFLICT"); },
      now: () => 200
    });

    assert.deepEqual(await service.flush(), { sent: 0, pending: 0, quarantined: 1 });
    assert.equal(storage.listDueRemoteEvents(100, 999_999).length, 0);
    assert.equal(storage.getRemoteEventSyncStatus().quarantinedEventCount, 1);
  } finally {
    storage.close();
    cleanup(root);
  }
});
