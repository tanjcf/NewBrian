type SkillPolicyRuntime = {
  addSkillRoots(roots: string[]): Promise<unknown>;
  setDisabledSkills(names: string[]): Promise<unknown>;
};

type FeatureSkill = { name: string; status: string };

export async function applyApplicationSkillPolicy(
  runtime: SkillPolicyRuntime,
  userSkillRoot: string,
  readFeatureSkills: () => Promise<FeatureSkill[]>
) {
  await runtime.addSkillRoots([userSkillRoot]);
  const skills = await readFeatureSkills();
  await runtime.setDisabledSkills(
    skills.filter((skill) => skill.status === "disabled").map((skill) => skill.name)
  );
}
