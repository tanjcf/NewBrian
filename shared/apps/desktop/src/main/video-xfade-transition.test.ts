import assert from "node:assert/strict";
import test from "node:test";

const { mapXfadeTransition } = await import(new URL("./video-xfade-map.ts", import.meta.url).href);

test("mapXfadeTransition: unset/cut/none/unknown → hard cut (null)", () => {
  assert.equal(mapXfadeTransition(undefined), null);
  assert.equal(mapXfadeTransition(""), null);
  assert.equal(mapXfadeTransition("cut"), null);
  assert.equal(mapXfadeTransition("none"), null);
  assert.equal(mapXfadeTransition("硬切"), null);
  assert.equal(mapXfadeTransition("mystery-fx"), null);
});

test("mapXfadeTransition: explicit fade/dissolve/wipe/blur → xfade", () => {
  assert.deepEqual(mapXfadeTransition("fade"), { name: "fade", durationSec: 0.3 });
  assert.deepEqual(mapXfadeTransition("fade-0.6"), { name: "fade", durationSec: 0.6 });
  assert.deepEqual(mapXfadeTransition("dissolve"), { name: "dissolve", durationSec: 0.25 });
  assert.deepEqual(mapXfadeTransition("wipe-left"), { name: "wipeleft", durationSec: 0.25 });
  assert.deepEqual(mapXfadeTransition("blur"), { name: "hblur", durationSec: 0.25 });
  assert.deepEqual(mapXfadeTransition("模糊过渡"), { name: "hblur", durationSec: 0.25 });
  assert.deepEqual(mapXfadeTransition("叠化"), { name: "dissolve", durationSec: 0.25 });
  assert.deepEqual(mapXfadeTransition("淡入淡出"), { name: "fade", durationSec: 0.3 });
});
