import assert from "node:assert/strict";
import test from "node:test";
import {
  listSceneMediaModels,
  resolveSceneMediaModel
} from "./resolve-scene-media-model.ts";

test("resolveSceneMediaModel prefers explicit model over preference and catalog", () => {
  const model = resolveSceneMediaModel({
    kind: "video",
    explicitModel: "minimax-video-h3",
    preferredModel: "hy-video-v1.5",
    availableModels: [
      { id: "1", model: "hy-video-v1.5", label: "混元视频", provider: "TokenHub", capabilities: ["video"] },
      { id: "2", model: "minimax-video-h3", label: "H3", provider: "TokenHub", capabilities: ["video"] }
    ]
  });
  assert.equal(model, "minimax-video-h3");
});

test("resolveSceneMediaModel never invents hy-video-v1.5 when empty", () => {
  const model = resolveSceneMediaModel({
    kind: "video",
    explicitModel: "",
    preferredModel: "auto",
    availableModels: [
      { id: "1", model: "hy-video-v1.5", label: "混元视频", provider: "TokenHub", capabilities: ["video"] },
      { id: "2", model: "minimax-video-h3", label: "H3", provider: "TokenHub", capabilities: ["video"] }
    ]
  });
  assert.equal(model, "");
});

test("resolveSceneMediaModel treats explicit auto alias as gateway Auto", () => {
  const model = resolveSceneMediaModel({
    kind: "video",
    explicitModel: "auto",
    preferredModel: "deepseek-v4-flash",
    availableModels: [
      { id: "1", model: "minimax-video-h3", label: "H3", provider: "TokenHub", capabilities: ["video"] }
    ]
  });
  assert.equal(model, "");
});

test("resolveSceneMediaModel uses preferred video-capable settings model", () => {
  const model = resolveSceneMediaModel({
    kind: "video",
    preferredModel: "minimax-video-h3",
    availableModels: [
      { id: "1", model: "hy-video-v1.5", label: "混元视频", provider: "TokenHub", capabilities: ["video"] },
      { id: "2", model: "minimax-video-h3", label: "H3", provider: "TokenHub", capabilities: ["video"] }
    ]
  });
  assert.equal(model, "minimax-video-h3");
});

test("listSceneMediaModels filters video-capable options", () => {
  const listed = listSceneMediaModels("video", [
    { id: "1", model: "deepseek-v4-flash", label: "flash", provider: "x", capabilities: ["chat"] },
    { id: "2", model: "minimax-video-h3", label: "H3", provider: "TokenHub", capabilities: ["text-to-video"] }
  ]);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.model, "minimax-video-h3");
});
