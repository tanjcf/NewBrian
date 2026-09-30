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

test("decodes mixed newline and Content-Length messages in one incremental buffer", async () => {
  const { encodeMcpMessage, decodeMcpMessages } = await framing;
  const legacyPayload = { jsonrpc: "2.0", id: 2, result: { tools: [] } };
  const legacyBody = Buffer.from(JSON.stringify(legacyPayload));
  const input = Buffer.concat([
    encodeMcpMessage({ jsonrpc: "2.0", id: 1, result: {} }),
    Buffer.from(`Content-Length: ${legacyBody.length}\r\n\r\n`),
    legacyBody,
    Buffer.from('{"jsonrpc":"2.0"')
  ]);
  const decoded = decodeMcpMessages(input);
  assert.deepEqual(decoded.messages.map((message) => message.id), [1, 2]);
  assert.equal(decoded.rest.toString(), '{"jsonrpc":"2.0"');
  assert.equal(decoded.error, undefined);
});

test("returns protocol parse errors without discarding the unread tail", async () => {
  const { decodeMcpMessages } = await framing;
  const decoded = decodeMcpMessages(Buffer.from('{not-json}\n{"jsonrpc":"2.0","id":2}\n'));
  assert.equal(decoded.messages.length, 0);
  assert.ok(decoded.error instanceof Error);
  assert.equal(decoded.rest.toString(), '{"jsonrpc":"2.0","id":2}\n');
});
