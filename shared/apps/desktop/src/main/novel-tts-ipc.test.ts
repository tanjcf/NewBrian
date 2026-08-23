import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const systemIpc = readFileSync(new URL("./system-ipc.ts", import.meta.url), "utf8");
const main = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const preload = readFileSync(new URL("../preload/index.ts", import.meta.url), "utf8");
const protocol = readFileSync(new URL("../../../../packages/protocol/src/index.ts", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../renderer/app/WorkspaceModules.tsx", import.meta.url), "utf8");
const button = readFileSync(new URL("../renderer/app/NovelTtsButton.tsx", import.meta.url), "utf8");
const policy = readFileSync(new URL("../shared/novel-tts-policy.ts", import.meta.url), "utf8");
const playback = readFileSync(new URL("../renderer/app/novel-tts-playback.ts", import.meta.url), "utf8");

test("exposes synthesizeNovelSpeech IPC end to end", () => {
  assert.match(protocol, /synthesizeNovelSpeech:\s*"phase1:synthesize-novel-speech"/);
  assert.match(protocol, /cancelNovelSpeech:\s*"phase1:cancel-novel-speech"/);
  assert.match(protocol, /export interface SynthesizeNovelSpeechInput/);
  assert.match(systemIpc, /parseSynthesizeNovelSpeechInput/);
  assert.match(systemIpc, /synthesizeNovelSpeech/);
  assert.match(systemIpc, /cancelNovelSpeech/);
  assert.match(preload, /synthesizeNovelSpeech:/);
  assert.match(preload, /cancelNovelSpeech:/);
  assert.match(main, /new NovelTtsService/);
  assert.match(main, /synthesizeNovelSpeech:\s*\(input\)\s*=>\s*novelTtsService\.synthesize\(input\)/);
  assert.match(main, /cancelNovelSpeech:/);
});

test("wires speaker controls on assistant actions and file preview header", () => {
  assert.match(workspace, /import \{ NovelTtsButton \} from "\.\/NovelTtsButton"/);
  assert.match(workspace, /className="message-action-tts"/);
  assert.match(workspace, /className="artifact-tts"/);
  // Product UI is single fixed voice (no caret / voice menu).
  assert.match(button, /novel-tts-wrap single-voice/);
  assert.match(button, /novel-tts-main/);
  assert.match(button, /DEFAULT_NOVEL_TTS_VOICE_ID/);
  assert.doesNotMatch(button, /novel-tts-caret/);
  assert.doesNotMatch(button, /NOVEL_TTS_VOICES\.map/);
  assert.match(policy, /多角色对话-自然流畅/);
  assert.match(policy, /清亮青叔音-活力/);
  assert.match(policy, /沉稳旁白-清晰/);
  assert.match(policy, /kokoroVoice/);
  assert.match(policy, /youth_bright/);
  assert.match(main, /NovelTtsService/);
  assert.doesNotMatch(policy, /NOVEL_TTS_REMOTE_TIMEOUT_MS/);
  assert.doesNotMatch(playback, /withTimeout\(|离线朗读超时/);
});
