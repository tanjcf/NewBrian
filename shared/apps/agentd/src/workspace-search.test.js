import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { globWorkspaceFiles, grepWorkspaceFiles } from "./workspace-search.js";
import { createBuiltinToolRegistry } from "./tool-registry.js";

test("workspace.glob finds **/*.py under a subdir with namePattern and ignores venv", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-glob-"));
  try {
    mkdirSync(join(root, "python-platform", "src", "auth"), { recursive: true });
    mkdirSync(join(root, "python-platform", "src", "billing"), { recursive: true });
    writeFileSync(join(root, "python-platform", "src", "auth", "user_service.py"), "# auth\n");
    writeFileSync(join(root, "python-platform", "src", "auth", "security.py"), "# security\n");
    writeFileSync(join(root, "python-platform", "src", "billing", "invoice.py"), "# billing\n");
    mkdirSync(join(root, "python-platform", "src", "venv", "lib"), { recursive: true });
    writeFileSync(join(root, "python-platform", "src", "venv", "lib", "user_hidden.py"), "# hidden\n");

    const result = await globWorkspaceFiles(root, {
      pattern: "**/*.py",
      searchPath: "python-platform/src",
      namePattern: "auth|user|security"
    });
    assert.deepEqual(result.paths.sort(), [
      "python-platform/src/auth/security.py",
      "python-platform/src/auth/user_service.py"
    ]);
    assert.equal(result.truncated, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspace.grep finds content with glob filter and ignores node_modules", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-grep-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "app.py"), "def authenticate():\n    return True\n");
    mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(root, "node_modules", "pkg", "index.js"), "authenticate should be ignored\n");
    const result = await grepWorkspaceFiles(root, {
      pattern: "authenticate",
      literal: true,
      glob: "*.py"
    });
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].path, "src/app.py");
    assert.match(result.matches[0].preview, /authenticate/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("registry exposes workspace.glob and workspace.grep tools", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-tools-glob-"));
  try {
    mkdirSync(join(root, "pkg"), { recursive: true });
    writeFileSync(join(root, "pkg", "auth.py"), "token = 1\n");
    const registry = createBuiltinToolRegistry();
    assert.deepEqual(
      registry.list().slice(0, 4).map((tool) => tool.name),
      ["workspace.scan", "workspace.glob", "workspace.grep", "workspace.search"]
    );
    const globbed = await registry.invoke("workspace.glob", {
      pattern: "**/*.py",
      namePattern: "auth"
    }, { workspacePath: root, shellEnv: {} });
    assert.equal(globbed.ok, true);
    assert.deepEqual(globbed.paths, ["pkg/auth.py"]);

    const grepped = await registry.invoke("workspace.grep", {
      pattern: "token",
      literal: true,
      glob: "*.py"
    }, { workspacePath: root, shellEnv: {} });
    assert.equal(grepped.ok, true);
    assert.match(grepped.output, /pkg\/auth\.py:1:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
