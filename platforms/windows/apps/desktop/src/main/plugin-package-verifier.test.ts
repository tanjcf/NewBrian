import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import JSZip from "jszip";

const verifier = await import(
  new URL("./plugin-package-verifier.ts", import.meta.url).href
) as typeof import("./plugin-package-verifier.js");

async function fixture(extra?: (zip: JSZip) => void) {
  const keys = generateKeyPairSync("ed25519");
  const zip = new JSZip();
  zip.file(".codex-plugin/plugin.json", JSON.stringify({ name: "game-studio", version: "1.0.0", skills: "./skills/" }));
  zip.file("skills/phaser/SKILL.md", "---\nname: phaser\n---\nBuild games.");
  extra?.(zip);
  const bytes = new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
  const hash = verifier.sha256Hex(bytes);
  return {
    bytes, hash,
    signature: sign(null, Buffer.from(hash, "utf8"), keys.privateKey).toString("base64"),
    publicKey: keys.publicKey.export({ type: "spki", format: "der" }).toString("base64")
  };
}

test("verifies a signed Codex plugin package", async () => {
  const value = await fixture();
  const result = await verifier.verifyPluginPackage({ ...value, pluginKey: "game-studio", version: "1.0.0" });
  assert.equal(result.manifest.name, "game-studio");
  assert.deepEqual(result.skillNames, ["phaser"]);
});

test("rejects hash and signature mismatches", async () => {
  const value = await fixture();
  await assert.rejects(() => verifier.verifyPluginPackage({ ...value, hash: "0".repeat(64), pluginKey: "game-studio", version: "1.0.0" }), /HASH_MISMATCH/);
  await assert.rejects(() => verifier.verifyPluginPackage({ ...value, signature: Buffer.alloc(64).toString("base64"), pluginKey: "game-studio", version: "1.0.0" }), /SIGNATURE_INVALID/);
});

test("rejects archives without the plugin manifest or skills", async () => {
  const keys = generateKeyPairSync("ed25519");
  const zip = new JSZip();
  zip.file("readme.txt", "missing");
  const bytes = new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
  const hash = verifier.sha256Hex(bytes);
  const signature = sign(null, Buffer.from(hash), keys.privateKey).toString("base64");
  const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  await assert.rejects(() => verifier.verifyPluginPackage({ bytes, hash, signature, publicKey, pluginKey: "game-studio", version: "1.0.0" }), /MANIFEST_INVALID/);
});

test("rejects unsafe absolute archive entries", async () => {
  const value = await fixture((zip) => zip.file("/escape.txt", "bad"));
  await assert.rejects(() => verifier.verifyPluginPackage({ ...value, pluginKey: "game-studio", version: "1.0.0" }), /ARCHIVE_UNSAFE/);
});
