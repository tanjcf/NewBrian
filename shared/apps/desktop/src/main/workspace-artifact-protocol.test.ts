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
