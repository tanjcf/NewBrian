import assert from "node:assert/strict";
import test from "node:test";

const serviceModule = await import(new URL("./agent-host-agent-service.ts", import.meta.url).href);

function createFixture() {
  const calls: string[] = [];
  const events: unknown[] = [];
  const runtime = {
    sessionMachine: { events },
    startAgentLoop(messages: unknown[]) {
      calls.push(`start:${messages.length}`);
      events.push({ type: "agent_loop_started", payload: { messageCount: messages.length } });
      return { status: "running", messages, pending: null, steps: 0, finalContent: "" };
    },
    restoreAgentLoop(snapshot: { status: string }) {
      calls.push(`restore:${snapshot.status}`);
      return snapshot;
    },
    async advanceAgentLoop(callModel: (input: unknown) => Promise<unknown>) {
      calls.push("advance");
      const response = await callModel({ messages: [{ role: "user", content: "hello" }], tools: [], step: 1 });
      events.push({ type: "agent_loop_completed", payload: { step: 1 } });
      return { status: "completed", messages: [], pending: null, steps: 1, finalContent: (response as { content: string }).content };
    },
    async resumeAgentApproval(approved: boolean, callModel: (input: unknown) => Promise<unknown>) {
      calls.push(`approval:${approved}`);
      await callModel({ messages: [], tools: [], step: 2 });
      return { status: "completed", messages: [], pending: null, steps: 2, finalContent: "approved" };
    },
    getAgentLoopSnapshot() {
      calls.push("snapshot");
      return { status: "running", messages: [], pending: null, steps: 1, finalContent: "" };
    },
    steerAgentLoop(message: string) {
      calls.push(`steer:${message}`);
      return { status: "running", messages: [], pending: null, steps: 1, finalContent: "" };
    },
    cancelAgentLoop(reason: string) {
      calls.push(`cancel:${reason}`);
      return { status: "failed", messages: [], pending: null, steps: 1, finalContent: reason };
    },
    async shutdown() {
      calls.push("shutdown");
    }
  };
  return { calls, events, runtime };
}

test("owns runtime lifecycle and correlates model callbacks", async () => {
  const fixture = createFixture();
  const modelRequests: unknown[] = [];
  const service = new serviceModule.AgentHostAgentService({
    createRuntime: async () => fixture.runtime,
    requestModel: async (runtimeId: string, input: unknown) => {
      modelRequests.push({ runtimeId, input });
      return { content: "done", toolCalls: [] };
    }
  });

  await service.create({ runtimeId: "runtime_1", workspacePath: "C:/workspace", platformLabel: "Windows", shellLabel: "PowerShell" });
  await assert.rejects(
    service.create({ runtimeId: "runtime_1", workspacePath: "C:/other", platformLabel: "Windows", shellLabel: "PowerShell" }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "runtime_exists"
  );

  assert.equal((await service.start("runtime_1", [{ role: "user", content: "hello" }], {})).status, "running");
  assert.equal((await service.advance("runtime_1")).finalContent, "done");
  assert.equal((await service.resumeApproval("runtime_1", true)).finalContent, "approved");
  assert.equal(service.snapshot("runtime_1").status, "running");
  assert.equal(service.steer("runtime_1", "focus").status, "running");
  assert.equal(service.cancel("runtime_1", "cancelled").status, "failed");
  assert.deepEqual(modelRequests, [
    { runtimeId: "runtime_1", input: { messages: [{ role: "user", content: "hello" }], tools: [], step: 1 } },
    { runtimeId: "runtime_1", input: { messages: [], tools: [], step: 2 } }
  ]);

  await service.dispose("runtime_1");
  await assert.rejects(
    service.advance("runtime_1"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "runtime_not_found"
  );
  assert.deepEqual(fixture.calls, [
    "start:1",
    "advance",
    "approval:true",
    "snapshot",
    "steer:focus",
    "cancel:cancelled",
    "shutdown"
  ]);
});

test("returns only new ordered runtime events from each operation", async () => {
  const fixture = createFixture();
  const published: unknown[] = [];
  const service = new serviceModule.AgentHostAgentService({
    createRuntime: async () => fixture.runtime,
    requestModel: async () => ({ content: "done", toolCalls: [] }),
    publishEvent: (runtimeId: string, event: unknown) => published.push({ runtimeId, event })
  });

  await service.create({ runtimeId: "runtime_1", workspacePath: "C:/workspace", platformLabel: "Windows", shellLabel: "PowerShell" });
  await service.start("runtime_1", [{ role: "user", content: "hello" }], {});
  await service.advance("runtime_1");

  assert.deepEqual(published, [
    { runtimeId: "runtime_1", event: { type: "agent_loop_started", payload: { messageCount: 1 } } },
    { runtimeId: "runtime_1", event: { type: "agent_loop_completed", payload: { step: 1 } } }
  ]);
});

test("publishes session events immediately through onSessionEvent for mid-tool durability", async () => {
  const published: unknown[] = [];
  let sessionHook: ((event: unknown) => void) | undefined;
  const events: unknown[] = [];
  const runtime = {
    sessionMachine: { events },
    startAgentLoop() {
      return { status: "running", messages: [], pending: null, steps: 0, finalContent: "" };
    },
    restoreAgentLoop(snapshot: unknown) { return snapshot; },
    async advanceAgentLoop() {
      const toolCall = { type: "tool_call", payload: { id: "call-1", name: "shell.exec" } };
      events.push(toolCall);
      sessionHook?.(toolCall);
      const toolResult = { type: "tool_result", payload: { callId: "call-1", name: "shell.exec", result: { ok: true } } };
      events.push(toolResult);
      sessionHook?.(toolResult);
      return { status: "completed", messages: [], pending: null, steps: 1, finalContent: "done" };
    },
    async resumeAgentApproval() {
      return { status: "completed", messages: [], pending: null, steps: 1, finalContent: "done" };
    },
    getAgentLoopSnapshot() {
      return { status: "running", messages: [], pending: null, steps: 0, finalContent: "" };
    },
    steerAgentLoop() {
      return { status: "running", messages: [], pending: null, steps: 0, finalContent: "" };
    },
    cancelAgentLoop(reason: string) {
      return { status: "failed", messages: [], pending: null, steps: 0, finalContent: reason };
    }
  };
  const service = new serviceModule.AgentHostAgentService({
    createRuntime: async (input: { onSessionEvent?: (event: unknown) => void }) => {
      sessionHook = input.onSessionEvent;
      return runtime;
    },
    requestModel: async () => ({ content: "done", toolCalls: [] }),
    publishEvent: (runtimeId: string, event: unknown) => published.push({ runtimeId, event })
  });

  await service.create({ runtimeId: "runtime_1", workspacePath: "C:/workspace", platformLabel: "Windows", shellLabel: "PowerShell" });
  await service.advance("runtime_1");

  assert.deepEqual(published.map((item: any) => item.event.type), ["tool_call", "tool_result"]);
});

test("delegates model callback resolution and callback shutdown", async () => {
  const resolved: unknown[] = [];
  let callbacksStopped = 0;
  const service = new serviceModule.AgentHostAgentService({
    createRuntime: async () => createFixture().runtime,
    requestModel: async () => ({ content: "done", toolCalls: [] }),
    resolveModel: (callbackId: string, result: unknown, error: unknown) => {
      resolved.push({ kind: "model", callbackId, result, error });
      return { callbackId, resolved: true };
    },
    resolvePolicy: (callbackId: string, result: unknown, error: unknown) => {
      resolved.push({ kind: "policy", callbackId, result, error });
      return { callbackId, resolved: true };
    },
    resolveTool: (callbackId: string, result: unknown, error: unknown) => {
      resolved.push({ kind: "tool", callbackId, result, error });
      return { callbackId, resolved: true };
    },
    shutdownModelCallbacks: () => {
      callbacksStopped += 1;
    }
  });

  assert.deepEqual(
    service.resolveModel("callback_1", { content: "done" }, undefined),
    { callbackId: "callback_1", resolved: true }
  );
  assert.deepEqual(
    service.resolvePolicy("callback_2", { decision: "allow" }, undefined),
    { callbackId: "callback_2", resolved: true }
  );
  assert.deepEqual(
    service.resolveTool("callback_3", { ok: true }, undefined),
    { callbackId: "callback_3", resolved: true }
  );
  await service.shutdown();

  assert.deepEqual(resolved, [{
    kind: "model",
    callbackId: "callback_1",
    result: { content: "done" },
    error: undefined
  }, {
    kind: "policy",
    callbackId: "callback_2",
    result: { decision: "allow" },
    error: undefined
  }, {
    kind: "tool",
    callbackId: "callback_3",
    result: { ok: true },
    error: undefined
  }]);
  assert.equal(callbacksStopped, 1);
});
