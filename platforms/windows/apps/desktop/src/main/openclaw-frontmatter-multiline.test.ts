import assert from "node:assert/strict";
import test from "node:test";
import { parseOpenClawSkillFrontmatter } from "./openclaw-skill-package.ts";

test("Nuwa literal and folded descriptions retain their actual YAML content", () => {
  assert.equal(parseOpenClawSkillFrontmatter("---\nname: nuwa\ndescription: |\n  first\n  second\n---\nbody", "fallback").description, "first\nsecond");
  assert.equal(parseOpenClawSkillFrontmatter("---\nname: nuwa\ndescription: >\n  first\n  second\n---\nbody", "fallback").description, "first second");
  assert.equal(parseOpenClawSkillFrontmatter("---\nname: nuwa\ndescription: null\n---\n", "fallback").description, "");
});
