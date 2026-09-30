import assert from "node:assert/strict";
import test from "node:test";

const config = await import(new URL("./mcp-server-config.ts", import.meta.url).href);
const processServiceModule = await import(new URL("./mcp-process-service.ts", import.meta.url).href);
const stdioClientModule = await import(new URL("./mcp-stdio-client.ts", import.meta.url).href);
const framingModule = await import(new URL("./mcp-framing.ts", import.meta.url).href);
const configServiceModule = await import(new URL("./mcp-config-service.ts", import.meta.url).href);
const toolRuntimeModule = await import(new URL("./mcp-tool-runtime-service.ts", import.meta.url).href);

test("normalizes MCP server configuration", () => {
  assert.deepEqual(config.normalizeMcpServer({
    name: " server ", command: " node ", args: [" tool.js ", " "], env: { " KEY ": " value " }
  }, () => "mcp-1"), {
    id: "mcp-1", name: "server", transport: "stdio", command: "node", args: ["tool.js"],
    url: "", env: { KEY: "value" }, enabled: true
  });
});

test("filters MCP servers without a runnable endpoint", () => {
  const servers = config.normalizeMcpServers([
    { id: "stdio", transport: "stdio", command: "node" },
    { id: "sse", transport: "sse", url: "https://example.com/sse" },
    { id: "empty", transport: "stdio", command: "" }
  ], () => "generated");
  assert.deepEqual(servers.map((server: { id: string }) => server.id), ["stdio", "sse"]);
});

test("removes the legacy Codex errer_outf MCP server from NewBrain configuration", () => {
  const servers = config.normalizeMcpServers([
    { id: "builtin:errer_outf", name: "errer_outf", transport: "stdio", command: "node" },
    { id: "keep", name: "Keep", transport: "stdio", command: "node" }
  ], () => "generated");

  assert.deepEqual(servers.map((server: { id: string }) => server.id), ["keep"]);
});

test("owns MCP process lifecycle and returns defensive bounded logs", async () => {
  const service = new processServiceModule.McpProcessService({
    cwd: process.cwd(),
    now: () => new Date("2026-01-02T03:04:05.000Z")
  });
  const server = config.normalizeMcpServer({
    id: "local", name: "local", command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 10000)"]
  });
  const started = await service.start(server);
  assert.equal(started.ok, true);
  assert.equal(service.isRunning(server.id), true);
  const logs = service.getLogs(server.id);
  assert.match(logs[0], /started:/);
  logs.length = 0;
  assert.equal(service.getLogs(server.id).length, 1);
  const stopped = await service.stop(server);
  assert.equal(stopped.ok, true);
  assert.equal(service.isRunning(server.id), false);
  service.shutdown();
});

test("rejects MCP processes without a runnable stdio command", async () => {
  const service = new processServiceModule.McpProcessService({ cwd: process.cwd() });
  const unsupported = await service.start(config.normalizeMcpServer({
    id: "remote", name: "remote", transport: "sse", url: "https://example.com/sse"
  }));
  assert.equal(unsupported.code, "unsupported_transport");
});

test("inspects and calls tools through one bounded MCP stdio session", async () => {
  const script = `
    process.stdin.setEncoding("utf8"); let buffer = "";
    process.stdin.on("data", chunk => { buffer += chunk; const lines = buffer.split("\\n"); buffer = lines.pop();
      for (const line of lines) { if (!line.trim()) continue; const request = JSON.parse(line);
        if (request.id === 1) process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:1,result:{protocolVersion:"2024-11-05",serverInfo:{name:"fixture",version:"1.0"}}}) + "\\n");
        if (request.method === "tools/list") process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:2,result:{tools:[{name:"echo",description:"Echo",inputSchema:{type:"object"}}]}}) + "\\n");
        if (request.method === "tools/call") process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:2,result:{content:[{type:"text",text:request.params.arguments.query}]}}) + "\\n");
      }
    });`;
  const server = config.normalizeMcpServer({
    id: "fixture", name: "fixture", command: process.execPath, args: ["-e", script]
  });
  const client = new stdioClientModule.McpStdioClient({
    cwd: process.cwd(),
    encodeMessage: framingModule.encodeMcpMessage,
    decodeMessages: framingModule.decodeMcpMessages
  });
  const inspection = await client.inspect(server);
  assert.equal(inspection.ok, true);
  assert.equal(inspection.serverInfo, "fixture 1.0");
  assert.deepEqual(inspection.tools.map((tool: { name: string }) => tool.name), ["echo"]);
  const call = await client.callTool(server, "echo", "hello");
  assert.equal(call.ok, true);
  assert.equal(call.content, "hello");
});

test("fails an MCP exchange when the child exits before a response", async () => {
  const server = config.normalizeMcpServer({
    id: "exits", name: "exits", command: process.execPath, args: ["-e", "process.exit(0)"]
  });
  const client = new stdioClientModule.McpStdioClient({
    cwd: process.cwd(),
    encodeMessage: framingModule.encodeMcpMessage,
    decodeMessages: framingModule.decodeMcpMessages
  });
  const inspection = await client.inspect(server);
  assert.equal(inspection.ok, false);
  assert.match(inspection.detail, /exited before/);
});

test("persists normalized MCP config before synchronizing runtime tools", async () => {
  const events: string[] = [];
  let state: any = {
    llm: { model: "main" }, preferences: { theme: "dark" },
    mcpServers: [],
    mcpDiscoveredTools: [{ id: "old", serverId: "server-1", name: "old" }, { id: "keep", serverId: "server-2", name: "keep" }]
  };
  const service = new configServiceModule.McpConfigService({
    readConfig: async () => state,
    writeConfig: async (config: any) => { events.push("write"); state = config; },
    normalizeModelConfig: (config: any) => ({ ...config, normalized: true }),
    normalizePreferences: (preferences: any) => ({ ...preferences, normalized: true }),
    normalizeServers: (servers: any[] = []) => servers.map((server) => ({ ...server, normalized: true })),
    syncRuntimeTools: async () => { events.push("sync"); }
  });
  await service.saveServers([{ id: "server-1", name: "one" }]);
  assert.deepEqual(events, ["write", "sync"]);
  assert.equal(state.llm.normalized, true);
  assert.equal(state.mcpServers[0].normalized, true);

  events.length = 0;
  const tools = await service.replaceDiscoveredTools(
    { id: "server-1", name: "one" },
    { checkedAt: "2026-01-01T00:00:00.000Z", protocolVersion: "v1", tools: [{ name: "new", description: "New" }] }
  );
  assert.deepEqual(events, ["write", "sync"]);
  assert.deepEqual(tools.map((tool: any) => tool.id), ["server-1:new", "keep"]);
});

test("serializes concurrent MCP config mutations without losing fields", async () => {
  let state: any = { llm: {}, preferences: {}, mcpServers: [], mcpDiscoveredTools: [] };
  const service = new configServiceModule.McpConfigService({
    readConfig: async () => structuredClone(state),
    writeConfig: async (config: any) => { await new Promise((resolve) => setTimeout(resolve, 5)); state = config; },
    normalizeModelConfig: (config: any) => config,
    normalizePreferences: (preferences: any) => preferences,
    normalizeServers: (servers: any[] = []) => servers,
    syncRuntimeTools: async () => undefined
  });
  await Promise.all([
    service.saveServers([{ id: "server", name: "server" }]),
    service.saveDiscoveredTools([{ id: "tool", serverId: "server", name: "tool" }])
  ]);
  assert.deepEqual(state.mcpServers.map((server: any) => server.id), ["server"]);
  assert.deepEqual(state.mcpDiscoveredTools.map((tool: any) => tool.id), ["tool"]);
});

test("registers only enabled stdio MCP tools with collision-safe model names", async () => {
  const registered: Array<{ definition: any; execute: (input: any) => Promise<any> }> = [];
  const tools: any[] = [
    { id: "one", serverId: "enabled", serverName: "Enabled", name: "a.b", description: "" },
    { id: "two", serverId: "enabled", serverName: "Enabled", name: "a?b", description: "" },
    { id: "disabled-tool", serverId: "disabled", serverName: "Disabled", name: "hidden", description: "" },
    { id: "sse-tool", serverId: "sse", serverName: "SSE", name: "remote", description: "" }
  ];
  const servers: any[] = [
    { id: "enabled", enabled: true, transport: "stdio" },
    { id: "disabled", enabled: false, transport: "stdio" },
    { id: "sse", enabled: true, transport: "sse" }
  ];
  const runtime = {
    unregisterExternalTools: () => undefined,
    registerExternalTool: (definition: any, execute: (input: any) => Promise<any>) => registered.push({ definition, execute }),
    getToolDescriptors: () => registered.map(({ definition }) => definition)
  };
  let callCount = 0;
  const service = new toolRuntimeModule.McpToolRuntimeService({
    readTools: async () => tools,
    readServers: async () => servers,
    callStdioTool: async (_server: any, toolName: string, query: string) => {
      callCount += 1;
      return { ok: true, toolName, serverName: "Enabled", detail: "ok", content: query };
    },
    getRuntime: () => runtime
  });
  await service.sync();
  assert.equal(registered.length, 2);
  assert.equal(new Set(registered.map(({ definition }) => definition.name)).size, 2);
  const execution = await registered[0].execute({ query: "hello" });
  assert.equal(execution.output, "hello");
  assert.equal(callCount, 1);
  const disabled = await service.call("disabled-tool", "blocked");
  assert.equal(disabled.ok, false);
  assert.match(disabled.detail, /disabled/i);
  assert.equal(callCount, 1);
});
