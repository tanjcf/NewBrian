import { join, resolve } from "node:path";

/**
 * Global skills are the user-home directory `.newbrain/skills`.
 * When the app workspace is already that `.newbrain` folder, state lives in
 * `.newbrain/.newbrain`, but skills must not follow it there.
 */
export function resolveUserSkillRoot(input: { homeDir: string; workspacePath: string }) {
  const primary = resolve(join(input.homeDir, ".newbrain", "skills"));
  const legacyNested = resolve(join(input.workspacePath, ".newbrain", "skills"));
  return {
    primary,
    legacy: legacyNested === primary ? [] : [legacyNested]
  };
}
