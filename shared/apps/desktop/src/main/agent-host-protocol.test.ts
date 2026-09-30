import assert from "node:assert/strict";
import test from "node:test";

const protocol = await import(new URL("./agent-host-protocol.ts", import.meta.url).href);

function hasProtocolCode(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code;
}

test("accepts versioned requests with known methods and data-only payloads", () => {
  const request = protocol.parseAgentHostRequest({
    version: 1,
    kind: "request",
    id: "request_1",
    method: "terminal.snapshot",
    payload: { workspaceId: "workspace_1", options: ["safe"] }
  });

  assert.deepEqual(request, {
    version: 1,
    kind: "request",
    id: "request_1",
    method: "terminal.snapshot",
    payload: { workspaceId: "workspace_1", options: ["safe"] }
  });
  assert.equal(protocol.parseAgentHostRequest({ version: 1, kind: "request", id: "status", method: "mcp.status", payload: { serverId: "mcp_1" } }).method, "mcp.status");
  assert.equal(protocol.parseAgentHostRequest({ version: 1, kind: "request", id: "append", method: "mcp.logs.append", payload: { serverId: "mcp_1", line: "stderr" } }).method, "mcp.logs.append");
});

test("accepts the complete agent runtime lifecycle as additive version 1 methods", () => {
  const methods = [
    "agent.runtime.create",
    "agent.runtime.dispose",
    "agent.loop.start",
    "agent.loop.restore",
    "agent.loop.advance",
    "agent.loop.resume-approval",
    "agent.loop.steer",
    "agent.loop.cancel",
    "agent.loop.snapshot",
    "agent.model.resolve",
    "agent.model.progress",
    "agent.policy.resolve",
    "agent.tool.resolve"
  ];

  for (const method of methods) {
    const request = protocol.parseAgentHostRequest({
      version: 1,
      kind: "request",
      id: `request_${method}`,
      method,
      payload: { runtimeId: "runtime_1" }
    });
    assert.equal(request.method, method);
    assert.equal(request.version, 1);
  }
});

test("rejects unknown protocol versions and methods with stable error codes", () => {
  assert.throws(
    () => protocol.parseAgentHostRequest({ version: 2, kind: "request", id: "request_1", method: "terminal.snapshot", payload: {} }),
    (error: unknown) => hasProtocolCode(error, "unsupported_version")
  );
  assert.throws(
    () => protocol.parseAgentHostRequest({ version: 1, kind: "request", id: "request_1", method: "process.exec", payload: {} }),
    (error: unknown) => hasProtocolCode(error, "unknown_method")
  );
});

test("rejects missing request IDs and non-data payloads", () => {
  assert.throws(
    () => protocol.parseAgentHostRequest({ version: 1, kind: "request", id: "", method: "terminal.snapshot", payload: {} }),
    (error: unknown) => hasProtocolCode(error, "invalid_message")
  );
  assert.throws(
    () => protocol.parseAgentHostRequest({ version: 1, kind: "request", id: "request_1", method: "terminal.snapshot", payload: { callback: () => undefined } }),
    (error: unknown) => hasProtocolCode(error, "invalid_payload")
  );
});

test("parses response and event envelopes without accepting malformed messages", () => {
  assert.deepEqual(protocol.parseAgentHostMessage({
    version: 1,
    kind: "response",
    id: "request_1",
    ok: true,
    result: { running: true }
  }), {
    version: 1,
    kind: "response",
    id: "request_1",
    ok: true,
    result: { running: true }
  });

  assert.deepEqual(protocol.parseAgentHostMessage({
    version: 1,
    kind: "event",
    event: "terminal.update",
    payload: { isRunning: true }
  }), {
    version: 1,
    kind: "event",
    event: "terminal.update",
    payload: { isRunning: true }
  });

  for (const event of [
    "agent.event",
    "agent.model.request",
    "agent.policy.request",
    "agent.tool.request"
  ]) {
    assert.deepEqual(protocol.parseAgentHostMessage({
      version: 1,
      kind: "event",
      event,
      payload: { runtimeId: "runtime_1", callbackId: "callback_1" }
    }), {
      version: 1,
      kind: "event",
      event,
      payload: { runtimeId: "runtime_1", callbackId: "callback_1" }
    });
  }

  assert.throws(
    () => protocol.parseAgentHostMessage({ version: 1, kind: "event", event: "arbitrary.event", payload: {} }),
    (error: unknown) => hasProtocolCode(error, "invalid_message")
  );
});
