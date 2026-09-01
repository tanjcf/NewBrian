import assert from "node:assert/strict";
import test from "node:test";

const { buildUserSkillPlatformInheritanceInstruction } = await import(
  new URL("./user-skill-platform-policy.ts", import.meta.url).href
);

test("platform inheritance instruction covers documents, media, and user skill additive rules", () => {
  const instruction = buildUserSkillPlatformInheritanceInstruction();
  assert.ok(instruction.length > 0);
  assert.match(instruction, /music_generate/);
  assert.match(instruction, /music\.song\.generate/);
  assert.match(instruction, /scene-knowledge/);
  assert.match(instruction, /image_generate/);
  assert.match(instruction, /video_generate/);
  assert.match(instruction, /document\.create_pdf/);
  assert.match(instruction, /用户 Skill 平台传承/);
  assert.match(instruction, /must not silently overwrite user skill packages/i);
});
