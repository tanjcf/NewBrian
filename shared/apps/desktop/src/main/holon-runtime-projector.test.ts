import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("projects ordered agent events into the durable Holon outbox", async () => {
  const [{ CodexStorage }, { HolonRuntimeProjector }] = await Promise.all([
    import(new URL("./codex-storage.ts", import.meta.url).href) as Promise<typeof import("./codex-storage.js")>,
    import(new URL("./holon-runtime-projector.ts", import.meta.url).href) as Promise<
      typeof import("./holon-runtime-projector.js")
    >
  ]);
  const root = mkdtempSync(join(tmpdir(), "newbrain-holon-projector-"));
  const storage = new CodexStorage(root);
  try {
    const projector = new HolonRuntimeProjector({
      storage,
      createId: (prefix, sequence) => `${prefix}_${sequence}`,
      nowIso: () => "2026-07-22T00:00:00.000Z",
      nowMs: () => 100
    });
    const context = { workItemId: "wi_1", threadId: "thread_1", turnId: "turn_1" };

    assert.equal(projector.project(context, { type: "agent_loop_started", payload: {} })?.sequenceNo, 0);
    assert.equal(projector.project(context, {
      type: "tool_result",
      payload: { callId: "call_1", name: "shell.exec", result: { ok: true, output: "done" } }
    })?.sequenceNo, 1);
    assert.equal(projector.project(context, { type: "agent_loop_completed", payload: { step: 2 } })?.sequenceNo, 2);

    const rows = storage.listDueRemoteEvents(100, 100);
    assert.deepEqual(rows.map((row) => [row.eventId, row.sequenceNo]), [
      ["evt_0", 0], ["evt_1", 1], ["evt_2", 2]
    ]);
    assert.deepEqual(rows.map((row) => JSON.parse(row.payloadJson).eventType), [
      "work_item.started", "tool.completed", "work_item.completed"
    ]);
  } finally {
    storage.close();
    try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 }); } catch { /* WAL closes at exit. */ }
  }
});
