import assert from "node:assert/strict";
import test from "node:test";

const {
  assertWorkspaceMediaKind,
  buildWorkspaceMediaOpenPayload,
  detectWorkspaceMediaKind,
  isWorkspaceImagePath,
  isWorkspaceVideoPath
} = await import(new URL("./workspace-media-tools.ts", import.meta.url).href);

test("detects supported image and video extensions", () => {
  assert.equal(isWorkspaceImagePath("outputs/chart.PNG"), true);
  assert.equal(isWorkspaceImagePath("outputs/chart.txt"), false);
  assert.equal(isWorkspaceVideoPath("outputs/demo.mp4"), true);
  assert.equal(isWorkspaceVideoPath("outputs/demo.webm"), true);
  assert.equal(detectWorkspaceMediaKind("a/b/c.webp"), "image");
  assert.equal(detectWorkspaceMediaKind("clip.mov"), "video");
  assert.equal(detectWorkspaceMediaKind("notes.md"), null);
});

test("rejects empty paths and wrong media kinds", () => {
  assert.throws(() => assertWorkspaceMediaKind("", "image"), /required/i);
  assert.throws(() => assertWorkspaceMediaKind("outputs/demo.mp4", "image"), /not a supported workspace image/i);
  assert.throws(() => assertWorkspaceMediaKind("outputs/shot.png", "video"), /not a supported workspace video/i);
  assert.equal(assertWorkspaceMediaKind("outputs/shot.jpeg", "image"), "outputs/shot.jpeg");
});

test("builds a side-panel open payload with artifact protocol URL", () => {
  const payload = buildWorkspaceMediaOpenPayload({
    workspaceId: "w1",
    relativePath: "outputs\\旺财.png",
    kind: "image",
    size: 12
  });
  assert.equal(payload.ok, true);
  assert.equal(payload.kind, "image");
  assert.equal(payload.path, "outputs/旺财.png");
  assert.equal(payload.mimeType, "image/png");
  assert.equal(payload.size, 12);
  assert.equal(payload.openedInSidePanel, true);
  assert.match(payload.previewUrl, /^newbrain-artifact:\/\/preview\/w1\/outputs\//);
});
