import assert from "node:assert/strict";
import test from "node:test";

const runtimeModule = await import(
  new URL("./hosted-agent-loop-runtime.ts", import.meta.url).href
);

const echoTool = {
  name: "echo",
  title: "Echo",
  description: "Echo text",
  kind: "read",
  risk: "low",
  requiresApproval: true,
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false
  }
};

test("hosts loop state while policy and tool side effects remain in desktop callbacks", async () => {
  const policyCalls: unknown[] = [];
  const toolCalls: unknown[] = [];
  let modelCalls = 0;
  const runtime = runtimeModule.createHostedAgentLoopRuntime({
    runtimeId: "runtime_1",
    requestModel: async () => {
      modelCalls += 1;
      return modelCalls === 1
        ? {
            content: "",
            toolCalls: [{
              id: "call_1",
              name: "echo",
              arguments: { text: "hello" }
            }]
          }
        : { content: "done", toolCalls: [] };
    },
    requestPolicy: async (input: unknown) => {
      policyCalls.push(input);
      return { decision: "ask", source: "desktop-policy", reason: "approval required" };
    },
    requestTool: async (input: unknown) => {
      toolCalls.push(input);
      return { ok: true, output: "hello" };
    }
  });

  runtime.startAgentLoop([{ role: "user", content: "echo hello" }], {
    permissionMode: "approval",
    maxSteps: 8,
    toolDescriptors: [echoTool]
  });
  const pending = await runtime.advanceAgentLoop();

  assert.equal(pending.status, "awaiting-approval");
  assert.equal(pending.pending?.call.name, "echo");
  assert.equal(toolCalls.length, 0);
  assert.equal(policyCalls.length, 1);

  const completed = await runtime.resumeAgentApproval(true);
  assert.equal(completed.status, "completed");
  assert.equal(completed.finalContent, "done");
  assert.deepEqual(toolCalls, [{
    runtimeId: "runtime_1",
    name: "echo",
    arguments: { text: "hello" }
  }]);
  assert.equal(
    runtime.sessionMachine.events.filter(
      (event: { type?: string }) => event.type === "tool_result"
    ).length,
    1
  );
});
test("restores approval checkpoints without repeating completed side effects", async () => {
  const toolCalls: unknown[] = [];
  const first = runtimeModule.createHostedAgentLoopRuntime({
    runtimeId: "runtime_1",
    requestModel: async () => ({
      toolCalls: [{ id: "call_1", name: "echo", arguments: { text: "hello" } }]
    }),
    requestPolicy: async () => ({ decision: "ask", source: "desktop-policy", reason: "" }),
    requestTool: async (input: unknown) => {
      toolCalls.push(input);
      return { ok: true, output: "hello" };
    }
  });
  first.startAgentLoop([{ role: "user", content: "echo" }], {
    permissionMode: "approval",
    maxSteps: 8,
    toolDescriptors: [echoTool]
  });
  const checkpoint = await first.advanceAgentLoop();

  const restored = runtimeModule.createHostedAgentLoopRuntime({
    runtimeId: "runtime_1",
    requestModel: async () => ({ content: "recovered", toolCalls: [] }),
    requestPolicy: async () => ({ decision: "ask", source: "desktop-policy", reason: "" }),
    requestTool: async (input: unknown) => {
      toolCalls.push(input);
      return { ok: true, output: "hello" };
    }
  });
  restored.restoreAgentLoop(checkpoint, {
    permissionMode: "approval",
    maxSteps: 8,
    toolDescriptors: [echoTool]
  });
  const completed = await restored.resumeAgentApproval(true);

  assert.equal(completed.finalContent, "recovered");
  assert.equal(toolCalls.length, 1);
});
