import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { resolve } from "node:path";

const { AgentHostClient } = await import(
  new URL("../src/main/agent-host-client.ts", import.meta.url).href
);

const desktopRoot = resolve(import.meta.dirname, "..");
const entryPath = resolve(desktopRoot, "out", "main", "agent-host-entry.js");
const children = [];
const modelSteps = new Map();
const callbackStarted = new Map();
let toolExecutions = 0;

function nextModelStep(runtimeId) {
  const next = (modelSteps.get(runtimeId) ?? 0) + 1;
  modelSteps.set(runtimeId, next);
  return next;
}

const client = new AgentHostClient({
  entryPath,
  cwd: desktopRoot,
  forkProcess: (modulePath, args, options) => {
    const child = fork(modulePath, args, options);
    children.push(child);
    return child;
  },
  onModelRequest: async ({ runtimeId }) => {
    callbackStarted.get(runtimeId)?.();
    if (runtimeId === "crash-active") {
      return new Promise(() => undefined);
    }
    const step = nextModelStep(runtimeId);
    if (runtimeId === "approval-chat" && step === 1) {
      return {
        content: "",
        toolCalls: [{
          id: "write-once",
          name: "test.write",
          arguments: JSON.stringify({ value: "confirmed" })
        }]
      };
    }
    return { content: `${runtimeId}-complete`, toolCalls: [] };
  },
  onPolicyRequest: async ({ runtimeId }) => ({
    decision: runtimeId === "approval-chat" ? "ask" : "allow",
    source: "integration-policy",
    reason: ""
  }),
  onToolRequest: async ({ runtimeId }) => {
    assert.equal(runtimeId, "approval-chat");
    toolExecutions += 1;
    return { ok: true, output: "written" };
  }
});

const runtimeInput = (runtimeId) => ({
  runtimeId,
  workspacePath: desktopRoot,
  platformLabel: "Windows",
  shellLabel: "PowerShell"
});
const loopOptions = (toolDescriptors = []) => ({
  permissionMode: "approval",
  maxSteps: 8,
  toolDescriptors
});

async function waitForExit(child, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(child.pid, 0);
    } catch {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error(`Child ${child.pid} did not exit.`);
}

try {
  await client.request("agent.runtime.create", runtimeInput("normal-chat"));
  await client.request("agent.loop.start", {
    runtimeId: "normal-chat",
    messages: [{ role: "user", content: "hello" }],
    options: loopOptions()
  });
  const normal = await client.request("agent.loop.advance", { runtimeId: "normal-chat" });
  assert.equal(normal.status, "completed");
  assert.equal(normal.finalContent, "normal-chat-complete");
  await client.request("agent.runtime.dispose", { runtimeId: "normal-chat" });

  await client.request("agent.runtime.create", runtimeInput("approval-chat"));
  await client.request("agent.loop.start", {
    runtimeId: "approval-chat",
    messages: [{ role: "user", content: "write once" }],
    options: loopOptions([{
      name: "test.write",
      title: "Write once",
      description: "Records one confirmed side effect.",
      kind: "write",
      risk: "medium",
      requiresApproval: true,
      inputSchema: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
        additionalProperties: false
      }
    }])
  });
  const awaiting = await client.request("agent.loop.advance", { runtimeId: "approval-chat" });
  assert.equal(awaiting.status, "awaiting-approval");
  assert.equal(toolExecutions, 0);
  const approved = await client.request("agent.loop.resume-approval", {
    runtimeId: "approval-chat",
    approved: true
  });
  assert.equal(approved.status, "completed");
  assert.equal(toolExecutions, 1);
  const completedCheckpoint = await client.request("agent.loop.snapshot", {
    runtimeId: "approval-chat"
  });

  await client.request("agent.runtime.create", runtimeInput("cancel-chat"));
  await client.request("agent.loop.start", {
    runtimeId: "cancel-chat",
    messages: [{ role: "user", content: "cancel" }],
    options: loopOptions()
  });
  const canceled = await client.request("agent.loop.cancel", {
    runtimeId: "cancel-chat",
    reason: "integration cancellation"
  });
  assert.equal(canceled.status, "failed");
  assert.match(canceled.finalContent, /integration cancellation/);
  await client.request("agent.runtime.dispose", { runtimeId: "cancel-chat" });

  await client.request("agent.runtime.create", runtimeInput("crash-active"));
  await client.request("agent.loop.start", {
    runtimeId: "crash-active",
    messages: [{ role: "user", content: "crash" }],
    options: loopOptions()
  });
  const callbackReady = new Promise((resolvePromise) => {
    callbackStarted.set("crash-active", resolvePromise);
  });
  const activeRequest = client.request("agent.loop.advance", { runtimeId: "crash-active" });
  await callbackReady;
  const crashedChild = children.at(-1);
  crashedChild.kill("SIGKILL");
  await assert.rejects(activeRequest, (error) =>
    error instanceof Error && error.code === "host_exited"
  );
  await waitForExit(crashedChild);

  await client.request("agent.runtime.create", runtimeInput("approval-chat"));
  await client.request("agent.loop.restore", {
    runtimeId: "approval-chat",
    snapshot: completedCheckpoint,
    options: loopOptions([{
      name: "test.write",
      title: "Write once",
      description: "Records one confirmed side effect.",
      kind: "write",
      risk: "medium",
      requiresApproval: true,
      inputSchema: { type: "object", properties: {}, additionalProperties: true }
    }])
  });
  const restored = await client.request("agent.loop.snapshot", { runtimeId: "approval-chat" });
  assert.equal(restored.status, "completed");
  assert.equal(toolExecutions, 1, "Restoring a completed checkpoint must not repeat the confirmed side effect.");
  await client.request("agent.runtime.dispose", { runtimeId: "approval-chat" });

  assert.ok(children.length >= 2, "A request after the crash must lazily start a new Host process.");
  await client.shutdown();
  await Promise.all(children.map((child) => waitForExit(child)));
  assert.equal(client.pendingCount, 0);
  console.log(
    `agent host chat lifecycle passed: hosts=${children.length}, toolExecutions=${toolExecutions}`
  );
} finally {
  await client.shutdown().catch(() => undefined);
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}
