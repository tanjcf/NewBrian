import assert from "node:assert/strict";
import test from "node:test";
import {
  detectOrchestratorIntent,
  pickMainAgentModel,
  shouldMainAgentHandleDirectly
} from "./agent-orchestrator-policy.ts";

test("你好 is main-agent direct chat with no vision/image-gen escalation", () => {
  const decision = shouldMainAgentHandleDirectly({
    latestUserText: "你好",
    selectedSkillNames: [],
    hasImageAttachments: false
  });
  assert.equal(decision.direct, true);
  assert.equal(decision.intent, "chat");
  assert.ok(decision.reasonCodes.includes("greeting_direct"));
  assert.ok(decision.reasonCodes.includes("handled_by_main"));
  assert.ok(decision.reasonCodes.includes("no_delegation"));
});

test("image question is not main-agent direct", () => {
  const decision = shouldMainAgentHandleDirectly({
    latestUserText: "这是什么",
    hasImageAttachments: true
  });
  assert.equal(decision.direct, false);
  assert.equal(decision.intent, "vision_qa");
});

test("text-to-image request routes to image_gen and is not direct", () => {
  assert.equal(detectOrchestratorIntent({ latestUserText: "画一只猫" }), "image_gen");
  const decision = shouldMainAgentHandleDirectly({ latestUserText: "帮我生成一张海报" });
  assert.equal(decision.direct, false);
  assert.equal(decision.intent, "image_gen");
});

test("music and 3d requests route to specialty channels", () => {
  assert.equal(detectOrchestratorIntent({ latestUserText: "生成一首流行歌曲" }), "music_gen");
  assert.equal(detectOrchestratorIntent({ latestUserText: "帮我生成一个3D模型" }), "three_d_gen");
  assert.equal(
    shouldMainAgentHandleDirectly({ latestUserText: "生成一首流行歌曲" }).reasonCodes.includes("needs_music_gen_channel"),
    true
  );
});

test("video request routes to video_gen and is not direct", () => {
  assert.equal(detectOrchestratorIntent({ latestUserText: "能帮做出视频吗" }), "video_gen");
  const decision = shouldMainAgentHandleDirectly({ latestUserText: "能帮做出视频吗" });
  assert.equal(decision.direct, false);
  assert.equal(decision.intent, "video_gen");
  assert.ok(decision.reasonCodes.includes("needs_video_gen_channel"));
});

test("pickMainAgentModel prefers default then flash-like models", () => {
  const pickedDefault = pickMainAgentModel(
    [
      { id: "1", model: "deepseek-v4-pro", label: "pro", provider: "ds" },
      { id: "2", model: "deepseek-v4-flash", label: "flash", provider: "ds" }
    ],
    "deepseek-v4-pro"
  );
  assert.equal(pickedDefault?.model, "deepseek-v4-pro");

  const pickedFlash = pickMainAgentModel([
    { id: "1", model: "deepseek-v4-pro", label: "pro", provider: "ds" },
    { id: "2", model: "deepseek-v4-flash", label: "flash", provider: "ds" }
  ]);
  assert.equal(pickedFlash?.model, "deepseek-v4-flash");

  const ignoredOutOfPlanDefault = pickMainAgentModel(
    [{ id: "1", model: "allowed-only", label: "allowed", provider: "g" }],
    "deepseek-v4-flash"
  );
  assert.equal(ignoredOutOfPlanDefault?.model, "allowed-only");
});
