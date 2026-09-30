import assert from "node:assert/strict";
import test from "node:test";
import type { ModelChatInput } from "@codex-forge/protocol";

const { ModelChatService, reconcileStreamedContent } = await import(new URL("./model-chat-service.ts", import.meta.url).href);

test("reconciles canonical content without repainting an identical or prefix stream", () => {
  assert.deepEqual(reconcileStreamedContent("answer", "answer"), []);
  assert.deepEqual(reconcileStreamedContent("ans", "answer"), [{ delta: "wer" }]);
  assert.deepEqual(reconcileStreamedContent("draft", "answer"), [
    { delta: "", reset: true },
    { delta: "answer" }
  ]);
});

test("reports preparation failures before closing an unstarted task", async () => {
  const observed: unknown[] = [];
  const finished: string[] = [];
  const failure = new Error("Auto route unavailable");
  const service = new ModelChatService({
    prepare: async () => { throw failure; },
    observePreTaskFailure: (input: unknown) => { observed.push(input); },
    finishTask: (requestId: string) => { finished.push(requestId); },
    finishGoal: () => undefined,
    nowIso: () => "2026-01-01T00:00:00.000Z",
    makeId: () => "turn"
  } as never);

  await assert.rejects(
    service.chat({ send: () => undefined }, {
      requestId: "request-prepare-failure",
      workspaceId: "workspace-1",
      threadId: "thread-1",
      messages: [{ role: "user", content: "market quote" }]
    } as ModelChatInput),
    failure
  );

  assert.deepEqual(observed, [{
    requestId: "request-prepare-failure",
    workspaceId: "workspace-1",
    threadId: "thread-1",
    error: failure
  }]);
  assert.deepEqual(finished, ["request-prepare-failure"]);
});

test("coordinates a successful model turn and always closes goal and task accounting", async () => {
  const order: string[] = [];
  const timingStages: string[] = [];
  let nowMs = 0;
  let remoteContext: unknown;
  const runtime = {
    getToolDescriptors: () => [{ name: "workspace.scan" }, { name: "shell.exec" }, { name: "write_file" }],
    getSkillDescriptors: () => [],
    matchSkills: () => [],
    loadSkill: async () => ({}),
    searchMemories: () => [],
    setThreadState: () => undefined,
    getAgentLoopSnapshot: () => ({ status: "completed" }),
    rememberExchangeWithShadow: async () => ({ shadow: { changed: [], skillName: "" } }),
    getMemories: () => []
  };
  const result = {
    content: "done",
    reasoningSummary: "reason",
    toolCalls: [],
    webSearchCalls: [],
    citations: []
  };
  const service = new ModelChatService({
    reasoningChannel: "reasoning",
    streamChannel: "stream",
    prepare: async (input: ModelChatInput) => ({
      input,
      workspace: { id: "workspace-1", path: "C:/workspace" },
      thread: { id: "thread-1" }
    }),
    startTask: async () => ({
      runtime,
      initialThreadState: { context: {} },
      scope: {
        workspaceId: "workspace-1",
        threadId: "thread-1",
        requestId: "request-1",
        turnId: "turn-1",
        runtimeId: "thread-thread-1-request-1"
      }
    }),
    startGoal: () => ({
      explicitSkillNames: [],
      composerModes: [],
      centralSkillNames: [],
      selectedLocalSkillNames: [],
      governmentSkillEnabled: false,
      goalRuntimeRequested: false,
      goalRuntimeEnabled: false,
      goalSnapshot: null,
      accounting: null
    }),
    loadSkills: async () => ({ loadedLocalSkills: [], disclosedSkills: [] }),
    prepareContext: async () => ({
      state: { context: {} },
      requestMessages: [{ role: "user", content: "hello" }]
    }),
    buildSystemPrompt: () => "system",
    updateModelContext: async (input: { state: unknown }) => input.state,
    updateRunningMetadata: async () => { order.push("running"); },
    runAgentLoop: async (input: any) => {
      remoteContext = input.remoteExecutionContext;
      input.emitStream({ requestId: "request-1", delta: "done" });
      return ({
      skillDisclosure: "",
      canonicalContent: "done",
      result,
      loopSnapshot: { status: "completed", pending: null },
      agentEvents: []
    }); },
    persistRun: async () => { order.push("run"); },
    persistCancellation: async () => undefined,
    persistFailure: async () => undefined,
    persistSuccess: async () => { order.push("success"); },
    saveRuntimeState: async () => undefined,
    getGoalSnapshot: () => null,
    estimateTokens: () => 0,
    isCanceled: () => false,
    attachArtifacts: () => undefined,
    attachSkillDisclosure: () => undefined,
    setModelCallback: () => undefined,
    publishActivity: () => undefined,
    observeTiming: (mark: { stage: string }) => { timingStages.push(mark.stage); },
    nowMs: () => ++nowMs,
    finishGoal: () => { order.push("goal-finished"); },
    finishTask: () => { order.push("task-finished"); },
    nowIso: () => "2026-01-01T00:00:00.000Z",
    makeId: () => "turn-1"
  } as never);

  const output = await service.chat({ send: () => undefined }, {
    requestId: "request-1",
    messages: [{ role: "user", content: "hello" }]
  } as ModelChatInput, {
    workItemId: "wi_1",
    knowledgeSnapshotId: "ks_1",
    allowedToolNames: ["workspace.scan", "shell.exec"]
  });

  assert.equal(output.content, "done");
  assert.deepEqual(order, ["running", "run", "success", "goal-finished", "task-finished"]);
  assert.deepEqual(timingStages, [
    "prepared",
    "task-started",
    "context-ready",
    "loop-started",
    "first-delta",
    "loop-completed",
    "run-persisted",
    "success-persisted",
    "finished"
  ]);
  assert.deepEqual(remoteContext, {
    workItemId: "wi_1",
    knowledgeSnapshotId: "ks_1",
    allowedToolNames: ["workspace.scan", "shell.exec"],
    registeredToolNames: ["workspace.scan", "shell.exec", "write_file"]
  });
});

test("flushes boundary events mid-loop and only persists the unflushed tail at the end", async () => {
  const boundaryBatches: unknown[][] = [];
  const persistRuns: Array<{ agentEvents: unknown[]; replayMetadata: unknown }> = [];
  const runtime = {
    getToolDescriptors: () => [{ name: "goal.get", kind: "read", risk: "low" }],
    getSkillDescriptors: () => [],
    matchSkills: () => [],
    loadSkill: async () => ({}),
    searchMemories: () => [],
    setThreadState: () => undefined,
    getAgentLoopSnapshot: () => ({ status: "completed" }),
    rememberExchangeWithShadow: async () => ({ shadow: { changed: [], skillName: "" } }),
    getMemories: () => []
  };
  const service = new ModelChatService({
    reasoningChannel: "reasoning",
    streamChannel: "stream",
    prepare: async (input: ModelChatInput) => ({
      input,
      workspace: { id: "workspace-1", path: "C:/workspace" },
      thread: { id: "thread-1" }
    }),
    startTask: async () => ({
      runtime,
      initialThreadState: { context: {} },
      scope: {
        workspaceId: "workspace-1",
        threadId: "thread-1",
        requestId: "request-1",
        turnId: "turn-1",
        runtimeId: "thread-thread-1-request-1"
      }
    }),
    startGoal: () => ({
      explicitSkillNames: [],
      composerModes: [],
      centralSkillNames: [],
      selectedLocalSkillNames: [],
      governmentSkillEnabled: false,
      goalRuntimeRequested: false,
      goalRuntimeEnabled: false,
      goalSnapshot: null,
      accounting: null
    }),
    loadSkills: async () => ({ loadedLocalSkills: [], disclosedSkills: [] }),
    prepareContext: async () => ({
      state: { context: {} },
      requestMessages: [{ role: "user", content: "hello" }]
    }),
    buildSystemPrompt: () => "system",
    updateModelContext: async (input: { state: unknown }) => input.state,
    updateRunningMetadata: async () => undefined,
    runAgentLoop: async (input: any) => {
      await input.flushBoundaryEvents?.([
        { type: "tool_call", payload: { id: "call-1", name: "goal.get", arguments: {} } },
        { type: "tool_result", payload: { callId: "call-1", name: "goal.get", result: { ok: true } } }
      ]);
      return {
        skillDisclosure: "",
        canonicalContent: "done",
        result: { content: "done", reasoningSummary: "", toolCalls: [], webSearchCalls: [], citations: [] },
        loopSnapshot: { status: "completed", pending: null },
        agentEvents: [
          { type: "tool_call", payload: { id: "call-1", name: "goal.get", arguments: {} } },
          { type: "tool_result", payload: { callId: "call-1", name: "goal.get", result: { ok: true } } },
          { type: "agent_loop_completed", payload: { steps: 1 } }
        ],
        flushedEventCount: 2
      };
    },
    persistBoundaryEvents: async (input: any) => { boundaryBatches.push(input.agentEvents); },
    persistRun: async (input: any) => {
      persistRuns.push({ agentEvents: input.agentEvents, replayMetadata: input.replayMetadata });
    },
    persistCancellation: async () => undefined,
    persistFailure: async () => undefined,
    persistSuccess: async () => undefined,
    saveRuntimeState: async () => undefined,
    getGoalSnapshot: () => null,
    estimateTokens: () => 0,
    isCanceled: () => false,
    attachArtifacts: () => undefined,
    attachSkillDisclosure: () => undefined,
    setModelCallback: () => undefined,
    publishActivity: () => undefined,
    finishGoal: () => undefined,
    finishTask: () => undefined,
    nowIso: () => "2026-01-01T00:00:00.000Z",
    makeId: () => "turn-1"
  } as never);

  await service.chat({ send: () => undefined }, {
    requestId: "request-1",
    messages: [{ role: "user", content: "hello" }]
  } as ModelChatInput);

  assert.equal(boundaryBatches.length, 1);
  assert.equal(boundaryBatches[0].length, 2);
  assert.deepEqual(persistRuns[0].agentEvents.map((event: any) => event.type), ["agent_loop_completed"]);
  assert.deepEqual(persistRuns[0].replayMetadata, {
    hadPotentialSideEffects: false,
    replaySafe: true
  });
});

test("preserves the original PDF deliverable after an outline choice", async () => {
  let promptInput: any;
  let loopInput: any;
  const runtime = {
    getSkillDescriptors: () => [], matchSkills: () => [], loadSkill: async () => ({}),
    getToolDescriptors: () => [],
    searchMemories: () => [], setThreadState: () => undefined,
    getAgentLoopSnapshot: () => ({ status: "completed" }),
    rememberExchangeWithShadow: async () => ({ shadow: { changed: [], skillName: "" } }), getMemories: () => []
  };
  const service = new ModelChatService({
    reasoningChannel: "reasoning", streamChannel: "stream",
    prepare: async (input: ModelChatInput) => ({ input, workspace: { id: "w", path: "C:/w" }, thread: { id: "t" } }),
    startTask: async () => ({
      runtime,
      initialThreadState: {},
      scope: {
        workspaceId: "workspace-1",
        threadId: "thread-1",
        requestId: "request-1",
        turnId: "turn-1"
      }
    }),
    startGoal: () => ({
      explicitSkillNames: ["government-research-writing"], composerModes: ["goal"],
      centralSkillNames: ["government-research-writing"], selectedLocalSkillNames: [],
      governmentSkillEnabled: true, goalRuntimeRequested: true, goalRuntimeEnabled: true,
      goalSnapshot: { goal: { objective: "写煤炭企业年终总结并输出PDF文件", status: "active" }, runtime: {}, plan: [] }, accounting: null
    }),
    loadSkills: async () => ({ loadedLocalSkills: [], disclosedSkills: [] }),
    prepareContext: async () => ({ state: {}, requestMessages: [{ role: "user", content: "确认并继续" }] }),
    buildSystemPrompt: (input: any) => { promptInput = input; return "system"; },
    updateModelContext: async (input: any) => input.state, updateRunningMetadata: async () => undefined,
    runAgentLoop: async (input: any) => { loopInput = input; return {
      skillDisclosure: "", canonicalContent: "done",
      result: { content: "done", reasoningSummary: "", toolCalls: [], webSearchCalls: [], citations: [] },
      loopSnapshot: { status: "completed", pending: null }, agentEvents: []
    }; },
    persistRun: async () => undefined, persistCancellation: async () => undefined,
    persistFailure: async () => undefined, persistSuccess: async () => undefined,
    saveRuntimeState: async () => undefined, getGoalSnapshot: () => null, estimateTokens: () => 0,
    isCanceled: () => false, attachArtifacts: () => undefined, attachSkillDisclosure: () => undefined,
    setModelCallback: () => undefined, publishActivity: () => undefined, finishGoal: () => undefined,
    finishTask: () => undefined, nowIso: () => "2026-01-01T00:00:00.000Z", makeId: () => "turn"
  } as never);
  await service.chat({ send: () => undefined }, {
    requestId: "r", messages: [{ role: "user", content: "确认并继续" }]
  } as ModelChatInput);
  assert.match(promptInput.latestUserRequest, /输出PDF文件/);
  assert.match(promptInput.latestUserRequest, /确认并继续/);
  assert.equal(loopInput.latestUserRequest, promptInput.latestUserRequest);
});
