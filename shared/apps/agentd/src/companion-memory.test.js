import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyCompanionMemoryUpdate,
  ensureCompanionMemorySkill,
  extractCompanionMemoryUpdate,
  parseCompanionMemory,
  updateCompanionMemoryFromExchange
} from "./companion-memory.js";

test("a greeting does not fill the long-term archive", () => {
  const update = extractCompanionMemoryUpdate("你好", "先把长期设定定下来。我偏向「小满」。你在哪个城市？");
  assert.deepEqual(update.explicit, {});
  assert.deepEqual(update.inferred, {});
});

test("one reply can fill the address, city, and current work", () => {
  const update = extractCompanionMemoryUpdate(
    "叫我老周，我在杭州，最近在做 BRAIN。记住：不要半夜打扰。你就叫小满。",
    "好，我记下了。"
  );
  assert.equal(update.explicit["用户称呼"], "老周");
  assert.equal(update.explicit["城市"], "杭州");
  assert.equal(update.explicit["近期在忙"], "BRAIN");
  assert.equal(update.explicit["要记住的事"], "不要半夜打扰");
  assert.equal(update.explicit["助手名字"], "小满");
});

test("an existing archive is updated in place and is not recreated over user text", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "companion-memory-"));
  const dir = await ensureCompanionMemorySkill(root);
  const memoryPath = path.join(dir, "references", "memory.md");
  const original = await readFile(memoryPath, "utf8");
  assert.match(original, /助手名字:/);
  assert.match(await readFile(path.join(dir, "SKILL.md"), "utf8"), /小满/);

  await updateCompanionMemoryFromExchange([root], {
    user: "叫我老周，我在杭州",
    assistant: "好。"
  });
  const filled = parseCompanionMemory(await readFile(memoryPath, "utf8"));
  assert.equal(filled["用户称呼"], "老周");
  assert.equal(filled["城市"], "杭州");

  await ensureCompanionMemorySkill(root);
  const kept = parseCompanionMemory(await readFile(memoryPath, "utf8"));
  assert.equal(kept["用户称呼"], "老周");
});

test("a later explicit rename replaces the assistant name without dropping other fields", () => {
  const applied = applyCompanionMemoryUpdate(
    { "助手名字": "小满", "用户称呼": "老周", "城市": "杭州", "近期在忙": "", "要记住的事": "不要半夜打扰" },
    extractCompanionMemoryUpdate("你就叫阿满", "好。")
  );
  assert.equal(applied.changed, true);
  assert.equal(applied.values["助手名字"], "阿满");
  assert.equal(applied.values["用户称呼"], "老周");
  assert.equal(applied.values["要记住的事"], "不要半夜打扰");
});
