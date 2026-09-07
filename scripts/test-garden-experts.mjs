import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { listExpertCatalog, emptyExpertRegistry, installExpertFromBuiltin, readExpertRegistry, summonExpertToThread, resolveSummonedExpert } from "../shared/apps/desktop/src/main/expert-marketplace.ts";
import { isExpertAvailableInWorkspace } from "../shared/apps/desktop/src/shared/expert-workspace-policy.ts";

const root = await mkdtemp(join(tmpdir(), "garden-expert-test-"));
try {
  const builtinRoot = resolve("shared/apps/desktop/resources/experts");
  const installedRoot = join(root, "installed");
  const registryPath = join(root, "registry.json");
  const catalog = await listExpertCatalog({ builtinRoot, installedRoot, registry: emptyExpertRegistry() });
  const imported = catalog.filter(item => /^(nuwa-|agency-|game-studios-)/.test(item.id));
  assert.equal(imported.length, 21);
  for (const expert of imported) {
    const provenance = JSON.parse(await readFile(join(expert.rootPath, "provenance.json"), "utf8"));
    for (const [path, hash] of Object.entries(provenance.files)) {
      assert.equal(createHash("sha256").update(await readFile(join(expert.rootPath, path))).digest("hex"), hash, `${expert.id}/${path}`);
    }
    await installExpertFromBuiltin({ expertId: expert.id, builtinRoot, installedRoot, registryPath });
    await summonExpertToThread({ expertId: expert.id, threadId: "explore", workspaceKey: "explore", builtinRoot, installedRoot, registryPath });
    assert.equal((await resolveSummonedExpert({ threadId: "explore", workspaceKey: "explore", builtinRoot, installedRoot, registryPath })).expertId, expert.id);
  }
  await assert.rejects(summonExpertToThread({ expertId: "nuwa-mrbeast-perspective", threadId: "software", workspaceKey: "software", builtinRoot, installedRoot, registryPath }), /当前工作台/);
  const state = await readExpertRegistry(registryPath);
  assert.equal(state.installed.length, 21);
  assert.ok((await readdir(join(installedRoot, "nuwa-feynman-perspective/skills/nuwa-feynman-perspective/references"))).length > 0);
  const counts = Object.fromEntries(["quant", "game", "video", "music", "data", "software", "document", "explore"].map(key => [key, catalog.filter(item => isExpertAvailableInWorkspace(item, key)).length]));
  assert.equal(counts.explore, catalog.length);
  console.log(JSON.stringify({ passed: true, imported: imported.length, sceneCounts: counts }));
} finally { await rm(root, { recursive: true, force: true }); }
