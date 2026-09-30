import path from "node:path";

export const USER_SKILL_PACKAGE_SEGMENT = ".newbrain/skills";
export const NEWBRAIN_QUANT_MANAGED_BY = "newbrain.quant";

export type UserSkillWriteGuardInput = {
  targetPath: string;
  exists?: boolean;
  managedBy?: string | null;
  force?: boolean;
  /** install = OpenClaw/user skill packages; quant = newbrain.quant managed packages only */
  policy?: "install" | "quant";
};

/** True when a relative or absolute path points at a user/project skill package directory. */
export function isUserSkillPackagePath(targetPath: string): boolean {
  const normalized = String(targetPath || "").replace(/\\/g, "/").toLowerCase();
  if (!normalized) return false;
  const segments = normalized.split("/").filter(Boolean);
  const skillsIndex = segments.lastIndexOf("skills");
  if (skillsIndex < 0) return false;
  const parent = skillsIndex > 0 ? segments[skillsIndex - 1] : "";
  return parent === ".newbrain" || parent === "newbrain" || skillsIndex === 0;
}

/** True when the path is directly under a managed global skills root (…/skills/{name}). */
export function isGlobalSkillRootChild(targetPath: string, userSkillRoot?: string): boolean {
  const normalized = path.resolve(String(targetPath || "")).replace(/\\/g, "/").toLowerCase();
  if (!userSkillRoot) return false;
  const root = path.resolve(userSkillRoot).replace(/\\/g, "/").toLowerCase();
  if (!normalized.startsWith(`${root}/`)) return false;
  const relative = normalized.slice(root.length + 1);
  return relative.length > 0 && !relative.includes("/");
}

/**
 * Unified overwrite guard for user skill packages.
 * Returns normally when write is allowed; throws when an existing package would be clobbered.
 */
export function assertUserSkillWriteAllowed(input: UserSkillWriteGuardInput): void {
  if (!input.exists || input.force) return;
  const policy = input.policy ?? "install";
  if (policy === "quant") {
    if (input.managedBy === NEWBRAIN_QUANT_MANAGED_BY) return;
    throw new Error(`Refusing to overwrite unmanaged Skill: ${input.targetPath}`);
  }
  throw new Error(`Skill already installed at ${input.targetPath}. Pass force=true to replace.`);
}
