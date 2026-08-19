import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DocumentChangeSetService } from "./document-change-set-service.ts";

test("applies an accepted text change atomically and returns the next version", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-change-set-"));
  try {
    const path = join(root, "notes.md");
    await writeFile(path, "旧标题\n正文", "utf8");
    const result = await new DocumentChangeSetService().applyText({
      projectRoot: root,
      relativePath: "notes.md",
      currentFileVersion: 1,
      changeSet: { status: "ACCEPTED", baseFileVersion: 1, diffJson: JSON.stringify({ operations: [{ start: 0, end: 3, replacement: "新标题" }] }) }
    });
    assert.equal(await readFile(path, "utf8"), "新标题\n正文");
    assert.equal(result.fileVersion, 2);
    assert.match(result.contentHash, /^sha256:/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects unreviewed, stale, mismatched, and non-text changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-change-set-"));
  try {
    await writeFile(join(root, "notes.md"), "内容", "utf8");
    const service = new DocumentChangeSetService();
    const base = { projectRoot: root, relativePath: "notes.md", currentFileVersion: 1, changeSet: { status: "PROPOSED" as const, baseFileVersion: 1, diffJson: "{}" } };
    await assert.rejects(service.applyText(base), /NOT_ACCEPTED/);
    await assert.rejects(service.applyText({ ...base, changeSet: { ...base.changeSet, status: "ACCEPTED", baseFileVersion: 2 } }), /VERSION_CONFLICT/);
    await assert.rejects(service.applyText({ ...base, expectedContentHash: "sha256:wrong", changeSet: { ...base.changeSet, status: "ACCEPTED" } }), /CONTENT_CONFLICT/);
    await writeFile(join(root, "notes.pdf"), "内容", "utf8");
    await assert.rejects(service.applyText({ ...base, relativePath: "notes.pdf", changeSet: { ...base.changeSet, status: "ACCEPTED" } }), /FORMAT_UNSUPPORTED/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
