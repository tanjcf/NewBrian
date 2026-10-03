import assert from "node:assert/strict";
import test from "node:test";

const { parseCancelModelRequestInput, parseRespondApprovalInput, parseShellCommand } =
  await import(new URL("./runtime-control-contract.ts", import.meta.url).href);
const { RuntimeCommandService } = await import(new URL("./runtime-command-service.ts", import.meta.url).href);
const { ApprovalResumeService } = await import(new URL("./approval-resume-service.ts", import.meta.url).href);

test("normalizes runtime control request identifiers", () => {
  assert.deepEqual(parseCancelModelRequestInput(undefined), {});
  assert.deepEqual(parseCancelModelRequestInput({ requestId: " request-1 " }), { requestId: "request-1" });
  assert.deepEqual(parseRespondApprovalInput({ approved: false, requestId: " request-1 ", approvalId: " approval-1 " }), {
    approved: false, requestId: "request-1", approvalId: "approval-1"
  });
  assert.deepEqual(parseRespondApprovalInput({ approved: true, permissionMode: "full" }), {
    approved: true, requestId: undefined, approvalId: undefined, permissionMode: "full"
  });
  assert.deepEqual(parseRespondApprovalInput({ approved: true, permissionMode: "agent" }), {
    approved: true, requestId: undefined, approvalId: undefined
  });
  assert.equal(parseShellCommand("  git status  "), "  git status  ");
});

test("rejects malformed runtime controls", () => {
  assert.throws(() => parseCancelModelRequestInput({ requestId: " " }), /invalid/);
  assert.throws(() => parseRespondApprovalInput({ approved: "yes" }), /boolean/);
  assert.throws(() => parseShellCommand(" "), /invalid/);
  assert.throws(() => parseShellCommand("x".repeat(65_537)), /invalid/);
});

function createRuntimeCommandFixture(preferenceOverrides: any = {}) {
  const events: string[] = [];
  const runtime: any = {
    workspacePath: "C:\\workspace",
    sessionMachine: { events: [{ type: "before" }] },
    queueShellCommand: async (command: string, input: any) => {
      events.push(`run:${command}:${input.permissionMode}`);
      return { command };
    }
  };
  const preferences: any = {
    configuration: { requireApprovalForShell: false },
    hooks: {
      beforeCommand: true, afterCommand: true, beforeCommit: true, afterTask: true,
      beforeCommandScript: "before", afterCommandScript: "after", beforeCommitScript: "commit", afterTaskScript: "task"
    },
    git: { forcePushWithLease: true, confirmBeforePush: true, showDiffBeforeCommit: true },
    ...preferenceOverrides
  };
  let task: any;
  let spawnArgs: any[] = [];
  const service = new RuntimeCommandService({
    getRuntime: () => runtime,
    getPreferences: async () => preferences,
    runHook: async (label: string) => { events.push(`hook:${label}`); },
    saveActiveThreadState: async (summary: string) => { events.push(`save:${summary}`); },
    appendRuntimeEventsSince: async (offset: number) => { events.push(`events:${offset}`); },
    getActiveModelRequestId: () => "active",
    getModelTask: () => task,
    markModelRequestCanceled: (requestId: string) => { events.push(`canceled:${requestId}`); },
    removeModelTask: (requestId: string) => {
      events.push(`remove:${requestId}`);
      task = undefined;
    },
    clearCanceledModelRequest: (requestId: string) => { events.push(`clear-canceled:${requestId}`); },
    updateThreadMetadata: async (input: any) => { events.push(`metadata:${input.statusLabel}`); },
    getShellEnv: () => ({ TEST: "1" }),
    spawnProcess: ((...args: any[]) => { spawnArgs = args; return { unref: () => events.push("unref") }; }) as any
  });
  return { service, events, setTask: (value: any) => { task = value; }, getSpawnArgs: () => spawnArgs };
}

test("applies Git safety policy and hooks in a stable command sequence", async () => {
  const fixture = createRuntimeCommandFixture();
  await fixture.service.queueShellCommand("git push origin main");
  assert.deepEqual(fixture.events, [
    "save:钩子 beforeCommand: git push origin main", "hook:beforeCommand",
    "run:git push --force-with-lease origin main:approval",
    "save:推送前确认已启用：命令将保留审批请求",
    "hook:afterCommand", "save:钩子 afterCommand: git push origin main",
    "hook:afterTask", "save:已提交命令: git push origin main", "events:1"
  ]);
});

test("previews staged changes before commit and cancels the selected model task", async () => {
  const fixture = createRuntimeCommandFixture({
    hooks: { beforeCommand: false, afterCommand: false, beforeCommit: true, afterTask: false, beforeCommitScript: "commit" },
    git: { forcePushWithLease: false, confirmBeforePush: false, showDiffBeforeCommit: true }
  });
  await fixture.service.queueShellCommand("git commit -m test");
  const abortController = new AbortController();
  fixture.setTask({
    abortController, workspaceId: "workspace", threadId: "thread",
    runtime: { cancelAgentLoop: (reason: string) => fixture.events.push(`agent:${reason}`) }
  });
  const result = await fixture.service.cancelModelRequest({ requestId: "request" });
  assert.equal(result.ok, true);
  assert.equal(abortController.signal.aborted, true);
  assert.deepEqual(fixture.events, [
    "run:git diff --cached --stat:full", "hook:beforeCommit",
    "save:提交前钩子：已生成 staged diff 摘要", "run:git commit -m test:full",
    "save:已提交命令: git commit -m test", "events:1",
    "canceled:request", "agent:User requested cancellation.", "metadata:Cancelled",
    "remove:request", "clear-canceled:request"
  ]);
});

test("cancelModelRequest stops locally before spring turn.cancel", async () => {
  const springCalls: string[] = [];
  const events: string[] = [];
  const abortController = new AbortController();
  const service = new RuntimeCommandService({
    getRuntime: () => ({
      workspacePath: "C:\\workspace",
      sessionMachine: { events: [] },
      queueShellCommand: async () => ({})
    }),
    getPreferences: async () => ({
      configuration: { requireApprovalForShell: false },
      hooks: {},
      git: {}
    }) as any,
    runHook: async () => undefined,
    saveActiveThreadState: async () => undefined,
    appendRuntimeEventsSince: async () => undefined,
    getActiveModelRequestId: () => "active",
    getModelTask: () => ({
      abortController,
      workspaceId: "workspace",
      threadId: "thread",
      springTurnId: "trn_1",
      springSessionId: "thread",
      runtime: { cancelAgentLoop: (reason: string) => events.push(`agent:${reason}`) }
    }),
    markModelRequestCanceled: (requestId: string) => { events.push(`canceled:${requestId}`); },
    removeModelTask: (requestId: string) => { events.push(`remove:${requestId}`); },
    clearCanceledModelRequest: (requestId: string) => { events.push(`clear-canceled:${requestId}`); },
    updateThreadMetadata: async () => { events.push("metadata"); },
    getShellEnv: () => ({}),
    cancelSpringTurn: async (input) => {
      springCalls.push(`${input.sessionId}:${input.turnId}:${input.reason}`);
      events.push("spring-cancel");
    }
  });
  const result = await service.cancelModelRequest({ requestId: "active" });
  assert.equal(result.ok, true);
  assert.equal(abortController.signal.aborted, true);
  assert.deepEqual(events, [
    "canceled:active",
    "agent:User requested cancellation.",
    "metadata",
    "spring-cancel",
    "remove:active",
    "clear-canceled:active"
  ]);
  assert.deepEqual(springCalls, ["thread:trn_1:user_stop"]);
});

test("escapes terminal working directories before detached PowerShell launch", async () => {
  const fixture = createRuntimeCommandFixture();
  await fixture.service.openSystemTerminal("C:\\O'Brien");
  const [command, args, options] = fixture.getSpawnArgs();
  assert.equal(command, "powershell.exe");
  assert.match(args.at(-1), /O''Brien/);
  assert.equal(options.detached, true);
  assert.deepEqual(fixture.events, ["unref", "save:已打开系统终端: C:\\O'Brien"]);
});

function createApprovalFixture(input: {
  tasks?: Map<string, any>;
  runtime?: any;
  retryable?: boolean;
  catalog?: any;
  resolveSpringApproval?: (input: {
    approvalId: string;
    decision: "approve" | "deny";
  }) => Promise<{ sideEffectAllowed: boolean; offline?: boolean; status?: string }>;
} = {}) {
  const events: string[] = [];
  const sent: any[] = [];
  const tasks = input.tasks ?? new Map<string, any>();
  const runtime = input.runtime ?? {
    sessionMachine: { events: [], snapshot: { messages: [] } },
    getAgentLoopSnapshot: () => null,
    getSnapshot: () => ({ approval: { id: "approval" }, runs: [], messages: [] }),
    respondToApproval: async (approved: boolean) => ({ approval: null, runs: [], messages: [], approved })
  };
  const service = new ApprovalResumeService({
    getTasks: () => tasks,
    getActiveWorkspaceId: () => "workspace",
    getActiveThreadId: () => "thread",
    getDefaultRuntime: () => runtime,
    getActiveModelCallback: () => undefined,
    clearActiveModelCallback: () => events.push("clear-callback"),
    isRetryableError: () => input.retryable ?? false,
    publishActivity: (activity: any) => events.push(`activity:${activity.title}`),
    appendActiveActivities: async () => { events.push("append-activity"); },
    readWorkspaceCatalog: async () => input.catalog ?? { workspaces: [] },
    appendThreadEvents: async (_workspace: any, _thread: any, records: any[]) => {
      events.push(`thread:${records[0].type ?? records[0].payload?.stage ?? "event"}`);
    },
    createThreadEvent: (type: string, payload: any) => ({ type, payload }),
    updateThreadMetadata: async (metadata: any) => events.push(`metadata:${metadata.status}`),
    formatWrittenArtifacts: () => "artifacts",
    streamDeltaChannel: "model:delta",
    saveActiveThreadState: async (summary?: string) => events.push(`save:${summary ?? "refresh"}`),
    appendRolloutRecords: async () => events.push("rollout"),
    getThreadEventLogPath: () => "events.jsonl",
    createRolloutEvent: (record: any) => record,
    saveRuntimeThreadState: async () => events.push("save-runtime"),
    readThreadState: async () => ({ messages: [] }),
    disposeRuntime: async () => events.push("dispose-runtime"),
    removeTask: (requestId: string) => { tasks.delete(requestId); events.push(`remove:${requestId}`); },
    clearCanceledRequest: (requestId: string) => events.push(`clear-canceled:${requestId}`),
    appendDebugLog: async () => events.push("debug"),
    resolveSpringApproval: input.resolveSpringApproval
  });
  return { service, runtime, tasks, events, sender: { send: (channel: string, payload: any) => sent.push({ channel, payload }) }, sent };
}

test("rejects stale or canceled approval requests before runtime mutation", async () => {
  const canceledTask = { abortController: new AbortController() };
  canceledTask.abortController.abort();
  const canceled = createApprovalFixture({ tasks: new Map([["canceled", canceledTask]]) });
  await assert.rejects(() => canceled.service.respond(canceled.sender, { approved: true, requestId: "canceled" }), /取消|cancelled/i);
  const stale = createApprovalFixture();
  await assert.rejects(() => stale.service.respond(stale.sender, { approved: true, requestId: "missing" }), /失效/);
});

test("persists a rejection through the default runtime approval path", async () => {
  const fixture = createApprovalFixture({
    catalog: { workspaces: [{ id: "workspace", path: "C:\\workspace", threads: [{ id: "thread" }] }] }
  });
  // Default-runtime approvals must still carry an explicit approvalId (no UI-thread fallback).
  const result = await fixture.service.respond(fixture.sender, { approved: false, approvalId: "approval" });
  assert.equal(result.approved, false);
  assert.ok(fixture.events.includes("save-runtime") || fixture.events.includes("metadata:idle"));
});

test("rejects approval responses that omit requestId and approvalId", async () => {
  const fixture = createApprovalFixture();
  await assert.rejects(
    () => fixture.service.respond(fixture.sender, false),
    /requestId|approvalId/
  );
});

test("spring approval deny blocks local tool side effects", async () => {
  let resumeCalled = false;
  const tasks = new Map([["req", {
    abortController: new AbortController(),
    workspaceId: "workspace",
    threadId: "thread",
    scope: {
      workspaceId: "workspace",
      threadId: "thread",
      requestId: "req",
      turnId: "turn"
    },
    springApprovalId: "ap_spring_1",
    runtime: {
      sessionMachine: { events: [] },
      getAgentLoopSnapshot: () => ({ status: "awaiting-approval" }),
      getSnapshot: () => ({ approval: { id: "local" }, runs: [], messages: [] }),
      resumeAgentApproval: async () => {
        resumeCalled = true;
        return { status: "completed", agentEvents: [] };
      },
      respondToApproval: async () => ({ approval: null })
    },
    modelCallback: async () => ({})
  }]]);
  const fixture = createApprovalFixture({
    tasks,
    runtime: tasks.get("req").runtime,
    resolveSpringApproval: async () => ({ sideEffectAllowed: false, status: "denied" })
  });
  await assert.rejects(
    () => fixture.service.respond(fixture.sender, { approved: true, requestId: "req" }),
    /服务端未批准/
  );
  assert.equal(resumeCalled, false);
});

test("spring approval deny decision still resumes local deny without side effects", async () => {
  const springCalls: string[] = [];
  const tasks = new Map([["req", {
    abortController: new AbortController(),
    workspaceId: "workspace",
    threadId: "thread",
    scope: {
      workspaceId: "workspace",
      threadId: "thread",
      requestId: "req",
      turnId: "turn"
    },
    springApprovalId: "ap_spring_2",
    runtime: {
      sessionMachine: { events: [] },
      getAgentLoopSnapshot: () => ({ status: "awaiting-approval" }),
      getSnapshot: () => ({ approval: { id: "local" }, runs: [], messages: [] }),
      resumeAgentApproval: async (approved: boolean) => {
        springCalls.push(`local:${approved}`);
        return { status: "failed", agentEvents: [{ type: "approval_denied" }] };
      },
      respondToApproval: async () => ({ approval: null })
    },
    modelCallback: async () => ({})
  }]]);
  const fixture = createApprovalFixture({
    tasks,
    runtime: tasks.get("req").runtime,
    resolveSpringApproval: async (input) => {
      springCalls.push(`spring:${input.decision}`);
      return { sideEffectAllowed: false, status: "denied" };
    }
  });
  await fixture.service.respond(fixture.sender, { approved: false, requestId: "req" });
  assert.deepEqual(springCalls[0], "spring:deny");
  assert.equal(springCalls.includes("local:false"), true);
});

test("routes a direct shell approval by approval id even when a model request is active", async () => {
  let modelResponses = 0;
  const modelRuntime = {
    getAgentLoopSnapshot: () => ({ status: "awaiting-approval" }),
    getSnapshot: () => ({ approval: { id: "model-approval" } }),
    respondToApproval: async () => { modelResponses += 1; }
  };
  const task = {
    abortController: new AbortController(),
    runtime: modelRuntime,
    workspaceId: "workspace",
    threadId: "thread",
    scope: {
      workspaceId: "workspace",
      threadId: "thread",
      requestId: "model-request",
      turnId: "turn"
    }
  };
  const fixture = createApprovalFixture({ tasks: new Map([["model-request", task]]) });
  const result = await fixture.service.respond(fixture.sender, {
    approved: true,
    requestId: "model-request",
    approvalId: "approval"
  });
  assert.equal(result.approved, true);
  assert.equal(modelResponses, 0);
});

test("completes approval content, streams the canonical result, and cleans the task", async () => {
  const snapshot: any = { approval: null, runs: [], messages: [{ role: "user", content: "question" }] };
  const runtime: any = {
    sessionMachine: { events: [], snapshot: { messages: [{ role: "assistant", content: "old" }] } },
    getAgentLoopSnapshot: () => ({ status: "awaiting-approval" }),
    resumeAgentApproval: async () => ({ status: "completed", finalContent: "answer" }),
    getSnapshot: () => snapshot,
    rememberExchangeWithShadow: async () => undefined
  };
  const task: any = {
    abortController: new AbortController(),
    runtime,
    modelCallback: async () => undefined,
    skillDisclosure: "skill",
    workspaceId: "workspace",
    threadId: "thread",
    scope: {
      workspaceId: "workspace",
      threadId: "thread",
      requestId: "request",
      turnId: "turn"
    }
  };
  const fixture = createApprovalFixture({ tasks: new Map([["request", task]]), runtime });
  const result = await fixture.service.respond(fixture.sender, { approved: true, requestId: "request" });
  assert.equal(result, snapshot);
  assert.deepEqual(fixture.sent.map((item) => item.payload), [
    { requestId: "request", delta: "", reset: true },
    { requestId: "request", delta: "answer" }
  ]);
  assert.equal(fixture.tasks.has("request"), false);
  assert.deepEqual(fixture.events.slice(-4), ["dispose-runtime", "remove:request", "clear-canceled:request", "debug"]);
});

test("keeps a remote task alive when approval resume requests another tool approval", async () => {
  const snapshot: any = { approval: null, runs: [], messages: [], session: { status: "idle" } };
  const runtime: any = {
    sessionMachine: { events: [], snapshot: { messages: [] } },
    getAgentLoopSnapshot: () => ({ status: "awaiting-approval" }),
    resumeAgentApproval: async () => ({
      status: "awaiting-approval",
      finalContent: "",
      pending: {
        call: { id: "call-next", name: "shell.exec", arguments: { command: "where.exe ffmpeg" } },
        descriptor: { kind: "command", description: "Run shell", risk: "high" }
      }
    }),
    getSnapshot: () => snapshot
  };
  const callback = async () => undefined;
  const task: any = {
    abortController: new AbortController(),
    runtime,
    modelCallback: callback,
    workspaceId: "workspace",
    threadId: "thread",
    scope: {
      workspaceId: "workspace",
      threadId: "thread",
      requestId: "request",
      turnId: "turn"
    }
  };
  const fixture = createApprovalFixture({ tasks: new Map([["request", task]]), runtime });

  const result = await fixture.service.respond(fixture.sender, { approved: true, requestId: "request" });

  assert.ok(result.approval);
  assert.equal(result.session?.status, "awaiting-approval");
  assert.equal(fixture.tasks.has("request"), true);
  assert.equal(task.modelCallback, callback);
  assert.equal(fixture.events.includes("dispose-runtime"), false);
  assert.equal(fixture.events.includes("remove:request"), false);
});

test("keeps approval pending and records retryable model failures", async () => {
  const runtime: any = {
    sessionMachine: { events: [], snapshot: { messages: [] } },
    getAgentLoopSnapshot: () => ({ status: "awaiting-approval" }),
    getSnapshot: () => ({ approval: { id: "approval" }, runs: [], messages: [] }),
    resumeAgentApproval: async () => { throw new Error("gateway unavailable"); }
  };
  const task = {
    abortController: new AbortController(),
    runtime,
    modelCallback: async () => undefined,
    workspaceId: "workspace",
    threadId: "thread",
    scope: {
      workspaceId: "workspace",
      threadId: "thread",
      requestId: "request",
      turnId: "turn"
    }
  };
  const catalog = { workspaces: [{ id: "workspace", path: "C:\\workspace", threads: [{ id: "thread" }] }] };
  const fixture = createApprovalFixture({ tasks: new Map([["request", task]]), runtime, retryable: true, catalog });
  const result = await fixture.service.respond(fixture.sender, { approved: true, requestId: "request" });
  assert.ok(result.approval);
  assert.deepEqual(fixture.events, ["activity:模型网关暂时不可用", "thread:error", "metadata:awaiting-approval"]);
  assert.equal(fixture.tasks.has("request"), true);
  assert.equal(fixture.events.includes("dispose-runtime"), false);
});

test("terminal no_progress failures clear the task and mark the thread failed", async () => {
  const snapshot: any = {
    approval: { id: "approval" },
    runs: [],
    messages: [],
    session: { status: "awaiting-approval" }
  };
  const runtime: any = {
    sessionMachine: { events: [], snapshot: { messages: [], approval: { id: "approval" } } },
    getAgentLoopSnapshot: () => ({ status: "awaiting-approval" }),
    getSnapshot: () => snapshot,
    resumeAgentApproval: async () => {
      throw new Error("Agent loop stalled: no tool progress across 4 consecutive steps.");
    }
  };
  const task = {
    abortController: new AbortController(),
    runtime,
    modelCallback: async () => undefined,
    workspaceId: "workspace",
    threadId: "thread",
    scope: {
      workspaceId: "workspace",
      threadId: "thread",
      requestId: "request",
      turnId: "turn"
    }
  };
  const catalog = { workspaces: [{ id: "workspace", path: "C:\\workspace", threads: [{ id: "thread" }] }] };
  const fixture = createApprovalFixture({ tasks: new Map([["request", task]]), runtime, catalog });
  await assert.rejects(
    () => fixture.service.respond(fixture.sender, { approved: true, requestId: "request" }),
    /没有成功进展/
  );
  assert.equal(fixture.tasks.has("request"), false);
  assert.ok(fixture.events.includes("dispose-runtime"));
  assert.ok(fixture.events.includes("remove:request"));
  assert.ok(fixture.events.includes("metadata:failed"));
  assert.ok(fixture.events.includes("activity:本轮已结束"));
  assert.equal(snapshot.approval, null);
});

test("full access selected during a run updates the loop before any later approval", async () => {
  const order: string[] = [];
  const tasks = new Map([["req", {
    abortController: new AbortController(),
    workspaceId: "workspace",
    threadId: "thread",
    scope: { workspaceId: "workspace", threadId: "thread", requestId: "req", turnId: "turn" },
    runtime: {
      sessionMachine: { events: [] },
      setAgentLoopPermissionMode: async (mode: string) => {
        order.push(`mode:${mode}`);
      },
      getAgentLoopSnapshot: () => ({ status: "running" }),
      getSnapshot: () => ({ approval: null, runs: [], messages: [] })
    }
  }]]);
  const fixture = createApprovalFixture({ tasks, runtime: tasks.get("req").runtime });
  const applied = await fixture.service.applyLivePermissionMode({ requestId: "req", permissionMode: "full" });
  assert.deepEqual(applied, { applied: true, permissionMode: "full" });
  assert.deepEqual(order, ["mode:full"]);
});
