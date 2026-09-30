import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const {
  buildExpertSkillIndex,
  buildSkillExpertSummonInstruction,
  parseExpertIdFromSkillMarkdown,
  resolveExpertIdForSkill,
  resolveExpertIdFromSelectedSkills
} = await import(new URL("./skill-expert-binding.ts", import.meta.url).href) as typeof import("./skill-expert-binding.js");

test("parses expert frontmatter aliases", () => {
  assert.equal(parseExpertIdFromSkillMarkdown("---\nname: x\nexpert: senior-developer\n---\n# hi"), "senior-developer");
  assert.equal(parseExpertIdFromSkillMarkdown("---\nsummon_expert: \"frontend-developer\"\n---\n"), "frontend-developer");
  assert.equal(parseExpertIdFromSkillMarkdown("---\nname: x\n---\n"), null);
});

test("matches expert via skill name index", () => {
  const index = buildExpertSkillIndex([
    { id: "equity-research", skillNames: ["equity-research-workflow"] }
  ]);
  assert.equal(
    resolveExpertIdForSkill({ skillName: "equity-research-workflow", expertSkillIndex: index }),
    "equity-research"
  );
});

test("resolves expert from skill roots on disk", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-expert-"));
  try {
    const skillRoot = join(root, "skills");
    await mkdir(join(skillRoot, "my-delivery"), { recursive: true });
    await writeFile(
      join(skillRoot, "my-delivery", "SKILL.md"),
      "---\nname: my-delivery\nexpert: software-delivery-team\n---\n\n# Delivery\n",
      "utf8"
    );
    const hit = await resolveExpertIdFromSelectedSkills({
      skillNames: ["my-delivery"],
      skillRoots: [skillRoot]
    });
    assert.deepEqual(hit, { expertId: "software-delivery-team", skillName: "my-delivery" });
    assert.match(buildSkillExpertSummonInstruction({
      experts: [{ id: "software-delivery-team", profession: "交付团", expertType: "team" }],
      selectedSkillNames: ["my-delivery"],
      suggestedExpertIds: ["software-delivery-team"]
    }), /expert.propose/i);
    assert.match(buildSkillExpertSummonInstruction({
      experts: [{ id: "software-delivery-team", profession: "交付团" }],
      selectedSkillNames: []
    }), /First-time users/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
