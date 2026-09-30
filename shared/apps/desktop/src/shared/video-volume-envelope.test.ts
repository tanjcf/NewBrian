import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFfmpegVolumeExpression,
  buildFfmpegVolumeFilterFragment,
  healSilentVolumeKeyframes,
  insertVolumeKeyframe,
  isAllZeroVolumeEnvelope,
  sampleVolumeEnvelope,
  yRatioToVolumeGain,
  volumeGainToYRatio
} from "./video-volume-envelope.ts";

test("samples flat baseline without keyframes", () => {
  assert.equal(sampleVolumeEnvelope(undefined, 1, 4, 1), 1);
  assert.equal(sampleVolumeEnvelope(undefined, 1, 4, 0.5), 0.5);
});

test("linear interpolates V-shape duck", () => {
  const kfs = [
    { t: 0, v: 1 },
    { t: 1, v: 0.2 },
    { t: 2, v: 1 }
  ];
  assert.ok(Math.abs(sampleVolumeEnvelope(kfs, 0.5, 2, 1) - 0.6) < 0.001);
  assert.ok(Math.abs(sampleVolumeEnvelope(kfs, 1, 2, 1) - 0.2) < 0.001);
  assert.ok(Math.abs(sampleVolumeEnvelope(kfs, 1.5, 2, 1) - 0.6) < 0.001);
});

test("baseline multiplies envelope", () => {
  const kfs = [
    { t: 0, v: 1 },
    { t: 2, v: 1 }
  ];
  assert.equal(sampleVolumeEnvelope(kfs, 1, 2, 0.5), 0.5);
});

test("insert keyframe materializes endpoints", () => {
  const next = insertVolumeKeyframe(undefined, 4, 2, 0.3, 1);
  assert.equal(next.length, 3);
  assert.equal(next[1]!.t, 2);
  assert.equal(next[1]!.v, 0.3);
});

test("y mapping round-trips mid gain", () => {
  assert.ok(Math.abs(yRatioToVolumeGain(volumeGainToYRatio(1)) - 1) < 0.001);
  // 100% gain draws at mid clip (not bottom); 0% is bottom.
  assert.ok(Math.abs(volumeGainToYRatio(1) - 0.5) < 0.001);
  assert.ok(Math.abs(volumeGainToYRatio(0) - 1) < 0.001);
});

test("heals all-zero envelope back to flat 100%", () => {
  assert.equal(isAllZeroVolumeEnvelope([{ t: 0, v: 0 }, { t: 4, v: 0 }]), true);
  assert.equal(isAllZeroVolumeEnvelope([{ t: 0, v: 1 }, { t: 4, v: 1 }]), false);
  assert.equal(isAllZeroVolumeEnvelope(undefined), false);
  const healed = healSilentVolumeKeyframes([{ t: 0, v: 0 }, { t: 4, v: 0 }], 4, 1);
  assert.deepEqual(healed, [{ t: 0, v: 1 }, { t: 4, v: 1 }]);
  assert.equal(sampleVolumeEnvelope(healed, 2, 4, 1), 1);
});

test("ffmpeg flat volume stays numeric", () => {
  assert.equal(buildFfmpegVolumeExpression([{ t: 0, v: 1 }, { t: 2, v: 1 }], 2, 1), "1");
  assert.equal(buildFfmpegVolumeFilterFragment([{ t: 0, v: 1 }, { t: 2, v: 1 }], 2, 1), "volume=1");
});

test("ffmpeg duck uses eval expression", () => {
  const expr = buildFfmpegVolumeExpression(
    [{ t: 0, v: 1 }, { t: 1, v: 0.2 }, { t: 2, v: 1 }],
    2,
    1
  );
  assert.match(expr, /if\(lt\(t\\,/);
  const frag = buildFfmpegVolumeFilterFragment(
    [{ t: 0, v: 1 }, { t: 1, v: 0.2 }, { t: 2, v: 1 }],
    2,
    1
  );
  assert.match(frag, /volume='.*':eval=frame/);
});
