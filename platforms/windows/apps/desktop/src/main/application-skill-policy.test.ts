import assert from "node:assert/strict";
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

  await applyApplicationSkillPolicy(runtime, "C:/newbrain/user-skills", async () => [
    { name: "enabled-skill", status: "enabled" },
    { name: "disabled-skill", status: "disabled" }
  ], ["C:/project/.newbrain/skills"]);

  assert.deepEqual(calls, [
    ["roots", ["C:/newbrain/user-skills", "C:/project/.newbrain/skills"]],
    ["disabled", ["disabled-skill"]]
  ]);
});
