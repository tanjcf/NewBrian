import assert from "node:assert/strict";
import test from "node:test";

  const { buildComposerModeInstruction, buildSkillSelectionRequest, formatSkillDisclosure, normalizeComposerModes, parseSelectedSkillNames, selectAutomaticSkillNames, shouldRunAutomaticSkillSelection, validateComposerModes, validateExplicitSkillNames } = await import(
  new URL("./skill-selection.ts", import.meta.url).href
) as typeof import("./skill-selection.js");

test("builds a cross-language intent selection request with the complete catalog", () => {
  const request = buildSkillSelectionRequest("修复 Java 漏洞", [
    { name: "programming-skill", description: "Safe coding guardrails" }
  ]);
  assert.match(request, /Infer intent across languages/);
  assert.match(request, /at most 1 name/);
  assert.match(request, /direct one-step file edit/);
  assert.match(request, /programming-skill: Safe coding guardrails/);
  assert.match(request, /修复 Java 漏洞/);
});

test("normalizes supported composer modes and removes duplicates", () => {
  assert.deepEqual(normalizeComposerModes(["goal", "invalid", "plan", "goal"]), ["goal", "plan"]);
});

test("builds hidden instructions and rejects unsupported IPC composer modes", () => {
  assert.match(buildComposerModeInstruction(["plan"]), /本轮启用计划模式/);
  assert.throws(() => validateComposerModes(["goal", "admin"]), /unsupported mode/);
});

test("accepts only catalog skill names and caps model selections", () => {
  const selected = parseSelectedSkillNames(
    'selection: {"skills":["Review","unknown","test","docs","build","extra"]}',
    ["review", "test", "docs", "build", "extra"]
  );
  assert.deepEqual(selected, ["review", "test", "docs", "build"]);
});

test("automatic selection prefers one specialized match and otherwise keeps project context", () => {
  const project = { name: "demo-project-manager", description: "Project context" };
  const writing = { name: "government-writing", description: "Government writing" };
  assert.deepEqual(selectAutomaticSkillNames([project, writing]), ["government-writing"]);
  assert.deepEqual(selectAutomaticSkillNames([project]), ["demo-project-manager"]);
  assert.deepEqual(selectAutomaticSkillNames([]), []);
});

  test("formats a user-visible skill disclosure", () => {
  assert.equal(formatSkillDisclosure([
    { name: "review", description: "Review code" },
    { name: "test", description: "Test code" }
  ]), "专业技能（review）、专业技能（test）");
  });

  test("does not mix automatic project skills into an explicit central workflow", () => {
    assert.equal(shouldRunAutomaticSkillSelection(["government-research-writing"]), false);
    assert.equal(shouldRunAutomaticSkillSelection([]), true);
  });

test("validates explicit skills against the active runtime catalog", () => {
  assert.deepEqual(validateExplicitSkillNames(
    ["Review", "review", "test"],
    [{ name: "review", description: "Review code" }, { name: "test", description: "Test code" }]
  ), ["review", "test"]);
  assert.throws(
    () => validateExplicitSkillNames(["disabled-skill"], [{ name: "review", description: "Review code" }]),
    /所选技能不可用或已禁用/
  );
});
