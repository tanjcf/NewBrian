import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  clampAnnotationRect,
  expandAnnotationCaptureRect,
  resolveAnnotationSnapshotPreview
} from "./document-annotation-snapshot.ts";

test("clamps mark rect inside the preview viewport", () => {
  assert.deepEqual(clampAnnotationRect(
    { x: -10, y: 20, width: 500, height: 80 },
    { width: 400, height: 300 }
  ), { x: 0, y: 20, width: 400, height: 80 });
});

test("expands the mark with padding while staying inside the viewport", () => {
  assert.deepEqual(expandAnnotationCaptureRect(
    { x: 40, y: 50, width: 80, height: 60 },
    { width: 400, height: 300 },
    20
  ), { x: 20, y: 30, width: 120, height: 100 });
  assert.deepEqual(expandAnnotationCaptureRect(
    { x: 5, y: 5, width: 40, height: 30 },
    { width: 100, height: 80 },
    20
  ), { x: 0, y: 0, width: 65, height: 55 });
});

test("snapshot capture burns the mark overlay into the PNG", () => {
  const source = readFileSync(new URL("./document-annotation-snapshot.ts", import.meta.url), "utf8");
  assert.match(source, /export function drawAnnotationMarkOnCanvas/);
  assert.match(source, /export function expandAnnotationCaptureRect/);
  assert.match(source, /finishAnnotatedCanvas/);
  assert.match(source, /mark\?: AnnotationMarkOverlay/);
  assert.match(source, /tool === "highlight"/);
  assert.match(source, /setLineDash/);
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
