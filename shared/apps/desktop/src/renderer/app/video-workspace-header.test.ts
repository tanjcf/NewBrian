import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("resource navigation lives inside header and retains real data actions", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const start = source.indexOf('<header className="brain-resource-header">');
  const header = source.slice(start, source.indexOf("</header>", start));
  assert.ok(header.includes('className="brain-resource-global-nav"'));
  for (const name of ["brainFiles.length", "brainArtifacts.length", "brainTasks.length", "showCapability(brainSceneTab)"]) assert.ok(header.includes(name));
});

test("script confirmation saves before changing step", () => {
  const source = readFileSync(new URL("./VideoScriptWorkbench.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(await props.onSave\(\)\)/);
  assert.match(source, /if \(confirm\) props.onConfirm\(\)/);
  assert.match(source, /validateScriptSegments\(props.segments\)/);
});
