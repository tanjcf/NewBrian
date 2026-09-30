import assert from "node:assert/strict";
import test from "node:test";
import {
  audioTrackLabelForPath,
  fileKeyMatchesShot,
  healSharedUnscopedAudioPaths,
  isBrokenPeeledAudioMp4Path,
  isPeeledEmbeddedAudioPath,
  isPeeledVideoOnlyPath,
  peeledVideoOriginalMuxCandidates,
  peeledVideoSiblingAudioCandidates,
  pickFirstExistingMediaPath,
  resolveAudioFileId,
  resolveAudioRelativePath,
  shotIdMatchTokens
} from "./video-pipeline-audio-resolve.ts";

test("matches shot-scoped narration names, not bare digits in timestamps", () => {
  assert.ok(shotIdMatchTokens("shot-1").includes("shot-1"));
  assert.ok(shotIdMatchTokens("shot-1").includes("shot-001"));
  assert.equal(fileKeyMatchesShot("media/audio/narration-shot-1.wav", "shot-1"), true);
  assert.equal(fileKeyMatchesShot("media/audio/narration-shot-3.wav", "shot-1"), false);
  assert.equal(fileKeyMatchesShot("media/audio/narration-1788068914926.wav", "shot-1"), false);
  assert.equal(fileKeyMatchesShot("media/audio/narration-1788068914926.wav", "shot-3"), false);
});

test("does not fall back to any narration file for empty shot.audio", () => {
  const files = [
    { id: "f3", mimeType: "audio/wav", relativePath: "media/audio/narration-1788068914926.wav", logicalName: "narration-1788068914926.wav" },
    { id: "f1", mimeType: "audio/wav", relativePath: "media/audio/narration-shot-1.wav", logicalName: "narration-shot-1.wav" }
  ];
  assert.equal(resolveAudioFileId(files, "shot-1", ""), "f1");
  assert.equal(resolveAudioFileId(files, "shot-2", ""), undefined);
  assert.equal(resolveAudioFileId(files, "shot-3", ""), undefined);
  assert.equal(resolveAudioRelativePath(files, "shot-2", ""), "");
  assert.equal(resolveAudioRelativePath(files, "shot-3", ""), "");
});

test("keeps explicit audio path lookup even when unscoped", () => {
  const files = [
    { id: "f3", mimeType: "audio/wav", relativePath: "media/audio/narration-1788068914926.wav" }
  ];
  assert.equal(
    resolveAudioFileId(files, "shot-3", "media/audio/narration-1788068914926.wav"),
    "f3"
  );
});

test("heals shared unscoped audio paths across shots", () => {
  const shared = "media/audio/narration-1788068914926.wav";
  const { shots, changed } = healSharedUnscopedAudioPaths([
    { id: "shot-1", audio: shared },
    { id: "shot-2", audio: shared },
    { id: "shot-3", audio: shared }
  ]);
  assert.equal(changed, true);
  assert.equal(shots[0]?.audio, "");
  assert.equal(shots[1]?.audio, "");
  assert.equal(shots[2]?.audio, "");
});

test("keeps shared path only on shot-scoped owner", () => {
  const shared = "media/audio/narration-shot-3.wav";
  const { shots, changed } = healSharedUnscopedAudioPaths([
    { id: "shot-1", audio: shared },
    { id: "shot-2", audio: shared },
    { id: "shot-3", audio: shared }
  ]);
  assert.equal(changed, true);
  assert.equal(shots[0]?.audio, "");
  assert.equal(shots[1]?.audio, "");
  assert.equal(shots[2]?.audio, shared);
});

test("classifies peeled FFmpeg unlink paths", () => {
  assert.equal(isPeeledEmbeddedAudioPath("media/imports/clip-audio-1710000000000.m4a"), true);
  assert.equal(isPeeledVideoOnlyPath("media/imports/clip-video-1710000000000.mp4"), true);
  assert.equal(isPeeledEmbeddedAudioPath("media/audio/narration-shot-1.wav"), false);
  assert.equal(isBrokenPeeledAudioMp4Path("media/imports/clip-audio-1710000000000.mp4"), true);
  assert.equal(isBrokenPeeledAudioMp4Path("media/imports/clip-audio-1710000000000.m4a"), false);
  assert.equal(audioTrackLabelForPath("media/imports/x-audio-1.wav", "镜1", 0), "镜1 · 音轨");
  assert.equal(audioTrackLabelForPath("media/audio/narration-shot-1.wav", "镜1", 0), "镜1 · 旁白");
});

test("resolves peeled video sibling audio and original mux candidates", () => {
  const video = "media/imports/shot-001-1788024550473-1788092515448-video-1788092515925.mp4";
  assert.deepEqual(peeledVideoSiblingAudioCandidates(video), [
    "media/imports/shot-001-1788024550473-1788092515448-audio-1788092515925.m4a",
    "media/imports/shot-001-1788024550473-1788092515448-audio-1788092515925.wav",
    "media/imports/shot-001-1788024550473-1788092515448-audio-1788092515925.aac",
    "media/imports/shot-001-1788024550473-1788092515448-audio-1788092515925.mp3"
  ]);
  assert.ok(
    peeledVideoOriginalMuxCandidates(video).includes(
      "media/imports/shot-001-1788024550473-1788092515448.mp4"
    )
  );
  assert.equal(
    pickFirstExistingMediaPath(peeledVideoSiblingAudioCandidates(video), [
      "media/imports/shot-001-1788024550473-1788092515448-audio-1788092515925.m4a"
    ]),
    "media/imports/shot-001-1788024550473-1788092515448-audio-1788092515925.m4a"
  );
  assert.equal(pickFirstExistingMediaPath(peeledVideoSiblingAudioCandidates(video), []), "");
});
