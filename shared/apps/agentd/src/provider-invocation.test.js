import test from "node:test";
import assert from "node:assert/strict";
import { invokeProvider } from "./provider-invocation.js";

const capability = { id: "test.echo", providerId: "builtin.test", inputSchema: { type: "object", required: ["value"] }, outputSchema: { type: "object", required: ["value"] } };

test("invocation normalizes success and stable tool call id", async () => {
  const result = await invokeProvider({ capability, input: { value: 1 }, context: { toolCallId: "call-1" }, handler: async (input) => input });
  assert.equal(result.status, "completed");
  assert.equal(result.toolCallId, "call-1");
  assert.deepEqual(result.output, { value: 1 });
});

test("invocation validates input and has no fixed execution deadline", async () => {
  await assert.rejects(() => invokeProvider({ capability, input: {}, handler: async () => ({ value: 1 }) }), /missing required field/);
  const result = await invokeProvider({
    capability,
    input: { value: 1 },
    timeoutMs: 1,
    handler: () => new Promise((resolve) => setTimeout(() => resolve({ value: 1 }), 25))
  });
  assert.equal(result.status, "completed");
});

test("invocation stops only through the caller cancellation signal", async () => {
  const controller = new AbortController();
  const invocation = invokeProvider({
    capability,
    input: { value: 1 },
    signal: controller.signal,
    handler: (_input, context) => new Promise((_resolve, reject) => {
      context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
    })
  });
  controller.abort(new Error("cancelled by user"));
  const result = await invocation;
  assert.equal(result.status, "cancelled");
});
