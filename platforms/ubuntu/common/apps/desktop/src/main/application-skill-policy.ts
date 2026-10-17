import { ensureCompanionMemorySkill } from "../../../../../../shared/apps/agentd/src/companion-memory.js";
import { ensurePptWritingTeamSkill } from "../../../../../../../shared/apps/desktop/src/main/ppt-writing-team-skill.js";

type SkillPolicyRuntime = {
  addSkillRoots(roots: string[]): Promise<unknown>;
  setDisabledSkills(names: string[]): Promise<unknown>;
};

type FeatureSkill = { name: string; status: string };

export async function applyApplicationSkillPolicy(
  runtime: SkillPolicyRuntime,
  userSkillRoot: string,
  readFeatureSkills: () => Promise<FeatureSkill[]>,
  projectSkillRoots: string[] = []
) {
  await ensureCompanionMemorySkill(userSkillRoot);
  await ensurePptWritingTeamSkill(userSkillRoot);
  const roots = [...new Set([userSkillRoot, ...projectSkillRoots.map((root) => String(root || "").trim()).filter(Boolean)])];
  await runtime.addSkillRoots(roots);
  const skills = await readFeatureSkills();
  await runtime.setDisabledSkills(
    skills.filter((skill) => skill.status === "disabled").map((skill) => skill.name)
  );
}
