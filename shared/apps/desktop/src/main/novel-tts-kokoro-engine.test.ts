import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { __testOnly, probeNovelTtsGpu } from "./novel-tts-gpu-probe.ts";
import {
  NOVEL_TTS_KOKORO_VOICE_FILES,
  NOVEL_TTS_VOICES
} from "../shared/novel-tts-policy.ts";

test("curates exactly eight Kokoro-mapped novel voices", () => {
  assert.equal(NOVEL_TTS_VOICES.length, 8);
  assert.equal(NOVEL_TTS_KOKORO_VOICE_FILES.length, 8);
  assert.equal(new Set(NOVEL_TTS_KOKORO_VOICE_FILES).size, 8);
  assert.ok(NOVEL_TTS_VOICES.every((voice) => voice.kokoroVoice.startsWith("z")));
});

test("parses nvidia-smi csv for GPU probe", () => {
  const parsed = __testOnly.parseNvidiaSmiCsv("NVIDIA GeForce RTX 3060, 12288");
  assert.deepEqual(parsed, { name: "NVIDIA GeForce RTX 3060", totalMb: 12288 });
});

test("GPU probe falls back to CPU when nvidia-smi missing", async () => {
  const result = await probeNovelTtsGpu({
    execFileImpl: async () => {
      throw new Error("not found");
    }
  });
  assert.equal(result.preferred, "cpu");
  assert.equal(result.reason, "nvidia_smi_unavailable");
});

test("GPU probe prefers GPU when VRAM is enough", async () => {
  const result = await probeNovelTtsGpu({
    execFileImpl: async () => ({ stdout: "RTX 4060, 8188\n", stderr: "" }) as any
  });
  assert.equal(result.preferred, "gpu");
  assert.equal(result.vramTotalMb, 8188);
});

test("GPU probe uses CPU when VRAM below 2GB", async () => {
  const result = await probeNovelTtsGpu({
    execFileImpl: async () => ({ stdout: "Tiny GPU, 1024\n", stderr: "" }) as any
  });
  assert.equal(result.preferred, "cpu");
  assert.equal(result.reason, "vram_below_threshold");
});

test("Kokoro engine and service enforce offline-first lifecycle contracts", () => {
  const engine = readFileSync(new URL("./novel-tts-kokoro-engine.ts", import.meta.url), "utf8");
  const worker = readFileSync(new URL("./novel-tts-kokoro-worker.ts", import.meta.url), "utf8");
  assert.match(engine, /ELECTRON_RUN_AS_NODE/);
  assert.match(engine, /fork\(/);
  assert.match(engine, /isolated Node child/);
  assert.match(engine, /resolveWorkerCwd/);
  assert.match(engine, /NEWBRAIN_KOKORO_MODULE_ROOT/);
  assert.doesNotMatch(
    engine,
    /cwd:\s*path\.resolve\(path\.dirname\(workerPath\),\s*"\.\.",\s*"\.\."\)/
  );
  assert.match(engine, /dtype: "q4f16"/);
  assert.match(engine, /Soft-cancel/);
  assert.doesNotMatch(engine, /170_000|Kokoro 合成超时|Kokoro 子进程启动超时/);
  assert.match(engine, /killWarmChild/);
  assert.doesNotMatch(engine, /this\.cancel\(\);\s*\n\s*const jobId/);
  assert.match(worker, /type: "dispose"/);
  assert.match(worker, /ensureTts/);
  assert.match(worker, /q4f16/);
  assert.match(worker, /isRecoverableAudioError/);
  assert.match(worker, /@uzen\/kokoro-js/);
  assert.match(worker, /NEWBRAIN_KOKORO_MODULE_ROOT/);
  assert.match(worker, /audioPath/);
  assert.match(worker, /Number\.isFinite/);
  assert.match(worker, /pcm16Peak/);
  assert.doesNotMatch(worker, /process\.exit\(0\);\s*\n\s*\}\);\s*\n\s*\}\);/);
});

test("resolveWorkerCwd helper rejects asar-file package roots", () => {
  const engine = readFileSync(new URL("./novel-tts-kokoro-engine.ts", import.meta.url), "utf8");
  assert.match(engine, /export function resolveWorkerCwd/);
  assert.match(engine, /statSync\(target\)\.isDirectory\(\)/);
  assert.match(engine, /app\.asar\.unpacked/);
});
