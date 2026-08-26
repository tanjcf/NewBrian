import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const paths = await import(new URL("./repository-plugin-paths.ts", import.meta.url).href) as typeof import("./repository-plugin-paths.js");
const sync = await import(new URL("./repository-plugin-feature-sync.ts", import.meta.url).href) as typeof import("./repository-plugin-feature-sync.js");

test("repository virtual paths round-trip through plugins root", () => {
  const uri = paths.repositoryPackageUri("game-studio", "1.0.0", "skills/phaser/SKILL.md");
  assert.equal(
    paths.resolveRepositoryVirtualPath(uri, "C:/Users/me/AppData/plugins"),
    "C:\\Users\\me\\AppData\\plugins\\packages\\game-studio\\1.0.0\\skills\\phaser\\SKILL.md"
  );
});

test("repository plugin activation writes plugin and skills into feature config", async () => {
  const pluginsRoot = await mkdtemp(join(tmpdir(), "repo-plugins-"));
  const packageDir = join(pluginsRoot, "packages", "game-studio", "1.0.0");
  await mkdir(join(packageDir, "skills", "phaser"), { recursive: true });
  await writeFile(
    join(packageDir, "skills", "phaser", "SKILL.md"),
    "---\nname: phaser\ndescription: Build games with Phaser.\n---\n\n# Phaser\n",
    "utf8"
  );

  const baseSpec = sync.buildRepositoryPluginSpec({
    pluginKey: "game-studio",
    version: "1.0.0",
    displayName: "Game Studio"
  });
  const skills = await sync.discoverRepositorySkillSpecs({
    pluginKey: "game-studio",
    version: "1.0.0",
    packageDir,
    skillRoots: [join(packageDir, "skills")]
  });
  const merged = sync.mergeRepositoryPluginActivation(
    { skills: [], plugins: [], automations: [], runtime: { rustCoreTools: "disabled" } },
    {
      plugin: sync.virtualizeActivatedRepositoryPlugin({
        pluginKey: "game-studio",
        version: "1.0.0",
        packageDir,
        activated: { ...baseSpec, status: "enabled", skillRoots: [join(packageDir, "skills")] }
      }),
      skills
    }
  );

  assert.equal(merged.plugins[0]?.id, "repository:game-studio");
  assert.equal(merged.skills[0]?.name, "phaser");
  assert.match(String(merged.skills[0]?.path), /^repository:\/\/packages\/game-studio\/1\.0\.0\//);
});

test("repository plugin deactivation disables plugin-owned skills", () => {
  const config = {
    skills: [{ id: "repository:game-studio:phaser", name: "phaser", summary: "", status: "enabled" as const }],
    plugins: [{ id: "repository:game-studio", name: "Game Studio", summary: "", status: "enabled" as const }],
    automations: [],
    runtime: { rustCoreTools: "disabled" as const }
  };
  const next = sync.mergeRepositoryPluginDeactivation(config, "game-studio");
  assert.equal(next.plugins[0]?.status, "disabled");
  assert.equal(next.skills[0]?.status, "disabled");
});

test("repository plugin upgrade preserves prior disabled skill and plugin status", () => {
  const config = {
    skills: [{ id: "repository:game-studio:phaser", name: "phaser", summary: "old", status: "disabled" as const }],
    plugins: [{ id: "repository:game-studio", name: "Game Studio", summary: "", status: "disabled" as const, version: "1.0.0" }],
    automations: [],
    runtime: { rustCoreTools: "disabled" as const }
  };
  const merged = sync.mergeRepositoryPluginActivation(config, {
    plugin: sync.buildRepositoryPluginSpec({ pluginKey: "game-studio", version: "1.1.0" }),
    skills: [{
      id: "repository:game-studio:phaser",
      name: "phaser",
      summary: "new",
      status: "enabled",
      source: "repository",
      scope: "plugin",
      path: "repository://packages/game-studio/1.1.0/skills/phaser/SKILL.md"
    }]
  });
  assert.equal(merged.plugins[0]?.status, "disabled");
  assert.equal(merged.plugins[0]?.version, "1.1.0");
  assert.equal(merged.skills[0]?.status, "disabled");
  assert.equal(merged.skills[0]?.summary, "new");
});
