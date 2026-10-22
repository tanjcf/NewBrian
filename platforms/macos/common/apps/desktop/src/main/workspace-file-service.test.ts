import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";
const { WorkspaceFileService } = await import(new URL("./workspace-file-service.ts", import.meta.url).href);

async function withWorkspace(run: (root: string, service: InstanceType<typeof WorkspaceFileService>) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "newbrain-workspace-files-"));
  const resolveFile = async (workspaceRoot: string, target: string) => {
    const targetPath = resolve(workspaceRoot, target);
    const relativePath = relative(workspaceRoot, targetPath);
    if (!relativePath || relativePath.startsWith("..")) throw new Error("outside workspace");
    return { targetPath, relativePath };
  };
  const service = new WorkspaceFileService({ readWorkspaces: async () => [{ id: "w1", path: root }], resolveFile });
  try { await run(root, service); } finally { await rm(root, { recursive: true, force: true }); }
}

test("searches bounded workspace files while skipping generated directories", async () => {
  await withWorkspace(async (root, service) => {
    await writeFile(join(root, "source.ts"), "export const value = 1;", "utf8");
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "node_modules", "hidden.ts"), "hidden", "utf8");
    const results = await service.search(".ts");
    assert.deepEqual(results.map((item: { title: string }) => item.title), ["source.ts"]);
  });
});

test("reads bounded text and rejects a missing workspace", async () => {
  await withWorkspace(async (root, service) => {
    await writeFile(join(root, "notes.txt"), "hello", "utf8");
    assert.deepEqual(await service.read({ workspaceId: "w1", filePath: "notes.txt" }), {
      path: "notes.txt", name: "notes.txt", language: "txt", content: "hello", binary: false, truncated: false, size: 5
    });
    await assert.rejects(() => service.open({ workspaceId: "missing", filePath: "notes.txt" }), /not found/);
  });
});

test("resolves context-menu targets through the same workspace boundary", async () => {
  await withWorkspace(async (root, service) => {
    await writeFile(join(root, "artifact.txt"), "content", "utf8");
    const resolved = await service.resolve({ workspaceId: "w1", filePath: "artifact.txt" });
    assert.equal(resolved.targetPath, join(root, "artifact.txt"));
    await assert.rejects(() => service.resolve({ workspaceId: "w1", filePath: "../outside.txt" }), /outside workspace/);
  });
});

test("returns a bounded PDF payload for the embedded artifact viewer", async () => {
  await withWorkspace(async (root, service) => {
    const bytes = Buffer.from("%PDF-1.4\n%%EOF", "ascii");
    await writeFile(join(root, "report.pdf"), bytes);
    const preview = await service.preview({ workspaceId: "w1", filePath: "report.pdf" });
    assert.equal(preview.kind, "pdf");
    assert.equal(preview.path, "report.pdf");
    assert.equal(preview.size, bytes.length);
    assert.equal(preview.dataUrl, `data:application/pdf;base64,${bytes.toString("base64")}`);
  });
});

test("returns a bounded PPTX payload for the embedded artifact viewer", async () => {
  await withWorkspace(async (root, service) => {
    const bytes = Buffer.from("PK\u0003\u0004pptx", "binary");
    await writeFile(join(root, "slides.pptx"), bytes);
    const preview = await service.preview({ workspaceId: "w1", filePath: "slides.pptx" });
    assert.equal(preview.kind, "pptx");
    assert.equal(preview.path, "slides.pptx");
    assert.equal(preview.size, bytes.length);
    assert.equal(preview.dataUrl, `data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,${bytes.toString("base64")}`);
  });
});

test("returns an HTML preview URL and source for the embedded browser viewer", async () => {
  await withWorkspace(async (root, service) => {
    await mkdir(join(root, "outputs"));
    const html = "<!doctype html><html><body><h1>旺财</h1></body></html>";
    await writeFile(join(root, "outputs", "吉祥物-旺财动画狗.html"), html, "utf8");
    const preview = await service.preview({ workspaceId: "w1", filePath: "outputs/吉祥物-旺财动画狗.html" });
    assert.equal(preview.kind, "html");
    assert.equal(preview.path.replace(/\\/g, "/"), "outputs/吉祥物-旺财动画狗.html");
    assert.equal(preview.content, html);
    assert.equal(preview.mimeType, "text/html");
    assert.match(String(preview.previewUrl), /^newbrain-artifact:\/\/preview\/w1\/outputs\//);
  });
});

test("returns image, video, and audio preview URLs for the embedded media viewers", async () => {
  await withWorkspace(async (root, service) => {
    await mkdir(join(root, "outputs"));
    await mkdir(join(root, "media", "imports"), { recursive: true });
    await writeFile(join(root, "outputs", "shot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(join(root, "outputs", "clip.mp4"), Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]));
    await writeFile(join(root, "outputs", "track.mp3"), Buffer.from([0xff, 0xfb, 0x90, 0x00]));
    await writeFile(join(root, "media", "imports", "import-1"), Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00]));
    const image = await service.preview({ workspaceId: "w1", filePath: "outputs/shot.png" });
    assert.equal(image.kind, "image");
    assert.equal(image.mimeType, "image/png");
    assert.match(String(image.previewUrl), /^newbrain-artifact:\/\/preview\/w1\/outputs\/shot\.png$/);
    const video = await service.preview({ workspaceId: "w1", filePath: "outputs/clip.mp4" });
    assert.equal(video.kind, "video");
    assert.equal(video.mimeType, "video/mp4");
    assert.match(String(video.previewUrl), /^newbrain-artifact:\/\/preview\/w1\/outputs\/clip\.mp4$/);
    const audio = await service.preview({ workspaceId: "w1", filePath: "outputs/track.mp3" });
    assert.equal(audio.kind, "audio");
    assert.equal(audio.mimeType, "audio/mpeg");
    assert.match(String(audio.previewUrl), /^newbrain-artifact:\/\/preview\/w1\/outputs\/track\.mp3$/);
    const sniffed = await service.preview({ workspaceId: "w1", filePath: "media/imports/import-1" });
    assert.equal(sniffed.kind, "audio");
    assert.equal(sniffed.mimeType, "audio/mpeg");
    assert.match(String(sniffed.previewUrl), /^newbrain-artifact:\/\/preview\/w1\/media\/imports\/import-1$/);
  });
});

test("returns spreadsheet previews for CSV and XLSX files", async () => {
  await withWorkspace(async (root, service) => {
    await writeFile(join(root, "table.csv"), "name,value\nAlpha,1\n", "utf8");
    const csv = await service.preview({ workspaceId: "w1", filePath: "table.csv" });
    assert.equal(csv.kind, "spreadsheet");
    assert.deepEqual(csv.sheets[0].headers, ["name", "value"]);
    assert.deepEqual(csv.sheets[0].rows, [["Alpha", "1"]]);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Metrics");
    sheet.addRow(["Metric", "Value"]);
    sheet.addRow(["Passed", "yes"]);
    await workbook.xlsx.writeFile(join(root, "model.xlsx"));
    const xlsx = await service.preview({ workspaceId: "w1", filePath: "model.xlsx" });
    assert.equal(xlsx.kind, "spreadsheet");
    assert.equal(xlsx.sheets[0].name, "Metrics");
    assert.deepEqual(xlsx.sheets[0].headers, ["Metric", "Value"]);
    assert.deepEqual(xlsx.sheets[0].rows, [["Passed", "yes"]]);
  });
});

test("rejects unsupported and out-of-workspace artifact previews", async () => {
  await withWorkspace(async (root, service) => {
    await writeFile(join(root, "notes.txt"), "not an artifact", "utf8");
    const unsupported = await service.preview({ workspaceId: "w1", filePath: "notes.txt" });
    assert.equal(unsupported.ok, false);
    assert.match(String(unsupported.error), /不支持文档侧栏预览/);
    const escaped = await service.preview({ workspaceId: "w1", filePath: "../outside.pdf" });
    assert.equal(escaped.ok, false);
    assert.match(String(escaped.error), /outside workspace/);
  });
});
