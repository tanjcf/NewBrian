import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { MusicMediaService } from "./music-media-service.ts";

test("parses WAV with LIST chunk before data", async () => {
  const root = await mkdtemp(join(process.env.TEMP || ".", "brain-music-media-list-"));
  try {
    const wav = Buffer.alloc(80);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVE", 8);
    wav.write("fmt ", 12);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8_000, 24);
    wav.writeUInt32LE(16_000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("LIST", 36);
    wav.writeUInt32LE(4, 40);
    wav.write("INFO", 44);
    wav.write("data", 48);
    wav.writeUInt32LE(8, 52);
    wav.writeInt16LE(-16_384, 56);
    wav.writeInt16LE(16_384, 58);
    await writeFile(join(root, "listed.wav"), wav);
    const service = new MusicMediaService({ getProject: () => ({ primaryWorkspaceKey: "music", localWorkspaceId: "w1" }), getFile: () => ({ logicalName: "listed.wav", storageKey: "listed.wav" }) } as any, async () => root);
    const info = await service.inspect("owner", "project", "file");
    assert.equal(info.durationMs, 1);
    assert.ok(info.waveform.length >= 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recognizes compressed audio by storage key when logical name lacks extension", async () => {
  const root = await mkdtemp(join(process.env.TEMP || ".", "brain-music-media-ext-"));
  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(root, "media", "imports"), { recursive: true });
    await writeFile(join(root, "media", "imports", "song.mp3"), Buffer.from([0xff, 0xfb, 0x90, 0x00]));
    const service = new MusicMediaService(
      { getProject: () => ({ primaryWorkspaceKey: "music", localWorkspaceId: "w1" }), getFile: () => ({ logicalName: "用户上传歌曲", storageKey: "media/imports/song.mp3" }) } as any,
      async () => root,
      async () => ""
    );
    const info = await service.inspect("owner", "project", "file");
    assert.equal(info.kind, "audio");
    assert.ok(Array.isArray(info.warnings));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("parses bounded PCM waveform samples", async () => {
  const root = await mkdtemp(join(process.env.TEMP || ".", "brain-music-media-"));
  try {
    const wav = Buffer.alloc(44 + 8); wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVE", 8); wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8_000, 24); wav.writeUInt32LE(16_000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(8, 40); wav.writeInt16LE(-32768, 44); wav.writeInt16LE(32767, 46); await writeFile(join(root, "tone.wav"), wav);
    const service = new MusicMediaService({ getProject: () => ({ primaryWorkspaceKey: "music", localWorkspaceId: "w1" }), getFile: () => ({ logicalName: "tone.wav", storageKey: "tone.wav" }) } as any, async () => root);
    const info = await service.inspect("owner", "project", "file"); assert.equal(info.durationMs, 1); assert.deepEqual(info.waveform, [-1, 0.999969482421875, 0, 0]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
