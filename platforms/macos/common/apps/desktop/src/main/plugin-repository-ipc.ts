import {
  desktopIpcChannels,
  type PluginCatalogQuery,
  type PluginInstallInput,
  type PluginKeyInput,
  type PluginSetEnabledInput
} from "@codex-forge/protocol";

interface IpcRegistrar {
  handle(channel: string, handler: (_event: unknown, input?: unknown) => unknown): void;
  removeHandler(channel: string): void;
}

export interface PluginRepositoryIpcServices {
  list(input: PluginCatalogQuery): unknown;
  get(pluginKey: string): unknown;
  install(pluginKey: string, version?: string): unknown;
  setEnabled(pluginKey: string, enabled: boolean): unknown;
  remove(pluginKey: string): unknown;
  reconcile(): unknown;
}

export interface RepositoryPluginLifecycleInput {
  pluginKey: string;
  version: string;
}

export interface PluginRepositoryRuntimeOptions {
  pluginRoot: string;
  clientVersion: string;
  onInstalled?: (input: RepositoryPluginLifecycleInput) => Promise<void>;
  onSetEnabled?: (input: RepositoryPluginLifecycleInput & { enabled: boolean }) => Promise<void>;
  onRemoved?: (input: { pluginKey: string }) => Promise<void>;
  getConnection(): Promise<{
    runtimeKey: string;
    gatewayOrigin: string;
    headers: Record<string, string>;
    deviceId: string;
  }>;
  createClient(input: { gatewayOrigin: string; headers: Record<string, string> }): {
    list(input: PluginCatalogQuery, deviceId: string): unknown;
    detail(pluginKey: string, deviceId: string): unknown;
    reconcile(deviceId: string): unknown;
  };
  createInstaller(input: {
    root: string;
    client: ReturnType<PluginRepositoryRuntimeOptions["createClient"]>;
    deviceId: string;
    clientVersion: string;
  }): {
    install(pluginKey: string, version?: string): Promise<{ version: string }>;
    setEnabled(pluginKey: string, enabled: boolean): Promise<{ version: string }>;
    remove(pluginKey: string): Promise<{ version: string }>;
    getInstalled(pluginKey: string): Promise<{ version: string; enabled: boolean } | null>;
  };
}

function object(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PLUGIN_INPUT_INVALID");
  return value as Record<string, unknown>;
}

function key(value: unknown) {
  const pluginKey = String(value ?? "").trim();
  if (!/^[a-z0-9][a-z0-9-]{0,126}[a-z0-9]$/.test(pluginKey)) throw new Error("PLUGIN_KEY_INVALID");
  return pluginKey;
}

export function registerPluginRepositoryIpc(ipcMain: IpcRegistrar, services: PluginRepositoryIpcServices) {
  const channels = desktopIpcChannels.plugins;
  ipcMain.handle(channels.list, (_event, input) => services.list((input ?? {}) as PluginCatalogQuery));
  ipcMain.handle(channels.get, (_event, input) => services.get(key(object(input).pluginKey)));
  ipcMain.handle(channels.install, (_event, input) => {
    const value = object(input) as unknown as PluginInstallInput;
    return services.install(key(value.pluginKey), typeof value.version === "string" ? value.version : undefined);
  });
  ipcMain.handle(channels.setEnabled, (_event, input) => {
    const value = object(input) as unknown as PluginSetEnabledInput;
    if (typeof value.enabled !== "boolean") throw new Error("PLUGIN_INPUT_INVALID");
    return services.setEnabled(key(value.pluginKey), value.enabled);
  });
  ipcMain.handle(channels.remove, (_event, input) => services.remove(key((object(input) as unknown as PluginKeyInput).pluginKey)));
  ipcMain.handle(channels.reconcile, () => services.reconcile());
  return () => {
    for (const channel of Object.values(channels)) ipcMain.removeHandler(channel);
  };
}

export function registerPluginRepositoryRuntime(
  ipcMain: IpcRegistrar,
  options: PluginRepositoryRuntimeOptions
) {
  let runtimeKey = "";
  let client: ReturnType<PluginRepositoryRuntimeOptions["createClient"]> | null = null;
  let installer: ReturnType<PluginRepositoryRuntimeOptions["createInstaller"]> | null = null;
  const requireRuntime = async () => {
    const connection = await options.getConnection();
    if (connection.runtimeKey !== runtimeKey || !client || !installer) {
      client = options.createClient({
        gatewayOrigin: connection.gatewayOrigin,
        headers: connection.headers
      });
      installer = options.createInstaller({
        root: options.pluginRoot,
        client,
        deviceId: connection.deviceId,
        clientVersion: options.clientVersion
      });
      runtimeKey = connection.runtimeKey;
    }
    return { client, installer, deviceId: connection.deviceId };
  };
  return registerPluginRepositoryIpc(ipcMain, {
    list: async (input) => {
      const current = await requireRuntime();
      return current.client.list(input, current.deviceId);
    },
    get: async (pluginKey) => {
      const current = await requireRuntime();
      return current.client.detail(pluginKey, current.deviceId);
    },
    install: async (pluginKey, version) => {
      const current = await requireRuntime();
      const result = await current.installer.install(pluginKey, version) as { version?: string };
      const installedVersion = String(result.version || version || "").trim();
      if (options.onInstalled && installedVersion) {
        await options.onInstalled({ pluginKey, version: installedVersion });
      }
      return result;
    },
    setEnabled: async (pluginKey, enabled) => {
      const current = await requireRuntime();
      const result = await current.installer.setEnabled(pluginKey, enabled) as { version?: string };
      const installedVersion = String(result.version || "").trim();
      if (options.onSetEnabled && installedVersion) {
        await options.onSetEnabled({ pluginKey, version: installedVersion, enabled });
      }
      return result;
    },
    remove: async (pluginKey) => {
      const current = await requireRuntime();
      const result = await current.installer.remove(pluginKey) as { version?: string };
      if (options.onRemoved) {
        await options.onRemoved({ pluginKey });
      }
      return result;
    },
    reconcile: async () => {
      const current = await requireRuntime();
      return current.client.reconcile(current.deviceId);
    }
  });
}
