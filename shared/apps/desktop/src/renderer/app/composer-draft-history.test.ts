import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPOSER_DRAFT_HISTORY_MAX,
  commitComposerDraftHistory,
  createComposerDraftHistory,
  composerDraftHistoryCaps,
  redoComposerDraftHistory,
  resetComposerDraftHistory,
  shouldForceComposerDraftCheckpoint,
  undoComposerDraftHistory
} from "./composer-draft-history.ts";

test("commit records previous baseline and clears redo", () => {
  let state = createComposerDraftHistory("");
  state = commitComposerDraftHistory(state, { text: "hello", cursor: 5 });
  assert.equal(state.past.length, 1);
  assert.equal(state.past[0]?.text, "");
  assert.equal(state.committed.text, "hello");
  assert.deepEqual(composerDraftHistoryCaps(state), { canUndo: true, canRedo: false });
});

test("unchanged text does not create a checkpoint unless forced", () => {
  let state = createComposerDraftHistory("a", 1);
  const same = commitComposerDraftHistory(state, { text: "a", cursor: 1 });
  assert.equal(same, state);
  state = commitComposerDraftHistory(state, { text: "a", cursor: 1 }, { force: true });
  assert.equal(state.past.length, 1);
});

test("history caps at five undo checkpoints", () => {
  let state = createComposerDraftHistory("");
  for (let i = 1; i <= 7; i += 1) {
    state = commitComposerDraftHistory(state, { text: `v${i}`, cursor: 2 });
  }
  assert.equal(state.past.length, COMPOSER_DRAFT_HISTORY_MAX);
  assert.equal(state.past[0]?.text, "v2");
  assert.equal(state.committed.text, "v7");
});

test("undo and redo restore text and cursor", () => {
  let state = createComposerDraftHistory("");
  state = commitComposerDraftHistory(state, { text: "one", cursor: 3 });
  state = commitComposerDraftHistory(state, { text: "two", cursor: 3 });

  const undone = undoComposerDraftHistory(state, { text: "two", cursor: 3 });
  assert.ok(undone);
  assert.equal(undone.restored.text, "one");
  assert.equal(undone.restored.cursor, 3);
  assert.deepEqual(composerDraftHistoryCaps(undone.state), { canUndo: true, canRedo: true });

  const redone = redoComposerDraftHistory(undone.state, undone.restored);
  assert.ok(redone);
  assert.equal(redone.restored.text, "two");
  assert.deepEqual(composerDraftHistoryCaps(redone.state), { canUndo: true, canRedo: false });
});

test("reset clears past and future", () => {
  let state = createComposerDraftHistory("");
  state = commitComposerDraftHistory(state, { text: "x", cursor: 1 });
  state = resetComposerDraftHistory("");
  assert.deepEqual(composerDraftHistoryCaps(state), { canUndo: false, canRedo: false });
  assert.equal(state.committed.text, "");
});

test("paste and cut force a checkpoint", () => {
  assert.equal(shouldForceComposerDraftCheckpoint("insertFromPaste"), true);
  assert.equal(shouldForceComposerDraftCheckpoint("deleteByCut"), true);
  assert.equal(shouldForceComposerDraftCheckpoint("insertText"), false);
});
