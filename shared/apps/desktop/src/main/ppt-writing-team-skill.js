import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPptWritingTeamSkillMarkdown,
  PPT_WRITING_TEAM_PACKS,
  PPT_WRITING_TEAM_SKILL_MARKDOWN,
  PPT_WRITING_TEAM_SKILL_NAME,
  PPT_WRITING_TEAM_SKILL_REVISION
} from "../shared/ppt-writing-team-skill.js";

const SKIP_COPY_NAMES = new Set([".git", "node_modules", "__pycache__", ".github"]);

function gardenPptCandidates(explicitRoot) {
  const candidates = [];
  const explicit = String(explicitRoot || "").trim();
  if (explicit) {
    candidates.push(explicit);
    candidates.push(path.join(explicit, "ppt"));
    candidates.push(path.join(explicit, "..", "garden", "ppt"));
    candidates.push(path.join(explicit, "..", "..", "garden", "ppt"));
  }
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, "garden", "ppt"));
  candidates.push(fileURLToPath(new URL("../../resources/garden/ppt/", import.meta.url)));
  return candidates;
}

async function removeReplacedLayout(dir) {
  await Promise.all(["skills", "agents", "references", "upstream"].map((name) =>
    fs.rm(path.join(dir, name), { recursive: true, force: true })
  ));
}

function includeUpstreamPath(source) {
  return !source.split(path.sep).some((segment) => SKIP_COPY_NAMES.has(segment));
}

async function installUpstreamPacks(dir, sourceHint) {
  const stampPath = path.join(dir, `.${PPT_WRITING_TEAM_SKILL_REVISION}.stamp`);
  let sourceRoot = "";
  for (const candidate of gardenPptCandidates(sourceHint)) {
    try {
      await fs.access(path.join(candidate, "ppt-master", "scripts", "svg_to_pptx.py"));
      sourceRoot = candidate;
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  if (!sourceRoot) return null;
  let stamped = false;
  try {
    stamped = (await fs.readFile(stampPath, "utf8")).trim() === PPT_WRITING_TEAM_SKILL_REVISION;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (!stamped) {
    for (const name of PPT_WRITING_TEAM_PACKS) {
      const from = path.join(sourceRoot, name);
      await fs.access(path.join(from, "SKILL.md"));
      await fs.cp(from, path.join(dir, name), { recursive: true, force: true, filter: includeUpstreamPath });
    }
    await fs.writeFile(stampPath, `${PPT_WRITING_TEAM_SKILL_REVISION}\n`, "utf8");
  }
  const packSources = {};
  for (const name of PPT_WRITING_TEAM_PACKS) {
    packSources[name] = await fs.readFile(path.join(dir, name, "SKILL.md"), "utf8");
  }
  await fs.writeFile(path.join(dir, "SKILL.md"), buildPptWritingTeamSkillMarkdown(packSources), "utf8");
  await removeReplacedLayout(dir);
  return dir;
}

export {
  PPT_WRITING_TEAM_EXPERT_ID,
  PPT_WRITING_TEAM_SKILL_LABEL,
  PPT_WRITING_TEAM_SKILL_NAME,
  PPT_WRITING_TEAM_SKILL_SUMMARY
} from "../shared/ppt-writing-team-skill.js";

export async function ensurePptWritingTeamSkill(root, expertRoot) {
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
  const packaged = await installUpstreamPacks(dir, expertRoot);
  if (!packaged && !current.includes("attribution_guard.py")) {
    await fs.writeFile(skillPath, PPT_WRITING_TEAM_SKILL_MARKDOWN, "utf8");
  }
  return dir;
}
