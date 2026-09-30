import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { applyApplicationSkillPolicy } = await import(
  new URL("./application-skill-policy.ts", import.meta.url).href
) as typeof import("./application-skill-policy.js");

test("each task runtime receives the global skill root and disabled skills", async () => {
  const calls: Array<[string, string[]]> = [];
  const runtime = {
    async addSkillRoots(roots: string[]) { calls.push(["roots", roots]); },
    async setDisabledSkills(names: string[]) { calls.push(["disabled", names]); }
  };

  const userSkillRoot = await mkdtemp(path.join(os.tmpdir(), "newbrain-user-skills-"));
  await applyApplicationSkillPolicy(runtime, userSkillRoot, async () => [
    { name: "enabled-skill", status: "enabled" },
    { name: "disabled-skill", status: "disabled" }
  ], ["C:/project/.newbrain/skills"]);

  assert.deepEqual(calls, [
    ["roots", [userSkillRoot, "C:/project/.newbrain/skills"]],
    ["disabled", ["disabled-skill"]]
  ]);
  const skill = await readFile(path.join(userSkillRoot, "companion-memory", "SKILL.md"), "utf8");
  const memory = await readFile(path.join(userSkillRoot, "companion-memory", "references", "memory.md"), "utf8");
  assert.match(skill, /小满/);
  assert.match(memory, /用户称呼:/);
});
