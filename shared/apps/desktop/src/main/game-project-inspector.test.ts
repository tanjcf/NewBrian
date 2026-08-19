import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inspectGameProject } from "./game-project-inspector.ts";

test("detects a web game, its safe preview script, and bounded asset counts", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-game-web-"));
  await mkdir(join(root, "src", "scenes"), { recursive: true });
  await mkdir(join(root, "public", "audio"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "tiny-racer", scripts: { dev: "vite --host 127.0.0.1" } }));
  await writeFile(join(root, "src", "main.ts"), "export {};");
  await writeFile(join(root, "src", "scenes", "track.json"), "{}");
  await writeFile(join(root, "public", "audio", "start.ogg"), "audio");

  const result = await inspectGameProject(root);

  assert.equal(result.engine, "web");
  assert.equal(result.displayName, "tiny-racer");
  assert.deepEqual(result.preview, { supported: true, command: "npm", args: ["run", "dev"], url: "http://127.0.0.1:5173", requiresApproval: true });
  assert.equal(result.assets.scripts, 1);
  assert.equal(result.assets.scenes, 1);
  assert.equal(result.assets.audio, 1);
  assert.equal(result.truncated, false);
});

test("detects native engine markers without inventing a runnable command", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-game-godot-"));
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(join(root, "project.godot"), "[application]\nconfig/name=\"Fox Trail\"\n");
  await writeFile(join(root, "assets", "hero.png"), "image");

  const result = await inspectGameProject(root);

  assert.equal(result.engine, "godot");
  assert.equal(result.displayName, "Fox Trail");
  assert.equal(result.preview.supported, false);
  assert.equal(result.assets.images, 1);
  assert.match(result.warnings.join(" "), /未配置可验证的 Godot 可执行程序/);
});

test("does not follow symlinked directories outside the authorized project", async (context) => {
  if (process.platform === "win32") context.skip("Windows developer mode may disallow fixture symlinks.");
  const root = await mkdtemp(join(tmpdir(), "brain-game-root-"));
  const outside = await mkdtemp(join(tmpdir(), "brain-game-outside-"));
  await writeFile(join(outside, "secret.ts"), "do not inspect");
  await symlink(outside, join(root, "linked-assets"), "dir");

  const result = await inspectGameProject(root);

  assert.equal(result.assets.scripts, 0);
  assert.ok(result.skippedEntries >= 1);
});

test("stops at the configured scan limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-game-limit-"));
  for (let index = 0; index < 8; index += 1) await writeFile(join(root, `asset-${index}.png`), "x");

  const result = await inspectGameProject(root, { maxEntries: 3 });

  assert.equal(result.scannedEntries, 3);
  assert.equal(result.truncated, true);
});
