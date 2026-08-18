import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolveThinkingPanelOpen } from "./assistant-thinking-policy.ts";

const source = readFileSync(new URL("./AssistantThinkingPanel.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");

test("thinking panel forces open while live with no answer", () => {
  assert.equal(resolveThinkingPanelOpen({ live: true, hasAnswer: false, userOpen: null }), true);
  assert.equal(resolveThinkingPanelOpen({ live: true, hasAnswer: false, userOpen: false }), true);
});

test("thinking panel collapses by default once answer exists", () => {
  assert.equal(resolveThinkingPanelOpen({ live: true, hasAnswer: true, userOpen: null }), false);
  assert.equal(resolveThinkingPanelOpen({ live: false, hasAnswer: true, userOpen: null }), false);
  assert.equal(resolveThinkingPanelOpen({ live: true, hasAnswer: true, userOpen: true }), true);
});

test("thinking panel styles use muted smaller type", () => {
  assert.match(styles, /\.assistant-thinking-panel\s*\{[^}]*font-size:\s*12px/s);
  assert.match(styles, /\.assistant-live-thinking-text\s*\{[^}]*color:\s*#8a929e/s);
});

test("workspace wires AssistantThinkingPanel for live and historical reasoning", () => {
  assert.match(workspace, /AssistantThinkingPanel/);
  assert.match(source, /输出出现前会保持展开/);
});
