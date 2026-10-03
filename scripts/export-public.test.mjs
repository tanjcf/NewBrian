import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { exportPublicTree, isDeniedPublicPath, scrubPublicText } from "./export-public.mjs";

test("public export drops Rust source and private addresses", () => {
  assert.equal(isDeniedPublicPath("rust/brain-core/src/main.rs"), true);
  assert.equal(isDeniedPublicPath("shared/apps/desktop/resources/experts/secret.md"), true);
  assert.equal(isDeniedPublicPath("shared/apps/desktop/src/main/index.ts"), false);
  assert.equal(scrubPublicText("http://203.0.113.10:8790/v1"), "http://203.0.113.10:8790/v1");
});

test("export writes a tree without brain-core source", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-public-"));
  const source = join(root, "private");
  const output = join(root, "public");
  await mkdir(join(source, "rust", "brain-core", "src"), { recursive: true });
  await writeFile(join(source, "rust", "brain-core", "src", "main.rs"), "fn main() {}");
  await mkdir(join(source, "shared"), { recursive: true });
  await writeFile(join(source, "shared", "note.md"), "gateway http://203.0.113.10:8790");
  await writeFile(join(source, "rust-core-release.json"), "{}\n");
  await writeFile(join(source, "README.md"), "private");
  await exportPublicTree(source, output);
  await assert.rejects(readFile(join(output, "rust", "brain-core", "src", "main.rs"), "utf8"));
  assert.equal(await readFile(join(output, "shared", "note.md"), "utf8"), "gateway http://203.0.113.10:8790");
  assert.match(await readFile(join(output, "README.md"), "utf8"), /免费使用/);
  assert.match(await readFile(join(output, "README.md"), "utf8"), /docs\/guide\/custom-model\.png/);
  assert.match(await readFile(join(output, "README.md"), "utf8"), /看广告可以获得赠送金额/);
  assert.match(await readFile(join(output, "README.md"), "utf8"), /Codex/);
  assert.match(await readFile(join(output, "README.md"), "utf8"), /Claude Code/);
  assert.match(await readFile(join(output, "README.md"), "utf8"), /Cursor/);
  assert.match(await readFile(join(output, "README.md"), "utf8"), /OpenClaw/);
  assert.match(await readFile(join(output, "README.md"), "utf8"), /量化交易/);
  assert.match(await readFile(join(output, "README.md"), "utf8"), /文档创作/);
  assert.match(await readFile(join(output, "README.en.md"), "utf8"), /Quant trading/);
  assert.match(await readFile(join(output, "README.en.md"), "utf8"), /Watching an advertisement grants account credit/);
  assert.match(await readFile(join(output, "README.en.md"), "utf8"), /pnpm package:ubuntu-arm64/);
  assert.match(await readFile(join(output, "README.zh-CN.md"), "utf8"), /pnpm package:windows:production/);
  await rm(root, { recursive: true, force: true });
});
