import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";

const { readTextWithTransientRetry, writeTextAtomically } = await import(new URL("./atomic-file.ts", import.meta.url).href) as typeof import("./atomic-file.js");

test("readers never observe partial JSON during concurrent atomic writes", async () => {
  const directory = await fs.mkdtemp(join(os.tmpdir(), "codecn-atomic-"));
  const filePath = join(directory, "desktop-auth.json");
  try {
    await writeTextAtomically(filePath, JSON.stringify({ sequence: 0, value: "initial" }));
    const writes = Array.from({ length: 20 }, (_, sequence) =>
      writeTextAtomically(filePath, JSON.stringify({ sequence, value: "x".repeat(20_000 + sequence) }))
    );
    while (writes.some(() => true)) {
      const settled = await Promise.race([
        Promise.all(writes).then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 1))
      ]);
      const parsed = JSON.parse(await readTextWithTransientRetry(filePath));
      assert.equal(typeof parsed.sequence, "number");
      assert.equal(typeof parsed.value, "string");
      if (settled) break;
    }
    await Promise.all(writes);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
