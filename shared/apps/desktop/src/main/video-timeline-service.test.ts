import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BrainWorkspaceStorage } from "./brain-workspace-storage.ts";
import { VideoTimelineService } from "./video-timeline-service.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "brain-video-timeline-"));
  const storage = new BrainWorkspaceStorage(root);
  const project = storage.createProject({ ownerId: "owner-a", name: "视频项目", primaryWorkspaceKey: "video" });
  return { root, storage, project };
}

test("creates a durable timeline and keeps clips ordered by track and start time", () => {
  const { root, storage, project } = fixture();
  try {
    const service = new VideoTimelineService(storage);
    const created = service.ensureTimeline("owner-a", project.id, { title: "宣传片", width: 1920, height: 1080, fps: 30 });
    assert.equal(created.durationMs, 0);
    service.addClip("owner-a", project.id, { trackType: "audio", sourceFileId: "file-a", startMs: 900, durationMs: 500, sourceInMs: 0, volume: 0.8 });
    service.addClip("owner-a", project.id, { trackType: "video", sourceFileId: "file-v", startMs: 0, durationMs: 2_000, sourceInMs: 100 });
    service.addClip("owner-a", project.id, { trackType: "subtitle", sourceFileId: "file-s", startMs: 500, durationMs: 800, sourceInMs: 0, text: "开场" });
    const timeline = service.getTimeline("owner-a", project.id);
    assert.equal(timeline.title, "宣传片");
    assert.equal(timeline.durationMs, 2_000);
    assert.deepEqual(timeline.clips.map((clip) => [clip.trackType, clip.startMs]), [["video", 0], ["subtitle", 500], ["audio", 900]]);
  } finally { storage.close(); rmSync(root, { recursive: true, force: true }); }
});

test("rejects invalid clips and foreign projects", () => {
  const { root, storage, project } = fixture();
  try {
    const service = new VideoTimelineService(storage);
    service.ensureTimeline("owner-a", project.id, { title: "片段", width: 1280, height: 720, fps: 25 });
    assert.throws(() => service.addClip("owner-a", project.id, { trackType: "video", sourceFileId: "file", startMs: -1, durationMs: 100, sourceInMs: 0 }), (error: any) => error?.code === "BRAIN_VIDEO_CLIP_INVALID");
    assert.throws(
      () => service.getTimeline("owner-b", project.id),
      (error: any) => error?.code === "BRAIN_PROJECT_FORBIDDEN"
    );
  } finally { storage.close(); rmSync(root, { recursive: true, force: true }); }
});
