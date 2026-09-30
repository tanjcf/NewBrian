/**
 * Isolated Kokoro child (fork / ELECTRON_RUN_AS_NODE).
 * Must NOT share Electron's process — onnx/transformers crashes would otherwise kill the app.
 *
 * Stays warm across voice switches (model load is expensive / crash-prone if killed mid-flight).
 *
 * Protocol:
 *   child  -> { type: "ready" }
 *   parent -> { type: "synthesize", requestId, text, voice, modelDir, voicesDir, outPath, dtype }
 *   child  -> { type: "result", requestId, ok, audioPath?, durationMs?, detail?, runtime?, provider? }
 *   parent -> { type: "dispose" }  → child exits
 */
import { parentPort } from "node:worker_threads";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

type SynthRequest = {
  type: "synthesize";
  requestId?: string;
  text: string;
  voice: string;
  modelDir: string;
  voicesDir: string;
  outPath?: string;
  preferredDevice?: "gpu" | "cpu";
  dtype?: string;
};

type DisposeRequest = { type: "dispose" };

type SynthResponse = {
  type: "result";
  requestId?: string;
  ok: boolean;
  audioPath?: string;
  durationMs?: number;
  detail?: string;
  runtime?: "gpu" | "cpu";
  provider?: string;
};

type CachedTts = {
  tts: any;
  modelDir: string;
  voicesDir: string;
  dtype: string;
};

let cached: CachedTts | null = null;
let busy = false;

function reply(message: SynthResponse | { type: "ready" }) {
  if (parentPort) parentPort.postMessage(message);
  else if (typeof process.send === "function") process.send(message);
}

function estimateWavDurationMs(buffer: Buffer): number | undefined {
  if (buffer.length < 44) return undefined;
  const byteRate = buffer.readUInt32LE(28);
  const dataSize = Math.max(0, buffer.length - 44);
  if (!byteRate) return undefined;
  return Math.max(200, Math.round((dataSize / byteRate) * 1000));
}

function float32ToWavBuffer(floatAudio: Float32Array, sampleRate: number) {
  const buffer = Buffer.alloc(44 + floatAudio.length * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + floatAudio.length * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(floatAudio.length * 2, 40);
  for (let index = 0; index < floatAudio.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, floatAudio[index]!));
    buffer.writeInt16LE(sample < 0 ? sample * 0x8000 : sample * 0x7fff, 44 + index * 2);
  }
  return buffer;
}

function pcm16Peak(buffer: Buffer): number {
  let peak = 0;
  for (let i = 44; i + 1 < buffer.length; i += 2) {
    peak = Math.max(peak, Math.abs(buffer.readInt16LE(i)));
  }
  return peak;
}

async function encodeWav(audio: any): Promise<Buffer> {
  // SoundPlayer only plays PCM 16-bit. Kokoro RawAudio.save() writes IEEE float WAV (format=3),
  // which "succeeds" but is silent — always convert float samples to PCM16 ourselves.
  // q4f16/fp16 often emit all-NaN buffers for longer Chinese text; treat that as failure.
  const floatSource = audio?.audio || audio?.data;
  const sampleRate = Number(audio?.sampling_rate || audio?.sample_rate || 0);
  if (!floatSource || !sampleRate) {
    throw new Error("Kokoro 未返回可编码音频。");
  }
  const samples =
    floatSource instanceof Float32Array
      ? Float32Array.from(floatSource)
      : floatSource?.data instanceof Float32Array
        ? Float32Array.from(floatSource.data)
        : Float32Array.from(floatSource);
  if (!samples.length) throw new Error("Kokoro 返回了空音频。");
  let peak = 0;
  let nonFinite = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i]!;
    if (!Number.isFinite(value)) {
      nonFinite += 1;
      continue;
    }
    peak = Math.max(peak, Math.abs(value));
  }
  if (nonFinite > 0 || peak < 0.01) {
    throw new Error(
      nonFinite > 0
        ? `Kokoro 返回了无效音频（NaN/Inf ${nonFinite}/${samples.length}）。`
        : "Kokoro 返回了静音音频。"
    );
  }
  const wav = float32ToWavBuffer(samples, sampleRate);
  if (pcm16Peak(wav) < 50) {
    throw new Error("Kokoro PCM 编码后仍为静音。");
  }
  return wav;
}

async function loadKokoro() {
  const moduleRoots = [
    process.env.NEWBRAIN_KOKORO_MODULE_ROOT || "",
    process.cwd(),
    typeof process.resourcesPath === "string"
      ? path.join(process.resourcesPath, "app.asar.unpacked")
      : "",
    typeof process.resourcesPath === "string" ? process.resourcesPath : ""
  ].filter(Boolean);

  const errors: string[] = [];
  for (const root of moduleRoots) {
    try {
      const kokoroPkg = join(root, "node_modules", "@uzen", "kokoro-js", "package.json");
      const rootPkg = join(root, "package.json");
      const require = createRequire(
        existsSync(kokoroPkg) ? kokoroPkg : existsSync(rootPkg) ? rootPkg : join(root, "noop.js")
      );
      const entry = require.resolve("@uzen/kokoro-js");
      return await import(pathToFileURL(entry).href);
    } catch (error) {
      errors.push(`${root}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    return await import("@uzen/kokoro-js");
  } catch (error) {
    const detail = errors.length
      ? errors.join(" | ")
      : error instanceof Error
        ? error.message
        : String(error);
    throw new Error(`Kokoro 运行时未安装（${detail}）。`);
  }
}

async function ensureTts(request: SynthRequest, dtype: string): Promise<CachedTts> {
  if (
    cached &&
    cached.modelDir === request.modelDir &&
    cached.voicesDir === request.voicesDir &&
    cached.dtype === dtype
  ) {
    return cached;
  }
  if (cached) {
    try {
      cached.tts?.dispose?.();
    } catch {
      // ignore
    }
    cached = null;
  }
  const { KokoroTTS } = await loadKokoro();
  const tts = await KokoroTTS.from_pretrained(request.modelDir, {
    dtype,
    device: "cpu",
    voicePath: request.voicesDir
  });
  cached = { tts, modelDir: request.modelDir, voicesDir: request.voicesDir, dtype };
  return cached;
}

function isRecoverableAudioError(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error || "");
  return /静音|无效音频|NaN|Inf|空音频|可编码音频|PCM 编码后仍为静音/.test(detail);
}

async function generateWav(request: SynthRequest, dtype: string): Promise<Buffer> {
  const session = await ensureTts(request, dtype);
  const audio = await session.tts.generate(String(request.text || "").trim(), {
    voice: request.voice,
    speed: 1
  });
  return encodeWav(audio);
}

async function synthesize(request: SynthRequest): Promise<SynthResponse> {
  const requestId = request.requestId;
  try {
    await loadKokoro();
  } catch (error) {
    return {
      type: "result",
      requestId,
      ok: false,
      detail: `Kokoro 运行时未安装（${error instanceof Error ? error.message : String(error)}）。`
    };
  }

  // Prefer q4f16 — same Kokoro voice assets, warmer timbre users preferred.
  // Fall back to fp32 only when q4f16 returns NaN/silence on longer Chinese text.
  const preferred = request.dtype || "q4f16";
  const fallback = preferred === "fp32" ? "" : "fp32";

  try {
    let wav: Buffer;
    let usedDtype = preferred;
    try {
      wav = await generateWav(request, preferred);
    } catch (error) {
      if (!fallback || !isRecoverableAudioError(error)) throw error;
      await disposeCached();
      usedDtype = fallback;
      wav = await generateWav(request, fallback);
    }
    if (wav.length < 44 || wav.subarray(0, 4).toString("ascii") !== "RIFF") {
      return { type: "result", requestId, ok: false, detail: "Kokoro 返回了无效 WAV。" };
    }
    const dir = path.dirname(request.outPath || path.join(os.tmpdir(), "newbrain-novel-tts", "x.wav"));
    mkdirSync(dir, { recursive: true });
    const audioPath = request.outPath || path.join(dir, `${randomUUID()}.wav`);
    writeFileSync(audioPath, wav);
    return {
      type: "result",
      requestId,
      ok: true,
      audioPath,
      durationMs: estimateWavDurationMs(wav),
      runtime: "cpu",
      provider: usedDtype === "q4f16" ? "kokoro-zh-offline" : "kokoro-zh-offline-fp32"
    };
  } catch (error) {
    return {
      type: "result",
      requestId,
      ok: false,
      detail: `Kokoro 合成失败：${error instanceof Error ? error.message : String(error)}`
    };
  }
}

async function disposeCached() {
  if (!cached) return;
  try {
    cached.tts?.dispose?.();
  } catch {
    // ignore
  }
  cached = null;
}

async function handleMessage(raw: unknown) {
  const message = raw as SynthRequest | DisposeRequest;
  if (!message || typeof message !== "object") {
    reply({ type: "result", ok: false, detail: "未知的 Kokoro 消息。" });
    return;
  }
  if (message.type === "dispose") {
    await disposeCached();
    setImmediate(() => process.exit(0));
    return;
  }
  if (message.type !== "synthesize") {
    reply({ type: "result", ok: false, detail: "未知的 Kokoro 消息。" });
    return;
  }
  if (busy) {
    reply({
      type: "result",
      requestId: message.requestId,
      ok: false,
      detail: "Kokoro 正忙，请稍后再试。"
    });
    return;
  }
  busy = true;
  try {
    reply(await synthesize(message));
  } finally {
    busy = false;
  }
}

function bindIpc() {
  if (parentPort) {
    parentPort.on("message", (message) => {
      void handleMessage(message);
    });
    return;
  }
  if (typeof process.send === "function") {
    process.on("message", (message) => {
      void handleMessage(message);
    });
    process.on("disconnect", () => {
      void disposeCached().finally(() => process.exit(0));
    });
    process.send({ type: "ready" });
  }
}

bindIpc();
