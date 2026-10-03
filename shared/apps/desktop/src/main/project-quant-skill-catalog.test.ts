import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { listProjectQuantSkills } from "./project-quant-skill-catalog.ts";

test("lists rules packs and quant portfolios from .newbrain/skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "quant-skills-"));
  const skills = join(root, ".newbrain", "skills");
  await mkdir(join(skills, "nuclear-uranium-ai-team"), { recursive: true });
  await writeFile(join(skills, "nuclear-uranium-ai-team", "SKILL.md"), [
    "---",
    "name: nuclear-uranium-ai-team",
    "description: 三主线五角色分工，规定何时由谁调用量化工具。",
    "---",
    "",
    "# 核电铀矿 AI 团队",
    ""
  ].join("\n"), "utf8");
  await mkdir(join(skills, "nuclear-uranium-ai-tracker", "skill"), { recursive: true });
  await writeFile(join(skills, "nuclear-uranium-ai-tracker", "asset.json"), JSON.stringify({
    skillId: "nuclear-uranium-ai-tracker",
    title: "铀矿跟踪",
    strategyId: "trend-following"
  }), "utf8");
  await writeFile(join(skills, "nuclear-uranium-ai-tracker", "skill", "SKILL.md"), "# 铀矿跟踪\n", "utf8");

  const listed = await listProjectQuantSkills(root);
  assert.deepEqual(listed.map((item) => item.id), ["nuclear-uranium-ai-team", "nuclear-uranium-ai-tracker"]);
  assert.equal(listed[0]?.label, "核电铀矿 AI 团队");
  assert.equal(listed[0]?.strategyId, "");
  assert.match(listed[0]?.detail || "", /三主线/);
  assert.equal(listed[1]?.strategyId, "trend-following");
});
