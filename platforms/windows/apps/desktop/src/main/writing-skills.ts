/**
 * Known writing-oriented skill package names.
 * Local managed installs of these skills can be uninstalled via feature config.
 * Central product skill `government-research-writing` is product-offline via
 * `GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED` in central-skills.ts; the name
 * remains here so local installs can still be detected and removed.
 */
export const WRITING_SKILL_NAMES = [
  "government-research-writing",
  "prd-writer",
  "prompt-optimizer"
] as const;

export type WritingSkillName = (typeof WRITING_SKILL_NAMES)[number];

/** Normalizes a skill catalog name/id for writing-skill matching. */
export function normalizeSkillIdentity(value: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^skill-/, "")
    .replace(/[/\\]+/g, "-");
}

/** True when a skill name or id matches a known writing skill package. */
export function isWritingSkillIdentity(value: string) {
  const normalized = normalizeSkillIdentity(value);
  return WRITING_SKILL_NAMES.some((name) => normalized === name || normalized.endsWith(`-${name}`));
}

/** Filters a skill list down to writing skills present in the install catalog. */
export function selectInstalledWritingSkills<T extends { id?: string; name?: string }>(skills: T[]) {
  return skills.filter((skill) =>
    isWritingSkillIdentity(String(skill.name || "")) || isWritingSkillIdentity(String(skill.id || ""))
  );
}
