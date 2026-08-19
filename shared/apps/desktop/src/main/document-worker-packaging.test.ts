import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("packages the isolated document worker and parser dependencies on every desktop platform", () => {
  const root = process.cwd();
  const manifests = [
    "platforms/windows/apps/desktop/package.json",
    "platforms/macos/common/apps/desktop/package.json",
    "platforms/ubuntu/common/apps/desktop/package.json"
  ];
  assert.equal(existsSync(join(root, "shared/apps/desktop/scripts/sync-document-worker.mjs")), true);
  for (const relativePath of manifests) {
    const manifest = JSON.parse(readFileSync(join(root, relativePath), "utf8"));
    assert.match(manifest.scripts.prebuild, /sync-document-worker\.mjs/);
    const resources = manifest.build.extraResources as Array<{ from?: string; to?: string }>;
    assert.ok(resources.some((resource) => resource.from === "document-worker.js" && resource.to === "document-worker.js"), relativePath);
    for (const dependency of ["jszip", "exceljs", "pdf-parse", "pdfjs-dist"]) {
      assert.ok(manifest.build.files.includes(`node_modules/${dependency}/**`), `${relativePath} must package ${dependency}`);
    }
  }
});

test("emits the dynamic document anchor dependency beside the desktop main bundle", () => {
  const config = readFileSync(join(process.cwd(), "shared/apps/desktop/electron.vite.config.ts"), "utf8");
  assert.match(config, /["']document-anchor["']\s*:\s*resolve\([^\n]+document-anchor\.ts/);
});
