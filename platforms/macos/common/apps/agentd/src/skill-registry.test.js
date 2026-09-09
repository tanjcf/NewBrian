import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SkillRegistry, parseSkillFrontmatter } from "./skill-registry.js";

test("parses quoted skill frontmatter", () => {
  assert.deepEqual(parseSkillFrontmatter('---\nname: "review"\ndescription: "Review source code safely"\n---\nBody', "fallback"), {
    name: "review",
    description: "Review source code safely",
    bodyOffset: 64
  });
});

test("discovers metadata first and loads instructions on demand", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-skills-"));
  try {
    const skillPath = join(root, "review");
    mkdirSync(join(skillPath, "references"), { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), "---\nname: review\ndescription: Review source code safely\n---\n\n# Workflow\nInspect before editing.\n");
    writeFileSync(join(skillPath, "references", "rules.md"), "rules");
    const registry = new SkillRegistry({ roots: [root] });
    const descriptors = await registry.discover();
    assert.equal(descriptors.length, 1);
    assert.equal("instructions" in descriptors[0], false);
    assert.equal(registry.match("Please use $review for this task")[0].name, "review");
    const loaded = await registry.load("review");
    assert.match(loaded.instructions, /Inspect before editing/);
    assert.deepEqual(loaded.resources.references, ["rules.md"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
