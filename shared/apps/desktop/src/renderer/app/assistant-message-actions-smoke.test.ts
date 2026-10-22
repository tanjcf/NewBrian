/**
 * ASSISTANT-MESSAGE-ACTIONS-SMOKE-001
 * During live generation the like/dislike/branch/copy/TTS row must not mount;
 * after the turn settles it must be gated back on via shouldShowAssistantMessageActions.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { shouldShowAssistantMessageActions } from "./thread-activity-policy.ts";

const CASE_ID = "ASSISTANT-MESSAGE-ACTIONS-SMOKE-001";
const workspaceModulesSource = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test(`${CASE_ID} hides actions while generating and shows them when settled`, () => {
  assert.equal(shouldShowAssistantMessageActions({ isLiveTurn: true }), false);
  assert.equal(shouldShowAssistantMessageActions({ isLiveTurn: false }), true);
});

test(`${CASE_ID} mounts the action row only through shouldShowAssistantMessageActions`, () => {
  assert.match(workspaceModulesSource, /shouldShowAssistantMessageActions\(\{\s*isLiveTurn\s*\}\)/);
  assert.match(workspaceModulesSource, /data-testid="assistant-message-actions"/);
  assert.doesNotMatch(workspaceModulesSource, /className="message-actions"\s*\n\s*hidden=\{isLiveTurn\}/);
});

test(`${CASE_ID} keeps CSS from revealing actions during streaming`, () => {
  assert.match(stylesSource, /\.answer-group\.streaming\s+\.message-actions\s*\{[^}]*display:\s*none\s*!important/s);
  assert.match(stylesSource, /\.message-actions\[hidden\]/);
});
