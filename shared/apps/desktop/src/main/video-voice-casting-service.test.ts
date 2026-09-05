import test from "node:test";
import assert from "node:assert/strict";
import { analyzeVideoVoices } from "./video-voice-casting-service.js";
const input = { script: "纪录片", shots: [{ id: "s1", title: "山川", line: "山川壮丽。" }] };
const result = { roles: [{ id: "r1", name: "旁白", description: "沉稳", reason: "纪录片", candidates: ["calm_narrator", "uncle_classic", "narration_default"] }], lines: [{ id: "l1", shotId: "s1", roleId: "r1", text: "山川壮丽。", direction: "坚定" }] };
test("analysis recommends real voices without confirming or replacing audio", async () => {
  const value = await analyzeVideoVoices(input, async () => JSON.stringify(result));
  assert.equal(value.roles[0]!.confirmed, false);
  assert.deepEqual(value.versions, []);
  assert.deepEqual(value.accepted, {});
});
test("rejects invented voices and missing dialogue", async () => {
  await assert.rejects(analyzeVideoVoices(input, async () => JSON.stringify({ ...result, roles: [{ ...result.roles[0], candidates: ["invented"] }] })), /不可用音色/);
  await assert.rejects(analyzeVideoVoices(input, async () => JSON.stringify({ ...result, lines: [] })), /遗漏/);
});
