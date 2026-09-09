export type SkillDescriptor = { name: string; description: string };
export type ComposerMode = "goal" | "plan";

const composerModeInstructions: Record<ComposerMode, string> = {
  goal: "本轮启用目标模式。先用中文定义清晰、适度的目标和成功标准，再围绕该目标执行请求。",
  plan: "本轮启用计划模式。修改前先用中文生成并确认实施计划；本轮不得修改文件或外部状态。"
};

export function normalizeComposerModes(input: unknown): ComposerMode[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((value): value is ComposerMode => value === "goal" || value === "plan"))];
}

export function validateComposerModes(input: unknown): ComposerMode[] {
  if (input == null) return [];
  if (!Array.isArray(input) || input.some((value) => value !== "goal" && value !== "plan")) {
    throw new Error("composerModes contains an unsupported mode.");
  }
  return normalizeComposerModes(input);
}

export function buildComposerModeInstruction(input: unknown): string {
  return normalizeComposerModes(input).map((mode) => composerModeInstructions[mode]).join("\n\n");
}

export function validateExplicitSkillNames(
  requestedNames: unknown,
  skills: SkillDescriptor[]
) {
  if (requestedNames === undefined) return [];
  if (!Array.isArray(requestedNames)) {
    throw new Error("selectedSkillNames must be an array.");
  }
  const available = new Map(skills.map((skill) => [skill.name.toLowerCase(), skill.name]));
  const requested = [...new Map(requestedNames
    .filter((name): name is string => typeof name === "string")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => [name.toLowerCase(), name])).values()];
  const unavailable = requested.filter((name) => !available.has(name.toLowerCase()));
  if (unavailable.length > 0) {
    throw new Error(`所选技能不可用或已禁用：${unavailable.join(", ")}`);
  }
  return requested.map((name) => available.get(name.toLowerCase())!).slice(0, 4);
}

export function buildSkillSelectionRequest(prompt: string, skills: SkillDescriptor[]) {
  return [
    "Select a skill only when its specialized domain workflow is essential to the user's current request.",
    "Infer intent across languages; do not rely only on literal keyword overlap.",
    "Do not select generic project-management or coding-workflow skills for ordinary chat, a direct one-step file edit, or a simple artifact write.",
    "Return JSON only in this exact shape: {\"skills\":[\"skill-name\"]}.",
    "Select at most 1 name and only a name from the catalog. Return an empty array when no specialized skill is essential.",
    "",
    "Skill catalog:",
    ...skills.map((skill) => `- ${skill.name}: ${skill.description}`),
    "",
    "User request:",
    prompt
  ].join("\n");
}

export function parseSelectedSkillNames(content: string, allowedNames: Iterable<string>) {
  const allowed = new Map([...allowedNames].map((name) => [name.toLowerCase(), name]));
  const jsonText = content.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) return [];
  try {
    const parsed = JSON.parse(jsonText) as { skills?: unknown };
    if (!Array.isArray(parsed.skills)) return [];
    return [...new Set(parsed.skills
      .filter((name): name is string => typeof name === "string")
      .map((name) => allowed.get(name.trim().toLowerCase()))
      .filter((name): name is string => Boolean(name)))]
      .slice(0, 4);
  } catch {
    return [];
  }
}

export function formatSkillDisclosure(skills: SkillDescriptor[]) {
  const chineseNames: Record<string, string> = {
    "government-research-writing": "政务研究写作",
    "newbrain-agent-runtime-rules": "NewBrain Agent 运行时规则",
    "newbrain-architecture-guard": "NewBrain 架构约束",
    "newbrain-quality-gate": "NewBrain 质量门禁",
    "programming-skill": "编程安全规范"
  };
  return skills.map((skill) => {
    const normalized = skill.name.toLowerCase();
    const label = chineseNames[normalized]
      || (normalized.endsWith("-project-manager") ? "项目 OS 与偏好" : "专业技能");
    return `${label}（${skill.name}）`;
  }).join("、");
}

export function shouldRunAutomaticSkillSelection(explicitCentralSkillNames: string[]) {
  return explicitCentralSkillNames.length === 0;
}

export function selectAutomaticSkillNames(matches: SkillDescriptor[]) {
  const specialized = matches.find((skill) => !skill.name.toLowerCase().endsWith("-project-manager"));
  if (specialized) return [specialized.name];
  const projectContext = matches.find((skill) => skill.name.toLowerCase().endsWith("-project-manager"));
  return projectContext ? [projectContext.name] : [];
}
