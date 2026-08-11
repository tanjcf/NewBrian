import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const { builtinPluginCatalog, builtinPluginUri } = await import(new URL("../shared/builtin-plugins.ts", import.meta.url).href) as typeof import("../shared/builtin-plugins.js");

test("ships every advertised builtin plugin with a valid manifest and executable skill", async () => {
  assert.equal(builtinPluginCatalog.length, 10);
  assert.equal(new Set(builtinPluginCatalog.map((plugin) => plugin.id)).size, builtinPluginCatalog.length);
  for (const plugin of builtinPluginCatalog) {
    const root = resolve("build", "plugins", plugin.packageName);
    const manifest = JSON.parse(await readFile(resolve(root, ".codex-plugin", "plugin.json"), "utf8"));
    const skill = await readFile(resolve(root, "skills", plugin.packageName, "SKILL.md"), "utf8");
    assert.equal(manifest.name, plugin.packageName);
    assert.equal(manifest.skills, "./skills/");
    assert.match(skill, new RegExp(`name: ${plugin.packageName}`));
    assert.match(skill, /description:\s*\S/);
    assert.equal(builtinPluginUri(plugin.packageName), `builtin:${plugin.packageName}`);
  }
});

test("default templates and local web plugins include real reusable assets", async () => {
  const files = [
    "build/plugins/default-templates/skills/default-templates/assets/document-report.md",
    "build/plugins/default-templates/skills/default-templates/assets/spreadsheet.csv",
    "build/plugins/default-templates/skills/default-templates/assets/presentation-outline.md",
    "build/plugins/sites/skills/sites/assets/static-site.html",
    "build/plugins/visualize/skills/visualize/assets/chart.html"
  ];
  for (const file of files) assert.ok((await readFile(resolve(file), "utf8")).trim().length > 40, file);
});
