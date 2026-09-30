import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("model step retry uses five bounded delays for all chat turns", async () => {
  const stepSource = await readFile(new URL("./model-chat-step-service.ts", import.meta.url), "utf8");
  assert.match(stepSource, /const retryDelaysMs = \[500, 1_000, 2_000, 4_000, 8_000\]/);
  assert.doesNotMatch(stepSource, /resilientGoalMode === true[\s\S]*retryDelaysMs/);
  assert.match(stepSource, /input\.abortSignal\.aborted/);

  const chatSource = await readFile(
    new URL("../../../../../../shared/apps/desktop/src/main/model-chat-service.ts", import.meta.url),
    "utf8"
  );
  assert.match(chatSource, /模型步骤暂时失败，正在自动重试/);
  assert.match(chatSource, /目标进度已持久化，不会因单次超时丢失。/);
  assert.doesNotMatch(chatSource, /const resilientGoalMode = goalSnapshot/);
});
