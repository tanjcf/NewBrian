import assert from "node:assert/strict";
import test from "node:test";

const {
  assertUserSkillWriteAllowed,
  NEWBRAIN_QUANT_MANAGED_BY,
  isGlobalSkillRootChild,
  isUserSkillPackagePath
} = await import(new URL("./user-skill-write-guard.ts", import.meta.url).href);

test("isUserSkillPackagePath recognizes project and global skill packages", () => {
  assert.equal(isUserSkillPackagePath(".newbrain/skills/market-brief/SKILL.md"), true);
  assert.equal(isUserSkillPackagePath("C:/proj/.newbrain/skills/writing-style/skill/SKILL.md"), true);
  assert.equal(isUserSkillPackagePath("outputs/report.pdf"), false);
});

test("isGlobalSkillRootChild detects direct children of the managed skills root", () => {
  assert.equal(
    isGlobalSkillRootChild("C:/Users/me/.newbrain/skills/my-skill", "C:/Users/me/.newbrain/skills"),
    true
  );
  assert.equal(
    isGlobalSkillRootChild("C:/Users/me/.newbrain/skills/my-skill/refs/a.md", "C:/Users/me/.newbrain/skills"),
    false
  );
});

test("assertUserSkillWriteAllowed blocks install overwrite unless force=true", () => {
  assert.throws(
    () => assertUserSkillWriteAllowed({ targetPath: "/skills/foo", exists: true, policy: "install" }),
    /already installed/i
  );
  assert.doesNotThrow(() => assertUserSkillWriteAllowed({
    targetPath: "/skills/foo",
    exists: true,
    force: true,
    policy: "install"
  }));
});

test("assertUserSkillWriteAllowed allows idempotent quant-managed packages only", () => {
  assert.doesNotThrow(() => assertUserSkillWriteAllowed({
    targetPath: "sany-trend",
    exists: true,
    managedBy: NEWBRAIN_QUANT_MANAGED_BY,
    policy: "quant"
  }));
  assert.throws(
    () => assertUserSkillWriteAllowed({
      targetPath: "user-writing",
      exists: true,
      managedBy: "user",
      policy: "quant"
    }),
    /Refusing to overwrite unmanaged Skill/
  );
});
