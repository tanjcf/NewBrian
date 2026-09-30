import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { runGitUtf8 } = await import(new URL("./git-command.ts", import.meta.url).href) as typeof import("./git-command.js");

test("git status preserves Chinese paths instead of octal quoting", (t) => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-git-path-"));
  try {
    if (runGitUtf8(root, ["init"]).status !== 0) {
      t.skip("Git is unavailable on this host.");
      return;
    }
    const chineseFileName = "\u4e2d\u6587\u6587\u4ef6.txt";
    writeFileSync(join(root, chineseFileName), "content", "utf8");
    const result = runGitUtf8(root, ["status", "--porcelain"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, new RegExp(chineseFileName.replace(".", "\\.")));
    assert.doesNotMatch(result.stdout, /\\[0-7]{3}/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
