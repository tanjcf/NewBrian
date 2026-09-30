import assert from "node:assert/strict";
import test from "node:test";
import { AgentLoop, resolveMaxSteps } from "./agent-loop.js";
import { ToolRegistry } from "./tool-registry.js";

function registry() {
  return new ToolRegistry().register({
    name: "echo",
    title: "Echo",
    description: "Echo text",
    kind: "read",
    risk: "low",
    requiresApproval: true,
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    execute: async (input) => ({ ok: true, output: input.text })
  });
}

test("defaults to unlimited steps and only enforces an explicit finite maxSteps", async () => {
  assert.equal(resolveMaxSteps(undefined), Number.POSITIVE_INFINITY);
  assert.equal(resolveMaxSteps(0), Number.POSITIVE_INFINITY);
  assert.equal(resolveMaxSteps(-1), Number.POSITIVE_INFINITY);
  assert.equal(resolveMaxSteps(3), 3);

  const tools = new ToolRegistry().register({
    name: "tick",
    title: "Tick",
    description: "noop",
    kind: "read",
    risk: "low",
    requiresApproval: false,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: async () => ({ ok: true, output: "ok" })
  });
  const unlimited = new AgentLoop({
    toolRegistry: tools,
    authorize: () => ({ decision: "allow" }),
    loopDetection: { enabled: false },
    noProgressStepLimit: 100
  });
  unlimited.start([{ role: "user", content: "keep going" }]);
  let unlimitedSteps = 0;
  const unlimitedDone = await unlimited.advance(async () => {
    unlimitedSteps += 1;
    if (unlimitedSteps < 30) {
      return { toolCalls: [{ id: `t-${unlimitedSteps}`, name: "tick", arguments: "{}" }] };
    }
    return { content: "done", toolCalls: [] };
  });
  assert.equal(unlimitedDone.status, "completed");
  assert.equal(unlimitedSteps, 30);

  const capped = new AgentLoop({
    toolRegistry: tools,
    maxSteps: 2,
    authorize: () => ({ decision: "allow" }),
    loopDetection: { enabled: false },
    noProgressStepLimit: 100
  });
  capped.start([{ role: "user", content: "cap me" }]);
  await assert.rejects(async () => {
    await capped.advance(async () => ({
      toolCalls: [{ id: "c-1", name: "tick", arguments: "{}" }]
    }));
  }, /exceeded 2 model steps/i);
});

test("pauses for approval, executes the tool, and resumes to a final answer", async () => {
  const events = [];
  const loop = new AgentLoop({ toolRegistry: registry(), onEvent: (event) => events.push(event) });
  let requests = 0;
  const callModel = async ({ messages, tools }) => {
    requests += 1;
    assert.equal(tools[0].name, "echo");
    if (requests === 1) return { content: "", toolCalls: [{ id: "call-1", name: "echo", arguments: '{"text":"hello"}' }] };
    assert.equal(messages.at(-1).role, "tool");
    return { content: "done", toolCalls: [] };
  };
  loop.start([{ role: "user", content: "echo hello" }]);
  const paused = await loop.advance(callModel);
  assert.equal(paused.status, "awaiting-approval");
  const completed = await loop.resumeApproval(true, callModel);
  assert.equal(completed.status, "completed");
  assert.equal(completed.finalContent, "done");
  assert.deepEqual(events.filter((event) => event.type.startsWith("approval_"))
    .map((event) => [event.type, event.payload.call.id, event.payload.approved]), [
      ["approval_requested", "call-1", undefined],
      ["approval_resolved", "call-1", true]
    ]);
  assert.ok(events.some((event) => event.type === "tool_result"));
});

test("preserves every tool call when one response requires multiple approvals", async () => {
  const executed = [];
  let modelRequests = 0;
  const tools = new ToolRegistry().register({
    name: "danger", title: "Danger", description: "Danger", kind: "shell", risk: "high",
    requiresApproval: true,
    inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
    execute: async (input) => {
      executed.push(input.value);
      return { ok: true, output: input.value };
    }
  });
  const loop = new AgentLoop({ toolRegistry: tools });
  loop.start([{ role: "user", content: "run both" }]);
  const callModel = async ({ messages }) => {
    modelRequests += 1;
    if (modelRequests === 1) {
      return {
        content: "",
        toolCalls: [
          { id: "call-1", name: "danger", arguments: '{"value":"one"}' },
          { id: "call-2", name: "danger", arguments: '{"value":"two"}' }
        ]
      };
    }
    assert.deepEqual(
      messages.filter((message) => message.role === "tool").map((message) => message.toolCallId),
      ["call-1", "call-2"]
    );
    return { content: "done", toolCalls: [] };
  };

  const firstApproval = await loop.advance(callModel);
  assert.equal(firstApproval.pending.call.id, "call-1");
  const secondApproval = await loop.resumeApproval(true, callModel);
  assert.equal(secondApproval.pending.call.id, "call-2");
  assert.equal(modelRequests, 1);
  const completed = await loop.resumeApproval(true, callModel);
  assert.equal(completed.status, "completed");
  assert.deepEqual(executed, ["one", "two"]);
  assert.equal(modelRequests, 2);
});

test("returns a denial to the model without executing the tool", async () => {
  let executed = false;
  const tools = new ToolRegistry().register({
    name: "echo", title: "Echo", description: "Echo text", kind: "read", risk: "low",
    requiresApproval: true, inputSchema: { type: "object", properties: {} },
    execute: async () => { executed = true; return { ok: true }; }
  });
  const loop = new AgentLoop({ toolRegistry: tools });
  let requests = 0;
  const callModel = async ({ messages }) => {
    requests += 1;
    if (requests === 1) return { toolCalls: [{ id: "call-1", name: "echo", arguments: { text: "hello" } }] };
    assert.match(messages.at(-1).content, /denied/);
    return { content: "understood" };
  };
  loop.start([{ role: "user", content: "echo hello" }]);
  await loop.advance(callModel);
  const completed = await loop.resumeApproval(false, callModel);
  assert.equal(completed.finalContent, "understood");
  assert.equal(executed, false);
});

test("feeds a policy denial back to the model without showing an approval", async () => {
  let executed = false;
  const tools = new ToolRegistry().register({
    name: "danger", title: "Danger", description: "Danger", kind: "shell", risk: "high",
    requiresApproval: true, inputSchema: { type: "object", properties: {} },
    execute: async () => { executed = true; return { ok: true }; }
  });
  const loop = new AgentLoop({
    toolRegistry: tools,
    authorize: () => ({ decision: "deny", source: "builtin", reason: "blocked" })
  });
  let requests = 0;
  const callModel = async ({ messages }) => {
    requests += 1;
    if (requests === 1) return { toolCalls: [{ id: "d1", name: "danger", arguments: "{}" }] };
    assert.match(messages.at(-1).content, /blocked/);
    return { content: "safe fallback" };
  };
  loop.start([{ role: "user", content: "danger" }]);
  const result = await loop.advance(callModel);
  assert.equal(result.status, "completed");
  assert.equal(executed, false);
});

test("awaits asynchronous policy decisions before executing a tool", async () => {
  const order = [];
  const tools = new ToolRegistry().register({
    name: "remote.tool",
    title: "Remote tool",
    description: "Runs through the desktop tool bridge",
    kind: "read",
    risk: "low",
    requiresApproval: false,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: async () => {
      order.push("execute");
      return { ok: true, output: "done" };
    }
  });
  const loop = new AgentLoop({
    toolRegistry: tools,
    authorize: async () => {
      await new Promise((resolve) => setImmediate(resolve));
      order.push("authorize");
      return { decision: "allow", source: "desktop-policy", reason: "" };
    }
  });
  let requests = 0;
  loop.start([{ role: "user", content: "run remote tool" }]);
  const result = await loop.advance(async () => {
    requests += 1;
    return requests === 1
      ? { toolCalls: [{ id: "remote-1", name: "remote.tool", arguments: "{}" }] }
      : { content: "complete", toolCalls: [] };
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(order, ["authorize", "execute"]);
});

test("keeps the loop resumable when the model call fails after a tool result", async () => {
  const registry = new ToolRegistry()
    .register({
      name: "demo.tool",
      title: "Demo tool",
      description: "Demo",
      kind: "read",
      risk: "low",
      requiresApproval: false,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        return { ok: true, output: "tool ok" };
      }
    });
  const loop = new AgentLoop({ toolRegistry: registry, authorize: () => ({ decision: "allow" }) });
  loop.start([{ role: "user", content: "run tool" }]);
  let calls = 0;
  await assert.rejects(
    () => loop.advance(async () => {
      calls += 1;
      if (calls === 1) return { toolCalls: [{ id: "call-1", name: "demo.tool", arguments: "{}" }] };
      throw new Error("HTTP 502");
    }),
    /HTTP 502/
  );
  assert.equal(loop.snapshot().status, "running");
  const completed = await loop.advance(async () => ({ content: "recovered" }));
  assert.equal(completed.status, "completed");
  assert.equal(completed.finalContent, "recovered");
});

test("retains opaque provider reasoning only for the next in-memory tool step", async () => {
  const tools = new ToolRegistry().register({
    name: "echo",
    title: "Echo",
    description: "Echo text",
    kind: "read",
    risk: "low",
    requiresApproval: false,
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    execute: async (input) => ({ ok: true, output: input.text })
  });
  const loop = new AgentLoop({ toolRegistry: tools });
  let requests = 0;
  loop.start([{ role: "user", content: "echo with thinking" }]);
  const completed = await loop.advance(async ({ messages }) => {
    requests += 1;
    if (requests === 1) {
      return {
        content: "",
        reasoningSummary: "正在调用 echo",
        providerReasoningContent: "provider-issued-opaque-reasoning",
        toolCalls: [{ id: "call-1", name: "echo", arguments: { text: "ok" } }]
      };
    }
    const assistant = messages.find((message) => message.role === "assistant");
    assert.equal(assistant?.reasoningSummary, undefined);
    assert.equal(assistant?.providerReasoningContent, "provider-issued-opaque-reasoning");
    return { content: "done", toolCalls: [] };
  });
  assert.equal(completed.status, "completed");
  assert.equal(requests, 2);
});

test("never executes shell text from an assistant Markdown response", async () => {
  let executed = false;
  const tools = new ToolRegistry().register({
    name: "shell.exec",
    title: "Shell",
    description: "Run a shell command",
    kind: "shell",
    risk: "high",
    requiresApproval: true,
    inputSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
    execute: async () => {
      executed = true;
      return { ok: true };
    }
  });
  const loop = new AgentLoop({ toolRegistry: tools });
  loop.start([{ role: "user", content: "show an example" }]);

  const completed = await loop.advance(async () => ({
    content: "```powershell\nRemove-Item important.txt\n```",
    toolCalls: []
  }));

  assert.equal(completed.status, "completed");
  assert.equal(executed, false);
});

test("returns a failed tool result to the model and lets the model recover", async () => {
  const tools = new ToolRegistry().register({
    name: "shell.exec",
    title: "Shell",
    description: "Run a shell command",
    kind: "shell",
    risk: "high",
    requiresApproval: false,
    inputSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
    execute: async () => ({ ok: false, exitCode: 1, output: "command failed" })
  });
  const loop = new AgentLoop({
    toolRegistry: tools,
    authorize: () => ({ decision: "allow", source: "test", reason: "" })
  });
  let requests = 0;
  loop.start([{ role: "user", content: "run and recover" }]);

  const completed = await loop.advance(async ({ messages, tools: definitions }) => {
    requests += 1;
    assert.equal(definitions.some((tool) => tool.name === "shell.exec"), true);
    if (requests === 1) {
      return { content: "", toolCalls: [{ id: "failed-call", name: "shell.exec", arguments: '{"command":"bad"}' }] };
    }
    const result = JSON.parse(messages.at(-1).content);
    assert.equal(messages.at(-1).toolCallId, "failed-call");
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
    assert.equal(result.output, "command failed");
    return { content: "I saw the failure and recovered.", toolCalls: [] };
  });

  assert.equal(completed.status, "completed");
  assert.equal(completed.finalContent, "I saw the failure and recovered.");
});

test("task tool allowlist hides and denies tools outside the task scope", async () => {
  let invoked = false;
  const tools = new ToolRegistry().register({
    name: "workspace.write_file",
    title: "Write",
    description: "Write a file",
    kind: "write",
    risk: "medium",
    requiresApproval: false,
    inputSchema: { type: "object", properties: {} },
    async execute() { invoked = true; return { ok: true, output: "written" }; }
  });
  const loop = new AgentLoop({ toolRegistry: tools, allowedToolNames: [] });
  loop.start([{ role: "user", content: "draft only" }]);
  let calls = 0;
  const snapshot = await loop.advance(async ({ tools: advertisedTools }) => {
    calls += 1;
    assert.deepEqual(advertisedTools, []);
    if (calls === 1) {
      return { content: "", toolCalls: [{ id: "blocked", name: "workspace.write_file", arguments: "{}" }] };
    }
    return { content: "draft text", toolCalls: [] };
  });
  assert.equal(snapshot.status, "completed");
  assert.equal(snapshot.finalContent, "draft text");
  assert.equal(invoked, false);
});

test("restores an approval checkpoint with remaining tool calls intact", async () => {
  let executed = 0;
  const tools = new ToolRegistry().register({
    name: "echo", title: "Echo", description: "Echo", kind: "read", risk: "low",
    requiresApproval: true,
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    execute: async (input) => { executed += 1; return { ok: true, output: input.text }; }
  });
  const first = new AgentLoop({ toolRegistry: tools, requiresApproval: () => true });
  first.start([{ role: "user", content: "run both" }]);
  const waiting = await first.advance(async () => ({
    toolCalls: [
      { id: "one", name: "echo", arguments: { text: "first" } },
      { id: "two", name: "echo", arguments: { text: "second" } }
    ]
  }));
  assert.equal(waiting.pending.remainingCalls.length, 1);

  const restored = new AgentLoop({ toolRegistry: tools, requiresApproval: () => true });
  const restoredSnapshot = restored.restore(waiting);
  assert.equal(restoredSnapshot.status, "awaiting-approval");
  assert.equal(restoredSnapshot.pending.remainingCalls[0].id, "two");
  const next = await restored.resumeApproval(true, async () => ({ content: "done" }));
  assert.equal(executed, 1);
  assert.equal(next.status, "awaiting-approval");
  assert.equal(next.pending.call.id, "two");
});
test("steering received during a model call is injected before the loop completes", async () => {
  const tools = registry();
  const loop = new AgentLoop({ toolRegistry: tools });
  loop.start([{ role: "user", content: "initial" }]);
  let releaseFirst;
  const firstPending = new Promise((resolve) => { releaseFirst = resolve; });
  let calls = 0;
  const run = loop.advance(async ({ messages }) => {
    calls += 1;
    if (calls === 1) {
      await firstPending;
      return { content: "premature completion", toolCalls: [] };
    }
    assert.match(messages.at(-1)?.content, /use the official source/);
    assert.match(messages.at(-1)?.content, /continue the current task/i);
    return { content: "guided result", toolCalls: [] };
  });
  loop.steer("use the official source");
  releaseFirst();

  const snapshot = await run;

  assert.equal(calls, 2);
  assert.equal(snapshot.finalContent, "guided result");
});

test("marks steering as guidance for the active task instead of a replacement request", async () => {
  const loop = new AgentLoop({ toolRegistry: registry() });
  loop.start([{ role: "user", content: "create test.docx" }]);
  let releaseFirst;
  const firstPending = new Promise((resolve) => { releaseFirst = resolve; });
  let calls = 0;
  const run = loop.advance(async ({ messages }) => {
    calls += 1;
    if (calls === 1) {
      await firstPending;
      return { content: "stale completion", toolCalls: [] };
    }
    const guidance = messages.at(-1);
    assert.equal(guidance.role, "user");
    assert.match(guidance.content, /guidance for the current active task/i);
    assert.match(guidance.content, /continue the current task/i);
    assert.match(guidance.content, /hello你好！/);
    assert.equal(messages.some((message) => message.content === "create test.docx"), true);
    return { content: "created test.docx", toolCalls: [] };
  });

  loop.steer("hello你好！");
  releaseFirst();

  const snapshot = await run;

  assert.equal(snapshot.status, "completed");
  assert.equal(snapshot.finalContent, "created test.docx");
});

test("steering can carry attachments into the next model call", async () => {
  const loop = new AgentLoop({ toolRegistry: registry() });
  loop.start([{ role: "user", content: "draft the report" }]);
  let releaseFirst;
  const firstPending = new Promise((resolve) => { releaseFirst = resolve; });
  let calls = 0;
  const run = loop.advance(async ({ messages }) => {
    calls += 1;
    if (calls === 1) {
      await firstPending;
      return { content: "stale completion", toolCalls: [] };
    }
    const guidance = messages.at(-1);
    assert.equal(guidance.role, "user");
    assert.match(guidance.content, /guidance for the current active task/i);
    assert.match(guidance.content, /use this table/);
    assert.equal(guidance.attachments?.length, 1);
    assert.equal(guidance.attachments[0].path, "C:/tmp/table.xlsx");
    return { content: "used the table", toolCalls: [] };
  });

  loop.steer({
    content: "use this table",
    attachments: [{ name: "table.xlsx", path: "C:/tmp/table.xlsx" }]
  });
  releaseFirst();

  const snapshot = await run;
  assert.equal(snapshot.finalContent, "used the table");
  assert.equal(calls, 2);
});

test("blocks critical tool loops before invoking the tool", async () => {
  let invocations = 0;
  const tools = new ToolRegistry().register({
    name: "web.search_official",
    title: "Search",
    description: "Search",
    kind: "read",
    risk: "low",
    requiresApproval: false,
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
    async execute() {
      invocations += 1;
      return { ok: true, output: JSON.stringify({ count: 1, results: [] }) };
    }
  });
  const events = [];
  const loop = new AgentLoop({
    toolRegistry: tools,
    authorize: () => ({ decision: "allow" }),
    onEvent: (event) => events.push(event),
    loopDetection: {
      enabled: true,
      pairProgress: [
        {
          idleTool: "web.search_official",
          progressTool: "web.read_official",
          warningThreshold: 2,
          criticalThreshold: 3
        }
      ]
    }
  });
  loop.start([{ role: "user", content: "research" }]);
  let step = 0;
  const snapshot = await loop.advance(async () => {
    step += 1;
    if (step <= 3) {
      return {
        toolCalls: [{ id: `s-${step}`, name: "web.search_official", arguments: JSON.stringify({ query: `q-${step}` }) }]
      };
    }
    return { content: "done", toolCalls: [] };
  });

  assert.equal(snapshot.status, "completed");
  assert.equal(invocations, 2);
  assert.equal(events.some((event) => event.type === "tool_loop_blocked"), true);
  const blocked = snapshot.messages.find((message) =>
    message.role === "tool" && String(message.content).includes('"deniedReason":"tool-loop"')
  );
  assert.ok(blocked);
  assert.match(blocked.content, /circuit breaker|without web\.read_official/i);
});

test("aborts after consecutive tool steps with no successful progress", async () => {
  const tools = new ToolRegistry().register({
    name: "workspace.write_file",
    title: "Write",
    description: "Write",
    kind: "write",
    risk: "high",
    requiresApproval: false,
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
    async execute() {
      return { ok: false, exitCode: 1, output: "write failed" };
    }
  });
  const events = [];
  const loop = new AgentLoop({
    toolRegistry: tools,
    authorize: () => ({ decision: "allow" }),
    onEvent: (event) => events.push(event),
    noProgressStepLimit: 3,
    loopDetection: { enabled: false }
  });
  loop.start([{ role: "user", content: "create files" }]);
  let step = 0;
  await assert.rejects(async () => {
    await loop.advance(async () => {
      step += 1;
      return {
        toolCalls: [{ id: `w-${step}`, name: "workspace.write_file", arguments: JSON.stringify({ path: `f${step}.py` }) }]
      };
    });
  }, /no tool progress/i);
  assert.equal(step, 3);
  assert.equal(events.some((event) => event.type === "agent_loop_failed" && event.payload?.reason === "no_progress"), true);
});

test("tool-loop policy feedback does not count as no-progress stall", async () => {
  const tools = new ToolRegistry().register({
    name: "web.search_official",
    title: "Search",
    description: "Search",
    kind: "read",
    risk: "low",
    requiresApproval: false,
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
    async execute() {
      return { ok: true, exitCode: 0, output: JSON.stringify({ count: 1, results: [] }) };
    }
  });
  const loop = new AgentLoop({
    toolRegistry: tools,
    authorize: () => ({ decision: "allow" }),
    noProgressStepLimit: 3,
    loopDetection: {
      enabled: true,
      pairProgress: [
        {
          idleTool: "web.search_official",
          progressTool: "web.read_official",
          warningThreshold: 1,
          criticalThreshold: 2
        }
      ]
    }
  });
  loop.start([{ role: "user", content: "research" }]);
  let step = 0;
  const snapshot = await loop.advance(async () => {
    step += 1;
    if (step <= 5) {
      return {
        toolCalls: [{ id: `s-${step}`, name: "web.search_official", arguments: JSON.stringify({ query: `q-${step}` }) }]
      };
    }
    return { content: "done after policy blocks", toolCalls: [] };
  });
  assert.equal(snapshot.status, "completed");
  assert.equal(snapshot.finalContent, "done after policy blocks");
  assert.ok(snapshot.messages.some((message) =>
    message.role === "tool" && String(message.content).includes("without web.read_official")
  ));
});
