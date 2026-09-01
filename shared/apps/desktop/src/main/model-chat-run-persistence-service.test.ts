import assert from "node:assert/strict";
import test from "node:test";

const { ModelChatRunPersistenceService } = await import(
  new URL("./model-chat-run-persistence-service.ts", import.meta.url).href
);

function createService(overrides: Record<string, unknown> = {}) {
  const projected: any[] = [];
  const audited: any[] = [];
  const metadata: any[] = [];
  const threadEvents: any[] = [];
  const service = new ModelChatRunPersistenceService({
    makeId: (prefix: string) => `${prefix}-1`,
    nowIso: () => "2026-07-19T00:00:00.000Z",
    getEventLogPath: () => "events.jsonl",
    appendAuditRecords: async (_path: string, records: unknown[]) => { audited.push(...records); },
    createAuditRecord: (input: any) => ({ record_type: input.recordType, payload: input.payload, turnId: input.turnId }),
    createThreadEvent: (type: string, payload: Record<string, unknown>, turnId?: string) => ({
      id: `event-${projected.length + threadEvents.length + 1}`,
      type,
      payload,
      turnId,
      createdAt: "2026-07-19T00:00:00.000Z"
    }),
    toRolloutThreadEvent: (_threadId: string, event: any) => ({ record_type: event.type, payload: event.payload }),
    projectEvents: async (_workspace: unknown, _thread: unknown, events: unknown[]) => {
      projected.push(...events);
      threadEvents.push(...events);
    },
    updateMetadata: async (input: unknown) => { metadata.push(input); },
    readThreadEvents: async () => threadEvents,
    ...overrides
  });
  return { service, projected, audited, metadata, threadEvents };
}

test("projects replayable tool history while preserving the raw audit rollout", async () => {
  const { service, projected, audited } = createService();
  await service.persist({
    workspace: { id: "workspace-1" },
    thread: { id: "thread-1" },
    turnId: "turn-1",
    agentEvents: [
      { type: "tool_call", timestamp: "2026-07-19T00:00:01.000Z", payload: { id: "call-1", name: "shell.exec", arguments: { command: "git status" } } },
      { type: "tool_result", timestamp: "2026-07-19T00:00:02.000Z", payload: { callId: "call-1", name: "shell.exec", result: { ok: true, exitCode: 0 } } },
      { type: "agent_loop_completed", payload: { steps: 1 } }
    ],
    nativeWebSearches: [],
    awaitingApproval: false,
    toolDescriptors: [{ name: "shell.exec", kind: "shell", risk: "high" }]
  } as never);
  assert.deepEqual(projected.map((event) => event.type), ["tool_call", "tool_result"]);
  assert.equal(projected[0].createdAt, "2026-07-19T00:00:01.000Z");
  assert.equal(projected[0].turnId, "turn-1");
  assert.equal(projected[0].payload.replaySafe, false);
  assert.deepEqual(audited.map((event) => event.record_type), ["tool_call", "tool_result", "agent_loop_completed"]);
});

test("persists boundary batches mid-loop without duplicating later tail flushes", async () => {
  const { service, projected, audited, metadata } = createService();
  await service.persistEvents({
    workspace: { id: "workspace-1" },
    thread: { id: "thread-1" },
    turnId: "turn-1",
    agentEvents: [
      { type: "tool_call", payload: { id: "call-1", name: "goal.get", arguments: {} } }
    ],
    toolDescriptors: [{ name: "goal.get", kind: "read", risk: "low" }]
  } as never);
  await service.persistEvents({
    workspace: { id: "workspace-1" },
    thread: { id: "thread-1" },
    turnId: "turn-1",
    agentEvents: [
      { type: "tool_result", payload: { callId: "call-1", name: "goal.get", result: { ok: true } } }
    ]
  } as never);
  await service.persist({
    workspace: { id: "workspace-1" },
    thread: { id: "thread-1" },
    turnId: "turn-1",
    agentEvents: [{ type: "agent_loop_completed", payload: { steps: 1 } }],
    nativeWebSearches: [],
    awaitingApproval: false,
    replayMetadata: { hadPotentialSideEffects: false, replaySafe: true }
  } as never);

  assert.deepEqual(projected.map((event) => event.type), ["tool_call", "tool_result"]);
  assert.equal(projected[0].payload.replaySafe, true);
  assert.deepEqual(audited.map((event) => event.record_type), [
    "tool_call",
    "tool_result",
    "agent_loop_completed",
    "turn_replay_metadata"
  ]);
  assert.equal(metadata.length, 0);
});

test("repairs orphan tool_call projections after an interrupted turn", async () => {
  const { service, projected, audited } = createService();
  await service.persistEvents({
    workspace: { id: "workspace-1" },
    thread: { id: "thread-1" },
    turnId: "turn-1",
    agentEvents: [
      { type: "tool_call", payload: { id: "call-9", name: "shell.exec", arguments: { command: "rm -rf /" } } }
    ],
    toolDescriptors: [{ name: "shell.exec", kind: "shell", risk: "high" }]
  } as never);
  const repaired = await service.repairOrphanToolCalls({
    workspace: { id: "workspace-1" },
    thread: { id: "thread-1" },
    turnId: "turn-1",
    failureReason: "Agent loop stalled: no tool progress across 4 consecutive steps."
  } as never);
  assert.equal(repaired.length, 1);
  assert.equal(projected.at(-1).type, "tool_result");
  assert.equal(projected.at(-1).payload.result.orphan, true);
  assert.match(String(projected.at(-1).payload.result.output), /Agent loop stalled/);
  assert.equal(audited.at(-1).record_type, "tool_result");
});

test("recovers unpersisted in-memory tool results instead of inventing orphan failures", async () => {
  const { service, projected } = createService();
  await service.persistEvents({
    workspace: { id: "workspace-1" },
    thread: { id: "thread-1" },
    turnId: "turn-1",
    agentEvents: [
      { type: "tool_call", payload: { id: "call-401", name: "music.generate", arguments: {} } }
    ],
    toolDescriptors: [{ name: "music.generate", kind: "write", risk: "medium" }]
  } as never);
  const repaired = await service.repairOrphanToolCalls({
    workspace: { id: "workspace-1" },
    thread: { id: "thread-1" },
    turnId: "turn-1",
    supplementalEvents: [{
      type: "tool_result",
      payload: {
        callId: "call-401",
        name: "music.generate",
        result: { ok: false, output: "HTTP 401 unauthorized" }
      }
    }]
  } as never);
  assert.equal(repaired.length, 1);
  assert.equal(projected.at(-1).payload.result.output, "HTTP 401 unauthorized");
  assert.notEqual(projected.at(-1).payload.result.orphan, true);
});
