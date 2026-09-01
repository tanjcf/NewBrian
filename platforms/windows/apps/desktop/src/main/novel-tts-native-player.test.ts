import assert from "node:assert/strict";
import test from "node:test";
import { estimateWavDurationMs } from "./novel-tts-native-player.ts";
import { readFileSync } from "node:fs";

test("estimates wav duration from header byte rate", () => {
  const buffer = Buffer.alloc(44 + 48_000);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + 48_000, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(24_000, 24);
  buffer.writeUInt32LE(48_000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(48_000, 40);
  assert.equal(estimateWavDurationMs(buffer), 1000);
});

test("kokoro engine isolates synthesis in forked node child", () => {
  const engine = readFileSync(new URL("./novel-tts-kokoro-engine.ts", import.meta.url), "utf8");
  assert.match(engine, /ELECTRON_RUN_AS_NODE/);
  assert.match(engine, /fork\(/);
  assert.match(engine, /CUDA_VISIBLE_DEVICES/);
  assert.match(engine, /ORT_DISABLE_GPU/);
  assert.match(engine, /warmChild/);
  assert.match(engine, /resolveWorkerCwd/);
  assert.doesNotMatch(engine, /new Worker\(/);
  assert.doesNotMatch(
    engine,
    /cwd:\s*path\.resolve\(path\.dirname\(workerPath\),\s*"\.\.",\s*"\.\."\)/
  );
});
