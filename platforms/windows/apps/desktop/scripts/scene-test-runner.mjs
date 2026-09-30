#!/usr/bin/env node
/**
 * Execute scene test catalog operations one-by-one with ledger + report output.
 * Usage:
 *   node scripts/scene-test-runner.mjs [scene|all] [--from=opId] [--limit=N] [--continue] [--fresh-ledger]
 */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSceneTestCdpClient } from "./scene-test-cdp-client.mjs";
import { executeCatalogOp } from "./scene-test-op-executor.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "../../../../../");
const catalogDir = join(repoRoot, "docs/evidence/scene-tests/catalog");
const evidenceRoot = join(repoRoot, "docs/evidence/scene-tests");
const scenes = ["quant", "game", "video", "music", "data", "software", "document"];

const args = process.argv.slice(2);
const sceneArg = args.find((item) => !item.startsWith("--")) || "game";
const fromOpId = args.find((item) => item.startsWith("--from="))?.slice(7);
const freshLedger = args.includes("--fresh-ledger");
const continueOnBlocking = args.includes("--continue");
const limit = Number(args.find((item) => item.startsWith("--limit="))?.slice(8) || 0);
const debugPort = Number(process.env.NEWBRAIN_SCENE_TEST_DEBUG_PORT || 9350);

async function loadCatalog(scene) {
  const path = join(catalogDir, `${scene}.json`);
  return JSON.parse(await readFile(path, "utf8"));
}

async function runScene(scene, cdp) {
  const catalog = await loadCatalog(scene);
  const outDir = join(evidenceRoot, scene);
  await mkdir(outDir, { recursive: true });
  const ledgerPath = join(outDir, "ledger.jsonl");
  if (freshLedger) await writeFile(ledgerPath, "", "utf8");
  const startedAt = new Date().toISOString();
  const results = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let started = !fromOpId;

  const ctx = {
    scene,
    displayName: catalog.displayName,
    cdp,
    state: {
      uniqueProjectName: null
    }
  };

  await cdp.waitForAppReady();
  await cdp.switchWorkspace(scene);

  for (let index = 0; index < catalog.operations.length; index += 1) {
    const op = catalog.operations[index];
    if (!started) {
      if (op.opId === fromOpId) started = true;
      else continue;
    }
    if (limit > 0 && results.length >= limit) break;

    const entryStarted = Date.now();
    const record = {
      index: index + 1,
      opId: op.opId,
      title: op.title,
      precondition: op.precondition,
      steps: op.steps,
      expected: op.expected,
      automation: op.automation,
      blocking: op.blocking,
      scene,
      startedAt: new Date(entryStarted).toISOString()
    };

    try {
      if (op.automation === "MANUAL") {
        throw new Error("MANUAL operation cannot be auto-passed");
      }
      const observation = await executeCatalogOp(ctx, op);
      record.status = "PASS";
      record.durationMs = Date.now() - entryStarted;
      record.observation = observation;
      passed += 1;
    } catch (error) {
      record.status = op.automation === "NATIVE" ? "SKIP" : "FAIL";
      record.durationMs = Date.now() - entryStarted;
      record.error = error instanceof Error ? error.message : String(error);
      if (record.status === "SKIP") skipped += 1;
      else failed += 1;
      if (op.blocking && record.status === "FAIL") {
        record.blockingFailure = true;
      }
    }

    results.push(record);
    await appendFile(ledgerPath, `${JSON.stringify(record)}\n`, "utf8");
    console.log(`${record.status} ${record.opId} ${record.title}${record.error ? ` :: ${record.error}` : ""}`);

    if (record.blockingFailure) {
      console.error(`BLOCKING FAIL at ${op.opId}${continueOnBlocking ? " (continuing)" : ""}`);
      if (!continueOnBlocking) break;
    }
  }

  const report = {
    scene,
    displayName: catalog.displayName,
    catalogVersion: catalog.version,
    totalOperations: catalog.totalOperations,
    executed: results.length,
    passed,
    failed,
    skipped,
    startedAt,
    finishedAt: new Date().toISOString(),
    go: failed === 0 && !results.some((item) => item.blockingFailure),
    results
  };
  await writeFile(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function main() {
  const targetScenes = sceneArg === "all" ? scenes : [sceneArg];
  const cdp = await createSceneTestCdpClient(debugPort);
  const reports = [];
  try {
    for (const scene of targetScenes) {
      console.log(`\n===== SCENE ${scene} =====`);
      reports.push(await runScene(scene, cdp));
    }
  } finally {
    await cdp.close({ preserveWorkspace: true });
  }
  const summaryPath = join(evidenceRoot, "summary.json");
  await writeFile(summaryPath, `${JSON.stringify({ finishedAt: new Date().toISOString(), reports }, null, 2)}\n`, "utf8");
  const bad = reports.filter((item) => !item.go);
  console.log(JSON.stringify({ ok: bad.length === 0, reports: reports.map((item) => ({ scene: item.scene, executed: item.executed, passed: item.passed, failed: item.failed, skipped: item.skipped, go: item.go })) }, null, 2));
  process.exit(bad.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
