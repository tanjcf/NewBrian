import assert from "node:assert/strict";
import test from "node:test";
import { clampAnnotationRect, resolveAnnotationSnapshotPreview } from "./document-annotation-snapshot.ts";

test("clamps mark rect inside the preview viewport", () => {
  assert.deepEqual(clampAnnotationRect(
    { x: -10, y: 20, width: 500, height: 80 },
    { width: 400, height: 300 }
  ), { x: 0, y: 20, width: 400, height: 80 });
});

test("resolves snapshot preview url preferring snapshotUrl", () => {
  assert.equal(resolveAnnotationSnapshotPreview({
    snapshotPath: "C:/tmp/a.png",
    snapshotUrl: "data:image/png;base64,abc"
  }), "data:image/png;base64,abc");
  assert.equal(resolveAnnotationSnapshotPreview({
    snapshotPath: "newbrain-attachment://media/a.png"
  }), "newbrain-attachment://media/a.png");
  assert.equal(resolveAnnotationSnapshotPreview({
    snapshotPath: "C:/tmp/a.png"
  }), "");
});
