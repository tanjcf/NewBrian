import assert from "node:assert/strict";
import test from "node:test";

const framing = import(new URL("./mcp-framing.ts", import.meta.url).href) as Promise<typeof import("./mcp-framing.js")>;

test("encodes and decodes newline-delimited MCP JSON-RPC", async () => {
  const { encodeMcpMessage, decodeMcpMessages } = await framing;
  const payload = { jsonrpc: "2.0", id: 1, method: "initialize" };
  const decoded = decodeMcpMessages(encodeMcpMessage(payload));
  assert.deepEqual(decoded.messages, [payload]);
  assert.equal(decoded.rest.length, 0);
});

test("decodes legacy Content-Length frames and preserves partial tails", async () => {
  const { decodeMcpMessages } = await framing;
  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 2, result: {} }));
  const legacy = Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body, Buffer.from('{"jsonrpc":')]);
  const decoded = decodeMcpMessages(legacy);
  assert.equal(decoded.messages[0].id, 2);
  assert.equal(decoded.rest.toString(), '{"jsonrpc":');
});
