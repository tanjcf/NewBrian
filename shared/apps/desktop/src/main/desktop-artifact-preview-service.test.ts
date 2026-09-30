import assert from "node:assert/strict";
import test from "node:test";

const { DesktopArtifactPreviewService } = await import(
  new URL("./desktop-artifact-preview-service.ts", import.meta.url).href
);

test("preserves a failed canonical render without reading the file", async () => {
  let resolved = false;
  const service = new DesktopArtifactPreviewService({
    renderBase: async () => ({ ok: false, detail: "invalid" }),
    resolveFile: async () => { resolved = true; throw new Error("unexpected"); },
    extractText: async () => ""
  });
  const result = await service.render({ targetPath: "report.pdf" });
  assert.equal(result.ok, false);
  assert.equal(resolved, false);
});

test("adds a bounded spreadsheet preview after canonical validation", async () => {
  const service = new DesktopArtifactPreviewService({
    renderBase: async () => ({ ok: true }),
    resolveFile: async () => ({ targetPath: "G:/repo/report.xlsx", relativePath: "report.xlsx" }),
    extractText: async () => "x".repeat(12_100)
  });
  const result = await service.render({ targetPath: "report.xlsx" });
  assert.equal(result.renderMode, "spreadsheet-text");
  assert.equal(result.previewTruncated, true);
  assert.equal(String(result.preview).length, 12_000);
});
