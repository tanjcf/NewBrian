import assert from "node:assert/strict";
import test from "node:test";

const { buildSkillLoadedPayload } = await import(
  new URL("./skill-event-policy.ts", import.meta.url).href
) as typeof import("./skill-event-policy.js");

test("persists an automatically routed central skill without inventing a local path", () => {
  assert.deepEqual(buildSkillLoadedPayload({
    name: "government-research-writing",
    description: "Government writing"
  }), {
    name: "government-research-writing",
    description: "Government writing"
  });
});

test("preserves the verified instruction path for a loaded local skill", () => {
  assert.deepEqual(buildSkillLoadedPayload({
    name: "local-writing",
    description: "Local writing",
    instructions: "instructions",
    instructionPath: "C:/skills/local-writing/SKILL.md"
  }), {
    name: "local-writing",
    description: "Local writing",
    instructionPath: "C:/skills/local-writing/SKILL.md"
  });
});
