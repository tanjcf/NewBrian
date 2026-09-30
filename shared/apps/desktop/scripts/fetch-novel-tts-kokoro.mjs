#!/usr/bin/env node
/**
 * Download curated Kokoro-zh offline assets (model + 8 voices) into userData/novel-tts/kokoro.
 *
 * Usage:
 *   node scripts/fetch-novel-tts-kokoro.mjs
 *   node scripts/fetch-novel-tts-kokoro.mjs --out "D:/path/to/kokoro"
 */
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.1-zh-ONNX";
const VOICES = [
  "zf_001",
  "zf_017",
  "zm_010",
  "zm_030",
  "zf_021",
  "zm_050",
  "zm_080",
  "zm_020"
];

const MODEL_FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "vocab.json",
  "onnx/model_fp16.onnx",
  "onnx/model_q4f16.onnx",
  "onnx/model.onnx"
];

function parseOutDir(argv) {
  const index = argv.indexOf("--out");
  if (index >= 0 && argv[index + 1]) return path.resolve(argv[index + 1]);
  const localAppData = process.env.LOCALAPPDATA || process.env.HOME || process.cwd();
  return path.join(localAppData, ".newbrain", "novel-tts", "kokoro");
}

async function download(url, dest) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`download failed ${response.status} ${url}`);
  }
  await mkdir(path.dirname(dest), { recursive: true });
  await pipeline(response.body, createWriteStream(dest));
}

async function main() {
  const root = parseOutDir(process.argv.slice(2));
  const modelDir = path.join(root, "model");
  const voicesDir = path.join(root, "voices");
  await mkdir(modelDir, { recursive: true });
  await mkdir(voicesDir, { recursive: true });

  console.log(`Downloading Kokoro assets -> ${root}`);
  for (const relative of MODEL_FILES) {
    const url = `https://huggingface.co/${MODEL_ID}/resolve/main/${relative}`;
    const dest = path.join(modelDir, relative.includes("/") ? path.basename(relative) : relative);
    // Keep onnx variants under model/onnx/
    const finalDest = relative.startsWith("onnx/")
      ? path.join(modelDir, "onnx", path.basename(relative))
      : dest;
    process.stdout.write(`model ${relative} ... `);
    try {
      await download(url, finalDest);
      console.log("ok");
    } catch (error) {
      console.log(`skip (${error instanceof Error ? error.message : error})`);
    }
  }

  for (const voice of VOICES) {
    const url = `https://huggingface.co/${MODEL_ID}/resolve/main/voices/${voice}.bin`;
    const dest = path.join(voicesDir, `${voice}.bin`);
    process.stdout.write(`voice ${voice}.bin ... `);
    await download(url, dest);
    console.log("ok");
  }

  await writeFile(
    path.join(root, "READY.json"),
    JSON.stringify({
      modelId: MODEL_ID,
      voices: VOICES,
      downloadedAt: new Date().toISOString()
    }, null, 2),
    "utf8"
  );
  console.log("DONE");
  console.log(`Place/copy to Electron userData novel-tts/kokoro or pass --out explicitly.`);
  console.log(`This script file: ${fileURLToPath(import.meta.url)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
