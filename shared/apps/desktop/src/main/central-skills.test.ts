import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner loads this source file directly.
import {
  GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED,
  centralSkillDescriptors,
  getCentralSkillInstruction,
  isGovernmentResearchWritingProductEnabled,
  isGovernmentResearchWritingSkill
} from "./central-skills.ts";

test("government-research-writing product switch controls central catalog exposure", () => {
  assert.equal(isGovernmentResearchWritingProductEnabled(), GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED);
  assert.equal(isGovernmentResearchWritingSkill("government-research-writing"), true);
  if (GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED) {
    assert.ok(centralSkillDescriptors.some((skill) => skill.name === "government-research-writing"));
    assert.match(getCentralSkillInstruction(["government-research-writing"]), /native durable goal tools/);
  } else {
    assert.equal(centralSkillDescriptors.length, 0);
    assert.equal(getCentralSkillInstruction(["government-research-writing"]), "");
  }
});

test("government writing instruction payload stays recoverable when re-enabled", async () => {
  // Instruction text remains in source for product re-enable; offline returns empty.
  if (GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED) {
    const instruction = getCentralSkillInstruction(["government-research-writing"]);
    assert.match(instruction, /native durable goal tools as the only workflow state/);
    assert.match(instruction, /writing specification -> specification confirmation/);
  } else {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./central-skills.ts", import.meta.url), "utf8")
    );
    assert.match(source, /native durable goal tools as the only workflow state/);
    assert.match(source, /writing specification -> specification confirmation/);
    assert.match(source, /first visible deliverable is a writing specification analysis/);
    assert.match(source, /MANDATORY OFFICIAL-EVIDENCE RULE/);
    assert.match(source, /web\.search_official/);
    assert.match(source, /web\.read_official/);
  }
});
