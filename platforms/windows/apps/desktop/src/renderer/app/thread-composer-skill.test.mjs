import assert from "node:assert/strict";
import test from "node:test";
import {
  readThreadComposerSkills,
  skillForThread,
  upsertThreadComposerSkill,
  writeThreadComposerSkills
} from "./thread-composer-skill.ts";

function memoryStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    store
  };
}

test("upsert binds a skill to one thread without touching others", () => {
  const first = upsertThreadComposerSkill({}, "thread-a", { name: "政务研究写作", id: "gov" });
  const second = upsertThreadComposerSkill(first, "thread-b", { name: "visualize", id: "viz" });
  assert.equal(skillForThread(second, "thread-a")?.name, "政务研究写作");
  assert.equal(skillForThread(second, "thread-b")?.name, "visualize");
  assert.equal(skillForThread(second, "thread-c"), null);

  const cleared = upsertThreadComposerSkill(second, "thread-a", null);
  assert.equal(skillForThread(cleared, "thread-a"), null);
  assert.equal(skillForThread(cleared, "thread-b")?.name, "visualize");
});

test("thread composer skills round-trip through storage", () => {
  const storage = memoryStorage();
  const skills = upsertThreadComposerSkill({}, "thread-a", { name: "政务研究写作" });
  writeThreadComposerSkills(skills, storage);
  assert.deepEqual(readThreadComposerSkills(storage), {
    "thread-a": { name: "政务研究写作" }
  });
});
