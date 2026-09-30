import assert from "node:assert/strict";
import test from "node:test";
import { expertWorkspaceKeys, isExpertAvailableInWorkspace } from "./expert-workspace-policy.ts";

test("specialists are restricted by scene and explore alone sees every expert", () => {
  const video = { id: "nuwa-mrbeast-perspective" };
  assert.equal(isExpertAvailableInWorkspace(video, "video"), true);
  for (const key of ["software", "quant", "data", "document", "music", "game", "unknown"]) {
    assert.equal(isExpertAvailableInWorkspace(video, key), false);
  }
  assert.equal(isExpertAvailableInWorkspace(video, "explore"), true);
  assert.equal(isExpertAvailableInWorkspace({ id: "unclassified" }, "software"), false);
  assert.equal(isExpertAvailableInWorkspace({ id: "unclassified" }, "explore"), true);
});

test("multi-scene metadata works without allowing unknown scenes", () => {
  const expert = { id: "custom", workspaceKeys: ["quant", "data", "bad", "quant"] };
  assert.deepEqual(expertWorkspaceKeys(expert), ["quant", "data"]);
  assert.equal(isExpertAvailableInWorkspace(expert, "quant"), true);
  assert.equal(isExpertAvailableInWorkspace(expert, "document"), false);
});

test("scene-gap experts bind to game video music quant", () => {
  assert.deepEqual(expertWorkspaceKeys({ id: "game-studios-delivery" }), ["game"]);
  assert.deepEqual(expertWorkspaceKeys({ id: "ai-film-production" }), ["video"]);
  assert.deepEqual(expertWorkspaceKeys({ id: "music-composer" }), ["music"]);
  assert.deepEqual(expertWorkspaceKeys({ id: "quant-backtest" }), ["quant", "data"]);
  assert.equal(isExpertAvailableInWorkspace({ id: "ai-film-production" }, "video"), true);
  assert.equal(isExpertAvailableInWorkspace({ id: "ai-film-production" }, "music"), false);
});
