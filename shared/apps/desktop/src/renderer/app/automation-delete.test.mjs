import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ui = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const detailStart = ui.lastIndexOf("catalog-modal-foot");
const detail = ui.slice(detailStart, detailStart + 700);

test("automation detail offers delete and the list menu is not clipped", () => {
  assert.match(detail, /className="danger"/);
  assert.match(detail, /deleteAutomation\(selected\)/);
  assert.match(ui, /void deleteAutomation\(item\)/);
  assert.match(styles, /\.catalog-surface\.automation-surface \{\s*overflow: visible;/);
  assert.match(ui, /data-testid="automation-run-now"/);
  assert.match(ui, /data-testid="automation-detail-run-now"/);
  assert.match(ui, /selectWorkspaceThread\(item\.workspaceId, item\.threadId/);
  assert.match(ui, /targetThreadId: item\.threadId/);
  assert.match(ui, /status: "record_run"/);
  assert.match(styles, /\.capability-catalog \.task-menu \{/);
  assert.match(styles, /\.automation-template-card \{\s*[^}]*background:\s*#fff6e8;/);
  assert.doesNotMatch(styles.slice(styles.indexOf(".capability-catalog .automation-template-card {"), styles.indexOf(".capability-catalog .automation-template-card {") + 280), /background:\s*#fff;/);
});
