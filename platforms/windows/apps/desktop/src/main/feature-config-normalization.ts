import { isAbsolute, relative, resolve } from "node:path";
import type { AutomationSpec, PluginSpec, SkillSpec } from "@codex-forge/protocol";
import { isRepositoryPluginId, isRepositoryVirtualPath } from "./repository-plugin-paths.ts";

export interface FeatureConfigShape {
  skills: SkillSpec[];
  plugins: PluginSpec[];
  automations: AutomationSpec[];
  runtime: {
    rustCoreTools: "disabled" | "read" | "read-write";
  };
}

export interface FeatureConfigNormalizationContext {
  defaults: FeatureConfigShape;
  workspaceStateRoot: string;
  workspacePath: string;
  isPackaged: boolean;
}

export function normalizeFeatureConfig(
  parsed: Partial<FeatureConfigShape>,
  context: FeatureConfigNormalizationContext
): FeatureConfigShape {
  const isPortableFeaturePath = (value?: string) => {
    const trimmed = value?.trim();
    if (
      !trimmed
      || trimmed === "builtin"
      || isRepositoryVirtualPath(trimmed)
      || /^builtin:[a-z0-9-]+(?:\/[a-z0-9._\/-]+)?$/i.test(trimmed)
      || /^https?:\/\//i.test(trimmed)
    ) return true;
    const resolved = resolve(trimmed);
    const relativeToWorkspaceState = relative(context.workspaceStateRoot, resolved);
    const relativeToWorkspace = relative(context.workspacePath, resolved);
    return (
      (!relativeToWorkspaceState.startsWith("..") && !isAbsolute(relativeToWorkspaceState)) ||
      (!relativeToWorkspace.startsWith("..") && !isAbsolute(relativeToWorkspace))
    );
  };
  const normalizePluginForCurrentInstall = (plugin: PluginSpec) => {
    if (isRepositoryPluginId(plugin.id) || isRepositoryVirtualPath(plugin.source || "") || isRepositoryVirtualPath(plugin.manifestPath || "")) {
      return plugin;
    }
    if (!context.isPackaged || plugin.source === "builtin" || plugin.source?.startsWith("builtin:")) return plugin;
    const sourceOk = isPortableFeaturePath(plugin.source);
    const manifestOk = isPortableFeaturePath(plugin.manifestPath);
    const skillRoots = Array.isArray(plugin.skillRoots)
      ? plugin.skillRoots.filter((root) => isPortableFeaturePath(root))
      : [];
    if (!sourceOk || !manifestOk) return null;
    return { ...plugin, skillRoots };
  };
  const plugins = (Array.isArray(parsed.plugins) ? parsed.plugins : context.defaults.plugins)
    .map(normalizePluginForCurrentInstall)
    .filter((plugin): plugin is PluginSpec => Boolean(plugin));
  const skills = (Array.isArray(parsed.skills) ? parsed.skills : context.defaults.skills)
    .filter((item) => item.id !== "skill-error-auto-remediation" && item.name !== "error-auto-remediation");
  const automations = (Array.isArray(parsed.automations) ? parsed.automations : context.defaults.automations)
    .filter((item) => item.id !== "automation-error-remediation" && item.action !== "error_remediation");
  const rustCoreTools = parsed.runtime?.rustCoreTools === "read" || parsed.runtime?.rustCoreTools === "read-write"
    ? parsed.runtime.rustCoreTools
    : "disabled";
  return {
    skills: skills.map((skill) => ({
      ...skill,
      status: skill.status === "planned" || skill.status === "disabled" ? skill.status : "enabled"
    })),
    plugins,
    automations,
    runtime: { rustCoreTools }
  };
}
