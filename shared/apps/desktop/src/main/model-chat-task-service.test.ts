import assert from "node:assert/strict";
import test from "node:test";

const { ModelChatTaskService } = await import(
  new URL("./model-chat-task-service.ts", import.meta.url).href
);

test("registers initialized tasks and retains only approval-paused runtimes", async () => {
  const canceled = new Set(["request-1"]);
  let approval = false;
  let disposed = 0;
  const runtime = {
    setPolicyRules: () => undefined,
    setThreadState: () => undefined,
    steerAgentLoop: () => undefined,
    getAgentLoopSnapshot: () => approval ? { status: "awaiting-approval" } : { status: "completed" },
    getSnapshot: () => ({})
  };
  const tasks = new Map<string, { runtime?: typeof runtime; pendingGuidance?: unknown[]; pendingFollowups?: unknown[] }>();
  const service = new ModelChatTaskService({
    canceledRequestIds: canceled,
    registerTask: (requestId: string, task: { runtime: typeof runtime }) => { tasks.set(requestId, task); },
    getTask: (requestId: string) => tasks.get(requestId),
    removeTask: (requestId: string) => { tasks.delete(requestId); },
    createRuntime: async () => runtime,
    disposeRuntime: async () => { disposed += 1; },
    buildShellEnv: async () => ({}),
    configureRuntime: async () => undefined,
    readPolicyRules: async () => [],
    readThreadState: async () => ({ messages: [] }),
    appendDebugLog: async () => undefined
  } as never);

  await service.start({
    requestId: "request-1",
    workspace: { id: "workspace-1", path: "C:/workspace" },
    thread: { id: "thread-1" },
    abortController: new AbortController()
  } as never);
  assert.equal(canceled.has("request-1"), false);
  assert.equal(tasks.has("request-1"), true);

  approval = true;
  assert.equal((await service.finish("request-1")).waitingForApproval, true);
  assert.equal(tasks.has("request-1"), true);
  assert.equal(disposed, 0);
  approval = false;
  assert.equal((await service.finish("request-1")).waitingForApproval, false);
  assert.equal(tasks.has("request-1"), false);
  assert.equal(disposed, 1);
});

test("reserves the thread before runtime initialization and flushes queued guidance", async () => {
  const guided: unknown[] = [];
  function createRuntime() {
    return {
      setPolicyRules: () => undefined,
      setThreadState: () => undefined,
      steerAgentLoop: (message: unknown) => { guided.push(message); },
      getAgentLoopSnapshot: () => ({ status: "completed" }),
      getSnapshot: () => ({})
    };
  }
  type TestRuntime = ReturnType<typeof createRuntime>;
  let resolveRuntime!: (runtime: TestRuntime) => void;
  const runtimePromise = new Promise<TestRuntime>((resolve) => {
    resolveRuntime = resolve;
  });
  const tasks = new Map<string, {
    runtime?: ReturnType<typeof createRuntime>;
    pendingGuidance?: unknown[];
    pendingFollowups?: unknown[];
  }>();
  const service = new ModelChatTaskService({
    canceledRequestIds: new Set<string>(),
    registerTask: (requestId: string, task: { runtime?: ReturnType<typeof createRuntime>; pendingGuidance?: unknown[] }) => {
      tasks.set(requestId, task);
    },
    getTask: (requestId: string) => tasks.get(requestId),
    removeTask: (requestId: string) => { tasks.delete(requestId); },
    createRuntime: () => runtimePromise,
    buildShellEnv: async () => ({}),
    configureRuntime: async () => undefined,
    readPolicyRules: async () => [],
    readThreadState: async () => ({ messages: [] }),
    appendDebugLog: async () => undefined
  } as never);

  const startPromise = service.start({
    requestId: "request-race",
    workspace: { id: "workspace-1", path: "C:/workspace" },
    thread: { id: "thread-1" },
    abortController: new AbortController()
  } as never);

  assert.equal(tasks.has("request-race"), true);
  assert.deepEqual(service.guide("request-race", "hello你好！"), {
    ok: true,
    code: "guide_queued",
    detail: "引用消息将在运行初始化完成后发送。",
    delivery: "steer",
    attachments: []
  });
  resolveRuntime(createRuntime());
  await startPromise;
  assert.deepEqual(guided, ["hello你好！"]);
});

test("releases the reservation when runtime initialization fails", async () => {
  const tasks = new Map<string, { runtime?: unknown; pendingGuidance?: unknown[]; pendingFollowups?: unknown[] }>();
  const service = new ModelChatTaskService({
    canceledRequestIds: new Set<string>(),
    registerTask: (requestId: string, task: { runtime?: unknown; pendingGuidance?: unknown[] }) => {
      tasks.set(requestId, task);
    },
    getTask: (requestId: string) => tasks.get(requestId),
    removeTask: (requestId: string) => { tasks.delete(requestId); },
    createRuntime: async () => { throw new Error("runtime init failed"); },
    buildShellEnv: async () => ({}),
    configureRuntime: async () => undefined,
    readPolicyRules: async () => [],
    readThreadState: async () => ({ messages: [] }),
    appendDebugLog: async () => undefined
  } as never);

  await assert.rejects(service.start({
    requestId: "request-failed",
    workspace: { id: "workspace-1", path: "C:/workspace" },
    thread: { id: "thread-1" },
    abortController: new AbortController()
  } as never), /runtime init failed/);
  assert.equal(tasks.has("request-failed"), false);
});

test("does not block request completion when runtime disposal hangs", async () => {
  const runtime = {
    getAgentLoopSnapshot: () => ({ status: "completed" }),
    getSnapshot: () => ({})
  };
  const tasks = new Map([["request-finished", {
    runtime,
    abortController: new AbortController(),
    workspaceId: "workspace-1",
    threadId: "thread-1",
    pendingGuidance: [],
    pendingFollowups: []
  }]]);
  const service = new ModelChatTaskService({
    canceledRequestIds: new Set<string>(),
    registerTask: () => undefined,
    getTask: (requestId: string) => tasks.get(requestId),
    removeTask: (requestId: string) => { tasks.delete(requestId); },
    disposeRuntime: () => new Promise(() => undefined),
    appendDebugLog: async () => undefined
  } as never);

  const result = await Promise.race([
    service.finish("request-finished"),
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 50))
  ]);

  assert.notEqual(result, "timeout");
  assert.equal(tasks.has("request-finished"), false);
});

test("guides an active runtime exactly once and rejects a completed request", () => {
  const guided: unknown[] = [];
  const runtime = {
    setPolicyRules: () => undefined,
    setThreadState: () => undefined,
    steerAgentLoop: (message: unknown) => { guided.push(message); },
    getAgentLoopSnapshot: () => ({ status: "running" }),
    getSnapshot: () => ({})
  };
  const tasks = new Map([[
    "request-active",
    {
      runtime,
      abortController: new AbortController(),
      workspaceId: "workspace-1",
      threadId: "thread-1",
      pendingGuidance: [],
      pendingFollowups: []
    }
  ]]);
  const service = new ModelChatTaskService({
    canceledRequestIds: new Set<string>(),
    registerTask: (requestId: string, task: typeof tasks extends Map<string, infer T> ? T : never) => {
      tasks.set(requestId, task);
    },
    getTask: (requestId: string) => tasks.get(requestId),
    removeTask: (requestId: string) => { tasks.delete(requestId); },
    appendDebugLog: async () => undefined
  } as never);

  assert.deepEqual(service.guide("request-active", "hello你好！"), {
    ok: true,
    code: "guided",
    detail: "引用消息已发送到当前运行。",
    delivery: "steer",
    attachments: []
  });
  assert.deepEqual(guided, ["hello你好！"]);
  tasks.delete("request-active");
  assert.equal(service.guide("request-active", "LPP").code, "request_not_active");
  assert.deepEqual(guided, ["hello你好！"]);
});

test("queues followups without steering and forwards attachments on steer", () => {
  const guided: unknown[] = [];
  const canceled: string[] = [];
  const runtime = {
    setPolicyRules: () => undefined,
    setThreadState: () => undefined,
    steerAgentLoop: (message: unknown) => { guided.push(message); },
    cancelAgentLoop: (reason?: string) => { canceled.push(reason || ""); },
    getAgentLoopSnapshot: () => ({ status: "running" }),
    getSnapshot: () => ({})
  };
  const tasks = new Map([[
    "request-modes",
    {
      runtime,
      abortController: new AbortController(),
      workspaceId: "workspace-1",
      threadId: "thread-1",
      pendingGuidance: [],
      pendingFollowups: [] as Array<{ message: string; attachments: Array<{ name: string; path: string }>; delivery: string }>
    }
  ]]);
  const service = new ModelChatTaskService({
    canceledRequestIds: new Set<string>(),
    registerTask: (requestId: string, task: typeof tasks extends Map<string, infer T> ? T : never) => {
      tasks.set(requestId, task);
    },
    getTask: (requestId: string) => tasks.get(requestId),
    removeTask: (requestId: string) => { tasks.delete(requestId); },
    appendDebugLog: async () => undefined
  } as never);

  assert.equal(service.guide("request-modes", {
    message: "下一轮再说",
    delivery: "followup"
  }).code, "followup_queued");
  assert.deepEqual(guided, []);
  assert.equal(tasks.get("request-modes")?.pendingFollowups.length, 1);

  assert.deepEqual(service.guide("request-modes", {
    message: "看附件",
    attachments: [{ name: "a.png", path: "C:/a.png" }],
    delivery: "steer"
  }), {
    ok: true,
    code: "guided",
    detail: "引用消息与 1 个附件已发送到当前运行。",
    delivery: "steer",
    attachments: [{ name: "a.png", path: "C:/a.png" }]
  });
  assert.deepEqual(guided, [{
    content: "看附件",
    attachments: [{ name: "a.png", path: "C:/a.png" }]
  }]);

  assert.equal(service.guide("request-modes", {
    message: "改主意了",
    delivery: "interrupt"
  }).code, "interrupt_requested");
  assert.deepEqual(canceled, ["Interrupted by user guidance."]);
  assert.equal(service.finish("request-modes").followups.length, 2);
});

test("returns guide_unavailable when the active runtime cannot be steered", () => {
  const runtime = {
    setPolicyRules: () => undefined,
    setThreadState: () => undefined,
    steerAgentLoop: () => {
      throw new Error("Agent loop has not been started.");
    },
    getAgentLoopSnapshot: () => null,
    getSnapshot: () => ({})
  };
  const tasks = new Map([[
    "request-direct",
    {
      runtime,
      abortController: new AbortController(),
      workspaceId: "workspace-1",
      threadId: "thread-1",
      pendingGuidance: [],
      pendingFollowups: []
    }
  ]]);
  const service = new ModelChatTaskService({
    canceledRequestIds: new Set<string>(),
    registerTask: () => undefined,
    getTask: (requestId: string) => tasks.get(requestId),
    removeTask: (requestId: string) => { tasks.delete(requestId); },
    appendDebugLog: async () => undefined
  } as never);

  const result = service.guide("request-direct", "指定具体主题");
  assert.equal(result.ok, false);
  assert.equal(result.code, "guide_unavailable");
  assert.match(String(result.detail), /暂不可引导|has not been started/);
});

test("clears a failed task even when its runtime still exposes a stale approval", async () => {
  const runtime = {
    setPolicyRules: () => undefined,
    setThreadState: () => undefined,
    getAgentLoopSnapshot: () => ({ status: "awaiting-approval" }),
    getSnapshot: () => ({ approval: { id: "stale-approval" } })
  };
  const tasks = new Map([["request-1", { runtime }]]);
  const service = new ModelChatTaskService({
    canceledRequestIds: new Set<string>(),
    registerTask: () => undefined,
    getTask: (requestId: string) => tasks.get(requestId),
    removeTask: (requestId: string) => { tasks.delete(requestId); },
    createRuntime: async () => runtime,
    buildShellEnv: async () => ({}),
    configureRuntime: async () => undefined,
    readPolicyRules: async () => [],
    readThreadState: async () => ({ messages: [] }),
    appendDebugLog: async () => undefined
  } as never);

  assert.equal(service.finish("request-1", { retainForApproval: false }).waitingForApproval, false);
  assert.equal(tasks.has("request-1"), false);
});

test("freezes TurnScope at start and patchScope cannot retarget another thread", async () => {
  const tasks = new Map<string, any>();
  const service = new ModelChatTaskService({
    canceledRequestIds: new Set<string>(),
    registerTask: (requestId: string, task: unknown) => { tasks.set(requestId, task); },
    getTask: (requestId: string) => tasks.get(requestId),
    removeTask: (requestId: string) => { tasks.delete(requestId); },
    createRuntime: async () => ({
      setPolicyRules: () => undefined,
      setThreadState: () => undefined,
      steerAgentLoop: () => undefined,
      getAgentLoopSnapshot: () => ({ status: "completed" }),
      getSnapshot: () => ({})
    }),
    disposeRuntime: async () => undefined,
    buildShellEnv: async () => ({}),
    configureRuntime: async () => undefined,
    readPolicyRules: async () => [],
    readThreadState: async () => ({ messages: [] }),
    appendDebugLog: async () => undefined
  } as never);

  const started = await service.start({
    requestId: "request-a",
    workspace: { id: "workspace-1", path: "C:/workspace" },
    thread: { id: "thread-a" },
    abortController: new AbortController(),
    turnId: "turn-a"
  } as never);

  assert.equal(started.scope.threadId, "thread-a");
  assert.equal(started.scope.turnId, "turn-a");
  assert.equal(tasks.get("request-a").scope.threadId, "thread-a");

  const patched = service.patchScope("request-a", {
    springTurnId: "spring-1",
    mediaJobId: "job-1"
  });
  assert.equal(patched?.threadId, "thread-a");
  assert.equal(tasks.get("request-a").scope.springTurnId, "spring-1");
  assert.equal(tasks.get("request-a").threadId, "thread-a");

  // Simulate UI switching to another thread while the task is still running.
  assert.equal(service.requireTask("request-a").scope.threadId, "thread-a");
  assert.notEqual(service.requireTask("request-a").scope.threadId, "thread-b");
});
