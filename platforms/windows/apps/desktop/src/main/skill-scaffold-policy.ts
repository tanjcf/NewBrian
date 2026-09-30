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
  return `Use when coding or completing ${skillName} work that needs reliable edits, encoding-safe patches, domain workflow guidance, and an explicit post-change evaluation. Prefer this skill for Java/Spring or Windows source edits when those apply.`;
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

/**
 * Skill scaffold aligned with programming-skill structure:
 * Core Rules → Workflow → Encoding → Patch → Domain → Resources → Evaluation.
 */
export function makeSkillMarkdown(skillName: string, displayName: string, description: string) {
  const shortDescription = description.replace(/\s+/g, " ").trim().slice(0, 84) || `Use ${displayName}.`;
  return [
    "---",
    `name: ${skillName}`,
    `description: ${description}`,
    "metadata:",
    `  short-description: ${shortDescription}`,
    "---",
    "",
    `# ${displayName}`,
    "",
    "Use this skill for domain work when reliability matters more than speed.",
    "",
    "## Core Rules",
    "",
    "1. Prefer small, local edits over whole-file rewrites.",
    "2. Use patch-style edits whenever possible so unrelated code is less likely to break.",
    "3. Before editing, inspect the target file's local structure instead of assuming clean encoding or formatting.",
    "4. After editing, sanity-check that imports, braces, method boundaries, and type structure still line up.",
    "5. Do not guess when behavior is unclear; inspect direct evidence first (logs, HTTP responses, file bytes, running state).",
    "6. After every material change, include a short real-fix evaluation: implemented / verified / unverified.",
    "",
    "## Workflow",
    "",
    "- Identify whether the current user request matches this skill's trigger description.",
    "- Apply the domain-specific guidance below before choosing tools or producing output.",
    "- Prefer project-local evidence and reusable resources in this skill when they are relevant.",
    "- For Java edits, enforce `references/java-javadoc-rules.md` when that file exists; missing required method Javadoc means incomplete.",
    "- For Spring/backend design or implementation, follow `references/backend-technical-design-framework.md` when that file exists.",
    "",
    "## Encoding Rules",
    "",
    "1. On Windows, preserve UTF-8 without BOM unless the file already requires BOM.",
    "2. Treat UTF-8 as mandatory for repository source and config unless the file proves otherwise.",
    "3. Avoid PowerShell default text writes (`Set-Content`, `Out-File`, `>`) for source edits unless UTF-8 without BOM is explicit.",
    "4. Prefer smallest patches; after bulk rewrites, verify Chinese/non-ASCII text did not become mojibake.",
    "5. Java files: a UTF-8 BOM can trigger `illegal character: '\\ufeff'`.",
    "",
    "## Patch Strategy",
    "",
    "1. Start with the smallest possible patch.",
    "2. Avoid large replacements in files with mojibake, mixed encodings, or generated text.",
    "3. If a patch path is fragile, pause and verify exact local text before retrying.",
    "4. If your edit breaks the build, fix the workspace before adding more feature work.",
    "",
    "## Domain Guidance",
    "",
    description,
    "",
    "## Scene Tools (BRAIN)",
    "",
    "1. Except 场景学习探索, deliver through the current scene's **right-side Tools sub-architecture** (music DAW, video pipeline, quant panels, data Julius, document review, etc.).",
    "2. Prefer registered scene Agent tools over bare Auto gateway media calls that skip the panel.",
    "3. Honor project-init / project-manager references: `scene-knowledge.md` and `scene-tools-routing.md` when present.",
    "",
    "## Resources",
    "",
    "- Use `references/` for detailed guidance loaded only when needed (for example programming guardrails, Javadoc rules, backend design framework, scene knowledge).",
    "- Use `scripts/` for deterministic helpers that can be executed repeatedly.",
    "- Use `assets/` for templates, examples, images, or other files used in outputs.",
    "",
    "## Post-Change Evaluation",
    "",
    "1. Distinguish: implemented in code / verified by automated checks / verified by runtime or UI / not verified.",
    "2. If runtime or UI verification was impossible, say so clearly.",
    "3. When asked whether work was \"真实修复\" or \"按要求实现\", answer strictly from evidence and list gaps.",
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
