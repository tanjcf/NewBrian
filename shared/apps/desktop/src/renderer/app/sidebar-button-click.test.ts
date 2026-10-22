import assert from "node:assert/strict";
import test from "node:test";
import { resolveSidebarButtonClick } from "./sidebar-button-click.ts";

test("preview side workbench exits and expands left nav", () => {
  assert.deepEqual(
    resolveSidebarButtonClick({ previewPlacement: "side", brainResourcePlacement: "side" }),
    { action: "exit-workbench", nextBrainPlacement: undefined }
  );
});

test("preview center workbench exits and expands left nav", () => {
  assert.deepEqual(
    resolveSidebarButtonClick({ previewPlacement: "center", brainResourcePlacement: "hidden" }),
    { action: "exit-workbench", nextBrainPlacement: undefined }
  );
});

test("expanded brain tools exit to side placement", () => {
  assert.deepEqual(
    resolveSidebarButtonClick({ previewPlacement: "hidden", brainResourcePlacement: "center" }),
    { action: "exit-workbench", nextBrainPlacement: "side" }
  );
});

test("idle layout toggles sidebar only", () => {
  assert.deepEqual(
    resolveSidebarButtonClick({ previewPlacement: "hidden", brainResourcePlacement: "side" }),
    { action: "toggle-sidebar" }
  );
  assert.deepEqual(
    resolveSidebarButtonClick({ previewPlacement: "hidden", brainResourcePlacement: "hidden" }),
    { action: "toggle-sidebar" }
  );
});
