import assert from "node:assert/strict";
import test from "node:test";

const policy = await import(new URL("./skill-scaffold-policy.ts", import.meta.url).href);

test("normalizes skill names and capability lists", () => {
  assert.equal(policy.normalizeSkillName("  NewBrain 架构---Guard  "), "newbrain-guard");
  assert.equal(policy.titleCaseSkillName("newbrain-guard"), "Newbrain Guard");
  assert.deepEqual(policy.normalizeCapabilityList(" read, write\nreview "), ["read", "write", "review"]);
});

test("generates a valid skill scaffold and escaped OpenAI metadata", () => {
  const description = policy.makeSkillDescription({ name: "guard", summary: "  Architecture guard  " }, "guard");
  const markdown = policy.makeSkillMarkdown("guard", "Guard", description);

  assert.doesNotThrow(() => policy.validateSkillMarkdown("guard", markdown));
  assert.deepEqual(policy.parseSkillFrontmatter(markdown, "fallback"), {
    name: "guard",
    description: "Architecture guard"
  });
  assert.match(markdown, /## Core Rules/);
  assert.match(markdown, /## Encoding Rules/);
  assert.match(markdown, /## Patch Strategy/);
  assert.match(markdown, /## Scene Tools \(BRAIN\)/);
  assert.match(markdown, /right-side Tools sub-architecture/);
  assert.match(markdown, /## Post-Change Evaluation/);
  assert.match(markdown, /metadata:\s*\n\s*short-description:/);
  assert.match(markdown, /references\/java-javadoc-rules\.md/);
  assert.match(policy.makeOpenAiYaml("guard", 'Guard "Core"', "line one\nline two"), /display_name: "Guard \\"Core\\""/);
});

test("default skill description emphasizes coding reliability triggers", () => {
  const description = policy.makeSkillDescription({ name: "java-helper" }, "java-helper");
  assert.match(description, /Java\/Spring|encoding-safe|post-change evaluation/i);
});

test("rejects mismatched or malformed skill frontmatter", () => {
  assert.throws(() => policy.validateSkillMarkdown("expected", "# Missing frontmatter"), /frontmatter/);
  assert.throws(
    () => policy.validateSkillMarkdown("expected", "---\nname: different\ndescription: valid\n---\n"),
    /expected name/
  );
});
