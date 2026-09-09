import { promises as fs } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

function normalizeNameSet(names) {
  return new Set(Array.from(names ?? []).map((name) => String(name).toLowerCase()));
}

export function parseSkillFrontmatter(source, fallbackName) {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  const parsed = match ? parse(match[1], { maxAliasCount: 20 }) : {};
  const fields = Object.fromEntries(Object.entries(parsed && typeof parsed === "object" ? parsed : {})
    .filter(([, value]) => typeof value === "string"));
  return {
    name: fields.name || fallbackName,
    description: fields.description || "",
    bodyOffset: match?.[0].length ?? 0
  };
}

async function listSkillDirectories(root) {
  const roots = [root, path.join(root, ".system")];
  const directories = [];
  for (const current of roots) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) directories.push(path.join(current, entry.name));
    }
  }
  return directories;
}

async function listOptionalResources(skillPath) {
  const resources = {};
  for (const name of ["references", "scripts", "assets", "agents"]) {
    try {
      const entries = await fs.readdir(path.join(skillPath, name), { withFileTypes: true });
      resources[name] = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return resources;
}

async function readReferenceContents(skillPath) {
  const referencePath = path.join(skillPath, "references");
  let entries;
  try {
    entries = await fs.readdir(referencePath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const contents = [];
  for (const entry of entries.filter((item) => item.isFile()).sort((left, right) => left.name.localeCompare(right.name))) {
    const source = await fs.readFile(path.join(referencePath, entry.name), "utf8");
    if (entry.name === "session-digest.md" && source.length > 16 * 1024) {
      const tail = source.slice(-16 * 1024);
      const sectionOffset = tail.indexOf("\n## ");
      contents.push({
        name: entry.name,
        content: `# Session Digest (most recent entries)\n\n${sectionOffset >= 0 ? tail.slice(sectionOffset + 1) : tail}`
      });
      continue;
    }
    const limit = entry.name === "user-output-rules.md" ? 16 * 1024 : 64 * 1024;
    contents.push({ name: entry.name, content: source.slice(0, limit) });
  }
  return contents;
}

export class SkillRegistry {
  constructor(input = {}) {
    this.roots = [...new Set((input.roots ?? []).filter(Boolean).map((root) => path.resolve(root)))];
    this.disabledNames = normalizeNameSet(input.disabledNames);
    this.skills = new Map();
  }

  async discover() {
    const discovered = new Map();
    for (const root of this.roots) {
      for (const skillPath of await listSkillDirectories(root)) {
        const instructionPath = path.join(skillPath, "SKILL.md");
        let source;
        try {
          source = await fs.readFile(instructionPath, "utf8");
        } catch (error) {
          if (error?.code === "ENOENT") continue;
          throw error;
        }
        const metadata = parseSkillFrontmatter(source, path.basename(skillPath));
        if (!this.disabledNames.has(String(metadata.name).toLowerCase()) && !discovered.has(metadata.name)) {
          discovered.set(metadata.name, {
            name: metadata.name,
            description: metadata.description,
            path: skillPath,
            instructionPath,
            system: path.basename(path.dirname(skillPath)) === ".system"
          });
        }
      }
    }
    this.skills = discovered;
    return this.list();
  }

  list() {
    return [...this.skills.values()].map((skill) => ({ ...skill }));
  }

  get(name) {
    return this.skills.get(name);
  }

  match(prompt) {
    const normalized = String(prompt || "").toLowerCase();
    return this.list().filter((skill) => {
      const explicit = normalized.includes(`$${skill.name.toLowerCase()}`);
      if (explicit) return true;
      const name = skill.name.toLowerCase();
      if (name.length >= 4 && normalized.includes(name)) return true;
      const terms = skill.description.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
      return [...new Set(terms)].filter((term) => normalized.includes(term)).length >= 2;
    });
  }

  async load(name) {
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`Unknown skill: ${name}`);
    const instructions = await fs.readFile(skill.instructionPath, "utf8");
    return {
      ...skill,
      instructions,
      resources: await listOptionalResources(skill.path),
      referenceContents: await readReferenceContents(skill.path)
    };
  }

  setDisabledNames(names) {
    this.disabledNames = normalizeNameSet(names);
  }
}

export function defaultSkillRoots(workspacePath) {
  const configured = String(process.env.NEWBRAIN_SKILLS_PATH || "")
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
  return [...configured, path.join(workspacePath, ".newbrain", "skills"), path.join(workspacePath, "skills")];
}
