import assert from "node:assert/strict";
import test from "node:test";

const callbacksModule = await import(new URL("./agent-host-model-callbacks.ts", import.meta.url).href);

test("publishes and resolves correlated model requests", async () => {
  const published: unknown[] = [];
  const callbacks = new callbacksModule.AgentHostModelCallbacks({
    publish: (payload: unknown) => published.push(payload)
  });

  const pending = callbacks.request("runtime_1", { messages: [], tools: [], step: 1 });
  assert.equal(published.length, 1);
  const callbackId = (published[0] as { callbackId: string }).callbackId;
  assert.match(callbackId, /^model_/);
  assert.deepEqual(published[0], {
    runtimeId: "runtime_1",
    callbackId,
    input: { messages: [], tools: [], step: 1 }
  });

  assert.deepEqual(callbacks.resolve(callbackId, { content: "done", toolCalls: [] }), {
    callbackId,
    resolved: true
  });
  assert.deepEqual(await pending, { content: "done", toolCalls: [] });
  assert.equal(callbacks.pendingCount, 0);
});

test("production has no model-callback execution deadline", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("./agent-host-entry.ts", import.meta.url), "utf8")
  );
  assert.match(source, /progressModel:\s*\(callbackId\)\s*=>\s*modelCallbacks\.touch\(callbackId\)/);
  assert.doesNotMatch(source, /timeoutMs:/);
  assert.match(source, /until completion, explicit cancellation, or host shutdown/i);
});

test("touch reports progress without controlling callback lifetime", async () => {
  const published: unknown[] = [];
  const callbacks = new callbacksModule.AgentHostModelCallbacks({
    publish: (payload: unknown) => published.push(payload)
  });
  const pending = callbacks.request("runtime_1", {});
  const callbackId = (published.at(-1) as { callbackId: string }).callbackId;

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(callbacks.touch(callbackId), { callbackId, touched: true });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(callbacks.touch(callbackId), { callbackId, touched: true });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(callbacks.pendingCount, 1);
  callbacks.resolve(callbackId, { content: "still-alive" });
  assert.deepEqual(await pending, { content: "still-alive" });
});

test("rejects provider failures and unknown callbacks, then waits until shutdown", async () => {
  const published: unknown[] = [];
  const callbacks = new callbacksModule.AgentHostModelCallbacks({
    publish: (payload: unknown) => published.push(payload)
  });

  const failed = callbacks.request("runtime_1", {});
  const failedId = (published.at(-1) as { callbackId: string }).callbackId;
  callbacks.resolve(failedId, null, { code: "provider_failed", message: "provider unavailable" });
  await assert.rejects(
    failed,
    (error: unknown) => error instanceof Error && "code" in error && error.code === "provider_failed"
  );
  assert.throws(
    () => callbacks.resolve("missing", null),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "model_callback_not_found"
  );

  const waiting = callbacks.request("runtime_1", {});
  const stopped = callbacks.request("runtime_2", {});
  callbacks.shutdown();
  await assert.rejects(
    waiting,
    (error: unknown) => error instanceof Error && "code" in error && error.code === "host_shutting_down"
  );
  await assert.rejects(
    stopped,
    (error: unknown) => error instanceof Error && "code" in error && error.code === "host_shutting_down"
  );
  assert.equal(callbacks.pendingCount, 0);
});
