import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ToolRegistry, createBuiltinToolRegistry, normalizeWindowsShellCommand } from "./tool-registry.js";

test("registry exposes model-safe descriptors without handlers", () => {
  const registry = createBuiltinToolRegistry();
  const descriptors = registry.list();
  const names = descriptors.map((tool) => tool.name);
  for (const required of [
    "workspace.scan",
    "workspace.glob",
    "workspace.grep",
    "workspace.search",
    "workspace.read",
    "workspace.edit",
    "workspace.apply_patch",
    "workspace.write_file",
    "artifact.create",
    "document.create_pdf",
    "document.create_docx",
    "artifact.inspect",
    "spreadsheet.inspect",
    "spreadsheet.analyze",
    "spreadsheet.update",
    "git.status",
    "shell.exec",
    "shell.process",
    "read",
    "glob",
    "grep",
    "edit",
    "write",
    "apply_patch",
    "exec",
    "process"
  ]) {
    assert.ok(names.includes(required), `missing tool ${required}`);
  }
  assert.equal("execute" in descriptors[0], false);
  assert.equal(registry.get("workspace.read").requiresApproval, false);
  assert.equal(registry.get("workspace.read").replaySafe, true);
  assert.equal(registry.get("shell.exec").requiresApproval, true);
  assert.deepEqual(registry.get("shell.exec").inputSchema.required, ["command"]);
  assert.equal(registry.get("read").canonicalName, "workspace.read");
  assert.equal(registry.get("glob").canonicalName, "workspace.glob");
  assert.equal(registry.get("grep").canonicalName, "workspace.grep");
});

test("shell execution preserves stdout and stderr as structured fields", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-shell-output-"));
  try {
    const registry = createBuiltinToolRegistry();
    const command = process.platform === "win32"
      ? "Write-Output 'visible stdout'; [Console]::Error.WriteLine('visible stderr')"
      : "printf 'visible stdout'; printf 'visible stderr' >&2";
    const result = await registry.invoke("shell.exec", { command }, { workspacePath: root, shellEnv: process.env });
    assert.equal(result.ok, true);
    assert.match(result.stdout, /visible stdout/);
    assert.match(result.stderr, /visible stderr/);
    assert.match(result.output, /visible stdout/);
    assert.match(result.output, /visible stderr/);
    assert.equal(typeof result.durationMs, "number");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Windows shell input follows the Codex single-shell contract", async () => {
  assert.equal(
    normalizeWindowsShellCommand('powershell -NoProfile -Command "Write-Output \'single shell\'"'),
    "Write-Output 'single shell'"
  );
  assert.equal(
    normalizeWindowsShellCommand('powershell -Command "python -c \'print(\\"ok\\")\' 2>&1"'),
    'python -c \'print("ok")\' 2>&1'
  );
  assert.equal(normalizeWindowsShellCommand("Write-Output 'already direct'"), "Write-Output 'already direct'");
  assert.equal(
    normalizeWindowsShellCommand("New-Item -ItemType Directory -Force data && Set-Content a.txt hi"),
    "New-Item -ItemType Directory -Force data ; Set-Content a.txt hi"
  );
  assert.equal(
    normalizeWindowsShellCommand('Write-Output "keep && inside"'),
    'Write-Output "keep && inside"'
  );
  if (process.platform !== "win32") return;
  const root = mkdtempSync(join(tmpdir(), "newbrain-single-shell-"));
  try {
    const result = await createBuiltinToolRegistry().invoke("shell.exec", {
      command: 'powershell -Command "Write-Output \'single shell\'"'
    }, { workspacePath: root, shellEnv: process.env });
    assert.equal(result.ok, true);
    assert.equal(result.command, "Write-Output 'single shell'");
    assert.match(result.stdout, /single shell/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shell execution bounds large visible output with head-tail truncation", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-shell-truncation-"));
  try {
    const registry = createBuiltinToolRegistry();
    const command = process.platform === "win32"
      ? "[Console]::Out.Write(('H' * 200000) + ('M' * 100000) + ('T' * 80000))"
      : "python3 -c \"import sys; sys.stdout.write('H'*200000+'M'*100000+'T'*80000)\"";
    const result = await registry.invoke("shell.exec", { command }, { workspacePath: root, shellEnv: process.env });
    assert.equal(result.ok, true);
    assert.equal(result.outputTruncated, true);
    assert.equal(result.originalOutputBytes, 380000);
    assert.match(String(result.stdout), /^H+/);
    assert.match(String(result.stdout), /T+/);
    assert.match(String(result.stdout), /输出过大，已保留开头与结尾/);
    assert.ok(Buffer.byteLength(result.stdout, "utf8") < 380000);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspace.search ignores venv/node_modules and respects max hits", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-search-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "app.py"), "def hello():\n    return 'needle-value'\n");
    mkdirSync(join(root, "venv", "lib"), { recursive: true });
    writeFileSync(join(root, "venv", "lib", "hidden.py"), "needle-value should be ignored\n");
    mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(root, "node_modules", "pkg", "index.js"), "needle-value ignored\n");
    mkdirSync(join(root, "target"), { recursive: true });
    writeFileSync(join(root, "target", "x.txt"), "needle-value ignored\n");
    const result = await createBuiltinToolRegistry().invoke("workspace.search", {
      query: "needle-value",
      maxHits: 10
    }, { workspacePath: root, shellEnv: {} });
    assert.equal(result.ok, true);
    assert.equal(result.hits.length, 1);
    assert.equal(result.hits[0].path, "src/app.py");
    assert.match(result.hits[0].preview, /needle-value/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspace.glob finds files by pattern and namePattern under a subpath", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-search-glob-"));
  try {
    mkdirSync(join(root, "python-platform", "src", "auth"), { recursive: true });
    mkdirSync(join(root, "python-platform", "src", "billing"), { recursive: true });
    writeFileSync(join(root, "python-platform", "src", "auth", "user_service.py"), "# auth\n");
    writeFileSync(join(root, "python-platform", "src", "auth", "security.py"), "# security\n");
    writeFileSync(join(root, "python-platform", "src", "billing", "invoice.py"), "# billing\n");
    mkdirSync(join(root, "python-platform", "src", "venv", "lib"), { recursive: true });
    writeFileSync(join(root, "python-platform", "src", "venv", "lib", "user_hidden.py"), "# hidden\n");

    const result = await createBuiltinToolRegistry().invoke("workspace.glob", {
      path: "python-platform/src",
      pattern: "**/*.py",
      namePattern: "auth|user|security"
    }, { workspacePath: root, shellEnv: {} });
    assert.equal(result.ok, true);
    assert.equal(result.paths.length, 2);
    const paths = result.paths.sort();
    assert.deepEqual(paths, [
      "python-platform/src/auth/security.py",
      "python-platform/src/auth/user_service.py"
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspace.search treats query with wildcards as filename glob", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-search-wildcard-"));
  try {
    mkdirSync(join(root, "pkg"), { recursive: true });
    writeFileSync(join(root, "pkg", "auth_handler.py"), "pass\n");
    writeFileSync(join(root, "pkg", "billing.py"), "pass\n");
    const result = await createBuiltinToolRegistry().invoke("workspace.search", {
      query: "*auth*.py"
    }, { workspacePath: root, shellEnv: {} });
    assert.equal(result.ok, true);
    assert.equal(result.hits.length, 1);
    assert.equal(result.hits[0].path, "pkg/auth_handler.py");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shell.exec allows scoped filtered recursive PowerShell listing", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-shell-allow-"));
  try {
    mkdirSync(join(root, "python-platform", "src"), { recursive: true });
    writeFileSync(join(root, "python-platform", "src", "auth.py"), "x\n");
    const result = await createBuiltinToolRegistry().invoke("shell.exec", {
      command: 'Get-ChildItem -Path "python-platform\\src" -Recurse -Filter "*.py" | Select-Object -ExpandProperty FullName'
    }, { workspacePath: root, shellEnv: process.env });
    assert.notEqual(result.guarded, "unbounded_recursive_search");
    if (process.platform === "win32") {
      assert.match(String(result.output || result.stdout), /auth\.py/i);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspace.write_file coerces in-workspace absolute paths and rejects escapes", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-write-abs-"));
  try {
    const registry = createBuiltinToolRegistry();
    const absoluteInside = join(root, "outputs", "note.html");
    const written = await registry.invoke("workspace.write_file", {
      targetPath: absoluteInside,
      content: "<!DOCTYPE html><html></html>\n"
    }, { workspacePath: root, shellEnv: {} });
    assert.equal(written.ok, true);
    assert.equal(written.artifact.path, "outputs/note.html");
    assert.match(String(written.output), /outputs\/note\.html/);

    const escaped = await registry.invoke("workspace.write_file", {
      targetPath: join(root, "..", "escape.txt"),
      content: "nope"
    }, { workspacePath: root, shellEnv: {} });
    assert.equal(escaped.ok, false);
    assert.match(String(escaped.output), /inside the attached workspace|outside/i);
    assert.match(String(escaped.next_action || escaped.output), /workspace\.write_file|relative/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shell.exec rejects whole-file write fallbacks with next_action", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-shell-write-guard-"));
  try {
    const registry = createBuiltinToolRegistry();
    const setContent = await registry.invoke("shell.exec", {
      command: "Set-Content -Path outputs/a.html -Value '<html/>'"
    }, { workspacePath: root, shellEnv: {} });
    assert.equal(setContent.ok, false);
    assert.equal(setContent.guarded, "shell_whole_file_write");
    assert.match(String(setContent.output), /workspace\.write_file/);
    assert.match(String(setContent.next_action || ""), /workspace\.write_file/);

    const heredoc = await registry.invoke("shell.exec", {
      command: "cat <<'EOF' > outputs/b.html\n<html/>\nEOF"
    }, { workspacePath: root, shellEnv: {} });
    assert.equal(heredoc.ok, false);
    assert.equal(heredoc.guarded, "shell_whole_file_write");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("writes multiline files without shell quoting and inspects real PNG metadata", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-artifacts-"));
  try {
    const registry = createBuiltinToolRegistry();
    const script = "first line\nsecond 'quoted' line\n";
    const written = await registry.invoke("workspace.write_file", {
      targetPath: "scripts/example.py",
      content: script,
      encoding: "utf8"
    }, { workspacePath: root, shellEnv: {} });
    assert.equal(written.ok, true);
    assert.match(written.output, /scripts\/example\.py/);
    assert.equal(written.artifact.changeType, "created");
    const rewritten = await registry.invoke("workspace.write_file", {
      targetPath: "scripts/example.py",
      content: `${script}third line\n`,
      encoding: "utf8"
    }, { workspacePath: root, shellEnv: {} });
    assert.equal(rewritten.artifact.changeType, "modified");

    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png, 0);
    png.writeUInt32BE(512, 16);
    png.writeUInt32BE(256, 20);
    writeFileSync(join(root, "output.png"), png);
    const inspected = await registry.invoke("artifact.inspect", { targetPath: "output.png" }, { workspacePath: root });
    assert.equal(inspected.ok, true);
    assert.deepEqual(inspected.artifact, { path: "output.png", size: 24, type: "image/png", width: 512, height: 256 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspace file tools reject traversal outside the attached workspace", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-artifact-boundary-"));
  try {
    const registry = createBuiltinToolRegistry();
    const result = await registry.invoke("workspace.write_file", {
      targetPath: "../escape.txt",
      content: "blocked"
    }, { workspacePath: root });
    assert.equal(result.ok, false);
    assert.match(result.output, /inside the attached workspace/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("registry rejects duplicates and normalizes execution failures", async () => {
  const registry = new ToolRegistry().register({ name: "failure", execute: async () => { throw new Error("boom"); } });
  assert.throws(() => registry.register({ name: "failure", execute: async () => ({ ok: true }) }), /already registered/);
  const result = await registry.invoke("failure", {}, {});
  assert.equal(result.ok, false);
  assert.match(result.output, /boom/);
});

test("workspace scan stays scoped and ignores generated directories", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-tools-"));
  try {
    writeFileSync(join(root, "visible.txt"), "ok");
    mkdirSync(join(root, ".newbrain", "skills"), { recursive: true });
    writeFileSync(join(root, ".newbrain", "skills", "internal.md"), "hidden");
    const registry = createBuiltinToolRegistry();
    const result = await registry.invoke("workspace.scan", {}, { workspacePath: root, shellEnv: {} });
    assert.equal(result.ok, true);
    assert.deepEqual(result.workspace.map((entry) => entry.path), ["visible.txt"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("office artifacts are always written to the project outputs directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-tools-"));
  try {
    const registry = createBuiltinToolRegistry();
    const result = await registry.invoke("artifact.create", {
      targetPath: ".newbrain/skills/project-manager/report.docx",
      format: "docx",
      title: "Report",
      content: "Project output"
    }, { workspacePath: root });
    assert.equal(result.ok, true);
    assert.equal(result.artifact.path, "outputs/report.docx");
    assert.equal(existsSync(join(root, "outputs", "report.docx")), true);
    assert.equal(existsSync(join(root, ".newbrain", "skills", "project-manager", "report.docx")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("replaces and removes dynamically registered namespace tools", async () => {
  const registry = new ToolRegistry();
  registry.register({ name: "mcp__a", namespace: "mcp:a", external: true, execute: async () => ({ ok: true, output: "one" }) });
  registry.register({ name: "mcp__a", namespace: "mcp:a", external: true, execute: async () => ({ ok: true, output: "two" }) }, { replace: true });
  assert.equal((await registry.invoke("mcp__a", {}, {})).output, "two");
  assert.deepEqual(registry.unregisterWhere((tool) => tool.namespace === "mcp:a"), ["mcp__a"]);
  assert.equal(registry.get("mcp__a"), undefined);
});
