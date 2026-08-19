import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { BrainDocumentRevisionService } from "./brain-document-revision-service.ts";
import { BrainWorkspaceStorage } from "./brain-workspace-storage.ts";

function sha(content: string) {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
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
