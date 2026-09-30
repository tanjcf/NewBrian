import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  buildSkillRoutingHints,
  inferSkillRoutingHint,
  mergeSkillRoutingHints,
  parseSkillRoutingJson,
  readSkillRoutingHintFromDir
} = await import(new URL("./skill-routing.ts", import.meta.url).href);

test("infers government skill routing constraints", () => {
  const hint = inferSkillRoutingHint("government-research-writing", "central");
  assert.equal(hint?.task_class, "gov_write");
  assert.equal(hint?.min_tier, 2);
  assert.ok(hint?.roles?.includes("gov"));
});

test("merge takes max min_tier and unions roles; project task_class wins", () => {
  const merged = mergeSkillRoutingHints([
    {
      skillName: "central-gov",
      scope: "central",
      min_tier: 2,
      roles: ["gov"],
      task_class: "gov_write"
    },
    {
      skillName: "project-code",
      scope: "project",
      min_tier: 3,
      roles: ["code"],
      capabilities: ["tools"],
      task_class: "code"
    }
  ]);
  assert.equal(merged.min_tier, 3);
  assert.ok(merged.roles.includes("gov"));
  assert.ok(merged.roles.includes("code"));
  assert.ok(merged.capabilities.includes("tools"));
  assert.equal(merged.task_class, "code");
  assert.deepEqual(merged.skill_scopes_applied, ["central", "project"]);
});

test("parseSkillRoutingJson accepts routing.json body", () => {
  const hint = parseSkillRoutingJson({
    schema_version: 1,
    roles: ["research"],
    min_tier: 2,
    capabilities: ["long_context"],
    task_class: "research"
  }, "demo", "user");
  assert.equal(hint?.min_tier, 2);
  assert.deepEqual(hint?.roles, ["research"]);
});

test("readSkillRoutingHintFromDir loads routing.json then falls back", async () => {
  const root = await mkdtemp(join(tmpdir(), "newbrain-skill-"));
  const skillDir = join(root, "demo-skill");
  await mkdir(skillDir);
  await writeFile(join(skillDir, "routing.json"), JSON.stringify({
    schema_version: 1,
    roles: ["code"],
    min_tier: 2,
    capabilities: ["tools"],
    task_class: "code"
  }), "utf8");
  const loaded = await readSkillRoutingHintFromDir({
    skillDir,
    skillName: "demo-skill",
    scope: "project"
  });
  assert.equal(loaded?.task_class, "code");
  assert.equal(loaded?.scope, "project");

  const inferred = await readSkillRoutingHintFromDir({
    skillDir: join(root, "missing"),
    skillName: "vision-helper",
    scope: "user"
  });
  assert.ok(inferred?.capabilities?.includes("vision"));
});

test("buildSkillRoutingHints merges explicit over inferred names", () => {
  const hints = buildSkillRoutingHints({
    selectedSkillNames: ["government-research-writing"],
    explicitHints: [{
      skillName: "government-research-writing",
      scope: "project",
      min_tier: 3,
      roles: ["gov"],
      task_class: "gov_write"
    }]
  });
  assert.equal(hints.length, 1);
  assert.equal(hints[0]?.min_tier, 3);
  assert.equal(hints[0]?.scope, "project");
});
