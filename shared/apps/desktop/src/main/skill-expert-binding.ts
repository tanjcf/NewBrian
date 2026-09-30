/**
 * Bridge: global/project Skills can discover and optionally summon Expert Marketplace experts.
 *
 * Frontmatter keys (suggestion only — never auto-summon):
 *   expert: software-delivery-team
 *   expertId: software-delivery-team
 *   summon_expert: software-delivery-team
 *   summonExpert: software-delivery-team
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";

const EXPERT_ID_RE = /^[a-z][a-z0-9-]{1,63}$/;

const FRONTMATTER_KEYS = ["expert", "expertId", "expert_id", "summon_expert", "summonExpert", "summon-expert"];

export function parseExpertIdFromSkillMarkdown(markdown: string): string | null {
  const text = String(markdown || "");
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return null;
  const body = match[1];
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.+?)\s*$/.exec(trimmed);
    if (!kv) continue;
    const key = kv[1];
    if (!FRONTMATTER_KEYS.includes(key)) continue;
    const raw = kv[2].replace(/^["']|["']$/g, "").trim();
    if (EXPERT_ID_RE.test(raw)) return raw;
  }
  return null;
}

export function isValidSkillExpertId(value: string) {
  return EXPERT_ID_RE.test(String(value || "").trim());
}

/** Prefer explicit frontmatter; else match skill name against expert pack skillNames. */
export function resolveExpertIdForSkill(input: {
  skillName: string;
  skillMarkdown?: string | null;
  expertSkillIndex?: Map<string, string>;
}): string | null {
  const fromMd = input.skillMarkdown ? parseExpertIdFromSkillMarkdown(input.skillMarkdown) : null;
  if (fromMd) return fromMd;
  const skillName = String(input.skillName || "").trim().toLowerCase();
  if (!skillName || !input.expertSkillIndex) return null;
  return input.expertSkillIndex.get(skillName) || null;
}

export async function readSkillMarkdownFromRoots(skillName: string, roots: string[]): Promise<string | null> {
  const name = String(skillName || "").trim();
  if (!name) return null;
  const candidates = roots.flatMap((root) => [
    join(root, name, "SKILL.md"),
    join(root, name, "skill", "SKILL.md")
  ]);
  for (const path of candidates) {
    try {
      return await fs.readFile(path, "utf8");
    } catch {
      // try next
    }
  }
  return null;
}

export async function resolveExpertIdFromSelectedSkills(input: {
  skillNames: string[];
  skillRoots: string[];
  /** skillName(lower) -> expertId */
  expertSkillIndex?: Map<string, string>;
}): Promise<{ expertId: string; skillName: string } | null> {
  for (const skillName of input.skillNames) {
    const markdown = await readSkillMarkdownFromRoots(skillName, input.skillRoots);
    const expertId = resolveExpertIdForSkill({
      skillName,
      skillMarkdown: markdown,
      expertSkillIndex: input.expertSkillIndex
    });
    if (expertId) return { expertId, skillName };
  }
  return null;
}

export function buildExpertSkillIndex(
  experts: Array<{ id: string; skillNames?: string[] }>
): Map<string, string> {
  const index = new Map<string, string>();
  for (const expert of experts) {
    for (const skillName of expert.skillNames ?? []) {
      const key = String(skillName || "").trim().toLowerCase();
      if (key && !index.has(key)) index.set(key, expert.id);
    }
  }
  return index;
}

/** Task-driven recommendations include Skill hints without treating them as consent. */
export function buildSkillExpertSummonInstruction(input: {
  experts: Array<{ id: string; profession: string; expertType?: string; skillNames?: string[] }>;
  selectedSkillNames?: string[];
  /** Hints from SKILL.md `expert:` — never auto-summon; the agent decides. */
  suggestedExpertIds?: string[];
}): string {
  const selected = (input.selectedSkillNames ?? []).filter(Boolean);

  const experts = input.experts.slice(0, 40);
  const suggested = [...new Set((input.suggestedExpertIds ?? []).filter(Boolean))];
  if (!experts.length) {
    return [
      "No experts are available in this scene. Continue with native tools and Skills; do not fabricate experts."
    ].join("\n");
  }
  const lines = experts.map((expert) => {
    const skills = (expert.skillNames ?? []).slice(0, 4).join(", ") || "—";
    const mark = suggested.includes(expert.id) ? " ← suggested by active Skill" : "";
    return `- ${expert.id} · ${expert.profession} (${expert.expertType || "agent"}); skills: ${skills}${mark}`;
  });
  return [
    "Task-driven expert collaboration (mandatory):",
    "1. First-time users do not need to know expert names or select a Skill. Analyze the current request, attachments and project context; call expert.list to inspect actual capabilities. Recommend the minimum useful experts (1-3), never based on names or popularity alone.",
    "2. Resolve missing decisions that materially change the result first. For complex tasks call expert.propose({objective, choices:[{expertId,reason,responsibility}]}) with concrete task-specific reasons and deliverables. For greetings or simple tasks proceed without experts.",
    "3. When waiting_user, stop substantive execution and let the user choose 采用推荐, 调整分工, or 直接继续，不使用专家 in the decision card. Never answer for the user. No expert may run until accepted. If declined continue with native tools without repeating the recommendation. If adjusted revise the proposal and ask again.",
    "4. After accepted, expert.summon activates only approved experts; apply returned instructions and use real tools/delegation to produce results. Show responsibilities and actual outputs. Use expert.clear when done. Experts are not substitutes for media generation tools.",
    "5. Preference precedence: current explicit task decision > project preference/Skill > global preference/Skill > recommendation. Saved auto applies only to relevant tasks in the same scene. off excludes automatic recommendations; ask requires confirmation. A Skill expert: hint is not consent.",
    "6. One accepted task never creates a lasting preference. Only when the user wants to save/change one, call expert.preference({expertId,mode:'auto'|'ask'|'off'}), wait for scope confirmation, then call again to save. Observed habits are suggestions only; do not silently edit user Skills. Server failure means preference is not saved.",
    `5. Skills active this turn: ${selected.join(", ")}.`,
    suggested.length ? `6. Suggested expert ids from active Skills (optional): ${suggested.join(", ")}.` : "",
    "Available experts:",
    ...lines,
    "",
    "专家市场只负责能力管理。首次发现发生在任务对话中：分析任务 → 推荐并解释 → 用户确认或调整 → 真实执行 → 按用户意愿保存偏好。"
  ].filter(Boolean).join("\n");
}
