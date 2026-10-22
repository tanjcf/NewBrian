/**
 * COMPOSER-FOOTER-CONTROLS-SMOKE-001
 * Packaging must run this case and stop when it fails.
 * Composer footer must keep one modern control strip (approval/skill/project/mode/branch
 * hooks) and hide the legacy sibling row that used to double the footer.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

export const CASE_ID = "COMPOSER-FOOTER-CONTROLS-SMOKE-001";

test(`${CASE_ID} modern composer controls keep required hooks`, () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const modernStart = source.indexOf('className="composer-modern-controls"');
  assert.ok(modernStart >= 0, "composer-modern-controls must exist");
  const modernEnd = source.indexOf("</div>", source.indexOf('data-testid="composer-reasoning-menu"', modernStart));
  const modern = source.slice(modernStart, modernEnd > modernStart ? modernEnd : modernStart + 8_000);

  assert.match(modern, /data-testid="composer-permission-button"/);
  assert.match(modern, /data-testid="composer-skill-button"/);
  assert.match(modern, /data-testid="composer-add-button"/);
  assert.match(modern, /composer-reasoning-button/);

  // Project / mode / branch pickers live on the new-chat project row above the composer.
  assert.match(source, /new-chat-project-row/);
  assert.match(source, /openNewChatProjectMenu\("workspace"\)/);
  assert.match(source, /openNewChatProjectMenu\("local"\)/);
  assert.match(source, /openNewChatProjectMenu\("branch"\)/);
  assert.match(source, /new-chat-project-menu branch-menu/);
});

test(`${CASE_ID} CSS hides legacy composer-tools siblings so the footer is not double-layered`, () => {
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(
    styles,
    /\.composer-tools\s*>\s*button:not\(\.send-btn\),\s*\n\.composer-tools\s*>\s*\.composer-picker-wrap,\s*\n\.composer-tools\s*>\s*\.spacer,\s*\n\.composer-tools\s*>\s*span:not\(\.spacer\)\s*\{\s*\n\s*display:\s*none;/s
  );
  assert.match(styles, /\.composer-modern-controls\s*\{[^}]*display:\s*flex/s);
});
