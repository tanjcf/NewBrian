import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const icon = readFileSync(new URL("./SidebarIcon.tsx", import.meta.url), "utf8");
const unlock = icon.slice(icon.indexOf('name === "shield-unlock"'), icon.indexOf('name === "skill-grid"'));
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const optionIcon = styles.slice(
  styles.indexOf(".composer-modern-controls .composer-permission-menu .permission-option-icon svg {"),
  styles.indexOf(".composer-modern-controls .composer-permission-menu [data-permission-option=\"approval\"]")
);

test("full-access permission icon is an outline open lock", () => {
  assert.match(unlock, /<svg \{\.\.\.common\}>/);
  assert.match(unlock, /M13\.5 10\.5V6\.75/);
  assert.doesNotMatch(unlock, /fill="currentColor"/);
});

test("permission menu icons are stroked, not filled solid", () => {
  assert.match(optionIcon, /fill:\s*none/);
  assert.match(optionIcon, /stroke:\s*currentColor/);
  assert.doesNotMatch(optionIcon, /stroke:\s*none/);
});
