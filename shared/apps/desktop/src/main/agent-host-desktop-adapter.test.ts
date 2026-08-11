import assert from "node:assert/strict";
import test from "node:test";

const adapterModule = await import(new URL("./agent-host-desktop-adapter.ts", import.meta.url).href);

test("preserves terminal service response shapes over host requests", async () => {
  const calls: Array<{ method: string; payload: unknown }> = [];
  const snapshot = { cwd: "C:/workspace", shell: "pwsh.exe", prompt: ">", isRunning: true, lines: [] };
  const adapter = new adapterModule.AgentHostDesktopAdapter({
    client: { request: async (method: string, payload: unknown) => { calls.push({ method, payload }); return snapshot; } },
    getTerminalConfig: () => ({ cwd: "C:/workspace", shell: "pwsh.exe", prompt: ">", env: { TEST: "1" } })
  });

  assert.deepEqual(await adapter.getTerminalSession(), snapshot);
  assert.deepEqual(await adapter.writeTerminalInput("Get-Date\n"), snapshot);
  assert.deepEqual(await adapter.restartTerminalSession(), snapshot);
  assert.deepEqual(calls, [
    { method: "terminal.ensure", payload: { cwd: "C:/workspace", shell: "pwsh.exe", prompt: ">", env: { TEST: "1" } } },
    { method: "terminal.ensure", payload: { cwd: "C:/workspace", shell: "pwsh.exe", prompt: ">", env: { TEST: "1" } } },
    { method: "terminal.write", payload: { input: "Get-Date\n" } },
    { method: "terminal.restart", payload: { cwd: "C:/workspace", shell: "pwsh.exe", prompt: ">", env: { TEST: "1" } } }
  ]);
});

test("preserves MCP health, status, and log response shapes", async () => {
  const calls: string[] = [];
  const adapter = new adapterModule.AgentHostDesktopAdapter({
    client: {
      request: async (method: string) => {
        calls.push(method);
        if (method === "mcp.start") return { ok: true, code: "started", detail: "Started", checkedAt: "now", running: true };
        if (method === "mcp.stop") return { ok: true, code: "stopped", detail: "Stopped", checkedAt: "now", running: false };
        if (method === "mcp.status") return true;
        if (method === "mcp.logs.get") return ["line"];
        return [];
      }
    },
    getTerminalConfig: () => ({ cwd: "C:/workspace", shell: "pwsh.exe", prompt: ">", env: {} })
  });
  const server = { id: "mcp_1", name: "MCP", transport: "stdio", command: "node", args: [], env: {}, enabled: true };

  assert.equal((await adapter.startMcpServer(server)).running, true);
  assert.equal((await adapter.stopMcpServer(server)).running, false);
  assert.equal(await adapter.isMcpServerRunning("mcp_1"), true);
  assert.deepEqual(await adapter.getMcpLogs("mcp_1"), ["line"]);
  assert.deepEqual(await adapter.clearMcpLogs("mcp_1"), []);
  await adapter.appendMcpLog("mcp_1", "stderr");
  assert.deepEqual(calls, ["mcp.start", "mcp.stop", "mcp.status", "mcp.logs.get", "mcp.logs.clear", "mcp.logs.append"]);
});
