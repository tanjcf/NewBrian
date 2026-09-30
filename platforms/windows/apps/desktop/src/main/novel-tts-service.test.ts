import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./novel-tts-service.ts", import.meta.url), "utf8");

test("gateway speech has no fixed execution deadline", () => {
  assert.doesNotMatch(source, /NOVEL_TTS_REMOTE_TIMEOUT_MS|timeoutMs|setTimeout\(/);
  assert.match(source, /signal: controller\.signal/);
});

test("cancel explicitly aborts the active gateway speech request", () => {
  assert.match(source, /this\.remoteController\?\.abort\(new Error\("Novel speech cancelled"\)\)/);
  assert.match(source, /controller\.signal\.aborted/);
  assert.match(source, /朗读已取消。/);
});
