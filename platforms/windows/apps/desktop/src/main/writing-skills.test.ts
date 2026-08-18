import assert from "node:assert/strict";
import test from "node:test";

const {
  isWritingSkillIdentity,
  normalizeSkillIdentity,
  selectInstalledWritingSkills,
  WRITING_SKILL_NAMES
} = await import(new URL("./writing-skills.ts", import.meta.url).href);

test("recognizes known writing skill identities", () => {
  assert.ok(WRITING_SKILL_NAMES.includes("government-research-writing"));
  assert.equal(normalizeSkillIdentity("skill-prd-writer"), "prd-writer");
  assert.equal(isWritingSkillIdentity("government-research-writing"), true);
  assert.equal(isWritingSkillIdentity("skill-prd-writer"), true);
  assert.equal(isWritingSkillIdentity("browser"), false);
});

test("selects only installed writing skills from a catalog", () => {
  const selected = selectInstalledWritingSkills([
    { id: "skill-browser", name: "browser" },
    { id: "skill-prd-writer", name: "prd-writer" },
    { id: "central", name: "government-research-writing" }
  ]);
  assert.deepEqual(
    selected.map((item) => item.name),
    ["prd-writer", "government-research-writing"]
  );
});
