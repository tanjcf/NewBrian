import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("custom model form opens as a body portal beside the menu", () => {
  const menu = readFileSync(new URL("./CustomModelEndpointMenu.tsx", import.meta.url), "utf8");
  assert.match(menu, /createPortal\(/);
  assert.match(menu, /composer-custom-model-card-fixed/);
  assert.match(menu, /data-testid="composer-custom-model-add"/);
  assert.doesNotMatch(menu, /formOpen \? \(\s*<form/);
  const workspace = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(workspace, /closest\("\.composer-picker-menu, \.composer-custom-model-card"\)/);
  assert.match(workspace, /renderCustomModelMenu\(true\)/);
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.composer-custom-model-card\.composer-custom-model-card-fixed/);
});
