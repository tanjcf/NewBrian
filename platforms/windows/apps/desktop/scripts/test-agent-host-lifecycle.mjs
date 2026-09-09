import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const desktopRoot = resolve(import.meta.dirname, "..");
const hostEntry = join(desktopRoot, "out", "main", "agent-host-entry.js");
const fixtureEntry = join(desktopRoot, "scripts", "agent-host-child-fixture.mjs");
const tempRoot = await mkdtemp(join(tmpdir(), "newbrain-agent-host-"));
const pidFile = join(tempRoot, "child.pid");
const host = fork(hostEntry, [], { cwd: desktopRoot, stdio: ["ignore", "pipe", "pipe", "ipc"] });
let nextId = 1;

function request(method, payload = {}, timeoutMs = 5_000) {
  const id = `integration_${nextId++}`;
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
    const onMessage = (message) => {
      if (message?.kind !== "response" || message.id !== id) return;
      clearTimeout(timer);
      host.off("message", onMessage);
      if (message.ok) resolvePromise(message.result);
      else reject(Object.assign(new Error(message.error?.message ?? "Host request failed"), { code: message.error?.code }));
    };
    host.on("message", onMessage);
    host.send({ version: 1, kind: "request", id, method, payload });
  });
}

async function waitFor(check, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch { /* retry until deadline */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error("Condition did not become true before timeout.");
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

try {
  const health = await request("mcp.start", {
    server: {
      id: "lifecycle-fixture",
      name: "Lifecycle fixture",
      transport: "stdio",
      command: process.execPath,
      args: [fixtureEntry, pidFile],
      env: {},
      enabled: true
    }
  });
  assert.equal(health.running, true);
  await waitFor(async () => Boolean((await readFile(pidFile, "utf8")).trim()));
  const childPid = Number((await readFile(pidFile, "utf8")).trim());
  assert.equal(isAlive(childPid), true);

  const hostExit = new Promise((resolvePromise) => host.once("exit", resolvePromise));
  await request("host.shutdown");
  await hostExit;
  await waitFor(() => !isAlive(childPid));
  assert.equal(isAlive(host.pid), false);
  assert.equal(isAlive(childPid), false);
  console.log(`agent host lifecycle passed: host=${host.pid}, child=${childPid}`);
} finally {
  if (host.exitCode === null) host.kill("SIGKILL");
  await rm(tempRoot, { recursive: true, force: true });
}
