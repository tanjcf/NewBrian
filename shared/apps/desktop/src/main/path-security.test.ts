import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";

const { resolveExistingFileInsideRoot } = await import(
  new URL("./path-security.ts", import.meta.url).href
) as typeof import("./path-security.js");

test("resolves an existing file inside the project", async () => {
  const tempRoot = await fs.mkdtemp(join(os.tmpdir(), "codecn-path-"));
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
  const tempRoot = await fs.mkdtemp(join(os.tmpdir(), "codecn-path-"));
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
  const tempRoot = await fs.mkdtemp(join(os.tmpdir(), "codecn-path-"));
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
  const tempRoot = await fs.mkdtemp(join(os.tmpdir(), "codecn-path-"));
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
