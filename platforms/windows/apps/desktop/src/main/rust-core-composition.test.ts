import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("wires Rust Core through the managed desktop lifecycle and quit barrier", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(source, /new RustCoreService\(/u);
  assert.match(source, /resolveWindowsRustCoreBinary\(/u);
  assert.match(source, /rustCoreProcessManager/u);
  assert.match(source, /agentHostClient\.shutdown\(\)[\s\S]{0,200}rustCoreService\?\.shutdown\(\)/u);
});
