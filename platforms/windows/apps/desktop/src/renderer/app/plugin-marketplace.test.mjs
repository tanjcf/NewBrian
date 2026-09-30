import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("plugin marketplace consumes the typed repository API and exposes lifecycle actions", async () => {
  const source = await readFile(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  for (const contract of [
    'useState<"public" | "private">("public")',
    "listRepositoryPlugins",
    "installRepositoryPlugin",
    "setRepositoryPluginEnabled",
    "removeRepositoryPlugin",
    "repositoryPluginsLoading",
    "repositoryPluginError",
    ">公开</button>",
    ">个人</button>"
  ]) assert.ok(source.includes(contract), contract);
  assert.match(source, /dynamicPluginGroups\.map/);
  assert.match(source, /activeFeature !== "plugins"/);
});

test("preload exposes only fixed repository operations", async () => {
  const source = await readFile(new URL("../../preload/index.ts", import.meta.url), "utf8");
  assert.match(source, /desktopIpcChannels\.plugins\.list/);
  assert.match(source, /desktopIpcChannels\.plugins\.install/);
  assert.match(source, /desktopIpcChannels\.plugins\.setEnabled/);
  assert.match(source, /desktopIpcChannels\.plugins\.remove/);
  assert.doesNotMatch(source, /plugin.*ipcRenderer\.send/i);
});
