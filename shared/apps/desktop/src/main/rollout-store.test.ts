import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const rolloutStore = import(new URL("./rollout-store.ts", import.meta.url).href) as Promise<
  typeof import("./rollout-store.js")
>;

test("serializes concurrent rollout appends without losing records", async () => {
  const { appendRolloutRecords, createRolloutEvent, readRolloutRecords } = await rolloutStore;
  const root = mkdtempSync(join(tmpdir(), "newbrain-rollout-"));
  const path = join(root, "thread.rollout.jsonl");
  try {
    await Promise.all(Array.from({ length: 24 }, (_, index) => appendRolloutRecords(path, [
      createRolloutEvent({ recordType: "event_msg", threadId: "thread-1", payload: { index } })
    ])));
    const records = await readRolloutRecords(path) as Array<{ payload: { index: number } }>;
    assert.equal(records.length, 24);
    assert.deepEqual(records.map((record) => record.payload.index).sort((a, b) => a - b),
      Array.from({ length: 24 }, (_, index) => index));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recovers the latest snapshot when the rollout has a truncated tail", async () => {
  const { appendRolloutRecords, createRolloutEvent, createStateSnapshot, readLatestStateSnapshot } = await rolloutStore;
  const root = mkdtempSync(join(tmpdir(), "newbrain-rollout-"));
  const path = join(root, "thread.rollout.jsonl");
  try {
    await appendRolloutRecords(path, [
      createStateSnapshot({ threadId: "thread-1", state: { version: 1, value: "old" } }),
      createRolloutEvent({ recordType: "message", threadId: "thread-1", payload: { text: "hello" } }),
      createStateSnapshot({ threadId: "thread-1", state: { version: 1, value: "latest" } })
    ]);
    appendFileSync(path, "{\"record_type\":\"message\"", "utf8");
    assert.deepEqual(await readLatestStateSnapshot(path), { version: 1, value: "latest" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reads the latest snapshot from a multi-chunk oversized rollout without loading the whole file", async () => {
  const { createStateSnapshot, readLatestStateSnapshot } = await rolloutStore;
  const root = mkdtempSync(join(tmpdir(), "newbrain-rollout-huge-"));
  const path = join(root, "thread.rollout.jsonl");
  try {
    const padding = JSON.stringify({
      record_type: "noise",
      payload: { blob: "n".repeat(512 * 1024) }
    });
    const lines = [
      JSON.stringify(createStateSnapshot({ threadId: "thread-1", state: { version: 1, value: "old" } })),
      ...Array.from({ length: 8 }, () => padding),
      JSON.stringify(createStateSnapshot({ threadId: "thread-1", state: { version: 1, value: "latest-huge" } }))
    ];
    writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
    assert.ok(statSync(path).size > 1024 * 1024);
    assert.deepEqual(await readLatestStateSnapshot(path), { version: 1, value: "latest-huge" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compacts historical snapshots after the size threshold", async () => {
  const {
    appendRolloutRecords,
    appendStateSnapshotCompacting,
    createStateSnapshot,
    readRolloutRecords,
    readLatestStateSnapshot
  } = await rolloutStore;
  const root = mkdtempSync(join(tmpdir(), "newbrain-rollout-compact-"));
  const path = join(root, "thread.rollout.jsonl");
  try {
    await appendRolloutRecords(path, [
      createStateSnapshot({ threadId: "thread-1", state: { version: 1, value: "old", pad: "p".repeat(8_000) } }),
      createStateSnapshot({ threadId: "thread-1", state: { version: 1, value: "mid", pad: "p".repeat(8_000) } })
    ]);
    const before = statSync(path).size;
    const latest = createStateSnapshot({ threadId: "thread-1", state: { version: 1, value: "compacted" } });
    await appendStateSnapshotCompacting(path, latest, { compactAfterBytes: before });
    const records = await readRolloutRecords(path) as Array<{ record_type?: string; state?: { value?: string } }>;
    assert.equal(records.length, 1);
    assert.equal(records[0]?.record_type, "state_snapshot");
    assert.deepEqual(await readLatestStateSnapshot(path), { version: 1, value: "compacted" });
    assert.ok(statSync(path).size < before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
