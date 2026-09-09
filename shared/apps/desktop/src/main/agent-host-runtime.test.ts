import assert from "node:assert/strict";
import test from "node:test";

const runtimeModule = await import(new URL("./agent-host-runtime.ts", import.meta.url).href);

function request(id: string, method: string, payload: Record<string, unknown> = {}) {
  return { version: 1, kind: "request", id, method, payload };
}

test("dispatches terminal lifecycle requests and returns serializable snapshots", async () => {
  const calls: string[] = [];
  const terminal = {
    cwd: "C:/initial",
    shell: "powershell.exe",
    prompt: "PS>",
    process: null as null | { stdin: { write: (input: string, encoding: string) => void } },
    snapshot: () => ({ cwd: terminal.cwd, shell: terminal.shell, prompt: terminal.prompt, isRunning: terminal.process !== null, lines: [] }),
    ensure: (env: Record<string, string>) => {
      calls.push(`ensure:${env.NEWBRAIN_TEST ?? ""}`);
      terminal.process = { stdin: { write: (input, encoding) => calls.push(`write:${input}:${encoding}`) } };
      return terminal.process;
    },
    restart: (env: Record<string, string>) => { calls.push(`restart:${env.NEWBRAIN_TEST ?? ""}`); terminal.ensure(env); },
    stop: () => { calls.push("stop"); terminal.process = null; }
  };
  const runtime = new runtimeModule.AgentHostRuntime({
    terminal,
    mcp: { start: async () => ({}), stop: async () => ({}), getLogs: () => [], clearLogs: () => [], shutdown: async () => undefined },
    processManager: { shutdown: async () => undefined }
  });

  const ensured = await runtime.handle(request("1", "terminal.ensure", {
    cwd: "C:/workspace",
    shell: "pwsh.exe",
    prompt: ">",
    env: { NEWBRAIN_TEST: "1" }
  }));
  const written = await runtime.handle(request("2", "terminal.write", { input: "Get-Date\n" }));
  const restarted = await runtime.handle(request("3", "terminal.restart", { env: { NEWBRAIN_TEST: "2" } }));

  assert.equal(ensured.ok, true);
  assert.equal(written.ok, true);
  assert.equal(restarted.ok, true);
  assert.equal(terminal.cwd, "C:/workspace");
  assert.equal(terminal.shell, "pwsh.exe");
  assert.deepEqual(calls, ["ensure:1", "write:Get-Date\n:utf8", "restart:2", "ensure:2"]);
});

test("dispatches MCP lifecycle and bounded-log requests", async () => {
  const calls: string[] = [];
  const mcp = {
    start: async (server: { id: string }) => { calls.push(`start:${server.id}`); return { ok: true, running: true }; },
    stop: async (server: { id: string }) => { calls.push(`stop:${server.id}`); return { ok: true, running: false }; },
    getLogs: (serverId: string) => [`log:${serverId}`],
    clearLogs: (serverId: string) => { calls.push(`clear:${serverId}`); return []; },
    isRunning: (serverId: string) => serverId === "mcp_1",
    appendLog: (serverId: string, line: string) => { calls.push(`append:${serverId}:${line}`); },
    shutdown: async () => undefined
  };
  const runtime = new runtimeModule.AgentHostRuntime({
    terminal: { snapshot: () => ({}), ensure: () => ({ stdin: { write: () => undefined } }), restart: () => undefined, stop: () => undefined },
    mcp,
    processManager: { shutdown: async () => undefined }
  });
  const server = { id: "mcp_1", name: "Fixture", transport: "stdio", command: "node", args: [], env: {}, enabled: true };

  assert.equal((await runtime.handle(request("1", "mcp.start", { server }))).ok, true);
  assert.deepEqual((await runtime.handle(request("2", "mcp.logs.get", { serverId: "mcp_1" }))).result, ["log:mcp_1"]);
  assert.deepEqual((await runtime.handle(request("3", "mcp.logs.clear", { serverId: "mcp_1" }))).result, []);
  assert.equal((await runtime.handle(request("4", "mcp.stop", { server }))).ok, true);
  assert.equal((await runtime.handle(request("5", "mcp.status", { serverId: "mcp_1" }))).result, true);
  assert.equal((await runtime.handle(request("6", "mcp.logs.append", { serverId: "mcp_1", line: "stdio stderr" }))).ok, true);
  assert.deepEqual(calls, ["start:mcp_1", "clear:mcp_1", "stop:mcp_1", "append:mcp_1:stdio stderr"]);
});

test("dispatches agent runtime lifecycle through the host-owned service", { timeout: 2_000 }, async () => {
  const calls: string[] = [];
  const agent = {
    create: async (payload: Record<string, unknown>) => {
      calls.push(`create:${payload.runtimeId}`);
      return { runtimeId: payload.runtimeId, created: true };
    },
    dispose: async (runtimeId: string) => {
      calls.push(`dispose:${runtimeId}`);
      return { runtimeId, disposed: true };
    },
    start: (runtimeId: string, messages: unknown[]) => {
      calls.push(`start:${runtimeId}:${messages.length}`);
      return { status: "running" };
    },
    restore: (runtimeId: string) => {
      calls.push(`restore:${runtimeId}`);
      return { status: "awaiting-approval" };
    },
    advance: async (runtimeId: string) => {
      calls.push(`advance:${runtimeId}`);
      return { status: "completed" };
    },
    resumeApproval: async (runtimeId: string, approved: boolean) => {
      calls.push(`approval:${runtimeId}:${approved}`);
      return { status: "completed" };
    },
    steer: (runtimeId: string, message: string) => {
      calls.push(`steer:${runtimeId}:${message}`);
      return { status: "running" };
    },
    cancel: (runtimeId: string, reason: string) => {
      calls.push(`cancel:${runtimeId}:${reason}`);
      return { status: "failed" };
    },
    snapshot: (runtimeId: string) => {
      calls.push(`snapshot:${runtimeId}`);
      return { status: "running" };
    },
    resolveModel: (callbackId: string) => {
      calls.push(`model:${callbackId}`);
      return { resolved: true };
    },
    resolvePolicy: (callbackId: string) => {
      calls.push(`policy:${callbackId}`);
      return { resolved: true };
    },
    resolveTool: (callbackId: string) => {
      calls.push(`tool:${callbackId}`);
      return { resolved: true };
    },
    shutdown: async () => calls.push("agent-shutdown")
  };
  const runtime = new runtimeModule.AgentHostRuntime({
    terminal: { snapshot: () => ({}), ensure: () => ({ stdin: { write: () => undefined } }), restart: () => undefined, stop: () => undefined },
    mcp: { start: async () => ({}), stop: async () => ({}), getLogs: () => [], clearLogs: () => [], shutdown: async () => undefined },
    agent,
    processManager: { shutdown: async () => undefined }
  });
  const runtimeId = "runtime_1";

  assert.equal((await runtime.handle(request("1", "agent.runtime.create", {
    runtimeId,
    workspacePath: "C:/workspace",
    platformLabel: "Windows",
    shellLabel: "PowerShell"
  }))).ok, true);
  assert.deepEqual((await runtime.handle(request("2", "agent.loop.start", {
    runtimeId,
    messages: [{ role: "user", content: "hello" }],
    options: {}
  }))).result, { status: "running" });
  assert.deepEqual((await runtime.handle(request("3", "agent.loop.restore", {
    runtimeId,
    snapshot: { status: "awaiting-approval" },
    options: {}
  }))).result, { status: "awaiting-approval" });
  assert.deepEqual((await runtime.handle(request("4", "agent.loop.advance", { runtimeId }))).result, { status: "completed" });
  assert.deepEqual((await runtime.handle(request("5", "agent.loop.resume-approval", { runtimeId, approved: true }))).result, { status: "completed" });
  assert.deepEqual((await runtime.handle(request("6", "agent.loop.steer", { runtimeId, message: "focus" }))).result, { status: "running" });
  assert.deepEqual((await runtime.handle(request("7", "agent.loop.cancel", { runtimeId, reason: "stop" }))).result, { status: "failed" });
  assert.deepEqual((await runtime.handle(request("8", "agent.loop.snapshot", { runtimeId }))).result, { status: "running" });
  assert.equal((await runtime.handle(request("9", "agent.model.resolve", { callbackId: "model_1", result: {} }))).ok, true);
  assert.equal((await runtime.handle(request("10", "agent.policy.resolve", { callbackId: "policy_1", result: {} }))).ok, true);
  assert.equal((await runtime.handle(request("11", "agent.tool.resolve", { callbackId: "tool_1", result: {} }))).ok, true);
  assert.equal((await runtime.handle(request("12", "agent.runtime.dispose", { runtimeId }))).ok, true);
  assert.deepEqual(calls, [
    "create:runtime_1",
    "start:runtime_1:1",
    "restore:runtime_1",
    "advance:runtime_1",
    "approval:runtime_1:true",
    "steer:runtime_1:focus",
    "cancel:runtime_1:stop",
    "snapshot:runtime_1",
    "model:model_1",
    "policy:policy_1",
    "tool:tool_1",
    "dispose:runtime_1"
  ]);
});

test("returns stable errors for malformed requests and invalid method payloads", async () => {
  const runtime = new runtimeModule.AgentHostRuntime({
    terminal: { snapshot: () => ({}), ensure: () => ({ stdin: { write: () => undefined } }), restart: () => undefined, stop: () => undefined },
    mcp: { start: async () => ({}), stop: async () => ({}), getLogs: () => [], clearLogs: () => [], shutdown: async () => undefined },
    processManager: { shutdown: async () => undefined }
  });

  const malformed = await runtime.handle({ version: 9, kind: "request", id: "bad", method: "terminal.snapshot", payload: {} });
  const invalidPayload = await runtime.handle(request("payload", "terminal.write", { input: 42 }));

  assert.deepEqual(malformed, {
    version: 1,
    kind: "response",
    id: "bad",
    ok: false,
    error: { code: "unsupported_version", message: "Unsupported agent host protocol version: 9" }
  });
  assert.equal(invalidPayload.ok, false);
  assert.equal(invalidPayload.error.code, "invalid_request_payload");
});

test("shuts down terminal, MCP, and managed children exactly once", async () => {
  const calls: string[] = [];
  const runtime = new runtimeModule.AgentHostRuntime({
    terminal: { snapshot: () => ({}), ensure: () => ({ stdin: { write: () => undefined } }), restart: () => undefined, stop: () => { calls.push("terminal"); } },
    mcp: { start: async () => ({}), stop: async () => ({}), getLogs: () => [], clearLogs: () => [], shutdown: async () => { calls.push("mcp"); } },
    agent: { shutdown: async () => { calls.push("agent"); } },
    processManager: { shutdown: async () => { calls.push("children"); } }
  });

  await Promise.all([
    runtime.handle(request("1", "host.shutdown")),
    runtime.handle(request("2", "host.shutdown"))
  ]);

  assert.deepEqual(calls, ["agent", "terminal", "mcp", "children"]);
});
