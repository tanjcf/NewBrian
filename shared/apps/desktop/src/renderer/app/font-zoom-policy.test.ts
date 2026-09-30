import assert from "node:assert/strict";
import test from "node:test";
import {
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_MIN,
  resolveFontZoomDirection,
  scaleAppearanceFontSizes,
  shouldHandleFontZoomWheel,
  UI_FONT_SIZE_MAX,
  UI_FONT_SIZE_MIN
} from "./font-zoom-policy.ts";

test("ctrl/meta wheel is treated as font zoom", () => {
  assert.equal(shouldHandleFontZoomWheel({ ctrlKey: true, deltaY: -120 }), true);
  assert.equal(shouldHandleFontZoomWheel({ metaKey: true, deltaY: 40 }), true);
  assert.equal(shouldHandleFontZoomWheel({ ctrlKey: false, deltaY: -120 }), false);
  assert.equal(shouldHandleFontZoomWheel({ ctrlKey: true, deltaY: 0 }), false);
});

test("wheel direction maps to zoom in/out", () => {
  assert.equal(resolveFontZoomDirection(-100), 1);
  assert.equal(resolveFontZoomDirection(100), -1);
  assert.equal(resolveFontZoomDirection(0), 0);
});

test("font zoom keeps code size proportional and clamps", () => {
  assert.deepEqual(
    scaleAppearanceFontSizes({ uiFontSize: 14, codeFontSize: 12 }, 1),
    { uiFontSize: 15, codeFontSize: 13 }
  );
  assert.deepEqual(
    scaleAppearanceFontSizes({ uiFontSize: 14, codeFontSize: 12 }, -1),
    { uiFontSize: 13, codeFontSize: 11 }
  );
  assert.equal(
    scaleAppearanceFontSizes({ uiFontSize: UI_FONT_SIZE_MAX, codeFontSize: CODE_FONT_SIZE_MAX }, 1).uiFontSize,
    UI_FONT_SIZE_MAX
  );
  assert.equal(
    scaleAppearanceFontSizes({ uiFontSize: UI_FONT_SIZE_MIN, codeFontSize: CODE_FONT_SIZE_MIN }, -1).uiFontSize,
    UI_FONT_SIZE_MIN
  );
});
