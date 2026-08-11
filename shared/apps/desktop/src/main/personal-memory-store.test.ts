import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersonalMemoryStore } from "./personal-memory-store.ts";

test("PersonalMemoryStore upserts and syncs to hub callback", async () => {
  const dir = await mkdtemp(join(tmpdir(), "growth-mem-"));
  const store = new PersonalMemoryStore({ filePath: join(dir, "personal_memory.json") });
  await store.upsert("tone", { voice: "concise" });
  const items = await store.readAll();
  assert.equal(items.length, 1);
  assert.equal(items[0]?.kind, "tone");
  const raw = await readFile(join(dir, "personal_memory.json"), "utf8");
  assert.ok(raw.includes("concise"));

  const payloads: Array<Record<string, unknown>> = [];
  const synced = await store.syncToHub(async (payload) => {
    payloads.push(payload);
    return { ok: true };
  });
  assert.equal(synced, 1);
  assert.equal(payloads[0]?.scope, "user");
  assert.equal(payloads[0]?.kind, "tone");
});
