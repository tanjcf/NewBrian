import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  _resetShellProcessRegistryForTests,
  clampYieldTimeMs,
  handleShellProcessAction,
  killAllShellProcesses,
  MAX_YIELD_TIME_MS,
  MIN_YIELD_TIME_MS,
  STDIN_CLOSED_MESSAGE,
  WINDOWS_INITIAL_EXEC_YIELD_TIME_FLOOR_MS
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

test("yield time follows the Codex window and does not exceed 30s", () => {
  assert.equal(clampYieldTimeMs(undefined), process.platform === "win32" ? WINDOWS_INITIAL_EXEC_YIELD_TIME_FLOOR_MS : MIN_YIELD_TIME_MS);
  assert.equal(clampYieldTimeMs(60_000), MAX_YIELD_TIME_MS);
  if (process.platform === "win32") {
    assert.equal(clampYieldTimeMs(400), WINDOWS_INITIAL_EXEC_YIELD_TIME_FLOOR_MS);
  } else {
    assert.equal(clampYieldTimeMs(100), MIN_YIELD_TIME_MS);
  }
});

test("shell.exec yieldMs backgrounds a still-running command without killing it", async () => {
  _resetShellProcessRegistryForTests();
  const root = mkdtempSync(join(tmpdir(), "newbrain-shell-yield-"));
  try {
    const registry = createBuiltinToolRegistry();
    const command = process.platform === "win32"
      ? "Start-Sleep -Seconds 45; Write-Output 'done'"
      : "sleep 45; printf 'done\\n'";
    const result = await registry.invoke("shell.exec", {
      command,
      yieldMs: 400
    }, { workspacePath: root, shellEnv: process.env });
    assert.equal(result.ok, true);
    assert.equal(result.background, true);
    assert.equal(result.yielded, true);
    assert.equal(result.status, "running");
    assert.match(result.output, new RegExp(STDIN_CLOSED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await assert.rejects(
      () => handleShellProcessAction({ action: "write", sessionId: result.sessionId, data: "password\n" }),
      new RegExp(STDIN_CLOSED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
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
