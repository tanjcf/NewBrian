import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BrainWorkspaceStorage } from "./brain-workspace-storage.ts";
import { MusicTimelineService } from "./music-timeline-service.ts";

test("persists music timeline and clips with owner isolation", () => {
  const root = mkdtempSync(join(tmpdir(), "brain-music-")); const storage = new BrainWorkspaceStorage(root);
  try {
    const project = storage.createProject({ ownerId: "a", name: "音乐", primaryWorkspaceKey: "music" }); const service = new MusicTimelineService(storage);
    service.ensureTimeline("a", project.id, { title: "配乐", sampleRate: 48_000, channels: 2 });
    service.addClip("a", project.id, { trackType: "audio", sourceFileId: "file-a", startMs: 0, durationMs: 2_000, sourceInMs: 0, gain: 1, pan: 0 });
    assert.equal(service.getTimeline("a", project.id).durationMs, 2_000);
    assert.throws(() => service.getTimeline("b", project.id), (error: any) => error?.code === "BRAIN_PROJECT_FORBIDDEN");
  } finally { storage.close(); rmSync(root, { recursive: true, force: true }); }
});
