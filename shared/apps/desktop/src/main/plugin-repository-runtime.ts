import { PluginInstallationService } from "./plugin-installation-service.js";
import { readTextWithTransientRetry, writeTextAtomically } from "./atomic-file.js";
import { verifyPluginPackage } from "./plugin-package-verifier.js";
import { PluginRepositoryClient } from "./plugin-repository-client.js";
import {
  registerPluginRepositoryRuntime,
  type PluginRepositoryRuntimeOptions
} from "./plugin-repository-ipc.js";

type RuntimeOptions = Omit<PluginRepositoryRuntimeOptions, "createClient" | "createInstaller">;

export function registerDesktopPluginRepositoryRuntime(
  ipcMain: Parameters<typeof registerPluginRepositoryRuntime>[0],
  options: RuntimeOptions
) {
  return registerPluginRepositoryRuntime(ipcMain, {
    ...options,
    createClient: (input) => new PluginRepositoryClient(input),
    createInstaller: (input) => new PluginInstallationService({
      ...input,
      client: input.client as PluginRepositoryClient,
      dependencies: { readTextWithTransientRetry, writeTextAtomically, verifyPluginPackage }
    })
  });
}
