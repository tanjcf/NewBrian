/**
 * AUTOMATION-LAYOUT-ACTIONS-SMOKE-001
 * Packaging must run this case and stop when it fails.
 * A skill row squeezed into the automation table covered 查看对话 and 立即执行.
 * Each row stays full width and only as tall as its content, and those buttons stay clickable.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const CASE_ID = "AUTOMATION-LAYOUT-ACTIONS-SMOKE-001";
const ACTION_COLUMNS = "12px minmax(0, 1fr) 140px 156px 70px 220px";

function rule(css: string, selector: string) {
  const pattern = new RegExp(`${selector}\\s*\\{([^}]*)\\}`);
  const match = css.match(pattern);
  assert.ok(match, `${CASE_ID} missing CSS rule ${selector}`);
  return match[1];
}

test(`${CASE_ID} keeps skill and automation rows from covering each other's buttons`, () => {
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const modules = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");

  const surface = rule(styles, String.raw`\.capability-catalog \.catalog-surface`);
  assert.match(surface, /display:\s*flex;/);
  assert.match(surface, /flex-direction:\s*column;/);
  assert.match(surface, /align-items:\s*stretch;/);

  const skillRow = rule(styles, String.raw`\.capability-catalog \.skill-row`);
  assert.match(skillRow, /grid-column:\s*1\s*\/\s*-1;/);
  assert.match(skillRow, /align-self:\s*start;/);
  assert.match(skillRow, /width:\s*100%;/);
  assert.match(skillRow, /height:\s*auto;/);
  assert.match(skillRow, /grid-template-columns:\s*42px minmax\(0,\s*1fr\) max-content;/);
  assert.match(skillRow, /grid-template-rows:\s*auto;/);
  assert.match(skillRow, /background:\s*#fff;/);
  assert.doesNotMatch(skillRow, /92px/);

  const skillName = rule(styles, String.raw`\.capability-catalog \.skill-copy strong`);
  assert.match(skillName, /overflow:\s*hidden;/);
  assert.match(skillName, /text-overflow:\s*ellipsis;/);
  assert.match(skillName, /white-space:\s*nowrap;/);

  const skillActions = rule(styles, String.raw`\.capability-catalog \.skill-actions`);
  assert.match(skillActions, /flex-wrap:\s*nowrap;/);
  assert.match(skillActions, /justify-self:\s*end;/);

  const list = rule(styles, String.raw`\.capability-catalog \.scheduled-list`);
  assert.match(list, /display:\s*flex;/);
  assert.match(list, /flex-direction:\s*column;/);
  assert.match(list, /width:\s*100%;/);

  const head = rule(styles, String.raw`\.capability-catalog \.automation-table-head`);
  const task = rule(styles, String.raw`\.capability-catalog \.scheduled-task`);
  assert.match(head, new RegExp(`grid-template-columns:\\s*${ACTION_COLUMNS.replace(/[()]/g, "\\$&")};`));
  assert.match(task, new RegExp(`grid-template-columns:\\s*${ACTION_COLUMNS.replace(/[()]/g, "\\$&")};`));
  assert.match(task, /grid-column:\s*1\s*\/\s*-1;/);
  assert.match(task, /align-self:\s*start;/);
  assert.match(task, /width:\s*100%;/);
  assert.match(task, /height:\s*auto;/);
  assert.match(task, /z-index:\s*2;/);
  assert.match(task, /background:\s*#fff;/);
  assert.doesNotMatch(styles, /grid-template-columns:\s*12px minmax\(230px,\s*1fr\) 155px 155px 78px 132px;/);

  const menu = rule(styles, String.raw`\.capability-catalog \.task-menu`);
  assert.match(menu, /flex-wrap:\s*nowrap;/);
  assert.match(menu, /min-width:\s*max-content;/);

  const hits = rule(
    styles,
    String.raw`\.capability-catalog \.task-menu \.catalog-row-action,\s*\.capability-catalog \.task-menu \.task-menu-btn,\s*\.capability-catalog \.skill-actions \.switch,\s*\.capability-catalog \.skill-actions \.catalog-more`
  );
  assert.match(hits, /pointer-events:\s*auto;/);
  assert.match(hits, /z-index:\s*3;/);
  const action = rule(styles, String.raw`\.capability-catalog \.task-menu \.catalog-row-action`);
  assert.match(action, /white-space:\s*nowrap;/);

  assert.match(modules, /data-testid="automation-open-thread"/);
  assert.match(modules, /data-testid="automation-run-now"/);
  assert.match(modules, /查看对话/);
  assert.match(modules, /立即执行/);
  assert.match(modules, /className="skill-row"/);
  assert.match(modules, /className=\{`scheduled-task/);
  assert.match(modules, /className="task-menu"/);
});
