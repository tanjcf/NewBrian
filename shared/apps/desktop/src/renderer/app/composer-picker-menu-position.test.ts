import assert from "node:assert/strict";
import test from "node:test";
import { positionComposerPickerMenu } from "./composer-picker-menu-position.ts";

test("new-chat centered composer prefers opening the model menu below when space above is tight", () => {
  const position = positionComposerPickerMenu(
    { left: 700, right: 860, top: 280, bottom: 312, width: 160 },
    {
      preferBelow: true,
      estimatedHeight: 420,
      viewportWidth: 1280,
      viewportHeight: 720
    }
  );
  assert.equal(position.placement, "below");
  assert.equal(position.top, 322);
  assert.ok(position.maxHeight >= 160);
  assert.ok(position.top + position.maxHeight <= 720 - 8);
});

test("bottom-anchored composer opens the model menu above and keeps it inside the viewport", () => {
  const position = positionComposerPickerMenu(
    { left: 900, right: 1060, top: 640, bottom: 672, width: 160 },
    {
      preferBelow: false,
      estimatedHeight: 520,
      viewportWidth: 1280,
      viewportHeight: 720
    }
  );
  assert.equal(position.placement, "above");
  assert.ok(position.top >= 8);
  assert.ok(position.top + position.maxHeight <= 640 - 10);
  assert.ok(position.left + position.width <= 1280 - 8);
});

test("right-aligned menu stays within the horizontal viewport padding", () => {
  const position = positionComposerPickerMenu(
    { left: 1180, right: 1270, top: 300, bottom: 332, width: 90 },
    { menuWidth: 214, viewportWidth: 1280, viewportHeight: 720, preferBelow: true }
  );
  assert.equal(position.left, 1270 - 214);
  assert.ok(position.left + position.width <= 1280 - 8);
});
