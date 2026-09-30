import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPreviewMixTracks,
  isAudioClipAudible,
  isPrimaryAudioLane,
  resolveLaneMuteUi
} from "./video-pipeline-preview-mix.ts";

test("primary lane is index 0 or a1 only", () => {
  assert.equal(isPrimaryAudioLane("a1", 0), true);
  assert.equal(isPrimaryAudioLane("a2", 0), true);
  assert.equal(isPrimaryAudioLane("a2", 1), false);
  assert.equal(isPrimaryAudioLane("a1", 1), true);
});

test("mute UI uses trackEdit.muted only for primary lane", () => {
  assert.equal(resolveLaneMuteUi({ laneMuted: false, isPrimary: true, trackEditMuted: true }), true);
  assert.equal(resolveLaneMuteUi({ laneMuted: false, isPrimary: false, trackEditMuted: true }), false);
  assert.equal(resolveLaneMuteUi({ laneMuted: true, isPrimary: false, trackEditMuted: false }), true);
  assert.equal(resolveLaneMuteUi({ laneMuted: false, isPrimary: false, trackEditMuted: false }), false);
});

test("solo overrides mute; any solo silences non-solo", () => {
  assert.equal(isAudioClipAudible({
    laneMuted: true, laneSolo: true, clipMuted: false, anyAudioSolo: true
  }), true);
  assert.equal(isAudioClipAudible({
    laneMuted: false, laneSolo: false, clipMuted: false, anyAudioSolo: true
  }), false);
  assert.equal(isAudioClipAudible({
    laneMuted: true, laneSolo: false, clipMuted: false, anyAudioSolo: false
  }), false);
  assert.equal(isAudioClipAudible({
    laneMuted: false, laneSolo: false, clipMuted: true, anyAudioSolo: false
  }), false);
});

test("buildPreviewMixTracks mixes A1+A2 under playhead and skips muted A2", () => {
  const sampleVolume = () => 1;
  const clips = [
    {
      id: "a1-clip",
      shotId: "shot-1",
      audioTrackId: "a1",
      start: 0,
      duration: 4,
      muted: false,
      relativePath: "media/audio/narration.wav"
    },
    {
      id: "a2-clip",
      shotId: "shot-1",
      audioTrackId: "a2",
      start: 0,
      duration: 4,
      muted: false,
      relativePath: "media/imports/clip-audio-1.m4a"
    }
  ];
  const urls: Record<string, string> = {
    "media/audio/narration.wav": "blob:a1",
    "media/imports/clip-audio-1.m4a": "blob:a2"
  };
  const both = buildPreviewMixTracks({
    clips,
    lanes: [
      { id: "a1", muted: false, solo: false },
      { id: "a2", muted: false, solo: false }
    ],
    resolveUrl: (clip) => urls[String(clip.relativePath || "")] || "",
    playheadSec: 1,
    sampleVolume
  });
  assert.equal(both.length, 2);
  assert.deepEqual(both.map((t) => t.id).sort(), ["a1-clip", "a2-clip"]);

  const a1Only = buildPreviewMixTracks({
    clips,
    lanes: [
      { id: "a1", muted: true, solo: false },
      { id: "a2", muted: false, solo: false }
    ],
    resolveUrl: (clip) => urls[String(clip.relativePath || "")] || "",
    playheadSec: 1,
    sampleVolume
  });
  assert.equal(a1Only.length, 1);
  assert.equal(a1Only[0]?.id, "a2-clip");

  const mutedA2Ui = resolveLaneMuteUi({
    laneMuted: false,
    isPrimary: false,
    trackEditMuted: true
  });
  assert.equal(mutedA2Ui, false, "A1 trackEdit mute must not paint A2 as muted");
});

test("buildPreviewMixTracks uses local 0-based offsets for onlyUnderPlayhead (sequence playlist)", () => {
  const sampleVolume = () => 1;
  const clips = [
    {
      id: "a1-shot-2",
      shotId: "shot-2",
      audioTrackId: "a1",
      start: 12,
      duration: 5,
      muted: false,
      relativePath: "media/audio/shot2.wav"
    }
  ];
  const tracks = buildPreviewMixTracks({
    clips,
    lanes: [{ id: "a1", muted: false, solo: false }],
    resolveUrl: () => "blob:shot2",
    playheadSec: 13,
    sampleVolume,
    onlyUnderPlayhead: true
  });
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0]?.offsetSec, 0, "mix sync must follow per-clip video.currentTime, not timeline start");
  assert.equal(tracks[0]?.endSec, 5);
});
