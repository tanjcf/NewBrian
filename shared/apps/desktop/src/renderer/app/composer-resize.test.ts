import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPOSER_TEXTAREA_DEFAULT_HEIGHT,
  COMPOSER_TEXTAREA_MAX_HEIGHT,
  COMPOSER_TEXTAREA_MIN_HEIGHT,
  clampComposerTextareaHeight,
  nextComposerTextareaHeight,
  readStoredComposerTextareaHeight
} from "./composer-resize.ts";

test("clamps composer textarea height between min and max", () => {
  assert.equal(clampComposerTextareaHeight(10), COMPOSER_TEXTAREA_MIN_HEIGHT);
  assert.equal(clampComposerTextareaHeight(9999), COMPOSER_TEXTAREA_MAX_HEIGHT);
  assert.equal(clampComposerTextareaHeight(180), 180);
  assert.equal(clampComposerTextareaHeight(Number.NaN), COMPOSER_TEXTAREA_DEFAULT_HEIGHT);
});

test("dragging the top handle upward grows height", () => {
  assert.equal(nextComposerTextareaHeight(56, 400, 340), 116);
  assert.equal(nextComposerTextareaHeight(56, 400, 500), COMPOSER_TEXTAREA_MIN_HEIGHT);
  assert.equal(nextComposerTextareaHeight(300, 400, 0), COMPOSER_TEXTAREA_MAX_HEIGHT);
});

test("reads stored composer height with clamp", () => {
  assert.equal(readStoredComposerTextareaHeight({ getItem: () => "220" }), 220);
  assert.equal(readStoredComposerTextareaHeight({ getItem: () => "9999" }), COMPOSER_TEXTAREA_MAX_HEIGHT);
  assert.equal(readStoredComposerTextareaHeight({ getItem: () => null }), COMPOSER_TEXTAREA_DEFAULT_HEIGHT);
});
