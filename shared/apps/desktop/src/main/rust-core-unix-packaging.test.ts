import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

for (const platform of ["macos", "ubuntu"] as const) {
  test(`${platform} package builds and bundles the native Rust Core binary`, async () => {
    const root = resolve(`platforms/${platform}/common/apps/desktop`);
    const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
    assert.equal(manifest.scripts["build:rust-core"], "node ../../scripts/build-rust-core.mjs");
    assert.ok(manifest.build.extraResources.some((item: { from?: string; to?: string }) =>
      item.from === "build/rust-core/brain-core" && item.to === "brain-core/brain-core"
    ));
    const resources = await readFile(resolve(root, "build/prepare-package-resources.cjs"), "utf8");
    assert.match(resources, /runtime:\s*\{\s*rustCoreTools:\s*"disabled"\s*\}/u);
  });
}

