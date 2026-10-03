import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export type ProjectQuantSkillOption = {
  id: string;
  label: string;
  detail: string;
  /** Builtin price signal used when this package is a quant-managed portfolio. Empty for rules-only skills. */
  strategyId: "" | "trend-following" | "mean-reversion";
};

const SKILL_ID = /^[a-z0-9][a-z0-9_-]{1,63}$/;

function frontmatter(markdown: string): Record<string, string> {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!match) return {};
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.+?)\s*$/.exec(line.trim());
    if (!kv) continue;
    fields[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return fields;
}

function heading(markdown: string): string {
  const line = markdown.split(/\r?\n/).map((item) => item.trim()).find((item) => item.startsWith("# "));
  return line ? line.slice(2).trim() : "";
}

/** Project packages under `.newbrain/skills`, including rules packs that are not quant portfolios. */
export async function listProjectQuantSkills(workspaceRoot: string): Promise<ProjectQuantSkillOption[]> {
  const root = join(workspaceRoot, ".newbrain", "skills");
  let names: string[] = [];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const options: ProjectQuantSkillOption[] = [];
  for (const name of names.sort()) {
    if (!SKILL_ID.test(name)) continue;
    const dir = join(root, name);
    let markdown = "";
    for (const relative of ["SKILL.md", join("skill", "SKILL.md")]) {
      try {
        markdown = await readFile(join(dir, relative), "utf8");
        break;
      } catch {
        // try the other layout
      }
    }
    if (!markdown.trim()) continue;
    const meta = frontmatter(markdown);
    let strategyId: ProjectQuantSkillOption["strategyId"] = "";
    let assetTitle = "";
    try {
      const asset = JSON.parse(await readFile(join(dir, "asset.json"), "utf8")) as { strategyId?: string; title?: string };
      if (asset.strategyId === "trend-following" || asset.strategyId === "mean-reversion") strategyId = asset.strategyId;
      assetTitle = String(asset.title || "").trim();
    } catch {
      // Rules packs have no quant asset.
    }
    const label = heading(markdown) || assetTitle || meta.name || name;
    const detail = strategyId
      ? `量化组合 · 信号 ${strategyId === "trend-following" ? "趋势跟踪" : "均值回归"}`
      : (meta.description || "项目规则包，不定义自动买卖信号").slice(0, 160);
    options.push({ id: name, label, detail, strategyId });
  }
  return options;
}
