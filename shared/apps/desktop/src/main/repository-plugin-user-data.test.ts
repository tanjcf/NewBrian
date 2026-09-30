import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const userData = await import(new URL("./repository-plugin-user-data.ts", import.meta.url).href) as typeof import("./repository-plugin-user-data.js");

test("migrates version-scoped user data into a stable store and overlays upgrades", async () => {
  const root = await mkdtemp(join(tmpdir(), "repo-user-data-"));
  const previousPackageDir = join(root, "packages", "game-studio", "1.0.0");
  const targetPackageDir = join(root, "packages", "game-studio", "1.1.0");
  await mkdir(join(previousPackageDir, "data", "cache"), { recursive: true });
  await writeFile(join(previousPackageDir, "data", "cache", "state.json"), "{\"v\":1}\n", "utf8");
  await mkdir(targetPackageDir, { recursive: true });
  await mkdir(join(targetPackageDir, "data"), { recursive: true });
  await writeFile(join(targetPackageDir, "data", "readme.txt"), "shipped\n", "utf8");

  await userData.migrateRepositoryPluginUserData({
    pluginsRoot: root,
    pluginKey: "game-studio",
    previousVersion: "1.0.0",
    targetPackageDir
  });

  assert.match(await readFile(join(root, "user", "game-studio", "data", "cache", "state.json"), "utf8"), /"v":1/);
  assert.match(await readFile(join(targetPackageDir, "data", "cache", "state.json"), "utf8"), /"v":1/);
  assert.match(await readFile(join(targetPackageDir, "data", "readme.txt"), "utf8"), /shipped/);
});
