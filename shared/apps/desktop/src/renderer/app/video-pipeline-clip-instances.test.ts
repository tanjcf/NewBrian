import assert from "node:assert/strict";
import test from "node:test";
import {
  findRelinkCandidate,
  hasPeeledSoundtrackForShot,
  isLinkedClipGroup,
  isSecondaryClipInstanceId,
  reconcileClipInstancesWithShots,
  relinkAvInstances,
  unlinkClipGroup,
  upsertPeeledSoundtrackInstance,
  upsertPrimaryInstance
} from "./video-pipeline-clip-instances.ts";

test("secondary ids cover peel and copy markers", () => {
  assert.equal(isSecondaryClipInstanceId("audio-1-peel"), true);
  assert.equal(isSecondaryClipInstanceId("audio-1-copy-2"), true);
  assert.equal(isSecondaryClipInstanceId("audio-1"), false);
});

test("peeled soundtrack does not replace旁白 primary A", () => {
  let next = upsertPrimaryInstance([], {
    kind: "audio",
    shotId: "shot-1",
    relativePath: "media/audio/narration-shot-1.wav",
    trackId: "a1",
    startSec: 0,
    durationSec: 4,
    label: "旁白"
  });
  next = upsertPeeledSoundtrackInstance(next, {
    shotId: "shot-1",
    relativePath: "media/imports/clip-audio-1.m4a",
    trackId: "a2",
    startSec: 0,
    durationSec: 4,
    label: "原声"
  });
  next = upsertPrimaryInstance(next, {
    kind: "audio",
    shotId: "shot-1",
    relativePath: "media/audio/narration-shot-1-b.wav",
    trackId: "a1",
    startSec: 0,
    durationSec: 4,
    label: "旁白2"
  });
  const primary = next.find((item) => item.kind === "audio" && !isSecondaryClipInstanceId(item.id));
  const peel = next.find((item) => item.id.includes("-peel"));
  assert.equal(primary?.relativePath, "media/audio/narration-shot-1-b.wav");
  assert.equal(peel?.relativePath, "media/imports/clip-audio-1.m4a");
  assert.equal(peel?.trackId, "a2");
});

test("reconcile and peel keep-if-present never reshuffle user placement", () => {
  const arranged = [
    {
      id: "video-user-1",
      kind: "video" as const,
      shotId: "shot-1",
      relativePath: "media/clips/old.mp4",
      trackId: "v2",
      startSec: 12.5,
      durationSec: 3.2,
      inSec: 0.5,
      outSec: 3.7,
      label: "镜 1"
    },
    {
      id: "audio-user-1-peel",
      kind: "audio" as const,
      shotId: "shot-1",
      relativePath: "media/imports/old-audio.m4a",
      trackId: "a3",
      startSec: 12.5,
      durationSec: 3.2,
      volume: 0.4,
      volumeKeyframes: [{ t: 0, v: 0.2 }, { t: 1, v: 0.8 }],
      label: "原声"
    }
  ];

  const reconciled = reconcileClipInstancesWithShots(
    arranged,
    [{
      id: "shot-1",
      title: "镜 1",
      line: "",
      prompt: "",
      clip: "media/clips/new-silent.mp4",
      ready: true,
      transition: "cut"
    }],
    { "shot-1": { offsetSec: 0, videoTrackId: "v1", audioTrackId: "a1", inSec: 0, outSec: 4 } }
  );

  const video = reconciled.find((item) => item.kind === "video");
  assert.equal(video?.trackId, "v2");
  assert.equal(video?.startSec, 12.5);
  assert.equal(video?.durationSec, 3.2);
  assert.equal(video?.relativePath, "media/clips/new-silent.mp4");

  const peeled = upsertPeeledSoundtrackInstance(reconciled, {
    shotId: "shot-1",
    relativePath: "media/imports/new-audio.m4a",
    trackId: "a2",
    startSec: 0,
    durationSec: 99,
    label: "原声"
  });
  const peel = peeled.find((item) => String(item.id).includes("-peel"));
  assert.equal(peel?.trackId, "a3");
  assert.equal(peel?.startSec, 12.5);
  assert.equal(peel?.durationSec, 3.2);
  assert.equal(peel?.relativePath, "media/imports/new-audio.m4a");
  assert.equal(peel?.volume, 0.4);
  assert.equal(hasPeeledSoundtrackForShot(peeled, "shot-1"), true);
});

test("intentional replace placement still moves primary clip", () => {
  const current = upsertPrimaryInstance([], {
    kind: "video",
    shotId: "shot-1",
    relativePath: "media/clips/a.mp4",
    trackId: "v1",
    startSec: 0,
    durationSec: 4
  });
  const moved = upsertPrimaryInstance(current, {
    kind: "video",
    shotId: "shot-1",
    relativePath: "media/clips/a.mp4",
    trackId: "v2",
    startSec: 8,
    durationSec: 4,
    placement: "replace"
  });
  assert.equal(moved[0]?.trackId, "v2");
  assert.equal(moved[0]?.startSec, 8);
});

test("reconcile does not invent V↔旁白 linkGroupId", () => {
  const reconciled = reconcileClipInstancesWithShots(
    [],
    [{
      id: "shot-1",
      title: "镜 1",
      line: "旁白",
      prompt: "",
      clip: "media/clips/a.mp4",
      audio: "media/audio/n.wav",
      ready: true,
      transition: "cut"
    }],
    { "shot-1": { offsetSec: 0, videoTrackId: "v1", audioTrackId: "a1", inSec: 0, outSec: 4 } }
  );
  const video = reconciled.find((item) => item.kind === "video");
  const audio = reconciled.find((item) => item.kind === "audio");
  assert.equal(video?.linkGroupId, undefined);
  assert.equal(audio?.linkGroupId, undefined);
});

test("peel linkGroupId survives reconcile path update", () => {
  const linked = [
    {
      id: "video-1",
      kind: "video" as const,
      shotId: "shot-1",
      relativePath: "media/imports/old-video.mp4",
      trackId: "v1",
      startSec: 2,
      durationSec: 4,
      linkGroupId: "peel-shot-1"
    },
    {
      id: "audio-1-peel",
      kind: "audio" as const,
      shotId: "shot-1",
      relativePath: "media/imports/old-audio.m4a",
      trackId: "a2",
      startSec: 2,
      durationSec: 4,
      linkGroupId: "peel-shot-1"
    }
  ];
  const reconciled = reconcileClipInstancesWithShots(
    linked,
    [{
      id: "shot-1",
      title: "镜 1",
      line: "",
      prompt: "",
      clip: "media/imports/new-video.mp4",
      ready: true,
      transition: "cut"
    }],
    {}
  );
  const video = reconciled.find((item) => item.kind === "video");
  const peel = reconciled.find((item) => String(item.id).includes("-peel"));
  assert.equal(video?.linkGroupId, "peel-shot-1");
  assert.equal(peel?.linkGroupId, "peel-shot-1");
});

test("unlink and relink V + peel soundtrack", () => {
  let next = [
    {
      id: "video-1",
      kind: "video" as const,
      shotId: "shot-1",
      relativePath: "media/imports/v.mp4",
      trackId: "v1",
      startSec: 1,
      durationSec: 4,
      linkGroupId: "peel-1"
    },
    {
      id: "audio-1-peel",
      kind: "audio" as const,
      shotId: "shot-1",
      relativePath: "media/imports/a.m4a",
      trackId: "a2",
      startSec: 1,
      durationSec: 4,
      linkGroupId: "peel-1"
    },
    {
      id: "audio-narration",
      kind: "audio" as const,
      shotId: "shot-1",
      relativePath: "media/audio/n.wav",
      trackId: "a1",
      startSec: 1,
      durationSec: 4
    }
  ];
  assert.equal(isLinkedClipGroup(next, "video-1"), true);
  const broken = unlinkClipGroup(next, "video-1");
  assert.equal(broken.cleared, 2);
  assert.equal(broken.next.every((item) => !item.linkGroupId || item.id === "audio-narration"), true);
  assert.equal(findRelinkCandidate(broken.next, "video-1")?.id, "audio-1-peel");
  assert.equal(findRelinkCandidate(broken.next, "video-1", { allowNarration: true })?.id, "audio-1-peel");
  const relinked = relinkAvInstances(broken.next, "video-1");
  assert.ok(relinked.linkGroupId);
  assert.equal(isLinkedClipGroup(relinked.next, "video-1"), true);
  const video = relinked.next.find((item) => item.id === "video-1");
  const peel = relinked.next.find((item) => item.id === "audio-1-peel");
  const narration = relinked.next.find((item) => item.id === "audio-narration");
  assert.equal(video?.linkGroupId, peel?.linkGroupId);
  assert.equal(narration?.linkGroupId, undefined);
});
