import assert from "node:assert/strict";
import test from "node:test";

const {
  DEFAULT_AUTO_PARENT_DISPLAY_NAME,
  readAutoParentDisplayNameFromRecord,
  resolveAutoParentDisplayName
} = await import(new URL("./auto-parent-display-policy.ts", import.meta.url).href);

test("resolveAutoParentDisplayName defaults to brain", () => {
  assert.equal(resolveAutoParentDisplayName(), DEFAULT_AUTO_PARENT_DISPLAY_NAME);
  assert.equal(resolveAutoParentDisplayName("  "), DEFAULT_AUTO_PARENT_DISPLAY_NAME);
  assert.equal(resolveAutoParentDisplayName("  Cortex  "), "Cortex");
});

test("readAutoParentDisplayNameFromRecord accepts snake_case and camelCase", () => {
  assert.equal(readAutoParentDisplayNameFromRecord({ auto_parent_display_name: "brain" }), "brain");
  assert.equal(readAutoParentDisplayNameFromRecord({ autoParentDisplayName: "neo" }), "neo");
  assert.equal(readAutoParentDisplayNameFromRecord({}), undefined);
});
