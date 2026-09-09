import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createSceneTestCdpClient } from "./scene-test-cdp-client.mjs";
const fixture = { roles: [{ id: "r1", name: "旁白", description: "沉稳", reason: "纪录片", candidates: ["calm_narrator", "uncle_classic", "narration_default"] }], lines: [{ id: "l1", shotId: "s1", roleId: "r1", text: "山川壮丽。", direction: "坚定" }] };
let calls = 0;
const server = createServer((req, res) => {
  req.resume(); req.on("end", () => {
    calls++;
    const content = JSON.stringify(fixture);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: content })}\n\n`);
    res.end(`data: ${JSON.stringify({ type: "response.completed", response: { id: "voice-test", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: content }] }] } })}\n\ndata: [DONE]\n\n`);
  });
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const live = process.env.NEWBRAIN_VOICE_LIVE === "1";
if (!live) process.env.NEWBRAIN_MODEL_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
process.env.NEWBRAIN_E2E_FORCE_FRESH = "1";
const reservation = createServer(); await new Promise(r => reservation.listen(0, "127.0.0.1", r));
const port = reservation.address().port; await new Promise(r => reservation.close(r));
let client;
const output = resolve("evidence/voice-casting", new Date().toISOString().replaceAll(":", "-"));
await mkdir(output, { recursive: true });
try {
  client = await createSceneTestCdpClient(port);
  await client.waitForAppReady();
  const value = await client.evaluate(`window.newbrain.analyzeVideoVoices(${JSON.stringify({ script: "纪录片", shots: [{ id: "s1", title: "山川", line: "山川壮丽。" }] })})`);
  assert.equal(value.roles[0].confirmed, false);
  assert.ok(value.roles[0].voiceId);
  if (!live) assert.ok(calls > 0);
  if (live) {
    const speech = await client.evaluate(`window.newbrain.synthesizeNovelSpeech({text:"山川壮丽。",voiceId:${JSON.stringify(value.roles[0].voiceId)},playback:false})`);
    assert.equal(speech.ok, true, speech.detail);
    assert.ok(speech.audioBase64);
    await writeFile(resolve(output, speech.mimeType?.includes("wav") ? "sample.wav" : "sample.mp3"), Buffer.from(speech.audioBase64, "base64"));
  }
  const invalid = await client.evaluate(`window.newbrain.analyzeVideoVoices({script:42,shots:[]}).then(()=>false,()=>true)`);
  assert.equal(invalid, true);
  const screenshot = await client.command("Page.captureScreenshot", { format: "png" });
  await writeFile(resolve(output, "desktop.png"), Buffer.from(screenshot.data, "base64"));
  await writeFile(resolve(output, "result.json"), JSON.stringify({ status: "PARTIAL", integration: "PASS", live, calls, checks: ["real preload IPC", "model request and validated response", "unconfirmed recommendation", "invalid input rejected"], notRun: ["visible casting workflow", "MSI upgrade"] }, null, 2));
  console.log("Voice casting IPC integration passed: " + output);
} finally {
  await client?.close(); server.closeAllConnections(); await new Promise(r => server.close(r));
}
