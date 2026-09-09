export const THREAD_COMPOSER_SKILL_STORAGE_KEY = "newbrain.threadComposerSkills.v1";

export type ThreadComposerSkill = {
  id?: string;
  name: string;
  summary?: string;
  status?: string;
  icon?: string;
  [key: string]: unknown;
};

export function readThreadComposerSkills(
  storage: Pick<Storage, "getItem"> = globalThis.localStorage
): Record<string, ThreadComposerSkill> {
  try {
    const raw = storage?.getItem?.(THREAD_COMPOSER_SKILL_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, ThreadComposerSkill> = {};
    for (const [threadId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!threadId || !value || typeof value !== "object" || Array.isArray(value)) continue;
      const name = String((value as { name?: unknown }).name ?? "").trim();
      if (!name) continue;
      result[threadId] = { ...(value as ThreadComposerSkill), name };
    }
    return result;
  } catch {
    return {};
  }
}

export function writeThreadComposerSkills(
  skills: Record<string, ThreadComposerSkill>,
  storage: Pick<Storage, "setItem"> = globalThis.localStorage
): void {
  storage?.setItem?.(THREAD_COMPOSER_SKILL_STORAGE_KEY, JSON.stringify(skills));
}

export function upsertThreadComposerSkill(
  skills: Record<string, ThreadComposerSkill>,
  threadId: string | null | undefined,
  skill: ThreadComposerSkill | null | undefined
): Record<string, ThreadComposerSkill> {
  if (!threadId) return skills;
  const next = { ...skills };
  const name = String(skill?.name ?? "").trim();
  if (!skill || !name) {
    delete next[threadId];
    return next;
  }
  next[threadId] = { ...skill, name };
  return next;
}

export function skillForThread(
  skills: Record<string, ThreadComposerSkill>,
  threadId: string | null | undefined
): ThreadComposerSkill | null {
  if (!threadId) return null;
  return skills[threadId] ?? null;
}
