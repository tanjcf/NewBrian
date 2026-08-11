import assert from "node:assert/strict";
import test from "node:test";

const { ThreadStateService } = await import(new URL("./thread-state-service.ts", import.meta.url).href);

function defaultState() {
  return {
    version: 2,
    messages: [],
    memories: [],
    runs: [],
    timeline: [],
    events: [],
    context: { version: 1, summary: "", compactedMessageIds: [], estimatedTokens: 0, modelContextWindow: 128_000 }
  };
}

function fixture(records: unknown[] | Error = []) {
  const appended: Array<{ path: string; records: unknown[] }> = [];
  const memories: unknown[] = [];
  const latestSnapshot = () => {
    if (records instanceof Error) throw records;
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index] as { record_type?: string; state?: unknown };
      if (record?.record_type === "state_snapshot" && record.state) return record.state;
    }
    return null;
  };
  const service = new ThreadStateService({
    ensureWorkspaceThreads: async () => undefined,
    getStatePath: (_workspaceId: string, threadId: string) => `${threadId}.jsonl`,
    getLegacyStatePath: (_workspaceId: string, threadId: string) => `${threadId}.json`,
    getEventLogPath: (_workspaceId: string, threadId: string) => `${threadId}.events.jsonl`,
    readRolloutRecords: async () => {
      if (records instanceof Error) throw records;
      return records;
    },
    readLatestStateSnapshot: async () => latestSnapshot(),
    readLegacyText: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
    parseJson: JSON.parse,
    createDefaultState: defaultState,
    appendRolloutRecords: async (path: string, next: unknown[]) => { appended.push({ path, records: next }); },
    appendStateSnapshotCompacting: async (path: string, record: unknown) => {
      appended.push({ path, records: [record] });
    },
    createStateSnapshot: (input: unknown) => ({ record_type: "state_snapshot", ...input as object }),
    toRolloutThreadEvent: (_threadId: string, event: unknown) => ({ event }),
    upsertMemory: (memory: unknown) => { memories.push(memory); },
    createTimelineEvent: (_type: string, title: string, detail: string) => ({ id: "timeline", type: "thread", title, detail }),
    createThreadEvent: (_type: string, payload: object) => ({ id: "event", type: "message", payload }),
    nowMs: () => 100
  } as never);
  return { service, appended, memories };
}

const workspace = { id: "workspace-1", name: "Workspace" };
const thread = { id: "thread-1", title: "Thread", updatedAt: "2026-07-18T00:00:00.000Z" };

test("selects the latest rollout snapshot so a reset cannot resurrect stale messages", async () => {
  const rich = { ...defaultState(), messages: [{ role: "user", content: "one" }, { role: "assistant", content: "two" }] };
  const truncated = { ...defaultState(), messages: [{ role: "user", content: "one" }] };
  const { service } = fixture([
    { record_type: "state_snapshot", state: rich },
    { record_type: "state_snapshot", state: truncated }
  ]);
  const state = await service.read(workspace as never, thread as never);
  assert.equal(state.messages.length, 1);
});

test("creates a durable default when the rollout is missing", async () => {
  const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
  const { service, appended } = fixture(missing);
  const state = await service.read(workspace as never, thread as never);
  assert.equal(state.version, 2);
  assert.equal(appended[0].path, "thread-1.jsonl");
});

test("bounds events and mirrors them to the event rollout", async () => {
  const state = { ...defaultState(), events: Array.from({ length: 5_000 }, (_, index) => ({ id: `${index}` })) };
  const { service, appended } = fixture([{ record_type: "state_snapshot", state }]);
  await service.appendEvents(workspace as never, thread as never, [{ id: "new", type: "message", payload: {} }] as never);
  const stateSnapshot = appended[0].records[0] as { state: { events: unknown[] } };
  assert.equal(stateSnapshot.state.events.length, 5_000);
  assert.equal(appended[1].path, "thread-1.events.jsonl");
});

test("projects runtime events into the state snapshot without duplicating the audit rollout", async () => {
  const { service, appended } = fixture([{ record_type: "state_snapshot", state: defaultState() }]);
  await service.projectEvents(workspace as never, thread as never, [{ id: "tool-1", type: "tool_call", payload: {} }] as never);
  const stateSnapshot = appended[0].records[0] as { state: { events: Array<{ id: string }> } };
  assert.equal(stateSnapshot.state.events[0].id, "tool-1");
  assert.equal(appended.length, 1);
});

test("bounds oversized tool payloads before persisting a state snapshot", async () => {
  const { service, appended } = fixture([{ record_type: "state_snapshot", state: defaultState() }]);
  const huge = "x".repeat(120_000);
  await service.projectEvents(workspace as never, thread as never, [{
    id: "tool-1",
    type: "tool_result",
    payload: { callId: "call-1", result: { output: huge } }
  }] as never);
  const stateSnapshot = appended[0].records[0] as {
    state: { events: Array<{ payload: { result: { output: string } } }> }
  };
  const output = stateSnapshot.state.events[0]?.payload?.result?.output ?? "";
  assert.ok(output.length < 120_000);
  assert.match(output, /truncated \d+ chars for durable thread state/);
});
