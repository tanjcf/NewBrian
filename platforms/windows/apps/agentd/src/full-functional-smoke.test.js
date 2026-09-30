import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLocalRuntime } from "./runtime.js";

test("critical workspace, approval, shell, git, and patch journey", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain 全功能 smoke "));
  try {
    const sourcePath = join(root, "中文 文件.txt");
    writeFileSync(sourcePath, "before\n", "utf8");
    const gitInit = spawnSync("git", ["init"], { cwd: root, encoding: "utf8", windowsHide: true });
    assert.equal(gitInit.status, 0, gitInit.stderr);

    const runtime = await createLocalRuntime({
      runtimeId: "full-functional-smoke",
      workspacePath: root,
      platformLabel: "Windows",
      shellLabel: "PowerShell",
      skillRoots: []
    });

    const scan = await runtime.queueWorkspaceScan({ permissionMode: "approval" });
    assert.equal(scan.session.status, "idle");
    assert.equal(scan.runs[0].status, "completed");
    assert.ok(scan.workspace.some((entry) => entry.path === "中文 文件.txt"));

    const git = await runtime.queueGitStatus({ permissionMode: "approval" });
    assert.equal(git.session.status, "idle");
    assert.equal(git.runs[0].status, "completed");
    assert.match(git.runs[0].output, /\?\?/);

    const deniedMarker = join(root, "denied.txt");
    const deniedPending = await runtime.queueShellCommand(
      "Set-Content -LiteralPath 'denied.txt' -Value 'must-not-exist' -Encoding utf8",
      { permissionMode: "approval" }
    );
    assert.equal(deniedPending.session.status, "awaiting-approval");
    const denied = await runtime.respondToApproval(false);
    assert.equal(denied.session.status, "idle");
    assert.equal(existsSync(deniedMarker), false);

    const approvedPending = await runtime.queueShellCommand(
      "Set-Content -LiteralPath 'approved.txt' -Value 'approved' -Encoding utf8",
      { permissionMode: "approval" }
    );
    assert.equal(approvedPending.session.status, "awaiting-approval");
    const approved = await runtime.respondToApproval(true);
    assert.equal(approved.session.status, "idle");
    assert.equal(approved.runs[0].status, "completed");
    assert.match(readFileSync(join(root, "approved.txt"), "utf8"), /approved/);

    const failedPending = await runtime.queueShellCommand(
      "Write-Error 'expected failure'; exit 7",
      { permissionMode: "approval" }
    );
    const failed = failedPending.session.status === "awaiting-approval"
      ? await runtime.respondToApproval(true)
      : failedPending;
    assert.equal(failed.session.status, "failed");
    assert.equal(failed.runs[0].exitCode, 7);
    assert.match(failed.runs[0].output, /expected failure/);

    const proposed = await runtime.generatePatch({
      filePath: "中文 文件.txt",
      searchText: "before",
      replaceText: "after"
    });
    assert.equal(proposed.patch.filePath, "中文 文件.txt");
    assert.match(proposed.patch.hunks[0].preview.join("\n"), /before/);
    assert.equal(readFileSync(sourcePath, "utf8"), "before\n");

    const applied = await runtime.applyPatch();
    assert.equal(applied.patch, undefined);
    assert.equal(applied.runs[0].label, "Apply patch");
    assert.equal(readFileSync(sourcePath, "utf8"), "after\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("patch preview counts all changes and replaces every occurrence", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-patch-counts-"));
  try {
    const sourcePath = join(root, "many.txt");
    writeFileSync(sourcePath, Array.from({ length: 40 }, () => "before").join("\n"), "utf8");
    const runtime = await createLocalRuntime({
      runtimeId: "patch-counts", workspacePath: root,
      platformLabel: "test", shellLabel: "test", skillRoots: []
    });
    const proposed = await runtime.generatePatch({
      filePath: "many.txt", searchText: "before", replaceText: "after"
    });
    assert.equal(proposed.patch.hunks[0].additions, 40);
    assert.equal(proposed.patch.hunks[0].deletions, 40);
    assert.match(proposed.patch.hunks[0].preview.at(-1), /additional changed lines omitted/);
    assert.match(proposed.patch.summary, /40 occurrences/);

    await runtime.applyPatch();
    assert.equal(readFileSync(sourcePath, "utf8").split("after").length - 1, 40);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("patch application refuses to overwrite an externally changed file", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-patch-conflict-"));
  try {
    const sourcePath = join(root, "conflict.txt");
    writeFileSync(sourcePath, "before\n", "utf8");
    const runtime = await createLocalRuntime({
      runtimeId: "patch-conflict", workspacePath: root,
      platformLabel: "test", shellLabel: "test", skillRoots: []
    });
    await runtime.generatePatch({
      filePath: "conflict.txt", searchText: "before", replaceText: "after"
    });
    writeFileSync(sourcePath, "external change\n", "utf8");

    await assert.rejects(runtime.applyPatch(), /changed after the patch was generated/);
    assert.equal(readFileSync(sourcePath, "utf8"), "external change\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("git status keeps Chinese workspace paths human-readable instead of octal escaped", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-git-chinese-"));
  try {
    assert.equal(spawnSync("git", ["init"], { cwd: root, encoding: "utf8", windowsHide: true }).status, 0);
    writeFileSync(join(root, "中文文件.txt"), "content", "utf8");
    const runtime = await createLocalRuntime({
      runtimeId: "git-chinese-path",
      workspacePath: root,
      platformLabel: "Windows",
      shellLabel: "PowerShell",
      skillRoots: []
    });
    const snapshot = await runtime.queueGitStatus({ permissionMode: "approval" });
    assert.match(snapshot.runs[0].output, /中文文件\.txt/);
    assert.doesNotMatch(snapshot.runs[0].output, /\\[0-7]{3}/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
