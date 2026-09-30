import assert from "node:assert/strict";
import test from "node:test";
import { AgentHostLoopBridge } from "./agent-host-loop-bridge.ts";

function localRuntime() {
  let fallbacks = 0;
  return {
    runtime: {
      sessionMachine: { events: [] },
      getToolDescriptors: () => [],
      evaluateToolPolicy: () => ({ decision: "allow" }),
      invokeTool: async () => {
        fallbacks += 1;
        return { source: "node" };
      }
    },
    fallbackCount: () => fallbacks
  };
}

test("passes project binding to the Rust tool interceptor and exposes the Node fallback", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const local = localRuntime();
  const bridge = new AgentHostLoopBridge({
    client: { request: async () => ({ ok: true }) },
    invokeTool: async (input) => {
      seen.push(input as unknown as Record<string, unknown>);
      return input.fallback();
    }
  });
  await bridge.createRuntime(local.runtime, {
    runtimeId: "runtime-1",
    projectId: "workspace-1",
    workspacePath: "C:/projects/brain",
    workspaceType: "software",
    platformLabel: "Windows",
    shellLabel: "PowerShell"
  });

  const result = await bridge.handleToolRequest({
    runtimeId: "runtime-1",
    callbackId: "callback-1",
    input: { name: "workspace.read", arguments: { path: "README.md" } }
  });

  assert.deepEqual(result, { source: "node" });
  assert.equal(local.fallbackCount(), 1);
  assert.equal(seen[0]?.projectId, "workspace-1");
  assert.equal(seen[0]?.projectRoot, "C:/projects/brain");
  assert.equal(seen[0]?.workspaceType, "software");
  assert.equal(seen[0]?.toolName, "workspace.read");
});

