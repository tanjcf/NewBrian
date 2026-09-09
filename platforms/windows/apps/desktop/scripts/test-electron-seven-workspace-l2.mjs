import { execSync, spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));

function stopStaleElectronSessions() {
  if (process.platform === "win32") {
    try { execSync("taskkill /F /IM electron.exe /T", { stdio: "ignore" }); } catch { /* no stale process */ }
    return;
  }
  try { execSync("pkill -f electron || true", { stdio: "ignore", shell: true }); } catch { /* no stale process */ }
}

const suites = [
  { name: "workspace-section-restart", script: "test-electron-workspace-section-restart.mjs", port: 9340 },
  { name: "quant", script: "test-electron-quant-workspace.mjs", port: 9343 },
  { name: "data", script: "test-electron-data-workspace.mjs", port: 9342 },
  { name: "flow", script: "test-electron-flow-workspace.mjs", port: 9344 },
  { name: "document-revision", script: "test-electron-brain-document-revision.mjs", port: 9345 },
  { name: "pdf-annotation", script: "test-electron-brain-pdf-annotation.mjs", port: 9346 },
  { name: "media", script: "test-electron-media-workspace.mjs", port: 9347 },
  { name: "game", script: "test-electron-game-workspace.mjs", port: 9341 },
  { name: "game-template", script: "test-electron-game-template.mjs", port: 9348 },
  { name: "engine-auto-install", script: "test-electron-engine-auto-install.mjs", port: 9349 }
];

const results = [];
stopStaleElectronSessions();
for (const suite of suites) {
  stopStaleElectronSessions();
  const scriptPath = join(scriptDir, suite.script);
  const startedAt = Date.now();
  const child = spawnSync(process.execPath, [scriptPath], {
    env: { ...process.env, NEWBRAIN_E2E_REMOTE_DEBUG_PORT: String(suite.port), NEWBRAIN_E2E_FORCE_FRESH: "1" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  results.push({
    suite: suite.name,
    script: suite.script,
    ok: child.status === 0,
    durationMs: Date.now() - startedAt,
    stdout: child.stdout?.slice(-4000) || "",
    stderr: child.stderr?.slice(-2000) || ""
  });
  if (child.status !== 0) {
    const payload = { ok: false, caseId: "BRAIN-SEVEN-WORKSPACE-L2-E2E", failed: suite.name, suites: results.length, results };
    console.error(JSON.stringify(payload, null, 2));
    await writeEvidence(payload);
    process.exit(child.status || 1);
  }
}

const success = { ok: true, caseId: "BRAIN-SEVEN-WORKSPACE-L2-E2E", suites: results.length, results };
console.log(JSON.stringify(success, null, 2));
await writeEvidence(success);

async function writeEvidence(payload) {
  await writeFile(join(process.cwd(), "seven-workspace-l2-run.json"), `${JSON.stringify(payload, null, 2)}\n`).catch(() => undefined);
}
