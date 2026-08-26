import { join } from "node:path";

export const REPOSITORY_PLUGIN_PREFIX = "repository:";
export const REPOSITORY_URI_PREFIX = "repository://";

/** Stable feature-config id for one spring-app plugin key. */
export function repositoryPluginId(pluginKey: string) {
  return `${REPOSITORY_PLUGIN_PREFIX}${pluginKey}`;
}

/** Stable feature-config id for one skill contributed by a repository plugin. */
export function repositorySkillId(pluginKey: string, skillName: string) {
  return `${repositoryPluginId(pluginKey)}:${skillName}`;
}

export function isRepositoryPluginId(id: string) {
  return String(id || "").startsWith(REPOSITORY_PLUGIN_PREFIX);
}

export function isRepositoryVirtualPath(value: string) {
  return String(value || "").startsWith(REPOSITORY_URI_PREFIX);
}

export function repositoryPackageUri(pluginKey: string, version: string, relativePath = "") {
  const base = `packages/${pluginKey}/${version}`;
  const suffix = relativePath.replace(/^\/+/, "").replace(/\\/g, "/");
  return `${REPOSITORY_URI_PREFIX}${suffix ? `${base}/${suffix}` : base}`;
}

export function resolveRepositoryVirtualPath(value: string, pluginsRoot: string) {
  if (!isRepositoryVirtualPath(value)) return value;
  const uri = value.slice(REPOSITORY_URI_PREFIX.length);
  const match = /^packages\/([a-z0-9-]+)\/([^/]+)(?:\/(.*))?$/.exec(uri);
  if (!match) {
    throw new Error(`Invalid repository plugin path: ${value}`);
  }
  const [, pluginKey, version, rest = ""] = match;
  const base = join(pluginsRoot, "packages", pluginKey, version);
  return rest ? join(base, ...rest.split("/")) : base;
}

export function toRepositoryVirtualPath(absolutePath: string, packageDir: string, pluginKey: string, version: string) {
  const normalizedPackage = packageDir.replace(/\\/g, "/");
  const normalizedAbsolute = absolutePath.replace(/\\/g, "/");
  if (!normalizedAbsolute.startsWith(normalizedPackage)) {
    return absolutePath;
  }
  const relative = normalizedAbsolute.slice(normalizedPackage.length).replace(/^\/+/, "");
  return repositoryPackageUri(pluginKey, version, relative);
}
