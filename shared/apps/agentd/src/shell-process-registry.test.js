import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  _resetShellProcessRegistryForTests,
  handleShellProcessAction,
  killAllShellProcesses
} from "./shell-process-registry.js";
import { createBuiltinToolRegistry } from "./tool-registry.js";

test("shell.exec background + shell.process poll/log/kill lifecycle", async () => {
  _resetShellProcessRegistryForTests();
  const root = mkdtempSync(join(tmpdir(), "newbrain-shell-process-"));
  try {
    const registry = createBuiltinToolRegistry();
    const command = process.platform === "win32"
      ? "Write-Output 'tick-1'; Start-Sleep -Seconds 8; Write-Output 'tick-2'"
      : "printf 'tick-1\\n'; sleep 8; printf 'tick-2\\n'";
    const started = await registry.invoke("shell.exec", {
      command,
      background: true
    }, { workspacePath: root, shellEnv: process.env });
    assert.equal(started.ok, true);
    assert.equal(started.background, true);
    assert.ok(started.sessionId);

    const listed = await registry.invoke("shell.process", { action: "list" }, {
      workspacePath: root,
      shellEnv: process.env
    });
    assert.equal(listed.ok, true);
    assert.ok(listed.sessions.some((session) => session.sessionId === started.sessionId));

    const polled = await handleShellProcessAction({
      action: "poll",
      sessionId: started.sessionId,
      timeout: 2000
    });
    assert.equal(polled.ok, true);
    assert.match(String(polled.output), /tick-1|status=running|status=exited/);

    const killed = await registry.invoke("shell.process", {
      action: "kill",
      sessionId: started.sessionId
    }, { workspacePath: root, shellEnv: process.env });
    assert.equal(killed.ok, true);

    const after = await handleShellProcessAction({
      action: "poll",
      sessionId: started.sessionId,
      timeout: 500
    });
    assert.equal(after.status, "exited");

    const viaAlias = await registry.invoke("process", { action: "list" }, {
      workspacePath: root,
      shellEnv: process.env
    });
    assert.equal(viaAlias.ok, true);
  } finally {
    await killAllShellProcesses();
    _resetShellProcessRegistryForTests();
    rmSync(root, { recursive: true, force: true });
  }
});

test("shell.exec yieldMs backgrounds a still-running command", async () => {
  _resetShellProcessRegistryForTests();
  const root = mkdtempSync(join(tmpdir(), "newbrain-shell-yield-"));
  try {
    const registry = createBuiltinToolRegistry();
    const command = process.platform === "win32"
      ? "Start-Sleep -Seconds 5; Write-Output 'done'"
      : "sleep 5; printf 'done\\n'";
    const result = await registry.invoke("shell.exec", {
      command,
      yieldMs: 400
    }, { workspacePath: root, shellEnv: process.env });
    assert.equal(result.ok, true);
    assert.equal(result.background, true);
    assert.equal(result.yielded, true);
    assert.ok(result.sessionId);
    await registry.invoke("shell.process", {
      action: "kill",
      sessionId: result.sessionId
    }, { workspacePath: root, shellEnv: process.env });
  } finally {
    await killAllShellProcesses();
    _resetShellProcessRegistryForTests();
    rmSync(root, { recursive: true, force: true });
  }
});
