import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";

const { readTextWithTransientRetry, recoverDurableText, writeTextAtomically } = await import(new URL("./atomic-file.ts", import.meta.url).href) as typeof import("./atomic-file.js");

test("readers never observe partial JSON during concurrent atomic writes", async () => {
  const directory = await fs.mkdtemp(join(os.tmpdir(), "newbrain-atomic-"));
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
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await fs.rm(directory, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
      }
    }
  }
});

test("keeps a last-good backup and recovers when the primary file vanishes mid-write", async () => {
  const directory = await fs.mkdtemp(join(os.tmpdir(), "newbrain-atomic-recover-"));
  const filePath = join(directory, "newbrain.workspaces.json");
  try {
    await writeTextAtomically(filePath, JSON.stringify({ workspaces: [{ id: "keep-me" }] }));
    await writeTextAtomically(filePath, JSON.stringify({ workspaces: [{ id: "next" }] }));
    const backup = JSON.parse(await fs.readFile(`${filePath}.bak`, "utf8"));
    assert.equal(backup.workspaces[0].id, "keep-me");
    await fs.unlink(filePath);
    const recovered = JSON.parse(await recoverDurableText(filePath) ?? "null");
    assert.equal(recovered.workspaces[0].id, "keep-me");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("recovers leftover crash sidecar tmp when the primary catalog is gone", async () => {
  const directory = await fs.mkdtemp(join(os.tmpdir(), "newbrain-atomic-sidecar-"));
  const filePath = join(directory, "newbrain.workspaces.json");
  try {
    await fs.writeFile(
      `${filePath}.1234.deadbeef-crash.tmp`,
      JSON.stringify({ workspaces: [{ id: "from-tmp" }] }),
      "utf8"
    );
    const recovered = JSON.parse(await recoverDurableText(filePath) ?? "null");
    assert.equal(recovered.workspaces[0].id, "from-tmp");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
