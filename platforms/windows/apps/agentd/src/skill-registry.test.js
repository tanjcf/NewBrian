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
    assert.deepEqual(loaded.referenceContents, [{ name: "rules.md", content: "rules" }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("disabled skills are not discovered or matched", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-skills-disabled-"));
  try {
    const skillPath = join(root, "review");
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), "---\nname: review\ndescription: Review source code safely\n---\n\n# Workflow\nInspect before editing.\n");
    const registry = new SkillRegistry({ roots: [root], disabledNames: ["review"] });
    assert.deepEqual(await registry.discover(), []);
    assert.deepEqual(registry.match("Please use $review for this task"), []);
    await assert.rejects(() => registry.load("review"), /Unknown skill/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loads only the most recent bounded session digest context", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-skills-digest-"));
  try {
    const skillPath = join(root, "review");
    mkdirSync(join(skillPath, "references"), { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), "---\nname: review\ndescription: Review source code safely\n---\nBody\n");
    const oldSection = `## old\n- ${"old ".repeat(6_000)}\n`;
    const newestSection = "## newest\n- LATEST_SESSION_FACT\n";
    writeFileSync(join(skillPath, "references", "session-digest.md"), `# Session Digest\n\n${oldSection}${newestSection}`);
    const registry = new SkillRegistry({ roots: [root] });
    await registry.discover();
    const loaded = await registry.load("review");
    const digest = loaded.referenceContents.find((item) => item.name === "session-digest.md").content;
    assert.match(digest, /LATEST_SESSION_FACT/);
    assert.ok(digest.length < 17 * 1024);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
