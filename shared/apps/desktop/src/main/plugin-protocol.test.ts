import assert from "node:assert/strict";
import test from "node:test";
import { desktopIpcChannels } from "@codex-forge/protocol";
import type { PluginCatalogItem, PluginCatalogSnapshot, PluginInstallInput, PluginOperationResult } from "@codex-forge/protocol";

test("declares narrow plugin repository channels and data-only contracts", () => {
  const item: PluginCatalogItem = {
    plugin_key: "game-studio", display_name: "Game Studio", description: "Build games",
    category: "Developer Tools", publisher: "OpenAI", scope: "public", icon_url: "",
    install_state: "not_installed", installed_version: "", latest_version: "1.0.0",
    actions: ["install"], skills: ["phaser"]
  };
  const snapshot: PluginCatalogSnapshot = { items: [item], categories: ["Developer Tools"], page: 1, page_size: 20, total: 1 };
  const input: PluginInstallInput = { pluginKey: item.plugin_key, version: item.latest_version };
  const result: PluginOperationResult = { ok: true, pluginKey: input.pluginKey, state: "installed", version: input.version ?? "" };
  assert.equal(snapshot.items[0].plugin_key, result.pluginKey);
  assert.deepEqual(desktopIpcChannels.plugins, {
    list: "plugins:list", get: "plugins:get", install: "plugins:install",
    setEnabled: "plugins:set-enabled", remove: "plugins:remove", reconcile: "plugins:reconcile"
  });
});
