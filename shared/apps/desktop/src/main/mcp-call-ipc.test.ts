import assert from "node:assert/strict";
import test from "node:test";

const { parseMcpToolCallInput } = await import(new URL("./mcp-call-contract.ts", import.meta.url).href);

test("preserves validated MCP tool arguments", () => {
  assert.deepEqual(parseMcpToolCallInput({ toolId: " tool ", query: " query ", args: { city: "Shanghai", days: 3 } }), {
    toolId: "tool", query: "query", args: { city: "Shanghai", days: 3 }
  });
});

test("rejects malformed or unbounded MCP tool calls", () => {
  assert.throws(() => parseMcpToolCallInput({ toolId: "", query: "q" }), /invalid/);
  assert.throws(() => parseMcpToolCallInput({ toolId: "tool", query: "q", args: [] }), /object/);
  assert.throws(() => parseMcpToolCallInput({ toolId: "tool", query: "q", args: { value: BigInt(1) } }), /JSON-compatible/);
  assert.throws(() => parseMcpToolCallInput({ toolId: "tool", query: "q", args: { values: Array(1_001).fill(1) } }), /too large/);
});
