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

/** Prompt fragment: the only summon path is Skill-driven expert.summon. */
export function buildSkillExpertSummonInstruction(input: {
  experts: Array<{ id: string; profession: string; expertType?: string; skillNames?: string[] }>;
  selectedSkillNames?: string[];
  /** Hints from SKILL.md `expert:` — never auto-summon; the agent decides. */
  suggestedExpertIds?: string[];
}): string {
  const selected = (input.selectedSkillNames ?? []).filter(Boolean);
  // No active Skill → do not advertise summoning; marketplace UI is install-only.
  if (!selected.length) return "";

  const experts = input.experts.slice(0, 40);
  const suggested = [...new Set((input.suggestedExpertIds ?? []).filter(Boolean))];
  if (!experts.length) {
    return [
      "Expert Marketplace (Skill-only summon):",
      "A global/project Skill is active, but no expert packs are installed. Ask the user to install packs from 专家市场, or continue with the Skill alone.",
      "There is NO UI summon button. Only this Skill path may call expert.summon when packs exist.",
      "",
      "专家召唤唯一路径：当前已启用 Skill，但本地无专家包。可去专家市场安装；禁止幻想 UI 召唤，只能 expert.summon。"
    ].join("\n");
  }
  const lines = experts.map((expert) => {
    const skills = (expert.skillNames ?? []).slice(0, 4).join(", ") || "—";
    const mark = suggested.includes(expert.id) ? " ← suggested by active Skill" : "";
    return `- ${expert.id} · ${expert.profession} (${expert.expertType || "agent"}); skills: ${skills}${mark}`;
  });
  return [
    "Expert Marketplace (ONLY summon path = active Skill → expert.summon):",
    "1. UI marketplace is install/enable only. Do not tell the user to click「召唤」— that control does not exist.",
    "2. YOU decide: if this turn needs a specialist persona / named team roles, call expert.summon({ expertId }); else answer with the Skill alone.",
    "3. Do NOT summon for greetings, thanks, capability questions, or trivial one-step asks. Use expert.clear when done.",
    "4. Tools: expert.list, expert.summon({ expertId }), expert.clear. After summon, follow expert SOP with agent.delegate/agent.wait.",
    `5. Skills active this turn: ${selected.join(", ")}.`,
    suggested.length ? `6. Suggested expert ids from active Skills (optional): ${suggested.join(", ")}.` : "",
    "Available experts:",
    ...lines,
    "",
    "专家召唤唯一路径：已启用的全局/项目 Skill → expert.summon。",
    "专家市场页只负责安装/启用；无 UI 召唤按钮。寒暄与简单一步题不要召唤。"
  ].filter(Boolean).join("\n");
}
