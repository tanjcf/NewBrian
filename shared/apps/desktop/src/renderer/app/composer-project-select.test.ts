/**
 * COMPOSER-PROJECT-DRAFT-CLEAR-SMOKE-001
 * Packaging must run this case and stop when it fails.
 * Selecting a project home after a chat/thread must clear the unsent composer draft.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { shouldClearComposerOnProjectSelect } from "./composer-project-select.ts";

export const CASE_ID = "COMPOSER-PROJECT-DRAFT-CLEAR-SMOKE-001";

test(`${CASE_ID} clears composer when leaving chat for a project home`, () => {
  assert.equal(
    shouldClearComposerOnProjectSelect({
      previousRow: "chat:ws-1:thread-1",
      nextRow: "project:ws-2"
    }),
    true
  );
  assert.equal(
    shouldClearComposerOnProjectSelect({
      previousRow: "project-thread:ws-1:thread-1",
      nextRow: "project:ws-1"
    }),
    true
  );
  assert.equal(
    shouldClearComposerOnProjectSelect({
      previousRow: "feature:new-chat",
      nextRow: "project:ws-2"
    }),
    true
  );
});

test(`${CASE_ID} clears composer when switching between projects`, () => {
  assert.equal(
    shouldClearComposerOnProjectSelect({
      previousRow: "project:ws-a",
      nextRow: "project:ws-b"
    }),
    true
  );
});

test(`${CASE_ID} keeps draft on same-project re-click`, () => {
  assert.equal(
    shouldClearComposerOnProjectSelect({
      previousRow: "project:ws-a",
      nextRow: "project:ws-a"
    }),
    false
  );
});

test(`${CASE_ID} does not clear when leaving project home for a chat thread`, () => {
  assert.equal(
    shouldClearComposerOnProjectSelect({
      previousRow: "project:ws-a",
      nextRow: "chat:ws-a:thread-1"
    }),
    false
  );
  assert.equal(
    shouldClearComposerOnProjectSelect({
      previousRow: "project:ws-a",
      nextRow: "project-thread:ws-a:thread-1"
    }),
    false
  );
});

test(`${CASE_ID} project header selection clears unsent composer draft in WorkspaceModules`, () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(source, /shouldClearComposerOnProjectSelect/);
  assert.match(source, /clearComposerDraftOnProjectSelect/);
  const headerClick = source.slice(
    source.indexOf('data-testid="sidebar-project-header"'),
    source.indexOf('data-testid="project-new-thread-button"')
  );
  assert.match(headerClick, /setSelectedSidebarRow\(`project:\$\{workspace\.id\}`\)/);
  assert.match(source, /previousSidebarRowForComposerRef/);
});
