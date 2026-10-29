import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { nextBrainToolsPlacement } from "./brain-tools-expand.ts";

export const CASE_ID = "PREVIEW-EXPAND-SMOKE-001";

const workspace = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test(`${CASE_ID} expand preview stays wide instead of flashing back to the side panel`, () => {
  assert.equal(nextBrainToolsPlacement("side"), "center");
  assert.equal(nextBrainToolsPlacement("hidden"), "center");
  assert.equal(nextBrainToolsPlacement("center"), "side");
  assert.equal(nextBrainToolsPlacement(nextBrainToolsPlacement("side")), "side");

  const toggle = workspace.slice(workspace.indexOf("const toggleBrainExpanded"), workspace.indexOf("const collapseBrainPanel"));
  assert.match(toggle, /nextBrainToolsPlacement\(isCenter \? "center" : "side"\)/);
  assert.match(toggle, /setBrainResourcePlacement\(next\)/);
  assert.doesNotMatch(toggle, /setBrainResourcePlacement\(\(current\)/);
  assert.match(workspace, /frame\.classList\.toggle\("brain-tools-expanded", brainResourcePlacement === "center"\)/);
  assert.doesNotMatch(workspace, /setBrainResourcePlacement\("side"\);\s*\}, \[previewPlacement, previewMode, brainResourcePlacement\]/);

  assert.match(styles, /\.workspace-frame\.brain-tools-expanded > \.codex-sidebar\s*\{[^}]*display:\s*none\s*!important/s);
  assert.match(styles, /\.workspace-frame\.preview-hidden\.brain-tools-expanded[\s\S]*grid-template-columns:\s*clamp\(340px,\s*31vw,\s*460px\)\s*minmax\(0,\s*1fr\)\s*!important/);
  assert.match(styles, /\.workspace-frame\.brain-tools-expanded > \.brain-resource-panel/);
  assert.match(styles, /\.workspace-frame\.preview-hidden:not\(\.brain-tools-expanded\)/);
});
