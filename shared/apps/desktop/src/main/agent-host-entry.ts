import { AgentHostAgentService } from "./agent-host-agent-service.js";
import { AgentHostModelCallbacks } from "./agent-host-model-callbacks.js";
import { AgentHostRuntime } from "./agent-host-runtime.js";
import { createHostedAgentLoopRuntime } from "./hosted-agent-loop-runtime.js";
import { agentHostProtocolVersion, isAgentHostData } from "./agent-host-protocol.js";
import { ManagedChildProcessManager } from "./managed-child-process.js";
import { McpProcessService } from "./mcp-process-service.js";
import { TerminalSessionService } from "./terminal-session-service.js";

const processManager = new ManagedChildProcessManager();
function sendEvent(event: "terminal.update" | "mcp.status" | "agent.event" | "agent.model.request" | "agent.policy.request" | "agent.tool.request", value: unknown) {
  const payload = JSON.parse(JSON.stringify(value)) as unknown;
  if (!isAgentHostData(payload) || !process.send) return;
  process.send({ version: agentHostProtocolVersion, kind: "event", event, payload });
}

const terminal = new TerminalSessionService({
  cwd: process.cwd(),
  shell: process.env.SHELL?.trim() || (process.platform === "win32" ? "powershell.exe" : "/bin/zsh"),
  prompt: process.platform === "win32" ? "PS>" : "$",
  processManager,
  onUpdate: (snapshot) => sendEvent("terminal.update", snapshot)
});
const mcp = new McpProcessService({ cwd: process.cwd(), processManager });
const modelCallbacks = new AgentHostModelCallbacks({
  // Codex/OpenClaw-style: do NOT hard-kill model turns on a fragile 120s
  // no-heartbeat wall. Long coding / large-context TTFT, describe-bridge, and
  // retries stay alive until completion, explicit cancellation, or host shutdown.
  publish: (payload) => sendEvent("agent.model.request", payload)
});
const policyCallbacks = new AgentHostModelCallbacks({
  // Approvals wait on the user; do not kill the loop on inactivity.
  publish: (payload) => sendEvent("agent.policy.request", payload)
});
const toolCallbacks = new AgentHostModelCallbacks({
  // Long healthy tools (shell/build/browser) may exceed any fixed wall clock.
  // Progress events remain observational and never shorten the callback lifetime.
  publish: (payload) => sendEvent("agent.tool.request", payload)
});
const agent = new AgentHostAgentService({
  createRuntime: async (input) => createHostedAgentLoopRuntime({
    runtimeId: input.runtimeId,
    onSessionEvent: input.onSessionEvent,
    requestModel: (modelInput) => modelCallbacks.request(input.runtimeId, modelInput),
    requestPolicy: (policyInput) => policyCallbacks.request(input.runtimeId, policyInput),
    requestTool: (toolInput) => toolCallbacks.request(input.runtimeId, toolInput)
  }),
  requestModel: (runtimeId, input) => modelCallbacks.request(runtimeId, input),
  resolveModel: (callbackId, result, error) =>
    modelCallbacks.resolve(callbackId, result, error),
  progressModel: (callbackId) => modelCallbacks.touch(callbackId),
  resolvePolicy: (callbackId, result, error) =>
    policyCallbacks.resolve(callbackId, result, error),
  resolveTool: (callbackId, result, error) =>
    toolCallbacks.resolve(callbackId, result, error),
  shutdownModelCallbacks: () => {
    modelCallbacks.shutdown();
    policyCallbacks.shutdown();
    toolCallbacks.shutdown();
  },
  publishEvent: (runtimeId, event) =>
    sendEvent("agent.event", { runtimeId, event })
});
const runtime = new AgentHostRuntime({ terminal, mcp, agent, processManager });
let exiting = false;

async function stopAndExit(code = 0) {
  if (exiting) return;
  exiting = true;
  await runtime.handle({ version: agentHostProtocolVersion, kind: "request", id: "host_exit", method: "host.shutdown", payload: {} });
  process.exit(code);
}

process.on("message", (message) => {
  void (async () => {
    const response = await runtime.handle(message);
    const shouldExit = typeof message === "object" && message !== null && "method" in message && message.method === "host.shutdown";
    if (!process.send) {
      if (shouldExit) await stopAndExit();
      return;
    }
    process.send(response, undefined, undefined, (error) => {
      if (error) process.stderr.write(`agent host response failed: ${error.message}\n`);
      if (shouldExit) void stopAndExit(error ? 1 : 0);
    });
  })();
});

process.once("disconnect", () => { void stopAndExit(); });
process.once("SIGTERM", () => { void stopAndExit(); });
process.once("SIGINT", () => { void stopAndExit(); });
