import { promises as fs } from "node:fs";
import path from "node:path";
import {
  PPT_WRITING_TEAM_SKILL_MARKDOWN,
  PPT_WRITING_TEAM_SKILL_NAME,
  PPT_WRITING_TEAM_SKILL_REVISION
} from "../shared/ppt-writing-team-skill.js";

export {
  PPT_WRITING_TEAM_EXPERT_ID,
  PPT_WRITING_TEAM_SKILL_LABEL,
  PPT_WRITING_TEAM_SKILL_NAME,
  PPT_WRITING_TEAM_SKILL_SUMMARY
} from "../shared/ppt-writing-team-skill.js";

export async function ensurePptWritingTeamSkill(root) {
  const skillRoot = String(root || "").trim();
  if (!skillRoot) return null;
  const dir = path.join(skillRoot, PPT_WRITING_TEAM_SKILL_NAME);
  const skillPath = path.join(dir, "SKILL.md");
  await fs.mkdir(dir, { recursive: true });
  let current = "";
  try {
    current = await fs.readFile(skillPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (!current.includes(PPT_WRITING_TEAM_SKILL_REVISION)) {
    await fs.writeFile(skillPath, PPT_WRITING_TEAM_SKILL_MARKDOWN, "utf8");
  }
  return dir;
}
