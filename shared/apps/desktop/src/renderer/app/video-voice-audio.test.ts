import test from "node:test";
import assert from "node:assert/strict";
import { encodeVoiceWav } from "./video-voice-audio.js";
test("WAV encoding preserves silence, polarity, level and stereo order", () => {
  const wav = encodeVoiceWav([new Float32Array([0, -1, 0.5]), new Float32Array([1, 0, -0.5])], 24000);
  const view = new DataView(wav.buffer);
  assert.equal(view.getUint32(24, true), 24000);
  assert.equal(view.getUint16(22, true), 2);
  assert.deepEqual(Array.from({length: 6}, (_, i) => view.getInt16(44 + i * 2, true)), [0, 32767, -32768, 0, 16384, -16384]);
});
