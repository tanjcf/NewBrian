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
  const rewritten = skill.replace(PPT_WRITING_TEAM_SKILL_REVISION, "stale");
  await writeFile(path.join(dir!, "SKILL.md"), rewritten, "utf8");
  await ensurePptWritingTeamSkill(root);
  const refreshed = await readFile(path.join(dir!, "SKILL.md"), "utf8");
  assert.match(refreshed, new RegExp(PPT_WRITING_TEAM_SKILL_REVISION));
});

test("leaves an already current PPT writing team skill in place", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ppt-writing-team-"));
  const dir = path.join(root, PPT_WRITING_TEAM_SKILL_NAME);
  await mkdir(dir, { recursive: true });
  const kept = `---\nname: ppt-writing-team\nmetadata:\n  skill-revision: ${PPT_WRITING_TEAM_SKILL_REVISION}\n---\n\n# kept\n`;
  await writeFile(path.join(dir, "SKILL.md"), kept, "utf8");
  await ensurePptWritingTeamSkill(root);
  assert.equal(await readFile(path.join(dir, "SKILL.md"), "utf8"), kept);
});
