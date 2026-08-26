import { promises as fs } from "node:fs";
import { basename, join } from "node:path";
import type { FeatureConfigShape, PluginSpec, SkillSpec } from "@codex-forge/protocol";
import {
  repositoryPackageUri,
  repositoryPluginId,
  repositorySkillId,
  toRepositoryVirtualPath
} from "./repository-plugin-paths.ts";

function unquote(value: string) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseSkillFrontmatter(source: string, fallbackName: string) {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  const fields: Record<string, string> = {};
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const field = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
      if (field) fields[field[1]] = unquote(field[2]);
    }
  }
  return {
    name: fields.name || fallbackName,
    description: fields.description || ""
  };
}

async function listSkillDirectories(root: string) {
  try {
    await fs.access(join(root, "SKILL.md"));
    return [root];
  } catch {
    // fall through
  }
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const directories: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = join(root, entry.name);
    try {
      await fs.access(join(skillDir, "SKILL.md"));
      directories.push(skillDir);
    } catch {
      // ignore non-skill folders
    }
  }
  return directories;
}

export function buildRepositoryPluginSpec(input: {
  pluginKey: string;
  version: string;
  displayName?: string;
  description?: string;
  publisher?: string;
}): PluginSpec {
  const pluginKey = input.pluginKey.trim();
  const version = input.version.trim();
  return {
    id: repositoryPluginId(pluginKey),
    name: input.displayName?.trim() || pluginKey,
    summary: input.description?.trim() || "来自 spring-app 插件仓库的技能包。",
    status: "enabled",
    version,
    source: repositoryPackageUri(pluginKey, version),
    manifestPath: repositoryPackageUri(pluginKey, version, ".codex-plugin/plugin.json"),
    publisher: input.publisher?.trim() || "spring-app",
    capabilities: ["skills"],
    skillRoots: [],
    mcpServerIds: []
  };
}

export async function discoverRepositorySkillSpecs(input: {
  pluginKey: string;
  version: string;
  packageDir: string;
  skillRoots: string[];
}): Promise<SkillSpec[]> {
  const discovered: SkillSpec[] = [];
  const seen = new Set<string>();
  for (const skillRoot of input.skillRoots) {
    for (const skillDir of await listSkillDirectories(skillRoot)) {
      const source = await fs.readFile(join(skillDir, "SKILL.md"), "utf8");
      const metadata = parseSkillFrontmatter(source, basename(skillDir));
      const skillName = String(metadata.name || basename(skillDir)).trim();
      if (!skillName || seen.has(skillName.toLowerCase())) continue;
      seen.add(skillName.toLowerCase());
      let hasScripts = false;
      try {
        const scriptEntries = await fs.readdir(join(skillDir, "scripts"), { withFileTypes: true });
        hasScripts = scriptEntries.some((entry) => entry.isFile());
      } catch {
        hasScripts = false;
      }
      discovered.push({
        id: repositorySkillId(input.pluginKey, skillName),
        name: skillName,
        summary: metadata.description || `${input.pluginKey} 插件技能`,
        status: "enabled",
        source: "repository",
        scope: "plugin",
        path: toRepositoryVirtualPath(join(skillDir, "SKILL.md"), input.packageDir, input.pluginKey, input.version),
        executionKind: hasScripts ? "script-assisted" : "instructions",
        executionEvidence: hasScripts ? ["SKILL.md", "scripts/（不会自动执行）"] : ["SKILL.md"]
      });
    }
  }
  return discovered;
}

export function virtualizeActivatedRepositoryPlugin(input: {
  pluginKey: string;
  version: string;
  packageDir: string;
  activated: PluginSpec;
}): PluginSpec {
  return {
    ...input.activated,
    source: repositoryPackageUri(input.pluginKey, input.version),
    manifestPath: repositoryPackageUri(input.pluginKey, input.version, ".codex-plugin/plugin.json"),
    skillRoots: (input.activated.skillRoots ?? []).map((root) =>
      toRepositoryVirtualPath(root, input.packageDir, input.pluginKey, input.version)
    )
  };
}

export function mergeRepositoryPluginActivation(
  config: FeatureConfigShape,
  input: { plugin: PluginSpec; skills: SkillSpec[] }
): FeatureConfigShape {
  const pluginId = input.plugin.id;
  const skillIds = new Set(input.skills.map((skill) => skill.id));
  const previousPlugin = config.plugins.find((plugin) => plugin.id === pluginId);
  const previousSkills = new Map(
    config.skills
      .filter((skill) => skill.id.startsWith(`${pluginId}:`))
      .map((skill) => [skill.id, skill] as const)
  );
  const mergedPlugin: PluginSpec = previousPlugin?.status === "disabled"
    ? { ...input.plugin, status: "disabled" }
    : input.plugin;
  const mergedSkills = input.skills.map((skill) => {
    const previous = previousSkills.get(skill.id);
    if (!previous) return skill;
    return {
      ...skill,
      status: previous.status === "disabled" ? "disabled" as const : skill.status
    };
  });
  return {
    ...config,
    plugins: [mergedPlugin, ...config.plugins.filter((plugin) => plugin.id !== pluginId)],
    skills: [
      ...mergedSkills,
      ...config.skills.filter((skill) => !skillIds.has(skill.id) && !skill.id.startsWith(`${pluginId}:`))
    ]
  };
}

export function mergeRepositoryPluginDeactivation(config: FeatureConfigShape, pluginKey: string): FeatureConfigShape {
  const pluginId = repositoryPluginId(pluginKey);
  return {
    ...config,
    plugins: config.plugins.map((plugin) =>
      plugin.id === pluginId ? { ...plugin, status: "disabled" as const } : plugin
    ),
    skills: config.skills.map((skill) =>
      skill.id.startsWith(`${pluginId}:`) ? { ...skill, status: "disabled" as const } : skill
    )
  };
}

export function mergeRepositoryPluginRemoval(config: FeatureConfigShape, pluginKey: string): FeatureConfigShape {
  const pluginId = repositoryPluginId(pluginKey);
  return {
    ...config,
    plugins: config.plugins.filter((plugin) => plugin.id !== pluginId),
    skills: config.skills.filter((skill) => !skill.id.startsWith(`${pluginId}:`))
  };
}
