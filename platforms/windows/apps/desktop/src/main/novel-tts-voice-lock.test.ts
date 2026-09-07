import assert from "node:assert/strict";
import test from "node:test";
import { NovelTtsService } from "./novel-tts-service.js";
test("selected remote voice fails without changing to an offline speaker", async () => {
  let localCalls = 0;
  const service = new NovelTtsService({
    readGatewayBaseUrl: async () => "", readBearerToken: async () => "", enableGatewaySpeech: true,
    kokoroEngine: { synthesize: async () => { localCalls++; return { ok: false }; } } as never,
    nativePlayer: { stop() {} } as never
  });
  const result = await service.synthesizeToFile({ text: "保持同一个角色的声音。", voiceId: "narration_default", playback: false });
  assert.equal(result.ok, false);
  assert.equal(localCalls, 0);
});
test("explicit offline voice does not route to a different remote voice", async () => {
  let selected = "";
  const service = new NovelTtsService({
    readGatewayBaseUrl: async () => { throw new Error("must not call remote"); }, readBearerToken: async () => "", enableGatewaySpeech: true,
    kokoroEngine: { synthesize: async (input: { voiceId: string }) => { selected = input.voiceId; return { ok: false }; } } as never,
    nativePlayer: { stop() {} } as never
  });
  await service.synthesizeToFile({ text: "本地声音", voiceId: "calm_narrator", playback: false });
  assert.equal(selected, "calm_narrator");
});
