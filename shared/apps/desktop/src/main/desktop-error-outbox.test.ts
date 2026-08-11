import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
// @ts-expect-error Node's strip-types runner loads this source file directly.
import { DesktopErrorOutbox } from "./desktop-error-outbox.ts";

test("persists a sanitized renderer failure and uploads it once after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecn-error-outbox-"));
  try {
    const firstRun = new DesktopErrorOutbox(root, () => new Date("2026-07-22T11:00:00Z"));
    const record = await firstRun.capture({
      kind: "renderer_unhandled_rejection",
      message: "Bearer secret-token failed",
      stackTrace: "Error: api_key=top-secret",
      context: { route: "workspace" }
    });
    const pendingText = await readFile(join(root, "pending", `${record.id}.json`), "utf8");
    assert.doesNotMatch(pendingText, /secret-token|top-secret/);

    const uploaded: unknown[] = [];
    const restarted = new DesktopErrorOutbox(root, () => new Date("2026-07-22T11:01:00Z"));
    const result = await restarted.flush(async (item) => { uploaded.push(item); });
    assert.deepEqual(result, { uploaded: 1, failed: 0 });
    assert.equal(uploaded.length, 1);
    assert.deepEqual(await readdir(join(root, "pending")), []);
    assert.deepEqual(await readdir(join(root, "sent")), [`${record.id}.json`]);

    const repeated = await restarted.flush(async () => { throw new Error("must not repeat"); });
    assert.deepEqual(repeated, { uploaded: 0, failed: 0 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps a failed upload pending for the next restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecn-error-outbox-"));
  try {
    const outbox = new DesktopErrorOutbox(root);
    await outbox.capture({ kind: "renderer_error", message: "boom", stackTrace: "Error: boom" });
    assert.deepEqual(await outbox.flush(async () => { throw new Error("offline"); }), { uploaded: 0, failed: 1 });
    assert.equal((await readdir(join(root, "pending"))).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persists oversized renderer context without throwing", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecn-error-outbox-"));
  try {
    const outbox = new DesktopErrorOutbox(root);
    const record = await outbox.capture({
      kind: "renderer_error",
      message: "boom",
      context: { diagnostic: "x".repeat(20_000) }
    });
    const stored = JSON.parse(await readFile(join(root, "pending", `${record.id}.json`), "utf8"));
    assert.equal(typeof stored.context, "object");
    assert.ok(JSON.stringify(stored.context).length <= 16_500);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fingerprints distinct terminal messages separately even with the same stack", async () => {
  const root = await mkdtemp(join(tmpdir(), "codecn-error-outbox-"));
  try {
    const outbox = new DesktopErrorOutbox(root, () => new Date("2026-08-05T12:00:00Z"));
    const sharedStack = "Error: failure\n at callModelApi (index.js:1:1)";
    const gateway = await outbox.capture({
      kind: "model_request_failed",
      message: "无法连接模型网关; endpoint=http://127.0.0.1:8790/v1/responses; code=ECONNREFUSED",
      stackTrace: sharedStack
    });
    const timeout = await outbox.capture({
      kind: "model_request_failed",
      message: "Agent model callback timed out: model_23",
      stackTrace: sharedStack
    });
    assert.notEqual(gateway.fingerprint, timeout.fingerprint);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
