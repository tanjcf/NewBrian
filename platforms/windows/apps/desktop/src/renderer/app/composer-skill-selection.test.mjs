import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../ui.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("selected composer skill replaces the picker label and icon", () => {
  assert.match(source, /composer-skill-button\$\{selectedComposerSkill \? " active" : ""\}/);
  assert.match(source, /function composerSelectionIcon[\s\S]*?builtinPluginCatalog\.some[\s\S]*?builtinPluginIcon\(skill\.name\)/);
  assert.match(source, /<SidebarIcon name=\{composerSelectionIcon\(selectedComposerSkill\)\} \/>/);
  assert.match(source, /selectedComposerSkill \? composerSkillLabel\(selectedComposerSkill\) : "选择技能"/);
});

test("selected built-in plugin keeps its original colored icon container", () => {
  assert.match(source, /function BuiltinPluginIcon\(\{ plugin \}: \{ plugin: \(typeof builtinPluginCatalog\)\[number\] \}\)/);
  assert.equal((source.match(/<BuiltinPluginIcon plugin=\{/g) ?? []).length, 2);
  assert.match(source, /const selectedBuiltinPlugin = builtinPluginCatalog\.find\(\(plugin\) => plugin\.packageName === selectedComposerSkill\?\.name\)/);
  assert.match(source, /selectedBuiltinPlugin \? \([\s\S]*?<BuiltinPluginIcon plugin=\{selectedBuiltinPlugin\} \/>/);
  assert.match(styles, /\.composer-modern-controls \.composer-builtin-plugin-icon\s*\{[^}]*width:\s*16px\s*!important;[^}]*height:\s*16px\s*!important;[^}]*color:\s*#fff\s*!important;/s);
  assert.match(styles, /\.composer-modern-controls \.composer-builtin-plugin-icon\[data-plugin="visualize"\]\s*\{\s*background:\s*#258de8\s*!important;\s*\}/);
});

test("selected plugin SVG keeps its stroke visible", () => {
  assert.doesNotMatch(styles, /\.composer-modern-controls \.composer-skill-button > svg:first-child\s*\{[^}]*stroke:\s*none;/s);
});

test("clear skill uses the same single-line grid as skill options", () => {
  assert.match(source, /className="composer-skill-clear"[\s\S]*?composer-skill-option-icon[\s\S]*?<SidebarIcon name="remove"[\s\S]*?composer-skill-option-copy[\s\S]*?<strong>关闭技能<\/strong>[\s\S]*?composer-skill-option-check/);
  assert.doesNotMatch(source, /<strong>关闭技能<\/strong><small>/);
});

test("skills appear only in the dedicated skill picker", () => {
  assert.doesNotMatch(source, /composer-add-skill-/);
  assert.doesNotMatch(source, /composer-menu-label composer-plugin-label">技能/);
  assert.match(source, /data-testid={`composer-skill-\$\{skill\.name\}`}/);
});

test("add menu uses SVG icons instead of text glyphs", () => {
  const addMenuStart = source.indexOf('<div className="composer-picker-menu composer-add-menu">');
  const addMenuTail = source.slice(addMenuStart);
  const addMenuEndMatch = addMenuTail.match(/                    <\/div>\r?\n                  \) : null}/);
  assert.ok(addMenuStart >= 0 && addMenuEndMatch?.index != null, "Could not isolate the add menu source.");
  const addMenuEnd = addMenuStart + addMenuEndMatch.index;
  const addMenuSource = source.slice(addMenuStart, addMenuEnd);
  for (const icon of ["paperclip", "target", "plan", "file-check", "file-word", "file-review", "file-text", "tool"]) {
    assert.match(source, new RegExp(`<SidebarIcon name=["']${icon}["']`));
  }
  assert.doesNotMatch(addMenuSource, /<span aria-hidden="true">(?:\u25ce|\u2637|\u2713|W|\u5ba1|T|\u25c7)<\/span>/);
});

test("built-in plugins and discovered MCP tools are visible in the add menu", () => {
  assert.match(source, /composer-plugin-label">插件<\/span>[\s\S]*?builtinPluginCatalog\.map/);
  assert.match(source, /composer-plugin-label">MCP 工具<\/span>[\s\S]*?mcpDiscoveredTools\.slice\(0, 6\)\.map/);
  assert.doesNotMatch(source, /\{showMcpToolPicker \? mcpDiscoveredTools\.slice\(0, 6\)\.map/);
});

test("goal and plan composer modes are mutually exclusive", () => {
  assert.match(source, /function enableComposerMode[\s\S]*?setComposerModes\(\[mode\]\)/);
  assert.match(source, /async function enablePlanMode[\s\S]*?setGoalPaused\([\s\S]*?setComposerModes\(\["plan"\]\)/);
  assert.match(source, /data-composer-mode="goal"[\s\S]*?data-composer-mode="plan"/);
});

test("composer skill selection stays bound to the active thread", () => {
  assert.match(source, /bindThreadComposerSkill\(selectedThread\?\.id \|\| null, skill\)/);
  assert.match(source, /bindThreadComposerSkill\(selectedThread\?\.id \|\| null, null\)/);
  assert.match(appSource, /bindThreadComposerSkill\(createdThread\.thread\.id/);
  assert.match(appSource, /skillForThread\(threadComposerSkills, selectedThreadId\)/);
  assert.doesNotMatch(
    appSource.slice(
      appSource.indexOf("async function askModel"),
      appSource.indexOf("const currentWorkspaceId = selectedWorkspaceIdRef")
    ),
    /setSelectedComposerSkill\(null\)/
  );
  assert.doesNotMatch(
    source.slice(
      source.indexOf("A new-chat draft has no stable thread id yet"),
      source.indexOf("localStorage.setItem(researchWritingKey")
    ),
    /setSelectedComposerSkill\(null\)/
  );
});
