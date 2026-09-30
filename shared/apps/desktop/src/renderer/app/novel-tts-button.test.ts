import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const button = readFileSync(new URL("./NovelTtsButton.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("speaker main button toggles play and stop on click", () => {
  assert.match(button, /if \(playing \|\| isNovelSpeechActive\(\)\)/);
  assert.match(button, /stopReading\(\)/);
  assert.match(button, /void startReading\(\)/);
  assert.match(button, /aria-pressed=\{playing\}/);
  assert.match(button, /title=\{playing \? "停止朗读"/);
  assert.match(button, /name=\{playing \? "stop" : "speaker"\}/);
  assert.match(button, /DEFAULT_NOVEL_TTS_VOICE_ID/);
  assert.doesNotMatch(button, /novel-tts-caret/);
  assert.doesNotMatch(button, /novel-tts-menu/);
  assert.doesNotMatch(button, /NOVEL_TTS_VOICES\.map/);
});

test("playing state stays clickable (not wait-cursor blocked)", () => {
  assert.match(css, /\.novel-tts-wrap\.playing \.novel-tts-main/);
  assert.doesNotMatch(css, /\.novel-tts-wrap\.busy[\s\S]{0,80}cursor:\s*wait/);
});
