import assert from "node:assert/strict";
import test from "node:test";

const policy = await import(new URL("./skill-scaffold-policy.ts", import.meta.url).href);

test("normalizes skill names and capability lists", () => {
  assert.equal(policy.normalizeSkillName("  CodeCN 架构---Guard  "), "codecn-guard");
  assert.equal(policy.titleCaseSkillName("codecn-guard"), "Codecn Guard");
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
  assert.match(policy.makeOpenAiYaml("guard", 'Guard "Core"', "line one\nline two"), /display_name: "Guard \\"Core\\""/);
});

test("rejects mismatched or malformed skill frontmatter", () => {
  assert.throws(() => policy.validateSkillMarkdown("expected", "# Missing frontmatter"), /frontmatter/);
  assert.throws(
    () => policy.validateSkillMarkdown("expected", "---\nname: different\ndescription: valid\n---\n"),
    /expected name/
  );
});
