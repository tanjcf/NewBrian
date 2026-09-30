import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DocumentChangeSetService } from "./document-change-set-service.ts";

test("previews a bounded text change without writing either file", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-change-set-"));
  try {
    const path = join(root, "notes.md");
    await writeFile(path, "旧标题\n正文", "utf8");
    const result = await new DocumentChangeSetService().previewText({
      projectRoot: root,
      relativePath: "notes.md",
      currentFileVersion: 1,
      allowedRange: { start: 0, end: 3 },
      changeSet: { status: "PROPOSED", baseFileVersion: 1, diffJson: JSON.stringify({ operations: [{ start: 0, end: 3, replacement: "新标题" }] }) }
    });
    assert.equal(result.before, "旧标题\n正文");
    assert.equal(result.after, "新标题\n正文");
    assert.equal(await readFile(path, "utf8"), "旧标题\n正文");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("exports an accepted text change as a new verified revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-change-set-"));
  try {
    const source = join(root, "notes.md");
    await writeFile(source, "旧标题\n正文", "utf8");
    const result = await new DocumentChangeSetService().exportTextRevision({
      projectRoot: root,
      relativePath: "notes.md",
      outputRelativePath: "notes.v2.md",
      currentFileVersion: 1,
      allowedRange: { start: 0, end: 3 },
      changeSet: { status: "ACCEPTED", baseFileVersion: 1, diffJson: JSON.stringify({ operations: [{ start: 0, end: 3, replacement: "新标题" }] }) }
    });
    assert.equal(await readFile(source, "utf8"), "旧标题\n正文");
    assert.equal(await readFile(join(root, "notes.v2.md"), "utf8"), "新标题\n正文");
    assert.equal(result.fileVersion, 2);
    assert.match(result.contentHash, /^sha256:/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects out-of-anchor, stale, mismatched, overwrite, and non-text changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-change-set-"));
  try {
    await writeFile(join(root, "notes.md"), "内容", "utf8");
    const service = new DocumentChangeSetService();
    const base = { projectRoot: root, relativePath: "notes.md", currentFileVersion: 1, allowedRange: { start: 0, end: 2 }, changeSet: { status: "PROPOSED" as const, baseFileVersion: 1, diffJson: JSON.stringify({ operations: [{ start: 0, end: 2, replacement: "新" }] }) } };
    await assert.rejects(service.previewText({ ...base, allowedRange: { start: 1, end: 2 } }), /OUTSIDE_ANNOTATION/);
    await assert.rejects(service.previewText({ ...base, changeSet: { ...base.changeSet, baseFileVersion: 2 } }), /VERSION_CONFLICT/);
    await assert.rejects(service.previewText({ ...base, expectedContentHash: "sha256:wrong" }), /CONTENT_CONFLICT/);
    await writeFile(join(root, "notes.pdf"), "内容", "utf8");
    await assert.rejects(service.previewText({ ...base, relativePath: "notes.pdf" }), /FORMAT_UNSUPPORTED/);
    await assert.rejects(service.exportTextRevision({ ...base, outputRelativePath: "notes.v2.md" }), /NOT_ACCEPTED/);
    await writeFile(join(root, "notes.v2.md"), "已有文件", "utf8");
    await assert.rejects(service.exportTextRevision({ ...base, outputRelativePath: "notes.v2.md", changeSet: { ...base.changeSet, status: "ACCEPTED" } }), /OUTPUT_EXISTS/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
