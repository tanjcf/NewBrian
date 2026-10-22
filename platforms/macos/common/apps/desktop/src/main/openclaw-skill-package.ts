import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { basename, dirname, join, normalize, relative, resolve, sep } from "node:path";
import { parse } from "yaml";

export const OPENCLAW_SKILL_MARKERS = ["SKILL.md", "skill.md", "skills.md", "SKILL.MD"] as const;
export const SPRING_SKILL_MARKERS = ["skill/SKILL.md", "skill/skill.md"] as const;

export type OpenClawSkillLayout = "openclaw-root" | "spring-nested" | "nested-root";

export interface OpenClawSkillPackageInfo {
  layout: OpenClawSkillLayout;
  rootDir: string;
  skillMarkdownPath: string;
  name: string;
  description: string;
  hasScripts: boolean;
  hasReferences: boolean;
  hasAgentsYaml: boolean;
  warnings: string[];
}

export interface OpenClawSkillSecurityScan {
  ok: boolean;
  blocked: boolean;
  reasons: string[];
  warnings: string[];
  hasScripts: boolean;
}

/** Parse AgentSkills / OpenClaw SKILL.md frontmatter. */
export function parseOpenClawSkillFrontmatter(source: string, fallbackName: string) {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  const parsed = match ? parse(match[1], { maxAliasCount: 20 }) : {};
  const fields = Object.fromEntries(Object.entries(parsed && typeof parsed === "object" ? parsed : {})
    .filter(([, value]) => typeof value === "string")) as Record<string, string>;
  return {
    name: (fields.name || fallbackName).trim(),
    description: (fields.description || "").trim(),
    homepage: (fields.homepage || "").trim(),
    bodyOffset: match?.[0].length ?? 0
  };
}

/** Normalize a skill directory / slug name for NewBrain managed roots. */
export function normalizeOpenClawSkillName(rawName: string) {
  return rawName
    .trim()
    .toLowerCase()
    .replace(/^@[^/]+\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

async function pathExists(target: string) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function findMarkerFile(rootDir: string, markers: readonly string[]) {
  for (const marker of markers) {
    const candidate = join(rootDir, ...marker.split("/"));
    if (await pathExists(candidate)) return candidate;
  }
  return "";
}

async function listImmediateDirs(rootDir: string) {
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => join(rootDir, entry.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Detect an OpenClaw / AgentSkills / spring skill package directory.
 * Accepts root SKILL.md, nested zip wrapper folders, and spring `skill/SKILL.md`.
 */
export async function detectOpenClawSkillPackage(sourceDir: string): Promise<OpenClawSkillPackageInfo> {
  const resolved = resolve(sourceDir);
  let layout: OpenClawSkillLayout = "openclaw-root";
  let rootDir = resolved;
  let skillMarkdownPath = await findMarkerFile(resolved, OPENCLAW_SKILL_MARKERS);

  if (!skillMarkdownPath) {
    const springPath = await findMarkerFile(resolved, SPRING_SKILL_MARKERS);
    if (springPath) {
      layout = "spring-nested";
      skillMarkdownPath = springPath;
    }
  }

  if (!skillMarkdownPath) {
    const children = await listImmediateDirs(resolved);
    for (const child of children) {
      const nestedRoot = await findMarkerFile(child, OPENCLAW_SKILL_MARKERS);
      if (nestedRoot) {
        layout = "nested-root";
        rootDir = child;
        skillMarkdownPath = nestedRoot;
        break;
      }
      const nestedSpring = await findMarkerFile(child, SPRING_SKILL_MARKERS);
      if (nestedSpring) {
        layout = "spring-nested";
        rootDir = child;
        skillMarkdownPath = nestedSpring;
        break;
      }
    }
  }

  if (!skillMarkdownPath) {
    throw new Error("OpenClaw skill package must contain SKILL.md (AgentSkills layout).");
  }

  const source = await fs.readFile(skillMarkdownPath, "utf8");
  const fallbackName = basename(layout === "spring-nested" ? dirname(dirname(skillMarkdownPath)) : dirname(skillMarkdownPath));
  const metadata = parseOpenClawSkillFrontmatter(source, fallbackName);
  const name = normalizeOpenClawSkillName(metadata.name || fallbackName);
  if (!name) throw new Error("Skill package frontmatter is missing a usable name.");

  const warnings: string[] = [];
  if (!metadata.description) warnings.push("SKILL.md frontmatter is missing description.");
  if (layout === "spring-nested") {
    warnings.push("Detected spring SkillAsset layout (skill/SKILL.md); will remap to OpenClaw root SKILL.md on install.");
  }

  const hasScripts = await pathExists(join(rootDir, "scripts"));
  const hasReferences =
    (await pathExists(join(rootDir, "references"))) || (await pathExists(join(rootDir, "knowledge")));
  const hasAgentsYaml =
    (await pathExists(join(rootDir, "agents", "openai.yaml"))) ||
    (await pathExists(join(rootDir, "agents", "openai.yml")));

  if (hasScripts) {
    warnings.push("Package includes scripts/; NewBrain will not auto-execute them without approval.");
  }

  return {
    layout,
    rootDir,
    skillMarkdownPath,
    name,
    description: metadata.description || `OpenClaw skill ${name}`,
    hasScripts,
    hasReferences,
    hasAgentsYaml,
    warnings
  };
}

const DANGEROUS_CONTENT_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "inline private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: "aws access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "curl|bash pipe", pattern: /\bcurl\b[^\n|]*\|\s*(?:ba)?sh\b/i },
  { label: "powershell download cradle", pattern: /Invoke-Expression|IEX\s*\(|DownloadString\s*\(/i }
];

/** Lightweight static scan; skills are instruction packs and are never auto-executed. */
export async function scanOpenClawSkillPackage(info: OpenClawSkillPackageInfo): Promise<OpenClawSkillSecurityScan> {
  const reasons: string[] = [];
  const warnings = [...info.warnings];
  const skillText = await fs.readFile(info.skillMarkdownPath, "utf8");
  for (const rule of DANGEROUS_CONTENT_PATTERNS) {
    if (rule.pattern.test(skillText)) reasons.push(`Suspicious content in SKILL.md: ${rule.label}`);
  }

  if (info.hasScripts) {
    warnings.push("scripts/ present — review before running any helper from this skill.");
  }

  return {
    ok: reasons.length === 0,
    blocked: reasons.length > 0,
    reasons,
    warnings,
    hasScripts: info.hasScripts
  };
}

export function assertZipEntrySafe(stagingRoot: string, entryName: string) {
  const normalizedEntry = entryName.replace(/\\/g, "/");
  if (!normalizedEntry || normalizedEntry.startsWith("/") || normalizedEntry.includes("\0")) {
    throw new Error(`Unsafe zip entry: ${entryName}`);
  }
  if (normalizedEntry.split("/").some((part) => part === "..")) {
    throw new Error(`Zip path traversal blocked: ${entryName}`);
  }
  const destination = join(stagingRoot, ...normalizedEntry.split("/"));
  const normalizedRoot = normalize(stagingRoot + sep);
  const normalizedDestination = normalize(destination);
  if (normalizedDestination !== normalize(stagingRoot) && !normalizedDestination.startsWith(normalizedRoot)) {
    throw new Error(`Zip entry escapes staging root: ${entryName}`);
  }
  return destination;
}

export async function sha256File(filePath: string) {
  const bytes = await fs.readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

export async function sha256Text(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function relativizeUnder(rootDir: string, filePath: string) {
  return relative(rootDir, filePath).split(/[/\\]/).join("/");
}
