import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("agent model steps use one bounded timeout retry and preserve user cancellation", async () => {
  const stepSource = await readFile(new URL("./model-chat-step-service.ts", import.meta.url), "utf8");
  assert.match(stepSource, /for \(let attempt = 1; attempt <= 2; attempt \+= 1\)/);
  assert.match(stepSource, /AbortSignal\.timeout\(45_000\)/);
  assert.match(stepSource, /input\.abortSignal\.aborted \|\| attempt === 2/);

  const chatSource = await readFile(new URL("./model-chat-service.ts", import.meta.url), "utf8");
  assert.match(chatSource, /模型步骤超时，正在重试/);
});
