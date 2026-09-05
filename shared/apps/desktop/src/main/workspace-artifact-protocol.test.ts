import assert from "node:assert/strict";
import test from "node:test";

const {
  ARTIFACT_PROTOCOL_HOST,
  ARTIFACT_PROTOCOL_SCHEME,
  buildWorkspaceArtifactPreviewUrl,
  isHtmlArtifactExtension,
  isHtmlArtifactPath,
  isImageArtifactExtension,
  isImageArtifactPath,
  isVideoArtifactExtension,
  isVideoArtifactPath,
  mimeTypeForArtifactPath,
  parseWorkspaceArtifactPreviewUrl
} = await import(new URL("./workspace-artifact-protocol.js", import.meta.url).href);

test("recognizes HTML artifact paths and extensions", () => {
  assert.equal(isHtmlArtifactPath("outputs/吉祥物-旺财动画狗.html"), true);
  assert.equal(isHtmlArtifactPath("page.HTM"), true);
  assert.equal(isHtmlArtifactPath("report.pdf"), false);
  assert.equal(isHtmlArtifactExtension(".html"), true);
  assert.equal(isHtmlArtifactExtension(".HTM"), true);
  assert.equal(isHtmlArtifactExtension(".docx"), false);
});

test("recognizes image and video artifact paths", () => {
  assert.equal(isImageArtifactPath("outputs/shot.PNG"), true);
  assert.equal(isImageArtifactExtension(".webp"), true);
  assert.equal(isVideoArtifactPath("outputs/demo.mp4"), true);
  assert.equal(isVideoArtifactExtension(".webm"), true);
  assert.equal(isVideoArtifactPath("outputs/demo.txt"), false);
});

test("recognizes audio artifact paths, extensions, and name hints", async () => {
  const {
    firstAudioArtifactExtension,
    isAudioArtifactCandidate,
    isAudioArtifactExtension,
    isAudioArtifactPath
  } = await import(new URL("./workspace-artifact-protocol.js", import.meta.url).href);
  assert.equal(isAudioArtifactPath("outputs/track.mp3"), true);
  assert.equal(isAudioArtifactPath("outputs/score.mid"), true);
  assert.equal(isAudioArtifactExtension(".midi"), true);
  assert.equal(isAudioArtifactCandidate("files/import-1", "song.flac"), true);
  assert.equal(firstAudioArtifactExtension("files/import-1", "media/demo.wav"), ".wav");
});

test("builds and parses workspace-scoped artifact preview URLs", () => {
  const url = buildWorkspaceArtifactPreviewUrl("ws-1", "outputs\\吉祥物-旺财动画狗.html");
  assert.equal(
    url,
    `${ARTIFACT_PROTOCOL_SCHEME}://${ARTIFACT_PROTOCOL_HOST}/ws-1/outputs/${encodeURIComponent("吉祥物-旺财动画狗.html")}`
  );
  assert.deepEqual(parseWorkspaceArtifactPreviewUrl(url), {
    workspaceId: "ws-1",
    relativePath: "outputs/吉祥物-旺财动画狗.html"
  });
});

test("rejects traversal and foreign hosts in artifact protocol URLs", () => {
  assert.equal(
    parseWorkspaceArtifactPreviewUrl(`${ARTIFACT_PROTOCOL_SCHEME}://evil/ws-1/a.html`),
    null
  );
  assert.equal(
    parseWorkspaceArtifactPreviewUrl(`${ARTIFACT_PROTOCOL_SCHEME}://${ARTIFACT_PROTOCOL_HOST}/ws-1/../secret.txt`),
    null
  );
  assert.equal(
    parseWorkspaceArtifactPreviewUrl(`${ARTIFACT_PROTOCOL_SCHEME}://${ARTIFACT_PROTOCOL_HOST}/ws-1/`),
    null
  );
  assert.equal(
    parseWorkspaceArtifactPreviewUrl("https://example.com/outputs/a.html"),
    null
  );
});

test("maps common HTML sibling asset MIME types", () => {
  assert.equal(mimeTypeForArtifactPath("a.html"), "text/html; charset=utf-8");
  assert.equal(mimeTypeForArtifactPath("style.css"), "text/css; charset=utf-8");
  assert.equal(mimeTypeForArtifactPath("app.js"), "text/javascript; charset=utf-8");
  assert.equal(mimeTypeForArtifactPath("dog.png"), "image/png");
  assert.equal(mimeTypeForArtifactPath("clip.mp4"), "video/mp4");
  assert.equal(mimeTypeForArtifactPath("clip.mov"), "video/quicktime");
  assert.equal(mimeTypeForArtifactPath("unknown.bin"), "application/octet-stream");
});

test("sniffs mp3 bytes mislabeled as .wav for preview protocol", async () => {
  const {
    resolveArtifactMimeType,
    sniffAudioMimeFromBytes
  } = await import(new URL("./workspace-artifact-protocol.js", import.meta.url).href);
  const id3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  assert.equal(sniffAudioMimeFromBytes(id3), "audio/mpeg");
  assert.equal(resolveArtifactMimeType("media/audio/narration-shot-1.wav", id3), "audio/mpeg");
  const frame = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00]);
  assert.equal(resolveArtifactMimeType("media/audio/narration.wav", frame), "audio/mpeg");
  const wav = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00,
    0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20
  ]);
  assert.equal(resolveArtifactMimeType("media/audio/clip.mp3", wav), "audio/wav");
  assert.equal(resolveArtifactMimeType("media/audio/real.wav", wav), "audio/wav");
});

test("parses byte range headers for artifact streaming", async () => {
  const { parseByteRangeHeader, artifactProtocolResponseHeaders } = await import(
    new URL("./workspace-artifact-protocol.js", import.meta.url).href
  );
  assert.deepEqual(parseByteRangeHeader("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseByteRangeHeader("bytes=500-", 1000), { start: 500, end: 999 });
  assert.deepEqual(parseByteRangeHeader("bytes=-128", 1000), { start: 872, end: 999 });
  assert.equal(parseByteRangeHeader("bytes=1000-", 1000), null);
  assert.equal(parseByteRangeHeader("invalid", 1000), null);
  assert.equal(artifactProtocolResponseHeaders("video/mp4")["Accept-Ranges"], "bytes");
});
