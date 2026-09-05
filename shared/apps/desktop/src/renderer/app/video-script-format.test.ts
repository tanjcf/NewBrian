import assert from "node:assert/strict";
import test from "node:test";
import { formatScriptSegments, validateScriptSegments } from "./video-script-format.ts";

test("formats actual newlines and preserves multilingual script content", () => {
  const text = formatScriptSegments([{ title: "开场", prompt: "窗外\n清晨", line: "你好", duration: 6 }]);
  assert.equal(text, "【1 · 开场 · 6 秒】\n画面：窗外\n清晨\n旁白：你好");
  assert.ok(!text.includes("\\n"));
});
test("rejects empty visual descriptions and invalid durations, permits silent shots", () => {
  const shot = { title: "开场", prompt: "窗外", line: "", duration: 6 };
  assert.equal(validateScriptSegments([shot]), null);
  for (const duration of [0, NaN, Infinity, 121]) assert.ok(validateScriptSegments([{ ...shot, duration }]));
  assert.ok(validateScriptSegments([{ ...shot, prompt: " " }]));
  assert.ok(validateScriptSegments([]));
});
