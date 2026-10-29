import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { buildMsiUpdateRunner } from "./desktop-app-update-runner.ts";

test("runner parses on Windows and backs up before installing without interpolating paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-runner-test-"));
  try {
    const script = buildMsiUpdateRunner({
      msiPath: "C:\\updates\\a & '$test.msi", args: ["/i", "a & '$test.msi", "ALLUSERS="],
      executablePath: "C:\\Program Files\\NewBrain\\NewBrain.exe", processId: 123,
      dataRoot: "C:\\Users\\test\\.newbrain", chatRoot: "C:\\app\\tmp", downloadDir: "C:\\updates",
      backupRoot: "C:\\backup", resultPath: "C:\\updates\\result.json"
    });
    assert.ok(script.indexOf("WaitForExit") < script.indexOf("robocopy.exe"));
    assert.ok(script.indexOf("robocopy.exe") < script.indexOf("& msiexec.exe"));
    assert.match(script, /Stop-Process -Id \$config\.processId -Force/);
    assert.match(script, /\$LASTEXITCODE -ge 8/);
    assert.match(script, /\$LASTEXITCODE -notin @\(0, 3010\)/);
    assert.match(script, /NEWBRAIN_UPDATE_RUNNER=1/);
    assert.doesNotMatch(script, /rmdir|Remove-Item|a & '\$test/);
    const file = join(root, "runner.ps1");
    await writeFile(file, script);
    if (process.platform === "win32") {
      const command = `$t=$null;$e=$null;[System.Management.Automation.Language.Parser]::ParseFile('${file.replaceAll("'", "''")}',[ref]$t,[ref]$e)|Out-Null;if($e.Count){$e|Out-String|Write-Output;exit 1}`;
      execFileSync("powershell.exe", ["-NoProfile", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")], { windowsHide: true });
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("runner really copies user and chat files before calling the installer boundary", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-update-backup-"));
  try {
    const dataRoot = join(root, "profile");
    const chatRoot = join(root, "chat");
    const downloadDir = join(dataRoot, "updates");
    const backupRoot = join(root, "backup");
    const resultPath = join(root, "result.json");
    await mkdir(downloadDir, { recursive: true });
    await mkdir(chatRoot);
    await writeFile(join(dataRoot, "history.json"), '{"threads":["retained-thread"]}');
    await writeFile(join(chatRoot, "artifact.txt"), "retained artifact");
    await writeFile(join(downloadDir, "package.msi"), "excluded download");
    const script = buildMsiUpdateRunner({ msiPath: process.env.NEWBRAIN_TEST_MSI || "unused.msi", fullMsi: Boolean(process.env.NEWBRAIN_TEST_MSI), expectedVersion: "1.4.5", args: [], executablePath: join(root, "absent.exe"), processId: 2147483647, dataRoot, chatRoot, downloadDir, backupRoot, resultPath });
    // Only the installer is substituted; PowerShell, robocopy and disk I/O are real.
    const fixture = `function msiexec.exe { if (-not (Test-Path -LiteralPath (Join-Path $config.backupRoot 'user-data/history.json'))) { throw 'backup missing before install' }; $global:LASTEXITCODE = 0 }\n${script}`;
    const path = join(root, "verify.ps1");
    await writeFile(path, fixture);
    try {
      execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path], { windowsHide: true, timeout: 15000 });
    } catch (error) {
      throw new Error(await readFile(resultPath, "utf8").catch(() => String(error)));
    }
    assert.equal(JSON.parse(await readFile(resultPath, "utf8")).status, "installed");
    assert.equal(await readFile(join(backupRoot, "user-data", "history.json"), "utf8"), await readFile(join(dataRoot, "history.json"), "utf8"));
    assert.equal(await readFile(join(backupRoot, "chat-files", "artifact.txt"), "utf8"), "retained artifact");
    await assert.rejects(readFile(join(backupRoot, "user-data", "updates", "package.msi")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
