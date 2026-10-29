import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PPT_WRITING_TEAM_SKILL_NAME,
  PPT_WRITING_TEAM_SKILL_REVISION
} from "../shared/ppt-writing-team-skill.js";
import { ensurePptWritingTeamSkill } from "./ppt-writing-team-skill.js";

test("installs the PPT writing team into the Brain skill root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ppt-writing-team-"));
  const dir = await ensurePptWritingTeamSkill(root);
  assert.equal(dir, path.join(root, PPT_WRITING_TEAM_SKILL_NAME));
  const skill = await readFile(path.join(dir!, "SKILL.md"), "utf8");
  assert.match(skill, /name: ppt-writing-team/);
  assert.match(skill, /expert: ppt-creation-expert/);
  assert.match(skill, /PPT写作团队/);
  assert.match(skill, new RegExp(PPT_WRITING_TEAM_SKILL_REVISION));
  assert.match(skill, /attribution_guard\.py/);
  assert.match(skill, /viewport-base\.css/);
  assert.match(skill, /render_goal_deck\.ps1/);
  assert.match(skill, /template-swiss\.html/);
  assert.match(skill, /init_svg_project\.py/);
  assert.match(await readFile(path.join(dir!, "ppt-master", "scripts", "svg_to_pptx.py"), "utf8"), /pptx/);
  assert.match(await readFile(path.join(dir!, "frontend-slides", "SKILL.md"), "utf8"), /name: frontend-slides/);
  assert.match(await readFile(path.join(dir!, "dashi-ppt", "SKILL.md"), "utf8"), /name: dashi-ppt/);
  assert.match(await readFile(path.join(dir!, "dashi-ppt", "LICENSE"), "utf8"), /AFFERO GENERAL PUBLIC LICENSE/);
  assert.match(await readFile(path.join(dir!, "guizang-ppt-skill", "assets", "template.html"), "utf8"), /SLIDES_HERE/);
  assert.match(await readFile(path.join(dir!, "planners-ppt-hell", "SKILL.md"), "utf8"), /name: planners-ppt-hell/);
  await assert.rejects(readFile(path.join(dir!, "skills", "ppt-visual", "SKILL.md"), "utf8"));
  const rewritten = skill.replace(PPT_WRITING_TEAM_SKILL_REVISION, "stale");
  await writeFile(path.join(dir!, "SKILL.md"), rewritten, "utf8");
  await ensurePptWritingTeamSkill(root);
  const refreshed = await readFile(path.join(dir!, "SKILL.md"), "utf8");
  assert.match(refreshed, new RegExp(PPT_WRITING_TEAM_SKILL_REVISION));
});

test("upgrades an older local PPT skill from the packaged source", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ppt-writing-team-"));
  const dir = path.join(root, PPT_WRITING_TEAM_SKILL_NAME);
  await mkdir(path.join(dir, "ppt-master", "scripts"), { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), "# kept\n", "utf8");
  await writeFile(path.join(dir, "ppt-master", "SKILL.md"), "# old\n", "utf8");
  await writeFile(path.join(dir, "ppt-master", "scripts", "svg_to_pptx.py"), "# old\n", "utf8");
  await writeFile(path.join(dir, ".ppt-writing-team-1.stamp"), "ppt-writing-team-1\n", "utf8");
  await ensurePptWritingTeamSkill(root);
  const skill = await readFile(path.join(dir, "SKILL.md"), "utf8");
  assert.match(skill, new RegExp(PPT_WRITING_TEAM_SKILL_REVISION));
  assert.match(skill, /attribution_guard\.py/);
  assert.match(await readFile(path.join(dir, "ppt-master", "scripts", "svg_to_pptx.py"), "utf8"), /pptx/);
  assert.equal(await readFile(path.join(dir, `.${PPT_WRITING_TEAM_SKILL_REVISION}.stamp`), "utf8"), `${PPT_WRITING_TEAM_SKILL_REVISION}\n`);
});
