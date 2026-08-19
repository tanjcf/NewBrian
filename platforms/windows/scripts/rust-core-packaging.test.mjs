import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Windows package stages and verifies the Rust Core sidecar", async () => {
  const desktopPackage = JSON.parse(await readFile(new URL("../apps/desktop/package.json", import.meta.url), "utf8"));
  const resources = desktopPackage.build.extraResources;
  assert.ok(resources.some((item) =>
    item.from === "build/rust-core/brain-core.exe" && item.to === "brain-core/brain-core.exe"
  ));

  const packaging = await readFile(new URL("./package-win-msi.ps1", import.meta.url), "utf8");
  assert.match(packaging, /build-rust-core\.ps1/u);
  assert.match(packaging, /resources\\\\brain-core\\\\brain-core\.exe/u);
  assert.match(packaging, /rustCoreTools\s*=\s*"disabled"/u);
});
