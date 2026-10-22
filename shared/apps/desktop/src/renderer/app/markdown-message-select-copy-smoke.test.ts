/**
 * MARKDOWN-MESSAGE-SELECT-COPY-SMOKE-001
 * Packaging must run this case and stop when it fails.
 * Generated answer text must stay drag-selectable / copyable: flat markdown
 * (no collapsible details), explicit user-select:text, and auto-stick scroll
 * must not fight an active selection.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

export const CASE_ID = "MARKDOWN-MESSAGE-SELECT-COPY-SMOKE-001";

function readFirstExisting(relativeUrls: string[]) {
  for (const relativeUrl of relativeUrls) {
    const file = fileURLToPath(new URL(relativeUrl, import.meta.url));
    if (existsSync(file)) return readFileSync(file, "utf8");
  }
  throw new Error(`Missing smoke source: ${relativeUrls.join(" | ")}`);
}

test(`${CASE_ID} keeps assistant markdown on a flat document for reliable selection`, () => {
  const markdown = readFirstExisting([
    "../../../../../../platforms/windows/apps/desktop/src/renderer/app/MarkdownMessage.tsx",
    "./MarkdownMessage.tsx"
  ]);
  assert.match(markdown, /const useFlatDocument = true/);
  assert.doesNotMatch(markdown, /const useFlatDocument = isStreaming \|\| !collapsible/);
});

test(`${CASE_ID} styles allow text selection without overflow-wrap anywhere on body copy`, () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css, /\.markdown-message\s*\{[\s\S]*?user-select:\s*text/);
  assert.match(
    css,
    /\.markdown-message p,\s*\r?\n\.markdown-message li,[\s\S]{0,220}?overflow-wrap:\s*break-word/
  );
  assert.doesNotMatch(
    css,
    /\.markdown-message p,\s*\r?\n\.markdown-message li,[\s\S]{0,220}?overflow-wrap:\s*anywhere/
  );
});

test(`${CASE_ID} auto-stick scroll skips while answer text is selected`, () => {
  const workspace = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(workspace, /window\.getSelection\(\)/);
  assert.match(workspace, /\.markdown-message, \.assistant-block/);
  assert.match(workspace, /selectionchange/);
});
