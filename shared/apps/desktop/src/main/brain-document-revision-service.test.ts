import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { BrainDocumentRevisionService } from "./brain-document-revision-service.ts";
import { BrainWorkspaceStorage } from "./brain-workspace-storage.ts";

function sha(content: string) {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

async function docxFixture() {
  const zip = new JSZip();
  zip.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>原始文本</w:t></w:r></w:p></w:body></w:document>');
  return zip.generateAsync({ type: "nodebuffer" });
}

async function xlsxFixture() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("数据");
  sheet.getCell("B2").value = "旧值";
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test("previews an annotation-bounded change and exports an accepted new version", async () => {
  const root = mkdtempSync(join(tmpdir(), "brain-revision-"));
  const workspace = join(root, "workspace");
  const data = join(root, "data");
  mkdirSync(join(workspace, "files"), { recursive: true });
  const source = "标题\r\n需要修改的正文\r\n结尾";
  writeFileSync(join(workspace, "files", "note.md"), source, "utf8");
  const storage = new BrainWorkspaceStorage(data);
  try {
    const project = storage.createProject({ ownerId: "owner-a", name: "文档", primaryWorkspaceKey: "document", localWorkspaceId: "local-1" });
    const file = storage.registerFile({ ownerId: "owner-a", projectId: project.id, logicalName: "note.md", mimeType: "text/markdown", sizeBytes: Buffer.byteLength(source), contentHash: sha(source), storageKey: "files/note.md" });
    const annotation = storage.createAnnotation({
      ownerId: "owner-a", projectId: project.id, fileId: file.id, fileVersion: 1, instruction: "替换正文",
      anchor: { anchorId: "line-2", objectId: "line-2", format: "markdown", locator: { kind: "text-range", startLine: 2, endLine: 2, startCharacter: 0, endCharacter: 7 }, selectedText: "需要修改的正文" }
    });
    const changeSet = storage.createChangeSet({
      ownerId: "owner-a", projectId: project.id, annotationId: annotation.id, baseFileVersion: 1,
      changeSummary: "替换正文", diffJson: JSON.stringify({ operations: [{ start: 4, end: 11, replacement: "已经修改的正文" }] })
    });
    const service = new BrainDocumentRevisionService({ storage, resolveWorkspaceRoot: async (id) => {
      assert.equal(id, "local-1");
      return workspace;
    } });
    const preview = await service.preview("owner-a", project.id, changeSet.id);
    assert.equal(preview.before, source);
    assert.match(preview.after, /已经修改的正文/);
    assert.equal(readFileSync(join(workspace, "files", "note.md"), "utf8"), source);
    storage.updateChangeSet({ ownerId: "owner-a", projectId: project.id, changeSetId: changeSet.id, status: "ACCEPTED" });
    const exported = await service.export("owner-a", project.id, changeSet.id);
    assert.equal(exported.file.versionNo, 2);
    assert.equal(exported.changeSet.resultFileVersion, 2);
    assert.equal(readFileSync(join(workspace, "files", "note.v2.md"), "utf8"), preview.after);
    await assert.rejects(() => service.export("owner-a", project.id, changeSet.id), /VERSION_CONFLICT|OUTPUT_EXISTS/);
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects unbound projects, foreign owners, stale hashes, and out-of-anchor changes", async () => {
  const root = mkdtempSync(join(tmpdir(), "brain-revision-deny-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace, { recursive: true });
  const source = "abcdef";
  writeFileSync(join(workspace, "note.txt"), source, "utf8");
  const storage = new BrainWorkspaceStorage(join(root, "data"));
  try {
    const project = storage.createProject({ ownerId: "owner-a", name: "文档", primaryWorkspaceKey: "document", localWorkspaceId: "local-1" });
    const file = storage.registerFile({ ownerId: "owner-a", projectId: project.id, logicalName: "note.txt", mimeType: "text/plain", sizeBytes: 6, contentHash: sha(source), storageKey: "note.txt" });
    const annotation = storage.createAnnotation({ ownerId: "owner-a", projectId: project.id, fileId: file.id, fileVersion: 1, instruction: "改中间", anchor: { anchorId: "range", objectId: "range", format: "txt", locator: { kind: "text-range", startLine: 1, endLine: 1, startCharacter: 1, endCharacter: 3 } } });
    const changeSet = storage.createChangeSet({ ownerId: "owner-a", projectId: project.id, annotationId: annotation.id, baseFileVersion: 1, changeSummary: "越界", diffJson: JSON.stringify({ start: 0, end: 1, replacement: "Z" }) });
    const service = new BrainDocumentRevisionService({ storage, resolveWorkspaceRoot: async () => workspace });
    await assert.rejects(
      () => service.preview("owner-b", project.id, changeSet.id),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "BRAIN_PROJECT_FORBIDDEN")
    );
    await assert.rejects(() => service.preview("owner-a", project.id, changeSet.id), /OUTSIDE_ANNOTATION/);
    storage.updateProject({ ownerId: "owner-a", projectId: project.id, localWorkspaceId: "" });
    await assert.rejects(() => service.preview("owner-a", project.id, changeSet.id), /LOCAL_WORKSPACE_REQUIRED/);
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("exports a structured DOCX paragraph change as a versioned file", async () => {
  const root = mkdtempSync(join(tmpdir(), "brain-docx-revision-"));
  const workspace = join(root, "workspace");
  mkdirSync(join(workspace, "files"), { recursive: true });
  const source = await docxFixture();
  writeFileSync(join(workspace, "files", "note.docx"), source);
  const storage = new BrainWorkspaceStorage(join(root, "data"));
  try {
    const project = storage.createProject({ ownerId: "owner-a", name: "文档", primaryWorkspaceKey: "document", localWorkspaceId: "local-1" });
    const file = storage.registerFile({ ownerId: "owner-a", projectId: project.id, logicalName: "note.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sizeBytes: source.byteLength, contentHash: `sha256:${createHash("sha256").update(source).digest("hex")}`, storageKey: "files/note.docx" });
    const annotation = storage.createAnnotation({ ownerId: "owner-a", projectId: project.id, fileId: file.id, fileVersion: 1, instruction: "替换段落", anchor: { anchorId: "p-0", objectId: "p-0", format: "docx", locator: { kind: "docx-object", objectType: "paragraph", paragraphIndex: 0, textRange: { start: 0, end: 4 } }, selectedText: "原始文本" } });
    const changeSet = storage.createChangeSet({ ownerId: "owner-a", projectId: project.id, annotationId: annotation.id, baseFileVersion: 1, changeSummary: "替换段落", diffJson: JSON.stringify({ format: "docx", paragraphIndex: 0, start: 2, end: 4, replacement: "修改" }) });
    const service = new BrainDocumentRevisionService({ storage, resolveWorkspaceRoot: async () => workspace });
    const exported = await service.export("owner-a", project.id, changeSet.id);
    assert.equal(exported.file.versionNo, 2);
    assert.equal(exported.changeSet.status, "ACCEPTED");
    const output = await JSZip.loadAsync(readFileSync(join(workspace, "files", "note.v2.docx")));
    const xml = await output.file("word/document.xml")!.async("string");
    assert.match(xml, /原始修改/);
    assert.equal(exported.file.contentHash, `sha256:${createHash("sha256").update(readFileSync(join(workspace, "files", "note.v2.docx"))).digest("hex")}`);
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("exports a structured XLSX cell change as a versioned file", async () => {
  const root = mkdtempSync(join(tmpdir(), "brain-xlsx-revision-"));
  const workspace = join(root, "workspace");
  mkdirSync(join(workspace, "files"), { recursive: true });
  const source = await xlsxFixture();
  writeFileSync(join(workspace, "files", "sheet.xlsx"), source);
  const storage = new BrainWorkspaceStorage(join(root, "data"));
  try {
    const project = storage.createProject({ ownerId: "owner-a", name: "数据", primaryWorkspaceKey: "data", localWorkspaceId: "local-1" });
    const file = storage.registerFile({ ownerId: "owner-a", projectId: project.id, logicalName: "sheet.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: source.byteLength, contentHash: `sha256:${createHash("sha256").update(source).digest("hex")}`, storageKey: "files/sheet.xlsx" });
    const annotation = storage.createAnnotation({ ownerId: "owner-a", projectId: project.id, fileId: file.id, fileVersion: 1, instruction: "替换单元格", anchor: { anchorId: "b2", objectId: "b2", format: "xlsx", sheet: "数据", range: "B2", locator: { kind: "xlsx-range", sheet: "数据", range: "B2" } } });
    const changeSet = storage.createChangeSet({ ownerId: "owner-a", projectId: project.id, annotationId: annotation.id, baseFileVersion: 1, changeSummary: "替换单元格", diffJson: JSON.stringify({ format: "xlsx", kind: "replace-cell", sheet: "数据", cell: "B2", value: "新值" }) });
    const service = new BrainDocumentRevisionService({ storage, resolveWorkspaceRoot: async () => workspace });
    const exported = await service.export("owner-a", project.id, changeSet.id);
    assert.equal(exported.file.versionNo, 2);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(join(workspace, "files", "sheet.v2.xlsx"));
    assert.equal(workbook.getWorksheet("数据")!.getCell("B2").value, "新值");
  } finally { storage.close(); rmSync(root, { recursive: true, force: true }); }
});
