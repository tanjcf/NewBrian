import assert from "node:assert/strict";
import test from "node:test";

const bridgeModule = await import(
  new URL("./agent-host-loop-bridge.ts", import.meta.url).href
);

function createLocalRuntime() {
  const calls: unknown[] = [];
  const runtime = {
    sessionMachine: { events: [] as unknown[] },
    getToolDescriptors: () => [{
      name: "echo",
      title: "Echo",
      description: "Echo text",
      kind: "read",
      risk: "low",
      requiresApproval: true,
      inputSchema: { type: "object", properties: {} }
    }],
    evaluateToolPolicy: (
      descriptor: unknown,
      argumentsValue: unknown,
      permissionMode: string
    ) => {
      calls.push({ kind: "policy", descriptor, argumentsValue, permissionMode });
      return { decision: "ask", source: "desktop-policy", reason: "approval" };
    },
    invokeTool: async (name: string, input: unknown, options: unknown) => {
      calls.push({ kind: "tool", name, input, options });
      return { ok: true, output: "done" };
    },
    loadSkill: async () => ({}),
    searchMemories: () => [],
    setThreadState: () => undefined,
    getSnapshot: () => ({ session: { status: "idle" } })
  };
  return { runtime, calls };
}

test("keeps local capabilities while routing the loop lifecycle to the host", async () => {
  const requests: Array<{ method: string; payload: unknown }> = [];
  let resolveAdvance!: (value: unknown) => void;
  const advanceResult = new Promise((resolve) => {
    resolveAdvance = resolve;
  });
  const client = {
    async request(method: string, payload: unknown) {
      requests.push({ method, payload });
      if (method === "agent.loop.advance") return advanceResult;
      if (method === "agent.loop.start") {
        return {
          status: "running",
          messages: [],
          pending: null,
          steps: 0,
          finalContent: ""
        };
      }
      return { created: true };
    }
  };
  const local = createLocalRuntime();
  const bridge = new bridgeModule.AgentHostLoopBridge({ client });
  const runtime = await bridge.createRuntime(local.runtime, {
    runtimeId: "runtime_1",
    workspacePath: "C:/workspace",
    platformLabel: "Windows",
    shellLabel: "PowerShell"
  });
  const abortController = new AbortController();

  runtime.startAgentLoop([{ role: "user", content: "hello" }], {
    permissionMode: "approval",
    maxSteps: 8,
    allowedToolNames: ["echo"],
    abortController,
    onEvent: () => undefined
  });
  await new Promise((resolve) => setImmediate(resolve));
  const modelCallback = async () => ({ content: "done", toolCalls: [] });
  const advancing = runtime.advanceAgentLoop(modelCallback);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(await bridge.handleModelRequest({
    runtimeId: "runtime_1",
    callbackId: "model_1",
    input: { messages: [], tools: [], step: 1 }
  }), { content: "done", toolCalls: [] });
  assert.deepEqual(await bridge.handlePolicyRequest({
    runtimeId: "runtime_1",
    callbackId: "policy_1",
    input: {
      descriptor: local.runtime.getToolDescriptors()[0],
      call: { id: "call_1", name: "echo", arguments: {} },
      permissionMode: "approval"
    }
  }), {
    decision: "allow",
    source: "agent-review",
    ruleId: ":agent-auto-review",
    reason: "approval"
  });
  assert.deepEqual(await bridge.handleToolRequest({
    runtimeId: "runtime_1",
    callbackId: "tool_1",
    input: { name: "echo", arguments: { text: "hello" } }
  }), { ok: true, output: "done" });

  const completed = {
    status: "completed",
    messages: [],
    pending: null,
    steps: 1,
    finalContent: "done"
  };
  resolveAdvance(completed);
  assert.deepEqual(await advancing, completed);
  assert.deepEqual(runtime.getAgentLoopSnapshot(), completed);
  assert.deepEqual(await runtime.loadSkill("demo"), {});
  assert.deepEqual(local.calls.at(-1), {
    kind: "tool",
    name: "echo",
    input: { text: "hello" },
    options: { permissionMode: "full", approved: true }
  });
  assert.deepEqual(requests[1], {
    method: "agent.loop.start",
    payload: {
      runtimeId: "runtime_1",
      messages: [{ role: "user", content: "hello" }],
      options: {
        permissionMode: "agent",
        maxSteps: 8,
        allowedToolNames: ["echo"],
        toolDescriptors: local.runtime.getToolDescriptors()
      }
    }
  });
});

test("agent-managed approval still pauses explicitly high-risk operations", async () => {
  const local = createLocalRuntime();
  const bridge = new bridgeModule.AgentHostLoopBridge({
    client: { async request() { return { created: true }; } }
  });
  await bridge.createRuntime(local.runtime, {
    runtimeId: "runtime_high_risk",
    workspacePath: "C:/workspace",
    platformLabel: "Windows",
    shellLabel: "PowerShell"
  });
  const decision = await bridge.handlePolicyRequest({
    runtimeId: "runtime_high_risk",
    callbackId: "policy_high",
    input: {
      descriptor: { ...local.runtime.getToolDescriptors()[0], risk: "high" },
      call: { id: "call_high", name: "echo", arguments: {} },
      permissionMode: "agent"
    }
  });
  assert.deepEqual(decision, { decision: "ask", source: "desktop-policy", reason: "approval" });
});

test("forwards official evidence tools registered on a task runtime into Agent Host", async () => {
  const requests: Array<{ method: string; payload: any }> = [];
  const descriptors = [{
    name: "goal.get", title: "Goal", description: "Read goal", kind: "read", risk: "low",
    requiresApproval: false, inputSchema: { type: "object", properties: {} }
  }];
  const local = createLocalRuntime();
  local.runtime.getToolDescriptors = () => descriptors;
  const bridge = new bridgeModule.AgentHostLoopBridge({
    client: {
      async request(method: string, payload: unknown) {
        requests.push({ method, payload });
        return method === "agent.loop.start"
          ? { status: "running", messages: [], pending: null, steps: 0, finalContent: "" }
          : { created: true };
      }
    }
  });
  const runtime = await bridge.createRuntime(local.runtime, {
    runtimeId: "government_runtime",
    workspacePath: "C:/workspace",
    platformLabel: "Windows",
    shellLabel: "PowerShell"
  });

  // Production configures task-specific tools after the hosted proxy exists.
  descriptors.push(
    {
      name: "web.search_official", title: "Search official", description: "Search gov.cn",
      kind: "read", risk: "low", requiresApproval: false, inputSchema: { type: "object", properties: {} }
    },
    {
      name: "web.read_official", title: "Read official", description: "Read gov.cn",
      kind: "read", risk: "low", requiresApproval: false, inputSchema: { type: "object", properties: {} }
    }
  );
  runtime.startAgentLoop([{ role: "user", content: "government case study" }], {
    permissionMode: "approval",
    allowedToolNames: undefined
  });
  await new Promise((resolve) => setImmediate(resolve));

  const start = requests.find((item) => item.method === "agent.loop.start");
  assert.deepEqual(
    start?.payload.options.toolDescriptors.map((tool: { name: string }) => tool.name),
    ["goal.get", "web.search_official", "web.read_official"]
  );
});

test("projects host events and cancellation into the owning local runtime", async () => {
  const client = {
    async request(method: string) {
      if (method === "agent.loop.cancel") {
        return {
          status: "failed",
          messages: [],
          pending: null,
          steps: 1,
          finalContent: "cancelled"
        };
      }
      return { created: true };
    }
  };
  const local = createLocalRuntime();
  const bridge = new bridgeModule.AgentHostLoopBridge({ client });
  const runtime = await bridge.createRuntime(local.runtime, {
    runtimeId: "runtime_1",
    workspacePath: "C:/workspace",
    platformLabel: "Windows",
    shellLabel: "PowerShell"
  });
  const observed: unknown[] = [];
  runtime.startAgentLoop([], {
    onEvent: (event: unknown) => observed.push(event)
  });

  bridge.handleHostEvent({
    runtimeId: "runtime_1",
    event: { type: "tool_call", payload: { id: "call-1", name: "goal.get", arguments: {} } }
  });
  runtime.cancelAgentLoop("cancelled");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(local.runtime.sessionMachine.events, [{
    type: "tool_call",
    payload: { id: "call-1", name: "goal.get", arguments: {} }
  }]);
  assert.deepEqual(observed, [{
    type: "tool_call",
    payload: { id: "call-1", name: "goal.get", arguments: {} }
  }]);
  assert.equal(runtime.getAgentLoopSnapshot()?.status, "failed");
});

test("coalesces overlapping approval resumes without clearing the active model callback", async () => {
  const requests: Array<{ method: string; payload: unknown }> = [];
  let resolveResume!: (value: unknown) => void;
  const resumeResult = new Promise((resolve) => {
    resolveResume = resolve;
  });
  const client = {
    async request(method: string, payload: unknown) {
      requests.push({ method, payload });
      if (method === "agent.loop.start") {
        return { status: "awaiting-approval", messages: [], pending: {}, steps: 1, finalContent: "" };
      }
      if (method === "agent.loop.resume-approval") return resumeResult;
      return { created: true };
    }
  };
  const local = createLocalRuntime();
  const bridge = new bridgeModule.AgentHostLoopBridge({ client });
  const runtime = await bridge.createRuntime(local.runtime, {
    runtimeId: "runtime_1",
    workspacePath: "C:/workspace",
    platformLabel: "Windows",
    shellLabel: "PowerShell"
  });
  runtime.startAgentLoop([], {});
  await new Promise((resolve) => setImmediate(resolve));
  const callback = async () => ({ content: "done", toolCalls: [] });

  const first = runtime.resumeAgentApproval(true, callback);
  const duplicate = runtime.resumeAgentApproval(true, callback);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    requests.filter((request) => request.method === "agent.loop.resume-approval").length,
    1
  );
  assert.deepEqual(await bridge.handleModelRequest({
    runtimeId: "runtime_1",
    callbackId: "model_1",
    input: { messages: [], tools: [], step: 2 }
  }), { content: "done", toolCalls: [] });

  const completed = { status: "completed", messages: [], pending: null, steps: 2, finalContent: "done" };
  resolveResume(completed);
  assert.deepEqual(await first, completed);
  assert.deepEqual(await duplicate, completed);
});

test("forwards stream progress while a host model callback is active", async () => {
  const client = {
    async request() {
      return { created: true };
    }
  };
  const local = createLocalRuntime();
  const bridge = new bridgeModule.AgentHostLoopBridge({ client });
  await bridge.createRuntime(local.runtime, {
    runtimeId: "runtime_progress",
    workspacePath: "C:/workspace",
    platformLabel: "Windows",
    shellLabel: "PowerShell"
  });
  const progress: number[] = [];
  const entry = (bridge as unknown as {
    entries: Map<string, { modelCallback?: (input: unknown) => Promise<unknown> }>;
  }).entries.get("runtime_progress");
  assert.ok(entry);
  entry!.modelCallback = async () => {
    bridge.notifyModelStreamProgress();
    bridge.notifyModelStreamProgress();
    return { content: "streamed", toolCalls: [] };
  };
  assert.deepEqual(await bridge.handleModelRequest({
    runtimeId: "runtime_progress",
    callbackId: "model_progress",
    input: {},
    reportProgress: () => progress.push(1)
  }), { content: "streamed", toolCalls: [] });
  // Immediate heartbeat + two stream notifies (interval may add more if slow).
  assert.ok(progress.length >= 3, `expected heartbeat+stream progress, got ${progress.length}`);
  const after = progress.length;
  bridge.notifyModelStreamProgress();
  assert.equal(progress.length, after);
});

test("heartbeats reportProgress while a long model callback waits for first token", async () => {
  const local = createLocalRuntime();
  let releaseModel: ((value: unknown) => void) | undefined;
  const bridge = new bridgeModule.AgentHostLoopBridge({
    client: {
      async request() {
        return { created: true };
      }
    }
  });
  await bridge.createRuntime(local.runtime, {
    runtimeId: "runtime_model_heartbeat",
    workspacePath: "C:/workspace",
    platformLabel: "Windows",
    shellLabel: "PowerShell"
  });
  const entry = (bridge as unknown as {
    entries: Map<string, { modelCallback?: (input: unknown) => Promise<unknown> }>;
  }).entries.get("runtime_model_heartbeat");
  assert.ok(entry);
  entry!.modelCallback = async () => new Promise((resolve) => {
    releaseModel = resolve;
  });
  const progress: number[] = [];
  const pending = bridge.handleModelRequest({
    runtimeId: "runtime_model_heartbeat",
    callbackId: "model_slow",
    input: {},
    reportProgress: () => progress.push(Date.now()),
    progressHeartbeatMs: 25
  });
  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.ok(progress.length >= 3, `expected heartbeats while model waits, got ${progress.length}`);
  assert.ok(releaseModel);
  releaseModel!({ content: "late", toolCalls: [] });
  assert.deepEqual(await pending, { content: "late", toolCalls: [] });
  const after = progress.length;
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(progress.length, after);
});

test("heartbeats reportProgress while a long tool callback stays in flight", async () => {
  const local = createLocalRuntime();
  let releaseTool: ((value: unknown) => void) | undefined;
  local.runtime.invokeTool = async () => new Promise((resolve) => {
    releaseTool = resolve;
  });
  const bridge = new bridgeModule.AgentHostLoopBridge({
    client: {
      async request() {
        return { created: true };
      }
    }
  });
  await bridge.createRuntime(local.runtime, {
    runtimeId: "runtime_tool_heartbeat",
    workspacePath: "C:/workspace",
    platformLabel: "Windows",
    shellLabel: "PowerShell"
  });
  const progress: number[] = [];
  const pending = bridge.handleToolRequest({
    runtimeId: "runtime_tool_heartbeat",
    callbackId: "tool_slow",
    input: { name: "echo", arguments: { text: "hello" } },
    reportProgress: () => progress.push(Date.now()),
    progressHeartbeatMs: 25
  });
  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.ok(progress.length >= 3, `expected heartbeats while tool runs, got ${progress.length}`);
  assert.ok(releaseTool);
  releaseTool!({ ok: true, output: "done" });
  assert.deepEqual(await pending, { ok: true, output: "done" });
  const after = progress.length;
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(progress.length, after);
});

test("heartbeats reportProgress while approval policy evaluation waits", async () => {
  const local = createLocalRuntime();
  let releasePolicy: ((value: unknown) => void) | undefined;
  local.runtime.evaluateToolPolicy = async () => new Promise((resolve) => {
    releasePolicy = resolve;
  });
  const bridge = new bridgeModule.AgentHostLoopBridge({
    client: {
      async request() {
        return { created: true };
      }
    }
  });
  await bridge.createRuntime(local.runtime, {
    runtimeId: "runtime_policy_heartbeat",
    workspacePath: "C:/workspace",
    platformLabel: "Windows",
    shellLabel: "PowerShell"
  });
  const progress: number[] = [];
  const pending = bridge.handlePolicyRequest({
    runtimeId: "runtime_policy_heartbeat",
    callbackId: "policy_wait",
    input: {
      descriptor: local.runtime.getToolDescriptors()[0],
      call: { id: "call_1", name: "echo", arguments: {} },
      permissionMode: "approval"
    },
    reportProgress: () => progress.push(1),
    progressHeartbeatMs: 20
  });
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.ok(progress.length >= 3, `expected approval wait heartbeats, got ${progress.length}`);
  assert.ok(releasePolicy);
  releasePolicy!({ decision: "allow", source: "desktop-policy", reason: "" });
  assert.deepEqual(await pending, { decision: "allow", source: "desktop-policy", reason: "" });
});

test("ignores late advance snapshots after cancel so approval cannot revive", async () => {
  let resolveAdvance!: (value: unknown) => void;
  const advanceResult = new Promise((resolve) => {
    resolveAdvance = resolve;
  });
  const client = {
    async request(method: string) {
      if (method === "agent.loop.start") {
        return { status: "running", messages: [], pending: null, steps: 0, finalContent: "" };
      }
      if (method === "agent.loop.advance") return advanceResult;
      if (method === "agent.loop.cancel") {
        return { status: "failed", messages: [], pending: null, steps: 1, finalContent: "cancelled" };
      }
      return { created: true };
    }
  };
  const local = createLocalRuntime();
  const bridge = new bridgeModule.AgentHostLoopBridge({ client });
  const runtime = await bridge.createRuntime(local.runtime, {
    runtimeId: "runtime_cancel_race",
    workspacePath: "C:/workspace",
    platformLabel: "Windows",
    shellLabel: "PowerShell"
  });
  runtime.startAgentLoop([], {});
  await new Promise((resolve) => setImmediate(resolve));

  const pendingAdvance = runtime.advanceAgentLoop(async () => ({ content: "late", toolCalls: [] }));
  runtime.cancelAgentLoop("user cancelled");
  assert.equal(runtime.getAgentLoopSnapshot()?.status, "failed");
  assert.equal((local.runtime.sessionMachine as { snapshot?: { approval?: unknown } }).snapshot?.approval, undefined);

  resolveAdvance({
    status: "awaiting-approval",
    messages: [],
    pending: { call: { name: "shell.exec" } },
    steps: 1,
    finalContent: ""
  });
  await pendingAdvance.catch(() => undefined);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(runtime.getAgentLoopSnapshot()?.status, "failed");
  assert.equal(bridge.cancelByRuntimeId("runtime_cancel_race", "again"), true);
  await assert.rejects(
    () => runtime.advanceAgentLoop(async () => ({ content: "nope", toolCalls: [] })),
    /Agent loop was cancelled/
  );
});

test("forwards a mid-run full-access switch to the host loop", async () => {
  const requests: Array<{ method: string; payload: unknown }> = [];
  const client = {
    async request(method: string, payload: unknown) {
      requests.push({ method, payload });
      return { permissionMode: "full" };
    }
  };
  const local = createLocalRuntime();
  const modes: string[] = [];
  (local.runtime as { setAgentLoopPermissionMode?: (mode: string) => void }).setAgentLoopPermissionMode = (mode) => {
    modes.push(mode);
  };
  const bridge = new bridgeModule.AgentHostLoopBridge({ client });
  const runtime = await bridge.createRuntime(local.runtime, {
    runtimeId: "runtime_1",
    workspacePath: "C:/workspace",
    platformLabel: "Windows",
    shellLabel: "PowerShell"
  });
  await runtime.setAgentLoopPermissionMode("full");
  assert.deepEqual(modes, ["full"]);
  assert.deepEqual(requests.at(-1), {
    method: "agent.loop.set-permission-mode",
    payload: { runtimeId: "runtime_1", permissionMode: "full" }
  });
});
