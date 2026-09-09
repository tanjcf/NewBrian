import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import JSZip from "jszip";

const { PluginRepositoryClient } = await import(
  new URL("./plugin-repository-client.ts", import.meta.url).href
) as typeof import("./plugin-repository-client.js");
const { PluginInstallationService } = await import(
  new URL("./plugin-installation-service.ts", import.meta.url).href
) as typeof import("./plugin-installation-service.js");
const { sha256Hex } = await import(
  new URL("./plugin-package-verifier.ts", import.meta.url).href
) as typeof import("./plugin-package-verifier.js");

test("integrates catalog, signed download, atomic install and Spring state report", async (context) => {
  const keys = generateKeyPairSync("ed25519");
  const zip = new JSZip();
  zip.file(".codex-plugin/plugin.json", JSON.stringify({ name: "game-studio", version: "1.0.0", skills: "./skills/" }));
  zip.file("skills/phaser/SKILL.md", "---\nname: phaser\n---\nBuild a browser game.");
  const archive = new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
  const hash = sha256Hex(archive);
  const signature = sign(null, Buffer.from(hash), keys.privateKey).toString("base64");
  const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const reports: Array<Record<string, unknown>> = [];

  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, "Bearer contract-token");
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/api/desktop/v1/plugins") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ items: [{
        plugin_key: "game-studio", display_name: "Game Studio", description: "Build games",
        category: "Developer Tools", publisher: "openai-api-curated", scope: "public",
        icon_url: "", status: "published", latest_version: "1.0.0",
        install_state: "not_installed", installed_version: "", skills: ["phaser"], actions: ["install"]
      }], page: 1, size: 20, total: 1 }));
      return;
    }
    if (request.method === "GET" && url.pathname.endsWith("/manifest")) {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({
        manifest_version: "1", plugin_key: "game-studio", version: "1.0.0",
        content_hash: "sha256:" + hash, signature: "ed25519:" + signature,
        signing_public_key: publicKey, archive_size: archive.byteLength,
        minimum_client_version: "0.1.0", maximum_client_version: "", skills: ["phaser"]
      }));
      return;
    }
    if (request.method === "GET" && url.pathname.endsWith("/download")) {
      response.setHeader("Content-Type", "application/zip");
      response.setHeader("X-Content-SHA256", hash);
      response.setHeader("X-Content-Signature", "ed25519:" + signature);
      response.end(archive);
      return;
    }
    if (request.method === "PUT" && url.pathname.endsWith("/game-studio")) {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      reports.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ accepted: true, status: "installed" }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ code: "NOT_FOUND", message: "missing" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const client = new PluginRepositoryClient({
    gatewayOrigin: "http://127.0.0.1:" + address.port,
    headers: { Authorization: "Bearer contract-token", "X-Device-ID": "device-001" }
  });
  const catalog = await client.list({ scope: "public" }, "device-001");
  assert.equal(catalog.items[0].publisher, "openai-api-curated");

  const root = await mkdtemp(join(tmpdir(), "newbrain-contract-"));
  const installer = new PluginInstallationService({ root, client, deviceId: "device-001", clientVersion: "0.1.55" });
  const installed = await installer.install("game-studio");
  assert.equal(installed.state, "installed");
  assert.equal(reports.length, 1);
  assert.equal(reports[0].content_hash, hash);
  assert.match(await readFile(join(root, "packages", "game-studio", "1.0.0", "skills", "phaser", "SKILL.md"), "utf8"), /browser game/);
});
