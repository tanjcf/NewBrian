import assert from "node:assert/strict";
import test from "node:test";

const { composerSkillContextAfterReset } = await import(
  new URL("./composer-skill-context-reset.ts", import.meta.url).href
) as typeof import("./composer-skill-context-reset.js");

test("keeps a same-turn Automation Creator write across the new-chat reset", () => {
  assert.equal(composerSkillContextAfterReset("Automation Creator"), "Automation Creator");
});

test("keeps an explicit empty write from a plain new chat", () => {
  assert.equal(composerSkillContextAfterReset(""), "");
});

test("blanks leftover creator context when the switch did not write one", () => {
  assert.equal(composerSkillContextAfterReset(null), "");
});
