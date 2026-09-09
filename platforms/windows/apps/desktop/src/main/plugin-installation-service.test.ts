import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, mkdir, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import JSZip from "jszip";

const { PluginInstallationService } = await import(
  new URL("./plugin-installation-service.ts", import.meta.url).href
) as typeof import("./plugin-installation-service.js");
const { sha256Hex } = await import(
  new URL("./plugin-package-verifier.ts", import.meta.url).href
) as typeof import("./plugin-package-verifier.js");

async function release(version: string) {
  const keys = generateKeyPairSync("ed25519");
  const zip = new JSZip();
  zip.file(".codex-plugin/plugin.json", JSON.stringify({ name: "game-studio", version, skills: "./skills/" }));
  zip.file("skills/phaser/SKILL.md", "---\nname: phaser\n---\n" + version);
  const bytes = new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
  const hash = sha256Hex(bytes);
  return {
    manifest: {
      plugin_key: "game-studio", version, content_hash: "sha256:" + hash,
      signature: "ed25519:" + sign(null, Buffer.from(hash), keys.privateKey).toString("base64"),
      signing_public_key: keys.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
      archive_size: bytes.byteLength
    },
    download: { bytes, contentHash: hash, signature: "" }
  };
}

test("installs, disables, enables and removes a signed plugin atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "newbrain-plugins-"));
  const value = await release("1.0.0");
  const reports: unknown[] = [];
  const client = {
    manifest: async () => value.manifest,
    download: async () => value.download,
    report: async (_device: string, _plugin: string, report: unknown) => { reports.push(report); return {}; }
  };
  const service = new PluginInstallationService({ root, client: client as never, deviceId: "device-001", clientVersion: "0.1.55" });
  assert.equal((await service.install("game-studio")).state, "installed");
  assert.match(await readFile(join(root, "packages", "game-studio", "1.0.0", "skills", "phaser", "SKILL.md"), "utf8"), /1\.0\.0/);
  assert.equal((await service.setEnabled("game-studio", false)).state, "disabled");
  assert.equal((await service.setEnabled("game-studio", true)).state, "installed");
  assert.equal((await service.remove("game-studio")).state, "removed");
  assert.equal(reports.length, 4);
});

test("a failed upgrade preserves the installed version", async () => {
  const root = await mkdtemp(join(tmpdir(), "newbrain-plugins-"));
  let value = await release("1.0.0");
  const client = {
    manifest: async () => value.manifest,
    download: async () => value.download,
    report: async () => ({})
  };
  const service = new PluginInstallationService({ root, client: client as never, deviceId: "device-001", clientVersion: "0.1.55" });
  await service.install("game-studio");
  value = await release("1.1.0");
  value.manifest.content_hash = "sha256:" + "0".repeat(64);
  await assert.rejects(() => service.install("game-studio", "1.1.0"), /PLUGIN_HASH_MISMATCH/);
  const snapshot = await service.snapshot();
  assert.equal(snapshot["game-studio"].version, "1.0.0");
  assert.match(await readFile(join(root, "packages", "game-studio", "1.0.0", "skills", "phaser", "SKILL.md"), "utf8"), /1\.0\.0/);
});

test("upgrades on top of the previous version and preserves user-owned data", async () => {
  const root = await mkdtemp(join(tmpdir(), "newbrain-plugins-"));
  let value = await release("1.0.0");
  const client = {
    manifest: async () => value.manifest,
    download: async () => value.download,
    report: async () => ({})
  };
  const service = new PluginInstallationService({ root, client: client as never, deviceId: "device-001", clientVersion: "0.1.55" });
  await service.install("game-studio");
  await mkdir(join(root, "packages", "game-studio", "1.0.0", "data", "projects"), { recursive: true });
  await writeFile(join(root, "packages", "game-studio", "1.0.0", "data", "projects", "demo.json"), "{\"saved\":true}\n", "utf8");
  await service.setEnabled("game-studio", false);

  value = await release("1.1.0");
  const upgraded = await service.install("game-studio", "1.1.0");
  assert.equal(upgraded.version, "1.1.0");
  assert.equal(upgraded.state, "disabled");
  assert.equal((await service.snapshot())["game-studio"].enabled, false);
  assert.match(await readFile(join(root, "packages", "game-studio", "1.1.0", "skills", "phaser", "SKILL.md"), "utf8"), /1\.1\.0/);
  assert.match(await readFile(join(root, "packages", "game-studio", "1.1.0", "data", "projects", "demo.json"), "utf8"), /saved/);
  assert.match(await readFile(join(root, "user", "game-studio", "data", "projects", "demo.json"), "utf8"), /saved/);
  await assert.rejects(() => access(join(root, "packages", "game-studio", "1.0.0")), /ENOENT/);
});
