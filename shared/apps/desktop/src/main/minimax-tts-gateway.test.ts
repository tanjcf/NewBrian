import test from "node:test";
import assert from "node:assert/strict";
import { synthesizeMinimaxSyncTts } from "./minimax-tts-gateway.js";
test("Spring speech job preserves voice and downloads without leaking bearer to CDN", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const result = await synthesizeMinimaxSyncTts({ gatewayBaseUrl: "https://spring.test", bearerToken: "private", text: "山川壮丽。",
    voice: { voiceId: "selected-speaker", speed: 1, pitch: 0 },
    fetchImpl: (async (url, init) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) return Response.json({ id: "job1", state: "RUNNING" }, { status: 202 });
      if (calls.length === 2) return Response.json({ id: "job1", state: "SUCCEEDED", resultJson: JSON.stringify({ data: [{ url: "https://cdn.test/audio.mp3" }] }) });
      return new Response(new Uint8Array([73, 68, 51, 1]), { headers: { "content-type": "audio/mpeg" } });
    }) as typeof fetch });
  assert.equal(result.ok, true);
  assert.equal(calls[0]!.url, "https://spring.test/v1/generation-jobs");
  assert.equal(JSON.parse(String(calls[0]!.init!.body)).voice_setting.voice_id, "selected-speaker");
  assert.ok(new Headers(calls[0]!.init!.headers).get("Idempotency-Key"));
  assert.equal(calls[1]!.url, "https://spring.test/v1/generation-jobs/job1");
  assert.equal(new Headers(calls[2]!.init!.headers).has("Authorization"), false);
});
test("expired and failed jobs terminate without downloading or changing voice", async () => {
  for (const state of ["EXPIRED", "FAILED", "CANCELLED"]) {
    let calls = 0;
    const result = await synthesizeMinimaxSyncTts({ gatewayBaseUrl: "https://spring.test/v1", bearerToken: "private", text: "测试",
      fetchImpl: (async () => { calls++; return Response.json({ id: "job1", state, errorMessage: "unavailable" }); }) as typeof fetch });
    assert.equal(result.ok, false); assert.equal(calls, 1);
  }
});
