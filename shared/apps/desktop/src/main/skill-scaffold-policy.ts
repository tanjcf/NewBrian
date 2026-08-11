import type { FeatureItemInput } from "@codex-forge/protocol";

export function normalizeCapabilityList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

export function normalizeSkillName(rawName: string) {
  return rawName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

export function titleCaseSkillName(skillName: string) {
  return skillName
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function yamlDoubleQuoted(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n")}"`;
}

export function makeSkillDescription(input: FeatureItemInput, skillName: string) {
  const summary = input.summary?.trim();
  if (summary) return summary.slice(0, 1024);
  return `Use when Codex needs the ${skillName} skill. Describe concrete triggers, workflow guidance, and reusable resources in this skill.`;
}

export function makeOpenAiYaml(skillName: string, displayName: string, description: string) {
  const shortDescription = description.replace(/\s+/g, " ").trim().slice(0, 84) || `Use ${displayName}.`;
  return [
    "interface:",
    `  display_name: ${yamlDoubleQuoted(displayName)}`,
    `  short_description: ${yamlDoubleQuoted(shortDescription)}`,
    `  default_prompt: ${yamlDoubleQuoted(`Use $${skillName} to help with this task.`)}`,
    "",
    "policy:",
    "  allow_implicit_invocation: true",
    ""
  ].join("\n");
}

export function makeSkillMarkdown(skillName: string, displayName: string, description: string) {
  return [
    "---",
    `name: ${skillName}`,
    `description: ${description}`,
    "---",
    "",
    `# ${displayName}`,
    "",
    "## Overview",
    "",
    description,
    "",
    "## Workflow",
    "",
    "- Identify whether the current user request matches this skill's trigger description.",
    "- Apply the domain-specific guidance in this file before choosing tools or producing output.",
    "- Prefer project-local evidence and reusable resources in this skill when they are relevant.",
    "",
    "## Resources",
    "",
    "- Use `references/` for detailed guidance that should be loaded only when needed.",
    "- Use `scripts/` for deterministic helpers that can be executed repeatedly.",
    "- Use `assets/` for templates, examples, images, or other files used in outputs.",
    ""
  ].join("\n");
}

export function validateSkillMarkdown(skillName: string, markdown: string) {
  if (!/^---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(markdown)) {
    throw new Error("Skill SKILL.md must start with YAML frontmatter.");
  }
  if (!/^[a-z0-9-]+$/.test(skillName) || skillName.startsWith("-") || skillName.endsWith("-") || skillName.includes("--")) {
    throw new Error(`Invalid skill name: ${skillName}`);
  }
  if (skillName.length > 64) {
    throw new Error(`Skill name is too long: ${skillName}`);
  }
  if (!new RegExp(`^name:\\s*${skillName}\\s*$`, "m").test(markdown)) {
    throw new Error("Skill SKILL.md frontmatter is missing the expected name.");
  }
  if (!/^description:\s*\S/m.test(markdown)) {
    throw new Error("Skill SKILL.md frontmatter is missing description.");
  }
}

export function parseSkillFrontmatter(source: string, fallbackName: string) {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  const fields: Record<string, string> = {};
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const field = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
      if (field) {
        const rawValue = field[2].trim();
        fields[field[1]] =
          (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
          (rawValue.startsWith("'") && rawValue.endsWith("'"))
            ? rawValue.slice(1, -1)
            : rawValue;
      }
    }
  }
  return {
    name: fields.name?.trim() || fallbackName,
    description: fields.description?.trim() || ""
  };
}
