import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { installBuiltinSkillFile } = await import(
  new URL("./builtin-skill-installer.ts", import.meta.url).href
);

test("upgrades a read-only builtin skill and leaves it writable", async () => {
  const root = await mkdtemp(join(tmpdir(), "newbrain-builtin-skill-"));
  const source = join(root, "source.md");
  const destination = join(root, "skills", "error-auto-remediation", "SKILL.md");

  try {
    await writeFile(source, "new skill\n", "utf8");
    await mkdir(join(root, "skills", "error-auto-remediation"), { recursive: true });
    await writeFile(destination, "old skill\n", "utf8");
    await chmod(destination, 0o444);

    await installBuiltinSkillFile(source, destination);

    assert.equal(await readFile(destination, "utf8"), "new skill\n");
    assert.notEqual((await stat(destination)).mode & 0o200, 0);
  } finally {
    await chmod(destination, 0o666).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
