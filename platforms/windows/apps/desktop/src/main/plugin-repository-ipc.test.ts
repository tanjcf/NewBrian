import assert from "node:assert/strict";
import test from "node:test";
import { desktopIpcChannels } from "@codex-forge/protocol";

const { registerPluginRepositoryIpc, registerPluginRepositoryRuntime } = await import(
  new URL("./plugin-repository-ipc.ts", import.meta.url).href
) as typeof import("./plugin-repository-ipc.js");

test("registers only the fixed plugin channels and validates operation input", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain = { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler), removeHandler: (channel: string) => handlers.delete(channel) };
  const calls: string[] = [];
  const services = {
    list: async () => { calls.push("list"); return { items: [] }; },
    get: async () => ({}),
    install: async (key: string) => { calls.push("install:" + key); return { ok: true }; },
    setEnabled: async () => ({}),
    remove: async () => ({}),
    reconcile: async () => ({})
  };
  const dispose = registerPluginRepositoryIpc(ipcMain as never, services);
  assert.deepEqual([...handlers.keys()].sort(), Object.values(desktopIpcChannels.plugins).sort());
  await handlers.get(desktopIpcChannels.plugins.list)?.({}, { scope: "public" });
  await handlers.get(desktopIpcChannels.plugins.install)?.({}, { pluginKey: "game-studio" });
  assert.deepEqual(calls, ["list", "install:game-studio"]);
  await assert.rejects(async () => handlers.get(desktopIpcChannels.plugins.install)?.({}, { pluginKey: "../escape" }), /PLUGIN_KEY_INVALID/);
  dispose();
  assert.equal(handlers.size, 0);
});

test("registers the plugin runtime once and reuses services for the same connection", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain = {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel)
  };
  let clients = 0;
  let installers = 0;
  const client = {
    list: async () => ({ items: [] }),
    detail: async () => ({}),
    reconcile: async () => ({ ok: true })
  };
  const installer = {
    install: async () => ({ ok: true }),
    setEnabled: async () => ({ ok: true }),
    remove: async () => ({ ok: true })
  };
  registerPluginRepositoryRuntime(ipcMain as never, {
    pluginRoot: "plugins",
    clientVersion: "1.0.0",
    getConnection: async () => ({
      runtimeKey: "connection",
      gatewayOrigin: "https://example.test",
      headers: {},
      deviceId: "device"
    }),
    createClient: () => { clients += 1; return client as never; },
    createInstaller: () => { installers += 1; return installer as never; }
  });
  await handlers.get(desktopIpcChannels.plugins.list)?.({}, {});
  await handlers.get(desktopIpcChannels.plugins.reconcile)?.({});
  assert.equal(clients, 1);
  assert.equal(installers, 1);
});
