import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  applyWorkspacePatch,
  editWorkspaceFile,
  parsePatchText,
  readWorkspaceFile,
  resolveSafeWorkspacePath
} from "./workspace-fs.js";
import { createBuiltinToolRegistry } from "./tool-registry.js";

function withTempWorkspace(run) {
  const root = mkdtempSync(join(tmpdir(), "newbrain-workspace-fs-"));
  return Promise.resolve()
    .then(() => run(root))
    .finally(() => rmSync(root, { recursive: true, force: true }));
}

test("resolveSafeWorkspacePath rejects escape and allows in-workspace absolute", async () => {
  await withTempWorkspace(async (root) => {
    await assert.rejects(
      () => resolveSafeWorkspacePath(root, "../outside.txt"),
      /must stay inside/
    );
    const inside = join(root, "ok.txt");
    writeFileSync(inside, "x");
    const resolved = await resolveSafeWorkspacePath(root, inside);
    assert.equal(resolved.relativePath, "ok.txt");
  });
});

test("workspace.read supports offset/limit and truncation metadata", async () => {
  await withTempWorkspace(async (root) => {
    const lines = Array.from({ length: 40 }, (_, i) => `line-${i + 1}`);
    writeFileSync(join(root, "notes.txt"), `${lines.join("\n")}\n`, "utf8");
    const windowed = await readWorkspaceFile(root, { path: "notes.txt", offset: 5, limit: 3 });
    assert.equal(windowed.ok, true);
    assert.match(windowed.content, /5\|line-5/);
    assert.match(windowed.content, /7\|line-7/);
    assert.doesNotMatch(windowed.content, /line-8/);

    const huge = `${"A".repeat(20)}\n`.repeat(3000);
    writeFileSync(join(root, "huge.txt"), huge, "utf8");
    const truncated = await readWorkspaceFile(root, { path: "huge.txt", limit: 50 });
    assert.equal(truncated.ok, true);
    assert.equal(truncated.kind, "truncated");
    assert.equal(truncated.truncation?.truncatedBy, "lines");
    assert.ok(truncated.content.includes("1|"));
    assert.match(truncated.content, /truncated by lines/);
  });
});

test("workspace.edit requires unique oldText and preserves CRLF", async () => {
  await withTempWorkspace(async (root) => {
    writeFileSync(join(root, "app.js"), "const a = 1;\r\nconst b = 1;\r\n", "utf8");
    const ok = await editWorkspaceFile(root, {
      path: "app.js",
      edits: [{ oldText: "const a = 1;", newText: "const a = 2;" }]
    });
    assert.equal(ok.changed, true);
    assert.match(ok.diff, /const a = 2/);
    assert.equal(readFileSync(join(root, "app.js"), "utf8"), "const a = 2;\r\nconst b = 1;\r\n");

    let duplicateError = null;
    try {
      await editWorkspaceFile(root, {
        path: "app.js",
        edits: [{ oldText: "const", newText: "let" }]
      });
    } catch (error) {
      duplicateError = error;
    }
    assert.ok(duplicateError, "expected duplicate oldText to fail");
    assert.match(String(duplicateError.message), /occurrences|unique/i);

    let missingError = null;
    try {
      await editWorkspaceFile(root, {
        path: "app.js",
        oldText: "missing-token-xyz",
        newText: "nope"
      });
    } catch (error) {
      missingError = error;
    }
    assert.ok(missingError, "expected missing oldText to fail");
    assert.match(String(missingError.message), /Could not find the exact text/);
  });
});

test("workspace.apply_patch supports Add+Update and rejects bad hunks", async () => {
  await withTempWorkspace(async (root) => {
    writeFileSync(join(root, "existing.js"), "export const value = 1;\n", "utf8");
    const patch = [
      "*** Begin Patch",
      "*** Add File: created.js",
      "+export const created = true;",
      "*** Update File: existing.js",
      "@@",
      "-export const value = 1;",
      "+export const value = 2;",
      "*** End Patch"
    ].join("\n");
    const result = await applyWorkspacePatch(root, patch);
    assert.deepEqual(result.summary.added, ["created.js"]);
    assert.deepEqual(result.summary.modified, ["existing.js"]);
    assert.equal(readFileSync(join(root, "created.js"), "utf8"), "export const created = true;\n");
    assert.equal(readFileSync(join(root, "existing.js"), "utf8"), "export const value = 2;\n");

    assert.throws(() => parsePatchText("not a patch"), /Begin Patch/);
    await assert.rejects(
      () => applyWorkspacePatch(root, [
        "*** Begin Patch",
        "*** Update File: existing.js",
        "@@",
        "-export const value = 999;",
        "+export const value = 3;",
        "*** End Patch"
      ].join("\n")),
      /Failed to find expected lines/
    );
  });
});

test("tool registry aliases invoke canonical file tools", async () => {
  await withTempWorkspace(async (root) => {
    mkdirSync(join(root, ".newbrain", "skills", "demo"), { recursive: true });
    writeFileSync(
      join(root, ".newbrain", "skills", "demo", "SKILL.md"),
      "---\nname: demo\ndescription: demo skill\n---\n\n# Demo Skill\n",
      "utf8"
    );
    const registry = createBuiltinToolRegistry();
    const viaAlias = await registry.invoke("read", {
      path: ".newbrain/skills/demo/SKILL.md",
      limit: 20
    }, { workspacePath: root, shellEnv: process.env });
    assert.equal(viaAlias.ok, true);
    assert.match(viaAlias.content, /Demo Skill/);

    const edited = await registry.invoke("edit", {
      path: ".newbrain/skills/demo/SKILL.md",
      edits: [{ oldText: "# Demo Skill", newText: "# Demo Skill Updated" }]
    }, { workspacePath: root, shellEnv: process.env });
    assert.equal(edited.ok, true);
    assert.match(readFileSync(join(root, ".newbrain", "skills", "demo", "SKILL.md"), "utf8"), /Updated/);

    const names = registry.list().map((tool) => tool.name);
    assert.ok(names.includes("workspace.read"));
    assert.ok(names.includes("workspace.edit"));
    assert.ok(names.includes("workspace.apply_patch"));
    assert.ok(names.includes("read"));
    assert.ok(names.includes("edit"));
    assert.ok(names.includes("apply_patch"));
    assert.ok(existsSync(join(root, ".newbrain", "skills", "demo", "SKILL.md")));
  });
});
