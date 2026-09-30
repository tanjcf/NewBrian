import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

for (const platform of ["macos", "ubuntu"] as const) {
  test(`${platform} wires Rust Core tools and shutdown behind a disabled-by-default feature`, async () => {
    const source = await readFile(resolve(
      `platforms/${platform}/common/apps/desktop/src/main/index.ts`
    ), "utf8");
    assert.match(source, /new RustCoreService\(/u);
    assert.match(source, /new RustCoreToolRouter\(/u);
    assert.match(source, /runtime:\s*\{\s*rustCoreTools:\s*"disabled"\s*\}/u);
    assert.match(source, /agentHostClient\.shutdown\(\)[\s\S]{0,120}rustCoreService\?\.shutdown\(\)/u);
  });
}

