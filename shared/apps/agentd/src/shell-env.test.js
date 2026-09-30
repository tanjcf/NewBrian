import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  discoverManagedEnginePathEntries,
  enrichShellEnvForTools,
  formatMissingHostToolGuidance,
  formatUnboundedRecursiveSearchGuidance,
  guardShellWholeFileWrite,
  guardUnboundedRecursiveSearch,
  mergePathEntries,
  readPathFromEnv,
  writePathToEnv
} from "./shell-env.js";
import { createBuiltinToolRegistry } from "./tool-registry.js";

test("collapses Windows Path/PATH duplicates and preserves original user path", () => {
  const broken = {
    Path: "C:\\Users\\test\\AppData\\Local\\Programs\\Python\\Python312;C:\\Windows\\System32",
    PATH: "C:\\conda\\env;C:\\conda\\Scripts",
    LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
    USERPROFILE: "C:\\Users\\test"
  };
  const enriched = enrichShellEnvForTools(broken, { processEnv: { Path: "C:\\orphan" } });
  const pathKeys = Object.keys(enriched).filter((key) => key.toLowerCase() === "path");
  assert.equal(pathKeys.length, 1);
  assert.equal(pathKeys[0], process.platform === "win32" ? "Path" : "PATH");
  const pathValue = readPathFromEnv(enriched);
  assert.match(pathValue, /Python312/i);
  assert.match(pathValue, /conda\\env/i);
  assert.doesNotMatch(pathValue, /^C:\\conda\\env$/);
});

test("writePathToEnv removes duplicate path keys", () => {
  const next = writePathToEnv({ Path: "a", PATH: "b", FOO: "1" }, "c;d");
  assert.equal(Object.keys(next).filter((key) => key.toLowerCase() === "path").length, 1);
  assert.equal(readPathFromEnv(next), "c;d");
  assert.equal(next.FOO, "1");
});

test("mergePathEntries dedupes case-insensitively on Windows", () => {
  const merged = mergePathEntries("C:\\Tools;C:\\Windows", "c:\\tools;C:\\Extra");
  if (process.platform === "win32") {
    assert.equal(merged.toLowerCase(), "c:\\tools;c:\\windows;c:\\extra");
  } else {
    assert.ok(merged.includes("C:\\Tools"));
  }
});

test("missing python guidance is Chinese and actionable", () => {
  const guidance = formatMissingHostToolGuidance(
    "python --version",
    "python : The term 'python' is not recognized as the name of a cmdlet"
  );
  assert.ok(guidance);
  assert.match(guidance, /PATH/);
  assert.match(guidance, /Python/);
  assert.match(guidance, /重启 NewBrain/);
});

test("guards unbounded recursive shell searches", () => {
  const blocked = guardUnboundedRecursiveSearch("Get-ChildItem -Recurse");
  assert.equal(blocked?.ok, false);
  assert.match(String(blocked?.output), /递归检索/);
  assert.match(String(blocked?.output), /workspace\.glob|workspace\.grep/);

  const blockedDot = guardUnboundedRecursiveSearch('Get-ChildItem -Path . -Recurse');
  assert.equal(blockedDot?.ok, false);

  const blockedRoot = guardUnboundedRecursiveSearch('Get-ChildItem -Path "C:\\" -Recurse');
  assert.equal(blockedRoot?.ok, false);

  assert.equal(guardUnboundedRecursiveSearch("Get-ChildItem -Recurse -Depth 3"), null);
  assert.equal(guardUnboundedRecursiveSearch("Get-ChildItem -Recurse -Depth 8"), null);
  assert.equal(guardUnboundedRecursiveSearch("Get-ChildItem -Recurse -Depth 12")?.ok, false);

  const userStyle =
    'Get-ChildItem -Path "python-platform\\src" -Recurse -Filter "*.py" | Where-Object { $_.Name -match "auth|user|security" } | Select-Object -ExpandProperty FullName';
  assert.equal(guardUnboundedRecursiveSearch(userStyle), null);

  const scopedInclude =
    'Get-ChildItem -Path src -Recurse -Include *.ts,*.tsx -File';
  assert.equal(guardUnboundedRecursiveSearch(scopedInclude), null);

  const filterOnlyBroad = 'Get-ChildItem -Recurse -Filter "*.py"';
  assert.equal(guardUnboundedRecursiveSearch(filterOnlyBroad)?.ok, false);

  assert.equal(guardUnboundedRecursiveSearch("python -m uvicorn app:app"), null);

  assert.equal(guardUnboundedRecursiveSearch("grep -r foo .")?.ok, false);
  assert.equal(guardUnboundedRecursiveSearch("grep -R pattern")?.ok, false);
  assert.equal(guardUnboundedRecursiveSearch("grep -r pattern src"), null);
  assert.equal(guardUnboundedRecursiveSearch("Select-String -Pattern foo -Recurse")?.ok, false);
  assert.equal(guardUnboundedRecursiveSearch('Select-String -Path src -Pattern foo -Recurse'), null);
  assert.equal(guardUnboundedRecursiveSearch("find . -maxdepth 3 -type f"), null);
});

test("recursive search guidance mentions built-in workspace tools on every platform", () => {
  const win = formatUnboundedRecursiveSearchGuidance("win32");
  const mac = formatUnboundedRecursiveSearchGuidance("darwin");
  assert.match(win, /workspace\.glob|workspace\.grep/);
  assert.match(mac, /workspace\.glob|workspace\.grep/);
  assert.match(win, /glob \/ grep/);
  assert.match(win, /Get-ChildItem/);
  assert.match(mac, /grep -r/);
});

test("shell.exec recovers python when Path was wiped by PATH overwrite", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows PATH inheritance regression");
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "newbrain-shell-path-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const brokenEnv = {
    Path: "C:\\Windows\\System32",
    PATH: "C:\\Windows\\System32",
    LOCALAPPDATA: process.env.LOCALAPPDATA || "",
    USERPROFILE: process.env.USERPROFILE || "",
    SystemRoot: process.env.SystemRoot || "C:\\Windows",
    ComSpec: process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe"
  };
  const result = await createBuiltinToolRegistry().invoke("shell.exec", {
    command: "python --version"
  }, { workspacePath: root, shellEnv: brokenEnv });
  assert.equal(result.ok, true, result.output);
  assert.match(String(result.stdout || result.output), /Python/i);
});

test("workspace.scan ignores venv/__pycache__ and reports truncation softly", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-scan-cap-"));
  try {
    writeFileSync(join(root, "app.py"), "print(1)\n");
    mkdirSync(join(root, "venv", "lib"), { recursive: true });
    writeFileSync(join(root, "venv", "lib", "hidden.py"), "x");
    mkdirSync(join(root, ".venv", "lib"), { recursive: true });
    writeFileSync(join(root, ".venv", "lib", "hidden2.py"), "x");
    mkdirSync(join(root, "__pycache__"), { recursive: true });
    writeFileSync(join(root, "__pycache__", "app.cpython.pyc"), "x");
    const result = await createBuiltinToolRegistry().invoke("workspace.scan", {}, {
      workspacePath: root,
      shellEnv: {}
    });
    assert.equal(result.ok, true);
    const paths = result.workspace.map((entry) => entry.path);
    assert.deepEqual(paths, ["app.py"]);
    assert.equal(paths.some((path) => path.includes("venv")), false);
    assert.equal(paths.some((path) => path.includes("__pycache__")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shell.exec rejects unbounded recursive PowerShell searches", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-shell-guard-"));
  try {
    const result = await createBuiltinToolRegistry().invoke("shell.exec", {
      command: "Get-ChildItem -Recurse"
    }, { workspacePath: root, shellEnv: {} });
    assert.equal(result.ok, false);
    assert.match(String(result.output), /递归检索/);
    assert.equal(result.guarded, "unbounded_recursive_search");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("guardShellWholeFileWrite blocks PowerShell and Bash write patterns", () => {
  assert.equal(guardShellWholeFileWrite("Get-ChildItem .") , null);
  assert.equal(guardShellWholeFileWrite("python app.py") , null);
  assert.equal(guardShellWholeFileWrite("Set-Content a.txt hi")?.guarded, "shell_whole_file_write");
  assert.equal(guardShellWholeFileWrite("Out-File -FilePath a.txt")?.guarded, "shell_whole_file_write");
  assert.equal(guardShellWholeFileWrite("cat <<EOF > a.txt\nx\nEOF")?.guarded, "shell_whole_file_write");
  assert.match(String(guardShellWholeFileWrite("Add-Content a.txt x")?.next_action), /workspace\.write_file/);
});

test("shell.exec appends Chinese missing-tool guidance on command-not-found", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-shell-guidance-"));
  try {
    // Force a python-shaped CommandNotFound failure so guidance wiring is tested
    // even when host Python is present on the real process PATH.
    const result = await createBuiltinToolRegistry().invoke("shell.exec", {
      command: "Write-Output \"python : The term 'python' is not recognized as the name of a cmdlet\"; exit 1"
    }, { workspacePath: root, shellEnv: process.env });
    assert.equal(result.ok, false);
    assert.match(String(result.output), /未能在当前工具宿主 PATH/);
    assert.match(String(result.output), /重启 NewBrain/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepends managed engine bins when BRAIN_MANAGED_ENGINES_ROOT is set", () => {
  const root = mkdtempSync(join(tmpdir(), "brain-managed-engines-"));
  try {
    const ffmpegBin = join(root, "ffmpeg", "bin");
    mkdirSync(ffmpegBin, { recursive: true });
    writeFileSync(join(ffmpegBin, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"), "");
    const enriched = enrichShellEnvForTools({}, {
      managedEnginesRoot: root,
      processEnv: { Path: "C:\\base" }
    });
    assert.match(readPathFromEnv(enriched), new RegExp(ffmpegBin.replace(/\\/g, "\\\\")));
    assert.deepEqual(discoverManagedEnginePathEntries(root), [ffmpegBin]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
