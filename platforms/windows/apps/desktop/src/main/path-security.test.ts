import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";

const { previewPathFallbacks, resolveExistingFileInsideRoot } = await import(
  new URL("./path-security.ts", import.meta.url).href
) as typeof import("./path-security.js");

test("resolves an existing file inside the project", async () => {
  const tempRoot = await fs.mkdtemp(join(os.tmpdir(), "newbrain-path-"));
  try {
    const projectRoot = join(tempRoot, "project");
    await fs.mkdir(projectRoot);
    await fs.writeFile(join(projectRoot, "inside.txt"), "safe", "utf8");

    const result = await resolveExistingFileInsideRoot(projectRoot, "inside.txt");
    assert.equal(result.relativePath, "inside.txt");
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("rejects lexical traversal outside the project", async () => {
  const tempRoot = await fs.mkdtemp(join(os.tmpdir(), "newbrain-path-"));
  try {
    const projectRoot = join(tempRoot, "project");
    await fs.mkdir(projectRoot);
    await fs.writeFile(join(tempRoot, "outside.txt"), "secret", "utf8");

    await assert.rejects(
      resolveExistingFileInsideRoot(projectRoot, "../outside.txt"),
      /inside the selected project/
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("rejects a directory link that escapes the project", async (t) => {
  const tempRoot = await fs.mkdtemp(join(os.tmpdir(), "newbrain-path-"));
  try {
    const projectRoot = join(tempRoot, "project");
    const outsideRoot = join(tempRoot, "outside");
    await fs.mkdir(projectRoot);
    await fs.mkdir(outsideRoot);
    await fs.writeFile(join(outsideRoot, "secret.txt"), "secret", "utf8");
    try {
      await fs.symlink(outsideRoot, join(projectRoot, "linked"), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        t.skip("Creating links is not permitted on this host.");
        return;
      }
      throw error;
    }

    await assert.rejects(
      resolveExistingFileInsideRoot(projectRoot, join("linked", "secret.txt")),
      /inside the selected project/
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("reports a clear Chinese error when the preview target is missing", async () => {
  const tempRoot = await fs.mkdtemp(join(os.tmpdir(), "newbrain-path-"));
  try {
    const projectRoot = join(tempRoot, "project");
    await fs.mkdir(projectRoot);
    await assert.rejects(
      resolveExistingFileInsideRoot(projectRoot, "outputs/missing.pdf"),
      /文件不存在，无法预览/
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("falls back to outputs/ when a generated artifact is opened by basename", async () => {
  const tempRoot = await fs.mkdtemp(join(os.tmpdir(), "newbrain-path-"));
  try {
    const projectRoot = join(tempRoot, "project");
    await fs.mkdir(join(projectRoot, "outputs"), { recursive: true });
    await fs.writeFile(join(projectRoot, "outputs", "龟途-第1章.md"), "# ok", "utf8");

    assert.deepEqual(previewPathFallbacks("龟途-第1章.md"), [
      "outputs/龟途-第1章.md",
      "files/龟途-第1章.md",
      "artifacts/龟途-第1章.md",
      "docs/龟途-第1章.md",
      "notes/龟途-第1章.md",
      ".newbrain/generated-media/image/龟途-第1章.md",
      ".newbrain/generated-media/video/龟途-第1章.md",
      ".newbrain/generated-media/music/龟途-第1章.md"
    ]);
    assert.ok(previewPathFallbacks("outputs/龟途-第1章.md").includes("龟途-第1章.md"));

    const result = await resolveExistingFileInsideRoot(projectRoot, "龟途-第1章.md");
    assert.equal(result.relativePath.replace(/\\/g, "/"), "outputs/龟途-第1章.md");
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("resolves Auto generated media under .newbrain/generated-media by basename", async () => {
  const tempRoot = await fs.mkdtemp(join(os.tmpdir(), "newbrain-path-media-"));
  try {
    const projectRoot = join(tempRoot, "project");
    const mediaDir = join(projectRoot, ".newbrain", "generated-media", "image");
    await fs.mkdir(mediaDir, { recursive: true });
    await fs.writeFile(join(mediaDir, "1788353897888-1-3f78b4f83c.png"), "png", "utf8");

    const byRelative = await resolveExistingFileInsideRoot(
      projectRoot,
      ".newbrain/generated-media/image/1788353897888-1-3f78b4f83c.png"
    );
    assert.equal(
      byRelative.relativePath.replace(/\\/g, "/"),
      ".newbrain/generated-media/image/1788353897888-1-3f78b4f83c.png"
    );

    const byBasename = await resolveExistingFileInsideRoot(projectRoot, "1788353897888-1-3f78b4f83c.png");
    assert.equal(
      byBasename.relativePath.replace(/\\/g, "/"),
      ".newbrain/generated-media/image/1788353897888-1-3f78b4f83c.png"
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("finds explore-style notes by basename under nested folders", async () => {
  const tempRoot = await fs.mkdtemp(join(os.tmpdir(), "newbrain-path-"));
  try {
    const projectRoot = join(tempRoot, "project");
    await fs.mkdir(join(projectRoot, "notes", "e2e"), { recursive: true });
    await fs.writeFile(join(projectRoot, "notes", "e2e", "explore-e2e-note-1787639474072.txt"), "场景学习探索E2E验收", "utf8");

    const result = await resolveExistingFileInsideRoot(projectRoot, "explore-e2e-note-1787639474072.txt");
    assert.equal(result.relativePath.replace(/\\/g, "/"), "notes/e2e/explore-e2e-note-1787639474072.txt");
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("uses a generic missing-file hint for plain text notes", async () => {
  const tempRoot = await fs.mkdtemp(join(os.tmpdir(), "newbrain-path-"));
  try {
    const projectRoot = join(tempRoot, "project");
    await fs.mkdir(projectRoot);
    await assert.rejects(
      resolveExistingFileInsideRoot(projectRoot, "explore-e2e-note.txt"),
      /请确认文件已写入当前项目目录后重试/
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
