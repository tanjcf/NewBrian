import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CapabilityResolver } from "./capability-resolver.js";
import { CapabilityStateStore } from "./capability-state-store.js";
import { ProviderSupervisor } from "./provider-supervisor.js";
import { activateProviderManifest } from "./provider-activation.js";
import { createBuiltinCapabilityCatalog, createBuiltinCapabilityRuntime } from "./tool-registry.js";

export function defaultCapabilityDataRoot(platform = process.platform) {
  if (platform === "win32") return path.join(process.env.LOCALAPPDATA || os.homedir(), "NewBrain", "capabilities");
  if (platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "NewBrain", "capabilities");
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "newbrain", "capabilities");
}

export function createCapabilitySystem({ toolRegistry, providerHandler, catalog, dataRoot, platform, onEvent }) {
  const capabilityRuntime = createBuiltinCapabilityRuntime(toolRegistry, { providerHandler });
  const registry = capabilityRuntime.registry;
  const capabilityCatalog = catalog || createBuiltinCapabilityCatalog(toolRegistry);
  const rootPath = path.resolve(dataRoot || defaultCapabilityDataRoot());
  const stateStore = new CapabilityStateStore({ rootPath: path.join(rootPath, "state") });
  const emit = async (event) => {
    onEvent?.(event);
    await stateStore.append(event);
  };
  const supervisor = new ProviderSupervisor({ installRoot: path.join(rootPath, "providers") });
  const activatePackage = async ({ candidate, installation }) => {
    if (installation.bundled) return { providerId: candidate.providerId || candidate.installation.providerId };
    const manifest = installation.manifest || candidate.installation.manifest;
    const activated = activateProviderManifest({
      manifest,
      registry,
      providers: capabilityRuntime.providers,
      createHandler: (provider, providerId) => createInstalledProviderHandler({ provider, providerId, packagePath: installation.packagePath })
    });
    for (const item of activated) registerCapabilityTool({ toolRegistry, capabilityRuntime, registry, capabilityId: item.capabilityId });
    return { providerId: activated.find((item) => candidate.capabilities.includes(item.capabilityId))?.providerId || activated[0]?.providerId };
  };
  const resolver = new CapabilityResolver({ registry, catalog: capabilityCatalog, supervisor, activatePackage, onEvent: emit });
  return { registry, capabilityRuntime, capabilityCatalog, supervisor, resolver, stateStore, toolRegistry, platform };
}

export async function restoreCapabilitySystem(system) {
  for (const installation of await system.supervisor.listActive()) {
    const manifestPath = path.join(installation.packagePath, "capability.json");
    try {
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      activateProviderManifest({
        manifest,
        registry: system.registry,
        providers: system.capabilityRuntime.providers,
        createHandler: (provider, providerId) => createInstalledProviderHandler({ provider, providerId, packagePath: installation.packagePath })
      }).forEach((item) => registerCapabilityTool({ toolRegistry: system.toolRegistry, capabilityRuntime: system.capabilityRuntime, registry: system.registry, capabilityId: item.capabilityId }));
    } catch (error) {
      await system.stateStore.append({ type: "capability_restore_failed", packageId: installation.packageId, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return system;
}

function registerCapabilityTool({ toolRegistry, capabilityRuntime, registry, capabilityId }) {
  if (toolRegistry.get(capabilityId)) return;
  const descriptor = registry.getCapability(capabilityId);
  if (!descriptor) throw new Error(`activated capability is missing: ${capabilityId}`);
  toolRegistry.register({
    name: capabilityId,
    title: descriptor.title || capabilityId,
    description: descriptor.description || `Installed capability: ${capabilityId}`,
    kind: ["local-write", "overwrite", "delete"].includes(descriptor.risk) ? "write" : "read",
    risk: descriptor.risk,
    requiresApproval: descriptor.approval !== "never",
    inputSchema: descriptor.inputSchema,
    installedCapability: true,
    async execute(input, context) {
      const result = await capabilityRuntime.invoke(capabilityId, input, { ...context, approved: true });
      if (result.status === "completed") return result.output;
      return { ok: false, exitCode: 1, output: result.error?.message || `Capability failed: ${capabilityId}`, capabilityResult: result };
    }
  });
}

function createInstalledProviderHandler({ provider, packagePath }) {
  if (provider.type !== "builtin") throw new Error(`Installed provider type is not supported by the local runtime: ${provider.type}`);
  const entry = provider.entry || "index.js";
  const entryPath = path.resolve(packagePath, entry);
  if (entryPath !== packagePath && !entryPath.startsWith(`${packagePath}${path.sep}`)) throw new Error("provider entry escapes package root");
  let loaded;
  return async (input, context) => {
    loaded ||= import(pathToFileURL(entryPath).href);
    const module = await loaded;
    const invoke = module.invoke || module.default;
    if (typeof invoke !== "function") throw new Error(`provider entry must export invoke(): ${entry}`);
    return invoke(context.capabilityId, input, context);
  };
}
