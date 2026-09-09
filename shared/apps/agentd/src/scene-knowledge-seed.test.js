import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ensureSceneProjectInit,
  PROJECT_INIT_SKILL_NAME,
  SCENE_TOOLS_TEMPLATE_MARKER,
  SCENE_KNOWLEDGE_FILENAME,
  SCENE_TOOLS_ROUTING_FILENAME
} from "./scene-knowledge-seed.js";
import { UserShadow } from "./user-shadow.js";

test("ensureSceneProjectInit seeds knowledge, routing, project-init skill, and Docs/BRAIN", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-scene-init-"));
  try {
    const result = await ensureSceneProjectInit({
      workspacePath: root,
      projectName: "Mario",
      brainWorkspaceKey: "music"
    });
    assert.equal(result.workspaceKey, "music");
    assert.equal(result.skillName, PROJECT_INIT_SKILL_NAME);
    assert.equal(existsSync(join(root, ".newbrain", "skills", PROJECT_INIT_SKILL_NAME, "SKILL.md")), true);
    const knowledge = readFileSync(result.knowledgePath, "utf8");
    assert.match(knowledge, /音乐创作/);
    assert.match(knowledge, /生成整曲/);
    const routing = readFileSync(result.routingPath, "utf8");
    assert.match(routing, /Scene Tools sub-architecture \(mandatory\)/);
    assert.match(routing, /music\.song\.generate/);
    assert.match(routing, /workspace\.glob/);
    assert.match(routing, /workspace\.grep/);
    assert.match(routing, /workspace\.read/);
    assert.equal(existsSync(join(root, "Docs", "BRAIN", "scene-knowledge-music.md")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("explore scene routing documents platform retrieval tools", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-scene-explore-"));
  try {
    const result = await ensureSceneProjectInit({
      workspacePath: root,
      projectName: "ExploreDemo",
      brainWorkspaceKey: "explore"
    });
    const knowledge = readFileSync(result.knowledgePath, "utf8");
    assert.match(knowledge, /workspace\.glob/);
    const routing = readFileSync(result.routingPath, "utf8");
    assert.match(routing, /workspace\.grep/);
    assert.match(routing, /workspace\.read/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("UserShadow ensureProjectSkill includes scene Tools marker and seeds references", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-shadow-scene-"));
  try {
    const shadow = new UserShadow({
      workspacePath: root,
      projectName: "Mario",
      brainWorkspaceKey: "music"
    });
    await shadow.ensureProjectSkill();
    const skill = readFileSync(join(shadow.skillPath, "SKILL.md"), "utf8");
    assert.match(skill, /Scene Tools sub-architecture \(mandatory\)/);
    assert.match(skill, new RegExp(SCENE_KNOWLEDGE_FILENAME));
    assert.equal(existsSync(join(shadow.referencesPath, SCENE_KNOWLEDGE_FILENAME)), true);
    assert.equal(existsSync(join(shadow.referencesPath, SCENE_TOOLS_ROUTING_FILENAME)), true);
    assert.equal(existsSync(join(root, ".newbrain", "skills", PROJECT_INIT_SKILL_NAME, "SKILL.md")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
