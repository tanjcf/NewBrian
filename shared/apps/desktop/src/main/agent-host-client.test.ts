import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

const clientModule = await import(new URL("./agent-host-client.ts", import.meta.url).href);

function fakeHost(pid: number) {
  const host = new EventEmitter() as EventEmitter & {
    pid: number;
    exitCode: number | null;
    killed: boolean;
    connected: boolean;
    sent: unknown[];
    send(message: unknown, callback?: (error: Error | null) => void): boolean;
    kill(): boolean;
  };
  host.pid = pid;
  host.exitCode = null;
  host.killed = false;
  host.connected = true;
  host.sent = [];
  host.send = (message, callback) => { host.sent.push(message); callback?.(null); return true; };
  host.kill = () => { host.killed = true; return true; };
  return host;
}

test("lazily starts one host and correlates out-of-order responses", async () => {
  const host = fakeHost(100);
  let forks = 0;
  const client = new clientModule.AgentHostClient({
    entryPath: "agent-host-entry.js",
    forkProcess: () => { forks += 1; return host; }
  });

  const first = client.request("terminal.snapshot", {});
  const second = client.request("mcp.logs.get", { serverId: "mcp_1" });
  await new Promise((resolve) => setImmediate(resolve));
  const firstId = (host.sent[0] as { id: string }).id;
  const secondId = (host.sent[1] as { id: string }).id;
  host.emit("message", { version: 1, kind: "response", id: secondId, ok: true, result: ["log"] });
  host.emit("message", { version: 1, kind: "response", id: firstId, ok: true, result: { running: false } });

  assert.deepEqual(await first, { running: false });
  assert.deepEqual(await second, ["log"]);
  assert.equal(forks, 1);
});

test("forwards validated host events", async () => {
  const host = fakeHost(101);
  const events: unknown[] = [];
  const client = new clientModule.AgentHostClient({ entryPath: "entry.js", forkProcess: () => host, onEvent: (event: unknown) => events.push(event) });
  const pending = client.request("terminal.snapshot", {});
  await new Promise((resolve) => setImmediate(resolve));

  host.emit("message", { version: 1, kind: "event", event: "terminal.update", payload: { isRunning: true } });
  const requestId = (host.sent[0] as { id: string }).id;
  host.emit("message", { version: 1, kind: "response", id: requestId, ok: true, result: {} });
  await pending;

  assert.deepEqual(events, [{ version: 1, kind: "event", event: "terminal.update", payload: { isRunning: true } }]);
});

test("resolves host model callback events through a correlated agent request", async () => {
  const host = fakeHost(106);
  const modelInputs: unknown[] = [];
  const client = new clientModule.AgentHostClient({
    entryPath: "entry.js",
    forkProcess: () => host,
    onModelRequest: async (input: unknown) => {
      modelInputs.push(input);
      return { content: "done", toolCalls: [] };
    }
  });
  const advance = client.request("agent.loop.advance", { runtimeId: "runtime_1" });
  await new Promise((resolve) => setImmediate(resolve));
  const advanceId = (host.sent[0] as { id: string }).id;

  host.emit("message", {
    version: 1,
    kind: "event",
    event: "agent.model.request",
    payload: {
      runtimeId: "runtime_1",
      callbackId: "callback_1",
      input: { messages: [{ role: "user", content: "hello" }], tools: [], step: 1 }
    }
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(modelInputs.length, 1);
  const modelInput = modelInputs[0] as {
    runtimeId: string;
    callbackId: string;
    input: unknown;
    reportProgress: unknown;
  };
  assert.equal(modelInput.runtimeId, "runtime_1");
  assert.equal(modelInput.callbackId, "callback_1");
  assert.deepEqual(modelInput.input, { messages: [{ role: "user", content: "hello" }], tools: [], step: 1 });
  assert.equal(typeof modelInput.reportProgress, "function");
  const resolution = host.sent[1] as {
    id: string;
    method: string;
    payload: unknown;
  };
  assert.equal(resolution.method, "agent.model.resolve");
  assert.deepEqual(resolution.payload, {
    callbackId: "callback_1",
    result: { content: "done", toolCalls: [] }
  });

  host.emit("message", {
    version: 1,
    kind: "response",
    id: resolution.id,
    ok: true,
    result: { resolved: true }
  });
  host.emit("message", {
    version: 1,
    kind: "response",
    id: advanceId,
    ok: true,
    result: { status: "completed", finalContent: "done" }
  });
  assert.deepEqual(await advance, { status: "completed", finalContent: "done" });
});

test("resolves host policy and tool callbacks through dedicated handlers", async () => {
  const host = fakeHost(107);
  const callbacks: unknown[] = [];
  const client = new clientModule.AgentHostClient({
    entryPath: "entry.js",
    forkProcess: () => host,
    onPolicyRequest: async (input: unknown) => {
      callbacks.push({ kind: "policy", input });
      return { decision: "allow", source: "desktop-policy", reason: "" };
    },
    onToolRequest: async (input: unknown) => {
      callbacks.push({ kind: "tool", input });
      return { ok: true, output: "done" };
    }
  });
  const started = client.request("terminal.snapshot", {});
  await new Promise((resolve) => setImmediate(resolve));

  host.emit("message", {
    version: 1,
    kind: "event",
    event: "agent.policy.request",
    payload: {
      runtimeId: "runtime_1",
      callbackId: "policy_1",
      input: { call: { id: "call_1", name: "echo", arguments: {} } }
    }
  });
  host.emit("message", {
    version: 1,
    kind: "event",
    event: "agent.tool.request",
    payload: {
      runtimeId: "runtime_1",
      callbackId: "tool_1",
      input: { name: "echo", arguments: { text: "hello" } }
    }
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(callbacks.length, 2);
  const policyCallback = callbacks[0] as { kind: string; input: { runtimeId: string; callbackId: string; input: unknown; reportProgress: unknown } };
  const toolCallback = callbacks[1] as { kind: string; input: { runtimeId: string; callbackId: string; input: unknown; reportProgress: unknown } };
  assert.equal(policyCallback.kind, "policy");
  assert.equal(policyCallback.input.runtimeId, "runtime_1");
  assert.equal(policyCallback.input.callbackId, "policy_1");
  assert.deepEqual(policyCallback.input.input, { call: { id: "call_1", name: "echo", arguments: {} } });
  assert.equal(typeof policyCallback.input.reportProgress, "function");
  assert.equal(toolCallback.kind, "tool");
  assert.equal(toolCallback.input.runtimeId, "runtime_1");
  assert.equal(toolCallback.input.callbackId, "tool_1");
  assert.deepEqual(toolCallback.input.input, { name: "echo", arguments: { text: "hello" } });
  assert.equal(typeof toolCallback.input.reportProgress, "function");
  assert.deepEqual(
    host.sent.slice(1).map((message) => ({
      method: (message as { method: string }).method,
      payload: (message as { payload: unknown }).payload
    })),
    [{
      method: "agent.policy.resolve",
      payload: {
        callbackId: "policy_1",
        result: { decision: "allow", source: "desktop-policy", reason: "" }
      }
    }, {
      method: "agent.tool.resolve",
      payload: {
        callbackId: "tool_1",
        result: { ok: true, output: "done" }
      }
    }]
  );

  for (const resolution of host.sent.slice(1) as Array<{ id: string }>) {
    host.emit("message", {
      version: 1,
      kind: "response",
      id: resolution.id,
      ok: true,
      result: { resolved: true }
    });
  }
  const initialId = (host.sent[0] as { id: string }).id;
  host.emit("message", {
    version: 1,
    kind: "response",
    id: initialId,
    ok: true,
    result: {}
  });
  await started;
});

test("keeps control requests pending until a response or host exit", async () => {
  const host = fakeHost(102);
  const client = new clientModule.AgentHostClient({ entryPath: "entry.js", forkProcess: () => host });
  const pending = client.request("terminal.snapshot", {});
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(client.pendingCount, 1);
  const requestId = (host.sent[0] as { id: string }).id;
  host.emit("message", { version: 1, kind: "response", id: requestId, ok: true, result: { completed: true } });
  assert.deepEqual(await pending, { completed: true });
  assert.equal(client.pendingCount, 0);
});

test("keeps model loop requests alive beyond the bounded control timeout", async () => {
  const host = fakeHost(109);
  const client = new clientModule.AgentHostClient({
    entryPath: "entry.js",
    forkProcess: () => host
  });
  const pending = client.request("agent.loop.advance", { runtimeId: "runtime-1" });

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(client.pendingCount, 1);
  const requestId = (host.sent[0] as { id: string }).id;
  host.emit("message", {
    version: 1,
    kind: "response",
    id: requestId,
    ok: true,
    result: { status: "completed" }
  });

  assert.deepEqual(await pending, { status: "completed" });
  assert.equal(client.pendingCount, 0);
});

test("renews agent.loop.advance inactivity while model progress is reported", async () => {
  const host = fakeHost(110);
  host.send = (message, callback) => {
    host.sent.push(message);
    callback?.(null);
    const request = message as { id?: string; method?: string };
    if (
      typeof request.id === "string"
      && (request.method === "agent.model.progress" || request.method === "agent.model.resolve")
    ) {
      queueMicrotask(() => {
        host.emit("message", {
          version: 1,
          kind: "response",
          id: request.id,
          ok: true,
          result: { ok: true }
        });
      });
    }
    return true;
  };

  let reportProgress: (() => void) | undefined;
  const client = new clientModule.AgentHostClient({
    entryPath: "entry.js",
    forkProcess: () => host,
    onModelRequest: async (input: { reportProgress: () => void }) => {
      reportProgress = input.reportProgress;
      for (let i = 0; i < 4; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        reportProgress();
      }
      return { content: "done", toolCalls: [] };
    }
  });

  const advance = client.request("agent.loop.advance", { runtimeId: "runtime-1" });
  await new Promise((resolve) => setImmediate(resolve));
  const advanceId = (host.sent[0] as { id: string }).id;

  host.emit("message", {
    version: 1,
    kind: "event",
    event: "agent.model.request",
    payload: {
      runtimeId: "runtime-1",
      callbackId: "callback_1",
      input: { messages: [], tools: [], step: 1 }
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 220));
  assert.equal(typeof reportProgress, "function");
  assert.equal(client.pendingCount >= 1, true);

  host.emit("message", {
    version: 1,
    kind: "response",
    id: advanceId,
    ok: true,
    result: { status: "completed", finalContent: "done" }
  });
  assert.deepEqual(await advance, { status: "completed", finalContent: "done" });
});

test("keeps inactive agent.loop.advance pending until explicitly completed", async () => {
  const host = fakeHost(111);
  const client = new clientModule.AgentHostClient({ entryPath: "entry.js", forkProcess: () => host });
  const pending = client.request("agent.loop.advance", { runtimeId: "runtime-1" });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(client.pendingCount, 1);
  const requestId = (host.sent[0] as { id: string }).id;
  host.emit("message", { version: 1, kind: "response", id: requestId, ok: true, result: { status: "completed" } });
  assert.deepEqual(await pending, { status: "completed" });
});

test("renews agent.loop.advance while tool reportProgress heartbeats continue", async () => {
  const host = fakeHost(112);
  host.send = (message, callback) => {
    host.sent.push(message);
    callback?.(null);
    const request = message as { id?: string; method?: string };
    if (typeof request.id === "string" && request.method === "agent.tool.resolve") {
      queueMicrotask(() => {
        host.emit("message", {
          version: 1,
          kind: "response",
          id: request.id,
          ok: true,
          result: { ok: true }
        });
      });
    }
    return true;
  };

  let reportProgress: (() => void) | undefined;
  const client = new clientModule.AgentHostClient({
    entryPath: "entry.js",
    forkProcess: () => host,
    onToolRequest: async (input: { reportProgress: () => void }) => {
      reportProgress = input.reportProgress;
      for (let i = 0; i < 4; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        reportProgress();
      }
      return { ok: true, output: "built" };
    }
  });

  const advance = client.request("agent.loop.advance", { runtimeId: "runtime-1" });
  await new Promise((resolve) => setImmediate(resolve));
  const advanceId = (host.sent[0] as { id: string }).id;

  host.emit("message", {
    version: 1,
    kind: "event",
    event: "agent.tool.request",
    payload: {
      runtimeId: "runtime-1",
      callbackId: "tool_1",
      input: { name: "shell", arguments: { command: "build" } }
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 220));
  assert.equal(typeof reportProgress, "function");
  assert.equal(client.pendingCount >= 1, true);

  host.emit("message", {
    version: 1,
    kind: "response",
    id: advanceId,
    ok: true,
    result: { status: "completed", finalContent: "built" }
  });
  assert.deepEqual(await advance, { status: "completed", finalContent: "built" });
});

test("agent events do not impose a fixed deadline on an advance request", async () => {
  const host = fakeHost(113);
  const client = new clientModule.AgentHostClient({ entryPath: "entry.js", forkProcess: () => host });
  const advance = client.request("agent.loop.advance", { runtimeId: "runtime-1" });
  await new Promise((resolve) => setImmediate(resolve));
  const advanceId = (host.sent[0] as { id: string }).id;

  await new Promise((resolve) => setTimeout(resolve, 40));
  host.emit("message", {
    version: 1,
    kind: "event",
    event: "agent.event",
    payload: { runtimeId: "runtime-1", event: { type: "step", payload: { step: 2 } } }
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(client.pendingCount, 1);

  host.emit("message", {
    version: 1,
    kind: "response",
    id: advanceId,
    ok: true,
    result: { status: "completed" }
  });
  assert.deepEqual(await advance, { status: "completed" });
});

test("rejects pending work on host crash and lazily restarts", async () => {
  const hosts = [fakeHost(103), fakeHost(104)];
  let forks = 0;
  const client = new clientModule.AgentHostClient({ entryPath: "entry.js", forkProcess: () => hosts[forks++] });
  const failed = client.request("terminal.snapshot", {});
  await new Promise((resolve) => setImmediate(resolve));
  hosts[0].emit("exit", 1, null);
  await assert.rejects(failed, (error: unknown) => error instanceof Error && "code" in error && error.code === "host_exited");

  const retried = client.request("terminal.snapshot", {});
  await new Promise((resolve) => setImmediate(resolve));
  const requestId = (hosts[1].sent[0] as { id: string }).id;
  hosts[1].emit("message", { version: 1, kind: "response", id: requestId, ok: true, result: { restarted: true } });

  assert.deepEqual(await retried, { restarted: true });
  assert.equal(forks, 2);
});

test("performs idempotent bounded shutdown through the process manager", async () => {
  const host = fakeHost(105);
  const stopped: unknown[] = [];
  const client = new clientModule.AgentHostClient({
    entryPath: "entry.js",
    forkProcess: () => host,
    processManager: { track: <T>(child: T) => child, stop: async (child: unknown) => { stopped.push(child); } }
  });
  const started = client.request("terminal.snapshot", {});
  await new Promise((resolve) => setImmediate(resolve));
  const startId = (host.sent[0] as { id: string }).id;
  host.emit("message", { version: 1, kind: "response", id: startId, ok: true, result: {} });
  await started;

  const firstShutdown = client.shutdown();
  const secondShutdown = client.shutdown();
  await new Promise((resolve) => setImmediate(resolve));
  const shutdownRequest = host.sent.at(-1) as { id: string };
  host.emit("message", { version: 1, kind: "response", id: shutdownRequest.id, ok: true, result: { stopped: true } });
  await Promise.all([firstShutdown, secondShutdown]);

  assert.equal(host.sent.filter((message) => (message as { method?: string }).method === "host.shutdown").length, 1);
  assert.deepEqual(stopped, [host]);
});
